# SendBlue → Blooio migration + new-conversation throttle — design

**Date:** 2026-06-01
**Status:** Draft design (pre-plan) — for review
**Branch:** `blooio-migration` (stacked on `sequence-stop-conditions`; that PR's provider-agnostic engine — opt-outs, scheduled-messages, sequences, console, Close sync — is unchanged here)
**Topic:** Replace SendBlue (whose $100 plan is inbound/reply-only) with Blooio for outbound iMessage, behind a provider interface, plus a daily new-conversation throttle + backfill queue so we stay under Blooio's shared-plan cap.

## Context & why

SendBlue's $100 tier is inbound-first (reply-to-inbound only); real SendBlue outbound starts ~$1,000/mo/line. Our drip + reminder features are *proactive* outbound, so we move to Blooio. Blooio **Commercial Shared** is $89/mo flat, unlimited messages, but caps **new conversations/day** on shared numbers (~15/day). Current organic volume is ~5 new leads/day, and there are **115 existing leads** to (re)engage — so we add a throttle + backfill queue rather than paying for a dedicated number up front.

## Blooio API (confirmed from docs)

- **Send:** `POST https://backend.blooio.com/v2/api/chats/{chatId}/messages`, `Authorization: Bearer <BLOOIO_API_KEY>`. `chatId` = recipient phone in E.164 — **auto-creates the chat, no separate create call**. Body: `{ "text", "attachments": ["url"], "from_number": "<line>", "Idempotency-Key": "<uuid>" }`.
- **Inbound webhook events:** `message.received` (`sender`, `internal_id` = our line, `text`, `attachments[]`, `message_id`, `external_id`, `received_at` ms, `is_group`, `group_id/name`); `message.reaction` (`direction`, `reaction` ∈ love/like/dislike/laugh/emphasize/question, `action` add/remove, `sender`, `original_text`, `message_id`); `message.delivered/read/failed` (`delivered_at`/`read_at`/`error_code`+`error_message`).
- **Signature:** `X-Blooio-Signature: t=<unix>,v1=<hmac_sha256_hex>` over `"{t}.{rawBody}"`, secret `whsec_…` (shown once at webhook creation; rotate via `POST /webhooks/{id}/secret/rotate`); 5-min replay window. **Identical scheme to `lib/calendly.js`** — reuse the `readRawBody` + verify pattern.
- Reaction vocabulary matches our current `REACTION_KEYS` exactly.

## Goals
1. All outbound iMessage goes through Blooio, behind a thin **provider interface** (swappable, env-selected).
2. Inbound (messages + reactions) arrives via Blooio webhooks, **signature-verified**, and feeds the *existing* STOP/suppress/pause + logging pipeline unchanged.
3. A **daily new-conversation throttle** keeps us under Blooio's shared cap; a **backfill queue** drains the 115 existing leads gradually.
4. **Zero change** to the provider-agnostic engine (sequences, opt-outs, scheduled-messages, Close sync, console UI).

## Non-goals
- Dedicated number now (start shared $89 + throttle; upgrade to dedicated $289 — which removes the cap — when organic volume nears it; the throttle remains the safety net).
- Long-term dual-provider support (we cut over; brief parallel run during migration only).
- RCS/SMS fallback (Blooio supports it; out of scope this pass).

## Architecture

### Provider interface (swappable)
- New `lib/imessage-provider.js`: re-exports `sendMessage` / `sendReaction` / `normalizePhone` from the active provider, chosen by `IMESSAGE_PROVIDER` env (`blooio` default; `sendblue` retained as fallback).
- `lib/imessage-bridge.js`: change its import from `./sendblue.js` → `./imessage-provider.js`. `sendImessage`'s signature/behavior is unchanged, so the cron, console reply, and `/send` + `/outbound` endpoints don't change, and **the STOP suppression guard stays exactly where it is**.

### Blooio client — `lib/blooio.js`
- `sendMessage({ phone, message, mediaUrl, fromNumber })` → `POST /chats/{E164(phone)}/messages` with `{ text, attachments: mediaUrl ? [mediaUrl] : undefined, from_number, 'Idempotency-Key': <uuid> }`, Bearer `BLOOIO_API_KEY`. Returns `{ message_handle: <message_id> }` (shape-matched to what `imessage-bridge` already expects).
- `sendReaction(...)` → Blooio reaction endpoint (confirm exact path in API ref during build).
- Base URL + auth centralized; env `BLOOIO_API_KEY`, optional `BLOOIO_FROM_NUMBER`.

### Inbound — `api/imessage/inbound.js` (new path)
- `bodyParser` off; read raw body; verify `X-Blooio-Signature` (HMAC over `{t}.{rawBody}`, `BLOOIO_WEBHOOK_SIGNING_SECRET`, 5-min window). **Extract the shared verify into `lib/hmac-signature.js`** and have both Calendly and Blooio use it.
- Branch by `event`:
  - `message.received` → map `{ sender→phone, text→message, attachments[0]→mediaUrl, message_id→handle }`, then feed the **existing** pipeline verbatim: `findLeadByPhone` → STOP detection / `suppressPhone` / `unenrollAllForLead` (Behavior 3) → `logImessageActivity` → `pauseEnrollmentsForLead` → push.
  - `message.reaction` → existing reaction-persist + push (same keys).
  - `message.failed` → record to `lead_sync_errors`; `delivered`/`read` → optional logging (minimal v1).
- Point Blooio's webhook at `https://lushfulcontent.vercel.app/api/imessage/inbound`. Leave `/api/sendblue/inbound` until cutover.

### New-conversation throttle — `lib/new-convo-throttle.js` + table
Blooio's shared cap is on **opening new conversations** (first outbound to a recipient). Replies and later drip steps to an already-contacted phone don't count.

- New table `imessage_contacts (phone text primary key, first_contacted_at timestamptz not null default now())`, index on `first_contacted_at`.
- `isNewConversation(phone)` → true if no row.
- `newConvosToday(now)` → count rows with `first_contacted_at >= start-of-UTC-day(now)`.
- `tryReserveNewConversation(phone, cap)` → if already contacted → `{ ok:true, isNew:false }`; else if `newConvosToday < cap` → insert row (on-conflict-do-nothing) → `{ ok:true, isNew:true }`; else `{ ok:false, reason:'daily-cap' }`.
- Cap = `IMESSAGE_NEW_CONVO_DAILY_CAP` (default **14**, headroom under the assumed 15).

### Where the throttle gates (first-contact sends only)
`sendImessage` is **not** the gate (it also sends replies). The gate lives in the *initiating* callers, all of which run in the cron:
- **Drip step send (`fireOne`)**: before sending, if `isNewConversation(phone)` → `tryReserveNewConversation`; if it defers, skip this tick (leave the enrollment active; retry next tick/day). If not new (step 2+) → send normally, no gate.
- **Scheduled-message (reminder) send**: same gate (a reminder to a never-contacted lead opens a conversation; to an already-dripped lead it doesn't).
- **Backfill drain**: same budget.
- **Console manual reply / reply-to-inbound**: **never gated** (replying to someone who texted us is not a new conversation).

Net effect: each tick, `remaining = cap − newConvosToday`, and only that many new conversations open; replies and continuations always flow.

### Backfill of the 115 existing leads
- One-time enqueue: the 115 leads into a single-step **reactivation sequence** (reuse the sequence engine), ordered warmest-first. The cron's first-send per lead is a new conversation, gated by the throttle, so backfill self-paces at ≤ `(cap − organic)` per day (~10/day → ~12 days). Organic new leads (~5/day) naturally take priority because they enroll/contact in real time; backfill fills the remaining budget.

## Data model (new)
- `imessage_contacts(phone PK, first_contacted_at)` — throttle accounting (index on `first_contacted_at`).

## Files
**New:** `lib/blooio.js`, `lib/imessage-provider.js`, `lib/new-convo-throttle.js`, `lib/hmac-signature.js` (shared with Calendly), `api/imessage/inbound.js`, `supabase/migrations/<ts>_imessage_contacts.sql`, + tests for each.
**Changed:** `lib/imessage-bridge.js` (import provider interface), `api/cron/sequence-tick.js` (throttle-gate first-contact sends + backfill drain), `lib/calendly.js` (use shared hmac util), `.env.example` (`IMESSAGE_PROVIDER`, `BLOOIO_API_KEY`, `BLOOIO_WEBHOOK_SIGNING_SECRET`, `BLOOIO_FROM_NUMBER?`, `IMESSAGE_NEW_CONVO_DAILY_CAP`), health check.
**Unchanged:** sequences engine, opt-outs, scheduled-messages core, Close sync, console UI, everything in the stop-conditions PR.

## Cutover
1. Blooio account → Commercial Shared; create API key + webhook (capture the one-time `whsec_`); set Vercel env.
2. Deploy with `IMESSAGE_PROVIDER=blooio`; point Blooio webhook → `/api/imessage/inbound`.
3. Smoke test: one outbound + one inbound; verify signature, STOP, suppression, throttle accounting.
4. Number: **port the SendBlue number to Blooio** (3–5 business days) so the 115 leads see the same number — or start on a Blooio number (open question).
5. Once verified, decommission SendBlue (`IMESSAGE_PROVIDER` flag flips back if needed; remove `lib/sendblue.js` + `/api/sendblue/*` later).

## Testing (TDD)
- `lib/__tests__/blooio.test.js` — send → `/chats/{phone}/messages`, Bearer, attachments, idempotency, error handling.
- `lib/__tests__/new-convo-throttle.test.js` — isNew; newConvosToday window; tryReserve (new-under-cap reserves+inserts; already-contacted ok no-count; over-cap defers); boundary.
- `api/__tests__/imessage-inbound.test.js` — signature accept/reject + replay; `message.received` → STOP/suppress + log + pause; reaction; failed→error log.
- `lib/__tests__/hmac-signature.test.js` — shared verify vectors; confirm Calendly tests still green after the extract.
- `api/cron/__tests__/sequence-tick.test.js` — first-contact send deferred when budget exhausted (enrollment stays active); reply/step-2 not gated; backfill drains ≤ remaining budget.
- Provider interface routes `imessage-bridge` through the selected provider.

## Open questions (please confirm)
1. **Number:** port the existing SendBlue iMessage number to Blooio (continuity + brand for the 115), or start fresh on a Blooio number? *(Recommend port.)*
2. **Exact cap + counting:** Blooio's rate-limit doc 404'd. We guard with our own cap (default 14). Confirm Blooio's real shared-plan cap and how they count a "new conversation" (first-ever message vs first-in-day), then set `IMESSAGE_NEW_CONVO_DAILY_CAP`.
3. **Backfill order + copy:** which of the 115 first (recency / booked-no-show?) and the reactivation message text.
4. **Dedicated upgrade trigger:** upgrade to dedicated ($289, cap removed) when organic new leads regularly approach the cap. Throttle stays as the guard either way.
