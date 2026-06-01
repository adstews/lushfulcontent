# iMessage sequence stop conditions — design

**Date:** 2026-06-01
**Status:** Approved design (pre-plan)
**Branch:** `sequence-stop-conditions`
**Topic:** Stop the drip when a lead replies (pause), books (unenroll), or texts STOP (permanent opt-out — never text again).

## Context

The iMessage sequence engine (`lib/sequences.js`, `api/cron/sequence-tick.js`) runs drip campaigns: leads are enrolled, a Vercel cron fires due steps every 5 minutes, and every outbound send funnels through `sendImessage()` in `lib/imessage-bridge.js`. Today:

- **Replies already pause.** `api/sendblue/inbound.js` calls `pauseEnrollmentsForLead()` on every non-STOP inbound, honoring each sequence's `on_reply_behavior` (`pause` default | `unenroll` | `continue`).
- **STOP already unenrolls current sequences.** `isStopKeyword()` → `unenrollAllForLead()`. But only when the inbound matches a Close lead, and with no persistent record — so a later status trigger can re-enroll and re-text the person.
- **Bookings already set a Close status.** `api/calendly-webhook.js` and `api/lead-update.js` flip the lead to `CLOSE_STATUS_CALL_BOOKED` (Calendly) or `CLOSE_STATUS_APPT_BOOKED` (Boulevard). A Close `lead.updated` webhook (`api/sendblue/close-webhook.js`) already receives status changes and auto-*enrolls* on matching triggers — but never unenrolls.

## Goals

1. Any inbound reply pauses the lead's active sequences (resumable). *Already built — verify only.*
2. A booking permanently unenrolls the lead from all sequences.
3. STOP permanently opts the number out: unenroll now **and** never text again — no future enrollment and no sends of any kind (automated or manual console), even if the texter is not yet a Close lead.

## Non-goals

- No in-app un-suppress / opt-back-in path. Reversal is a manual DB delete. *(User decision: hard block, no override.)*
- No START/UNSTOP keyword handling.
- No change to `on_reply_behavior` semantics or the pause→resume mechanics.
- STOP opt-out confirmation text: off by default (see Open question).

## Behavior 1 — Reply → pause (verify only, no code)

Pause-on-reply is the existing default. The work is verification, not building:

- The SendBlue inbound webhook is configured to POST `/api/sendblue/inbound` in production.
- The live scheduling sequences have `on_reply_behavior = 'pause'` (not `'continue'`). Flip any set to `continue`.

If verification surfaces a gap that config can't fix, reopen this section.

## Behavior 2 — Booking → unenroll

Extend `api/sendblue/close-webhook.js`. After resolving `newStatusId`, before the enroll branch:

```
stopStatusIds = [CLOSE_STATUS_CALL_BOOKED, CLOSE_STATUS_APPT_BOOKED]   // env, filtered to those actually set
if (newStatusId is in stopStatusIds) {
  await unenrollAllForLead(leadId, 'booked')
  return 200 { ok: true, leadId, statusId: newStatusId, unenrolled: true }
}
```

- Single chokepoint: every booking path (Calendly webhook, client-side ping, manual Close UI change, Close workflow) ends in a status flip → `lead.updated` → here.
- Precedence: a stop-status transition unenrolls and returns; it never also enrolls.
- Idempotent: `unenrollAllForLead` only touches `active`/`paused` rows, so repeat deliveries are no-ops.
- Webhook latency (seconds) is irrelevant against a 5-minute cron.

## Behavior 3 — STOP → opt-out (hard, everywhere)

### Data model — new table `imessage_opt_outs`

| column | type | notes |
|---|---|---|
| `phone` | text, primary key | normalized E.164 (via `normalizePhone`) |
| `close_lead_id` | text, null | set when the inbound matched a Close lead |
| `reason` | text | e.g. `stop-keyword` |
| `created_at` | timestamptz, default now() | |

Migration: `supabase/migrations/<ts>_imessage_opt_outs.sql` (timestamp assigned at implementation). Index on `close_lead_id` for enroll-time lookup by lead.

### New lib `lib/opt-outs.js`

- `suppressPhone({ phone, leadId, reason })` — upsert by `phone` (idempotent). No-op if the phone can't be normalized.
- `isSuppressed({ phone, leadId })` — true if a row matches the normalized phone OR the `close_lead_id`. Either identifier is sufficient.

### Enforcement points

| Location | Change |
|---|---|
| `api/sendblue/inbound.js` | Move STOP detection **above** the `findLeadByPhone` gate. On STOP: `suppressPhone({ phone, leadId: lead?.closeLeadId, reason: 'stop-keyword' })` (works with no lead), then `unenrollAllForLead` when a lead is known. Still log the inbound + push when a lead matched. |
| `lib/imessage-bridge.js` → `sendImessage()` | After `normalizePhone`, `if (await isSuppressed({ phone: normalized })) throw new Error('recipient opted out (STOP)')` before calling `sendMessage`. The one chokepoint all sends share. |
| `lib/sequences.js` → `enrollLead()` | At the top, `if (await isSuppressed({ phone, leadId })) return { skipped: 'opted-out' }`. Blocks status-trigger and manual re-enrollment. |
| `api/cron/sequence-tick.js` → `fireOne()` | Treat a thrown "opted out" from `sendImessage` as terminal: record the send row with the error and `unenrollAllForLead` (defensive; the enroll guard should prevent reaching here). |
| `api/sendblue/console/thread.js` | Add `optedOut: boolean` to the response (`isSuppressed` on the reply phone / lead). |
| `imessage.html` | When `optedOut`, show an "⛔ Opted out (STOP)" banner and disable the composer + attach button. |
| `api/sendblue/send.js`, `api/sendblue/outbound.js` | Verify both route through `sendImessage` (covered by the guard). If either calls `sendMessage` directly, reroute through `sendImessage`. |

A suppressed thread is read-only in the console: banner + disabled composer, no un-suppress control (per the hard-block decision).

## Error handling & idempotency

- `suppressPhone` upserts on the `phone` PK → safe on repeated STOPs.
- Booking unenroll is a no-op on terminal enrollments.
- The `sendImessage` guard throws a typed error; `fireOne` records it without crashing, and `api/sendblue/console/reply.js` surfaces it as a 4xx with a clear message.
- All webhooks keep returning 200 on handled/duplicate cases so Close and SendBlue do not retry-storm.

## Edge cases

- STOP from a number with no Close lead → still suppressed (phone-keyed).
- A suppressed lead later changing Close status → `enrollLead` skips; no texts.
- Same person, new Close lead id, same phone → phone match still suppresses.
- Media-only / reaction inbounds are not STOP (`STOP_REGEX` requires matching text) → unaffected.
- Phone normalization is centralized (`normalizePhone`) so opt-out keys and send keys always match.

## Testing (TDD, vitest, mirroring existing `__tests__`)

- `lib/__tests__/opt-outs.test.js` — suppress upsert idempotency; `isSuppressed` by phone and by leadId; normalization.
- `api/sendblue/__tests__/inbound.test.js` — STOP with a matched lead (suppress + unenroll); STOP with **no** lead (suppress only); non-STOP reply unaffected.
- `api/sendblue/__tests__/close-webhook.test.js` — booked status → unenroll, no enroll; non-stop status → existing enroll path intact.
- `lib/__tests__/imessage-bridge.test.js` — `sendImessage` throws for a suppressed phone, sends otherwise.
- `lib/__tests__/sequences.test.js` — `enrollLead` skips when suppressed.

## Ops / verification checklist

- Close `lead.updated` webhook subscription is live and delivers the booked statuses to `/api/sendblue/close-webhook`.
- SendBlue inbound webhook is live to `/api/sendblue/inbound`.
- `CLOSE_STATUS_CALL_BOOKED` and `CLOSE_STATUS_APPT_BOOKED` are set in Vercel production.
- Apply the `imessage_opt_outs` migration to the Supabase project.

## Open question (minor)

STOP opt-out confirmation text ("You're unsubscribed and won't receive further messages"): default **off**, to honor "never text again." CTIA permits a single confirmation — flip on if desired (it would send before the suppression row is written, so it bypasses the guard).

## File summary

**New:** `supabase/migrations/<ts>_imessage_opt_outs.sql`, `lib/opt-outs.js`, `lib/__tests__/opt-outs.test.js`.

**Changed:** `api/sendblue/close-webhook.js`, `api/sendblue/inbound.js`, `lib/imessage-bridge.js`, `lib/sequences.js`, `api/cron/sequence-tick.js`, `api/sendblue/console/thread.js`, `imessage.html`, and `api/sendblue/send.js` / `api/sendblue/outbound.js` if either bypasses `sendImessage`.

No new environment variables — booked statuses reuse the existing `CLOSE_STATUS_*` vars; opt-out state is table-driven.
