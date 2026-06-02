# iMessage sequence stop conditions + appointment reminder — design

**Date:** 2026-06-01
**Status:** Approved design (pre-plan)
**Branch:** `sequence-stop-conditions` (rebased onto local `main`, which carries the as-yet-unpushed Calendly feature)
**Topic:** Stop the drip when a lead replies (pause), books (unenroll), or texts STOP (permanent opt-out — never text again); and send one appointment-reminder text 30 minutes before a Calendly booking.

## Context

The iMessage sequence engine (`lib/sequences.js`, `api/cron/sequence-tick.js`) runs drip campaigns: leads are enrolled, a Vercel cron fires due steps every 5 minutes, and every outbound send funnels through `sendImessage()` in `lib/imessage-bridge.js`. Today:

- **Replies already pause.** `api/sendblue/inbound.js` calls `pauseEnrollmentsForLead()` on every non-STOP inbound, honoring each sequence's `on_reply_behavior` (`pause` default | `unenroll` | `continue`).
- **STOP already unenrolls current sequences** (`isStopKeyword()` → `unenrollAllForLead()`) — but only when the inbound matches a Close lead, and with no persistent record, so a later status trigger can re-enroll and re-text the person.
- **Bookings already set a Close status.** `api/calendly-webhook.js` (invitee.created) resolves/creates the lead, sets `CLOSE_STATUS_CALL_BOOKED` + `CLOSE_CF_BOOKED='Call'`, writes a note, and records a `calendly_bookings` row that already stores the appointment `start_time` as `scheduled_at`. `api/lead-update.js` covers the client-side ping and Boulevard (`CLOSE_STATUS_APPT_BOOKED`). The Close `lead.updated` webhook (`api/sendblue/close-webhook.js`) already auto-*enrolls* on matching status triggers — but never unenrolls.
- The Calendly feature currently lives on local `main` only (unpushed); `origin/main` does not have it yet. This branch is rebased onto local `main` so it builds on top of it.

## Goals

1. Any inbound reply pauses the lead's active sequences (resumable). *Already built — verify only.*
2. A booking permanently unenrolls the lead from all sequences.
3. STOP permanently opts the number out: unenroll now **and** never text again — no future enrollment and no sends of any kind (automated or manual console), even if the texter is not yet a Close lead.
4. A Calendly booking schedules **one** reminder text 30 minutes before the appointment — independent of the drip engine, and surviving the booking-unenroll.

## Non-goals

- No in-app un-suppress / opt-back-in path. Reversal is a manual DB delete. *(User decision: hard block, no override.)*
- No START/UNSTOP keyword handling.
- No change to `on_reply_behavior` semantics or the pause→resume mechanics.
- STOP opt-out confirmation text: off by default (see Open question).
- **The reminder does not handle cancel/reschedule (accepted).** A canceled or rescheduled appointment still fires the originally-scheduled reminder. This matches the Calendly feature's current invitee.created-only scope. Revisit later by adding an `invitee.canceled` handler that cancels the pending reminder (reschedules would then self-correct, since Calendly emits canceled-for-old + created-for-new).

## Behavior 1 — Reply → pause (verify only, no code)

Pause-on-reply is the existing default. The work is verification, not building:

- The SendBlue inbound webhook is configured to POST `/api/sendblue/inbound` in production.
- The live scheduling sequences have `on_reply_behavior = 'pause'` (not `'continue'`). Flip any set to `continue`.

If verification surfaces a gap config can't fix, reopen this section.

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
- **The appointment reminder (Behavior 4) is independent** — it lives in its own table and is not affected by the unenroll.

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

## Behavior 4 — Appointment reminder (30 min before)

The reminder cannot be a drip step: drip steps are scheduled *relative to enrollment* (`enrolled_at + delay_seconds`), whereas "30 min before the appointment" is an *absolute* time, and a drip enrollment would be killed by the Behavior-2 booking-unenroll. So it gets its own one-off scheduled-message mechanism.

### New table `imessage_scheduled_messages`

| column | type | notes |
|---|---|---|
| `id` | uuid, primary key | |
| `phone` | text, not null | normalized E.164 |
| `close_lead_id` | text, null | for Close logging on send |
| `message` | text, not null | final text, rendered at schedule time |
| `media_url` | text, null | unused for the reminder; kept for generality |
| `send_at` | timestamptz, not null | absolute fire time = `start_time − 30min` |
| `status` | text | `pending` \| `sending` \| `sent` \| `failed` \| `canceled`, default `pending` |
| `source` | text | e.g. `calendly-reminder` |
| `dedup_key` | text, unique, null | = Calendly `invitee_uri`; idempotent against webhook retries |
| `sent_at` | timestamptz, null | |
| `error` | text, null | |
| `created_at` | timestamptz, default now() | |

Index on `(status, send_at)` where `status = 'pending'`.

### New lib `lib/scheduled-messages.js`

- `scheduleMessage({ phone, closeLeadId, message, sendAt, dedupKey, source })` — insert; conflict on `dedup_key` is a no-op (idempotent).
- `findDueScheduledMessages({ now, limit })` — `status='pending' AND send_at <= now`.
- `claimScheduledMessage(id)` — atomic `pending → sending` (guards against double-send across concurrent ticks).
- `markSent(id, { sentAt, handle })` / `markFailed(id, error)`.

### Scheduling — in `api/calendly-webhook.js` (invitee.created)

After the `calendly_bookings` row is recorded, best-effort (wrapped so a failure never fails the booking response; log to `lead_sync_errors` on error):

- Schedule **only when** `parsed.phone` is present **and** `sendAt = startTime − 30min` is in the future. Skip if the appointment is ≤30 min out or the Calendly event collected no phone.
- Render the reminder text at schedule time from the Calendly payload (invitee name + appointment time formatted in `parsed.timezone`). Default copy (editable — see Open questions): `Hi {{name}} — reminder: your Lushful Aesthetics consult is at {{time}}. Reply here if you need anything.` A reply lands in the console for a human (the lead is already unenrolled from drips by the booking), which doubles as the reschedule path.
- `scheduleMessage({ phone, closeLeadId, message, sendAt, dedupKey: parsed.inviteeUri, source: 'calendly-reminder' })`.

### Sending — in `api/cron/sequence-tick.js`

After firing due sequence steps, drain due scheduled messages: `findDueScheduledMessages` → for each, `claimScheduledMessage` → `sendImessage({ phone, message, leadId: closeLeadId })` → `markSent` / `markFailed`.

- Sends through `sendImessage`, so the **STOP suppression guard applies automatically**: an opted-out number yields `markFailed('recipient opted out')` and no send.
- The claim guard prevents double-send across concurrent ticks.
- ±5 min granularity (cron cadence): the reminder fires ~25–30 min before the appointment.

## Error handling & idempotency

- `suppressPhone` upserts on the `phone` PK → safe on repeated STOPs.
- Booking unenroll is a no-op on terminal enrollments.
- Reminder scheduling is idempotent via `dedup_key` (= invitee_uri); the send claim prevents double-fire. Reminder scheduling is best-effort and never fails the Calendly booking.
- The `sendImessage` guard throws a typed error; `fireOne` and the scheduled-message drain record it without crashing; `api/sendblue/console/reply.js` surfaces it as a 4xx with a clear message.
- All webhooks keep returning 200 on handled/duplicate cases so Close and SendBlue do not retry-storm.

## Edge cases

- STOP from a number with no Close lead → still suppressed (phone-keyed).
- A suppressed lead later changing Close status → `enrollLead` skips; no texts.
- Same person, new Close lead id, same phone → phone match still suppresses.
- Media-only / reaction inbounds are not STOP (`STOP_REGEX` requires matching text) → unaffected.
- Phone normalization is centralized (`normalizePhone`) so opt-out keys, reminder keys, and send keys all match.
- Appointment booked ≤30 min out, or a Calendly event with no phone → no reminder scheduled.
- Appointment canceled/rescheduled → the original reminder still fires (accepted non-goal).
- A booked lead who also texted STOP → reminder is suppressed at send time.

## Testing (TDD, vitest, mirroring existing `__tests__`)

- `lib/__tests__/opt-outs.test.js` — suppress upsert idempotency; `isSuppressed` by phone and by leadId; normalization.
- `lib/__tests__/scheduled-messages.test.js` — schedule dedup on `dedup_key`; due selection by `send_at`; claim atomicity.
- `api/sendblue/__tests__/inbound.test.js` — STOP with a matched lead (suppress + unenroll); STOP with **no** lead (suppress only); non-STOP reply unaffected.
- `api/sendblue/__tests__/close-webhook.test.js` — booked status → unenroll, no enroll; non-stop status → existing enroll path intact.
- `api/__tests__/calendly-webhook.test.js` — schedules a reminder at `start − 30min`; skips when no phone or appt ≤30 min out; idempotent on webhook retry (no duplicate reminder).
- `lib/__tests__/imessage-bridge.test.js` — `sendImessage` throws for a suppressed phone, sends otherwise.
- `lib/__tests__/sequences.test.js` — `enrollLead` skips when suppressed.
- Cron drain of due scheduled messages: sends due ones; suppressed → `failed`, not sent.

## Ops / verification checklist

- Close `lead.updated` webhook subscription is live and delivers the booked statuses to `/api/sendblue/close-webhook`.
- SendBlue inbound webhook is live to `/api/sendblue/inbound`.
- `CLOSE_STATUS_CALL_BOOKED` and `CLOSE_STATUS_APPT_BOOKED` are set in Vercel production.
- Apply the `imessage_opt_outs` and `imessage_scheduled_messages` migrations to the Supabase project.
- The Calendly feature (currently unpushed on local `main`) must be merged to `origin/main` and deployed before Behavior 4 runs in production.

## Open questions (minor)

1. **STOP opt-out confirmation text** ("You're unsubscribed and won't receive further messages"): default **off**, to honor "never text again." CTIA permits a single confirmation — flip on if desired (it would send before the suppression row is written, so it bypasses the guard).
2. **Reminder copy:** the default above is a placeholder — confirm the exact wording (and whether to include the appointment time / a reschedule link).

## File summary

**New:** `supabase/migrations/<ts>_imessage_opt_outs.sql`, `supabase/migrations/<ts>_imessage_scheduled_messages.sql`, `lib/opt-outs.js`, `lib/scheduled-messages.js`, and their `__tests__`.

**Changed:** `api/sendblue/close-webhook.js`, `api/sendblue/inbound.js`, `lib/imessage-bridge.js`, `lib/sequences.js`, `api/cron/sequence-tick.js`, `api/sendblue/console/thread.js`, `imessage.html`, `api/calendly-webhook.js`, and `api/sendblue/send.js` / `api/sendblue/outbound.js` if either bypasses `sendImessage`.

No new environment variables — booked statuses reuse the existing `CLOSE_STATUS_*` vars; opt-out and scheduled-message state are table-driven.
