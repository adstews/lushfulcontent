# Call-time capture in Close + 30-minute email reminder — design

**Date:** 2026-06-01
**Status:** Approved design (pre-plan)
**Builds on:** the Calendly→Close webhook (`api/calendly-webhook.js`, `calendly_bookings`).

## Context & goal

When someone books the 30-min consult, we already mark the Close lead **Call
Booked**, log the Q&A, and store the booking in `calendly_bookings` (including
`scheduled_at`). Two gaps:

1. The booking time isn't a **structured Close field** — it's only in a timeline
   note, so it can't drive Close views/automations or be seen at a glance.
2. There's no **reminder** before the call.

This adds both: capture the start time into a Close datetime field, and email the
invitee ~30 minutes before the call.

## Decisions (confirmed)

- **Channel:** email, sent **via Close** (`POST /activity/email`, status
  `outbox`) through the connected Google account. Logs on the lead timeline.
- **Sender:** `hello@startlushfulaesthetics.com` (the connected account), env
  `CLOSE_REMINDER_FROM`.
- **Cancellations:** **not handled** (accepted risk) — a canceled booking could
  still get one reminder. Mitigation: the email carries reschedule **and** cancel
  links so the recipient can self-serve if plans changed.
- **Mechanism:** a dedicated Vercel cron, mirroring the existing
  `api/cron/sequence-tick` (same `CRON_SECRET` auth + atomic-claim pattern). If
  Vercel's cron limit is ever hit, fold the reminder check into the
  `sequence-tick` handler instead of adding a second cron.

## Part 1 — Capture the call time in Close

- Create a Close **datetime** lead custom field, "Scheduled Call Time" (created
  via the Close API during setup; id stored in env `CLOSE_CF_CALL_TIME`).
- `api/calendly-webhook.js` sets it to the Calendly `start_time` (ISO 8601) on
  **both** matched and created leads — conditional on `CLOSE_CF_CALL_TIME` being
  set, like the existing optional UTM fields (degrades gracefully if unset).
- The cron reads `calendly_bookings.scheduled_at` (our own data), not the Close
  field — the Close field is for Close-side visibility/automation.

## Part 2 — The 30-minute reminder

### Files

| File | Responsibility |
|------|----------------|
| `supabase/migrations/<ts>_calendly_bookings_reminder.sql` | Add `reminder_sent_at timestamptz` to `calendly_bookings`. |
| `lib/close.js` (modify) | Add `sendEmail({ leadId, to, sender, subject, bodyText, bodyHtml })` → `POST /activity/email` (status `outbox`). |
| `lib/reminders.js` (new) | `findDueReminders({ now, limit })`, `claimReminder(id)`, `buildReminderEmail(booking)`. Pure-ish, testable. |
| `api/cron/booking-reminders.js` (new) | Cron handler: verify → find due → claim → send → record. |
| `vercel.json` (modify) | Add cron `/api/cron/booking-reminders`, `*/5 * * * *`. |
| `.env.example` (modify) | Document `CLOSE_CF_CALL_TIME`, `CLOSE_REMINDER_FROM`. |

### Data flow

1. Vercel cron hits `/api/cron/booking-reminders` every 5 min; `verifyCron`
   (Bearer `CRON_SECRET` or `x-vercel-cron`) — reuse the `sequence-tick` check.
2. `findDueReminders()` → rows where
   `reminder_sent_at IS NULL AND scheduled_at > now() AND scheduled_at <= now() + interval '30 minutes'`
   (limit 50).
3. For each: `claimReminder(id)` — atomic
   `update calendly_bookings set reminder_sent_at = now() where id = $1 and reminder_sent_at is null returning id`.
   No row returned → another tick claimed it; skip.
4. `buildReminderEmail(booking)` extracts recipient/name/time/timezone and the
   reschedule + cancel URLs from `booking.raw.payload`.
5. `sendEmail({ leadId: booking.close_lead_id, to: <invitee email>, sender:
   CLOSE_REMINDER_FROM, subject, bodyText, bodyHtml })` → Close sends + logs it.
6. On send failure: record to `lead_sync_errors` (`service: 'calendly-reminder'`)
   and leave the row claimed (no auto-retry — avoids duplicate sends; failures
   are visible for manual follow-up).

### Timing

5-minute cron granularity → the email lands **~25–30 min before** the call. A
last-minute booking (<30 min out) is reminded on the next tick. `scheduled_at >
now()` guarantees a past call is never reminded.

### Idempotency

`reminder_sent_at` + the atomic claim guarantee exactly one send per booking,
even with overlapping cron runs.

### Email content

`buildReminderEmail(booking)` returns `{ subject, bodyText, bodyHtml }`.

- `first_name` = first token of `raw.payload.name`.
- `time` = `raw.payload.scheduled_event.start_time` formatted in
  `raw.payload.timezone` (e.g. "Jun 3, 2026, 2:00 PM").
- `reschedule_url` = `raw.payload.reschedule_url`; `cancel_url` =
  `raw.payload.cancel_url`. **Defensive:** include each line only if its URL is
  present; never break the email on a missing field.

Draft (HTML with a plain-text fallback):

```
Subject: Reminder: your Lushful consult is at {time}

Hi {first_name},

A quick reminder that your Lushful Aesthetics consultation is coming up at
{time} ({timezone}) — about 30 minutes away.

Need to make a change?
• Reschedule: {reschedule_url}
• Cancel: {cancel_url}

Talk soon!
— Lushful Aesthetics
```

Recipient = the invitee's email from the booking. Sender =
`CLOSE_REMINDER_FROM`. (Copy is easily editable post-build.)

### `lib/close.js` — `sendEmail`

```
POST /activity/email
{ lead_id, to: [<email>], sender, subject, body_text, body_html, status: 'outbox' }
```
`status: 'outbox'` tells Close to actually send (via the connected account), not
just log a draft. Throws on non-2xx like the other helpers.

## Env vars

Add to `.env.example` + Vercel:
- `CLOSE_CF_CALL_TIME` — datetime custom field id (created during setup).
- `CLOSE_REMINDER_FROM` — `hello@startlushfulaesthetics.com`.

Reused: `CLOSE_API_KEY`, `CRON_SECRET`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `CLOSE_STATUS_CALL_BOOKED`, `CLOSE_CF_BOOKED`.

## Error handling

Follows the repo's best-effort + `lead_sync_errors` pattern. The cron returns
200 with a summary (`due`/`sent`/`failed`); per-booking failures are logged, not
fatal to the batch (mirrors `sequence-tick`).

## Testing (TDD)

- `lib/__tests__/reminders.test.js`: `findDueReminders` window (in-window vs
  too-far-out vs past vs already-reminded), `buildReminderEmail` (subject/body,
  timezone formatting, links present, links omitted when absent).
- `lib/__tests__/close.test.js`: `sendEmail` posts the right shape with
  `status: 'outbox'`; throws on non-ok.
- `api/__tests__/booking-reminders.test.js`: 401 bad cron auth; nothing-due
  path; due → claim → `sendEmail` called; lost-claim race skips; send failure →
  `lead_sync_errors` insert + row stays claimed.
- `api/__tests__/calendly-webhook.test.js`: assert `CLOSE_CF_CALL_TIME` is set
  to `start_time` on matched and created leads.

## Setup / ops (one-time)

1. Create the Close datetime field via API:
   `POST /custom_field/lead/ { name: "Scheduled Call Time", type: "datetime" }`
   → set `CLOSE_CF_CALL_TIME` in Vercel.
2. Set `CLOSE_REMINDER_FROM=hello@startlushfulaesthetics.com` in Vercel.
3. Apply the migration (add `reminder_sent_at`).
4. Deploy (the new cron registers from `vercel.json`).

## Out of scope

- `invitee.canceled` / reschedule tracking (accepted risk, per decision).
- SMS/iMessage reminder (email only).
- Reminder for the in-person appointment (`Booked = Appointment`) flow — this
  covers the 30-min consult call only.
