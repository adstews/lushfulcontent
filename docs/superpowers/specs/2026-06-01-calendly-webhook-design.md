# Calendly → Close booking webhook — design

**Date:** 2026-06-01
**Status:** Approved design (pre-plan)
**Topic:** Capture Calendly bookings server-side and mark the lead "Call Booked" in Close.

## Context

When someone books the consult on Calendly, the only thing that updates Close
today is a client-side ping: the booking pages listen for the
`calendly.event_scheduled` `postMessage` and POST `cta_clicked: 'book-calendly'`
to `/api/lead-update`, which flips the lead to **Call Booked** and sets the
`Booked` custom field to `Call` (see `api/lead-update.js`).

Two gaps follow from relying on the browser event:

1. **Direct bookings are dropped.** The listener is guarded by
   `if (window.__leadId || window.__closeLeadId)`. Anyone who reaches Calendly
   without coming through the qualifier funnel (organic link, retargeting, a
   forwarded link) books a call and Close never hears about it.
2. **The Calendly form answers are never captured.** The browser
   `event_scheduled` message contains only event/invitee URIs — not the name,
   email, phone, or question answers the invitee typed. Those live only in
   Calendly's server-side `invitee.created` payload.

A server-side Calendly webhook closes both gaps and becomes the source of truth.

## Goals

- Receive Calendly `invitee.created` server-side, verified by signature.
- Mark the matching Close lead **Call Booked** (status + `Booked` = `Call`).
- Capture the Calendly answers (Q&A, scheduled time, event type) on the Close
  lead timeline.
- Never miss a booking: when no lead matches, create one (tagged
  `calendly-direct`). The email link is bare, so all created leads share that
  bucket — identity comes from Calendly's own booking form, not the link.
- Handle **email-link bookings where the recipient never did the form**, even
  when the link is bare — the webhook is account-level and fires for those too;
  match to an existing Close lead by the email the invitee types, else create.
- Be idempotent against Calendly's webhook retries.

## Non-goals (this iteration)

- `invitee.canceled` / reschedule handling. **Decision: ignore for now.** The
  design keeps this to a single added event subscription + one handler branch
  later.
- Changing the existing client-side `book-calendly` ping. It stays as-is — it
  fires the Meta Pixel `Schedule` event and gives instant feedback. The webhook
  is the authoritative, idempotent backstop; double-writes are harmless.

## Architecture

### New files

| File | Purpose |
|------|---------|
| `api/calendly-webhook.js` | HTTP handler: verify signature, route, resolve lead, write to Close, dedup. Thin. |
| `lib/calendly.js` | `verifySignature(rawBody, header, key)` + `parseInviteeCreated(payload)` — pure, unit-testable, no HTTP. |
| `api/__tests__/calendly-webhook.test.js` | Handler tests (vitest), mocking `lib/close.js`, `lib/supabase.js`, `lib/calendly.js`. |
| `lib/__tests__/calendly.test.js` | Signature + parser unit tests with known vectors. |
| `supabase/migrations/<ts>_calendly_bookings.sql` | Dedup table. |
| `docs/calendly-setup.md` | One-time subscription registration steps (mirrors `docs/sendblue-setup.md`). |

### Changed files

| File | Change |
|------|--------|
| `lib/close.js` | Add `findLeadByEmail(email)` and `createNote({ leadId, note })`. |
| `girthfill-form.html`, `girthfill-form-google.html` | Prefill the visitor's name/email into the Calendly widget (funnel flow; details below). |
| `.env.example` | Document `CALENDLY_WEBHOOK_SIGNING_KEY`. |

## Calendly `invitee.created` payload — fields we use

```jsonc
{
  "event": "invitee.created",
  "payload": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "text_reminder_number": "+15551234567",   // phone, if SMS reminders on
    "timezone": "America/New_York",
    "uri": ".../scheduled_events/EVT/invitees/INV", // unique → dedup key
    "questions_and_answers": [
      { "question": "Phone number", "answer": "(555) 123-4567", "position": 0 }
    ],
    "tracking": {                                  // forwarded from the booking link
      "utm_source": "email", "utm_medium": "...", "utm_campaign": "...",
      "utm_content": "...", "utm_term": "..."
    },
    "scheduled_event": {
      "name": "30 Minute Meeting",
      "start_time": "2026-06-03T18:00:00Z",
      "end_time": "2026-06-03T18:30:00Z"
    }
  }
}
```

Phone is best-effort: prefer `text_reminder_number`, else the first
`questions_and_answers` entry whose question matches `/phone/i`.

## Request handling flow

`api/calendly-webhook.js`, POST only:

1. **Read the raw body** by buffering the request stream. The handler must NOT
   read `req.body` — the HMAC is computed over the exact raw bytes, and a
   re-serialized `req.body` is not byte-identical.
2. **Verify signature** via `lib/calendly.verifySignature(raw, header, key)`
   using `CALENDLY_WEBHOOK_SIGNING_KEY`. Invalid → `401`. If the key env var is
   unset, fail closed (`401`) — we never want unverified writes to Close.
3. Parse the raw body as JSON. If `event !== 'invitee.created'` → `200`
   `{ skipped }`.
4. **Dedup:** if the invitee `uri` already exists in `calendly_bookings` → `200`
   `{ skipped: 'already processed' }`.
5. **Resolve the lead** (precedence below).
6. **Write to Close:** status → `CALL_BOOKED`, `Booked` → `Call`; created direct
   leads also set `Source` → `calendly-direct`. Then `createNote` with the
   booking summary + Q&A.
7. **Record** the `calendly_bookings` row, then `200` `{ ok: true }`.
8. Any failure in steps 5–7 → record in `lead_sync_errors` and return `500` so
   Calendly retries (step 4 makes the retry safe once a prior attempt fully
   succeeded).

### Response codes

| Condition | Code |
|-----------|------|
| Non-POST | 405 |
| Bad/missing signature | 401 |
| Not `invitee.created` | 200 (skipped) |
| Already processed (dedup) | 200 (skipped) |
| Success | 200 |
| Close/Supabase failure | 500 (Calendly retries) |

## Lead matching precedence

We match on data Calendly actually collects — no external id is threaded through
the booking link. Order:

1. **Email** → look up `leads` in Supabase by email (we own that table and it
   holds `close_lead_id`); if not there, `findLeadByEmail(payload.email)` in
   Close. The funnel prefills the form email into the Calendly widget, so the
   invitee email matches the lead email in ~all funnel bookings.
2. **Phone** → `findLeadByPhone(normalizedPhone)` (existing helper) — fallback
   when the invitee used a different email than the form.
3. **No match → create** a Close lead: `createLead` with status
   `CALL_BOOKED`, contact name/email/phone, custom fields `Source =
   calendly-direct`, `Booked = Call`, and any `tracking.utm_*` from Calendly
   (Close `CF_UTM_*`). Also upsert a Supabase `leads` row (`source:
   'calendly-direct'`, `cta_clicked: 'book-calendly'`, the `utm_*` columns,
   `close_lead_id`) so it shows up in the same tables as funnel leads. The
   `(email, source)` unique key keeps a direct booking from colliding with a
   funnel row for the same email.

If a Supabase row is found by email but has no `close_lead_id` yet (rare race),
fall through to phone, then create.

## Email-link bookings (no prior form)

A primary use case: an outreach / reactivation email with a "book an
appointment" link, sent to someone who has **never filled the funnel form** and
may not be in Supabase or Close yet. It works through the same webhook:

- The Calendly webhook is **account-level** — it fires for any booking on the
  account, whether the link points at `/consultation-book` or straight at
  Calendly. No funnel form and no client-side ping are required.
- **Identity comes from Calendly, not the link.** Every Calendly booking
  *requires* the invitee to enter their name + email, so the `invitee.created`
  payload always carries the booker's real email (and phone, if the event asks).
  A bare, param-less link still produces a fully-identified booking event.
- **The email link is bare and cannot carry params** — no name, email, or UTM.
  The only consequence is no Calendly prefill (the invitee types their own
  email). The webhook matches on **that typed email** (Supabase → Close), then
  phone, else creates. People book with the address they were emailed at, so this
  matches an existing Close lead in the common case; a different address falls
  through to create.
- A recipient already in Close flips to **Call Booked**; someone who exists
  nowhere is **created** (status Call Booked, `Source = calendly-direct`).
- **Attribution limit (accepted):** with a param-less link we cannot distinguish
  an email booking from an organic Calendly booking — all created leads land as
  `calendly-direct`. (The `tracking.utm_*` capture path stays in the code as
  harmless future-proofing, but nothing will populate it.)
- Same 30-min consult event as the funnel → always **Call Booked**; no
  event-type → status mapping needed.

## Close writes — new helpers in `lib/close.js`

- `findLeadByEmail(email)` → mirrors `findLeadByPhone`; query
  `email:"<email>"`, return `{ closeLeadId, contactId, displayName } | null`.
- `createNote({ leadId, note })` → POST `/activity/note/` with
  `{ lead_id, note }`.

Booking note format (plain text):

```
📅 Calendly booking confirmed
Event: 30 Minute Meeting
When: 2026-06-03 2:00 PM (America/New_York)
Campaign: email / reactivation        (utm_source / utm_campaign, when present)
— Answers —
Phone number: (555) 123-4567
<question>: <answer>
```

`updateLead` (existing) handles status + custom fields for matched leads;
`createLead` (existing) handles direct creation. Status/field writes are
idempotent. The note is written once per successful run; a mid-failure retry
(note created, then the `calendly_bookings` insert fails) could rarely produce a
duplicate note — acceptable, and avoidable later by inserting the dedup row
before the note.

## Idempotency / dedup

New migration `supabase/migrations/<ts>_calendly_bookings.sql`:

```sql
create table public.calendly_bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  invitee_uri text not null unique,        -- Calendly invitee URI (idempotency key)
  event_uri text,                          -- scheduled_event URI
  lead_id uuid references public.leads(id) on delete set null,
  close_lead_id text,
  scheduled_at timestamptz,
  matched_by text,                         -- 'email' | 'phone' | 'created'
  raw jsonb
);
```

RLS off, consistent with `leads` (browser never touches it; service-role only).

## Security

Calendly signs with `Calendly-Webhook-Signature: t=<ts>,v1=<hex>`. Verification:
HMAC-SHA256 over `"<t>.<rawBody>"` using the subscription's signing key, compared
to `v1` with a constant-time comparison. Optionally reject stale timestamps
(> a few minutes skew). Signing key is stored in `CALENDLY_WEBHOOK_SIGNING_KEY`;
missing key → fail closed.

## Client-side changes (funnel pages — optional hardening)

These touch only the funnel form pages, not the email flow. They're optional:
funnel bookings are already covered by the existing client-side `book-calendly`
ping, and the webhook matches by typed email regardless. Prefill just removes a
retype and makes the webhook's email match exact.

- **`consultation-book.html`** — **no change.** Email links are bare and can't
  carry params, so there's nothing to prefill; the page still embeds Calendly and
  fires the Meta Pixel `Schedule`.
- **`girthfill-form.html` / `girthfill-form-google.html`**: the widget is a
  static inline embed auto-initialized by `widget.js` on load, but the visitor's
  name/email are known only after they fill the form. So when the booking step
  is revealed, initialize the widget with `Calendly.initInlineWidget({ url,
  parentElement, prefill: { name, email } })` so the email is pre-populated.

Best-effort: if prefill fails, the webhook still matches by email (when the
invitee types the same one) or phone, and otherwise creates a direct lead.

## Env vars

Add to `.env.example` and Vercel:

- `CALENDLY_WEBHOOK_SIGNING_KEY` — from the subscription creation response.

Reused (already present): `CLOSE_API_KEY`, `CLOSE_STATUS_CALL_BOOKED`,
`CLOSE_CF_BOOKED`, `CLOSE_CF_SOURCE`, `CLOSE_CF_UTM_SOURCE`,
`CLOSE_CF_UTM_MEDIUM`, `CLOSE_CF_UTM_CAMPAIGN`, `CLOSE_CF_UTM_CONTENT`,
`CLOSE_CF_UTM_TERM`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

A Calendly **Personal Access Token** is needed only to *register* the
subscription (one-time, out of band) — not at runtime.

## Error handling

Follows the existing best-effort + `lead_sync_errors` pattern. Distinction: a
webhook returns `500` on a processing failure (so Calendly retries), unlike the
fire-and-forget client endpoints. Each failure is also written to
`lead_sync_errors` (`service: 'calendly'`) for visibility / manual replay.

## Testing plan (TDD)

`lib/__tests__/calendly.test.js`:
- `verifySignature` accepts a correctly-signed payload, rejects a tampered body,
  rejects a wrong key, rejects malformed headers.
- `parseInviteeCreated` extracts name/email/phone/Q&A/scheduled time/tracking;
  phone falls back from `text_reminder_number` to a `/phone/i` answer.

`api/__tests__/calendly-webhook.test.js` (mock `lib/close.js`,
`lib/supabase.js`, and `lib/calendly.verifySignature`):
- 405 non-POST; 401 bad signature; 401 when key unset.
- 200 skip for non-`invitee.created`.
- 200 skip when invitee already in `calendly_bookings`.
- Match by email (Supabase row, and Close-search fallback); match by phone.
- No match → `createLead` with `CALL_BOOKED` + `Source=calendly-direct` +
  `Booked=Call`, and a Supabase row upserted.
- When `tracking.utm_*` is present, a created lead captures it into Close
  `CF_UTM_*` + Supabase `utm_*`; a matched (existing) lead is NOT overwritten.
  (Bare links carry none today; the test exercises the capture path regardless.)
- `createNote` called with the Q&A summary.
- 500 + `lead_sync_errors` insert when a Close call throws.

## Setup / ops (one-time)

Documented in `docs/calendly-setup.md`:

```bash
curl -X POST https://api.calendly.com/webhook_subscriptions \
  -H "Authorization: Bearer $CALENDLY_PAT" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://lushfulaesthetics.com/api/calendly-webhook",
    "events": ["invitee.created"],
    "organization": "<organization_uri>",
    "scope": "organization"
  }'
```

The response's `signing_key` → set as `CALENDLY_WEBHOOK_SIGNING_KEY` in Vercel.
`<organization_uri>` comes from `GET https://api.calendly.com/users/me`.

**Close prerequisite:** if the Close `Source` custom field is a *choice*
(dropdown) field rather than free text, add a `calendly-direct` option in the
Close UI first, or `createLead` will reject the value.

## Future extensions

- `invitee.canceled` / reschedule: add the event to the subscription, then a
  handler branch (revert status, log a note). Reschedule arrives as a
  canceled + created pair (created carries `rescheduled: true`,
  `old_invitee`).
