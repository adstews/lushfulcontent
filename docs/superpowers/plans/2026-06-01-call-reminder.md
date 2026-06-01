# Call-time capture + 30-minute reminder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each Calendly booking's start time into a Close datetime field, and email the invitee ~30 minutes before the call via Close.

**Architecture:** The webhook writes the start time to a Close custom field. A new Vercel cron (`/api/cron/booking-reminders`, every 5 min) scans `calendly_bookings` for calls starting within 30 minutes, atomically claims each (`reminder_sent_at`), and sends a reminder email through Close's connected account — mirroring the existing `api/cron/sequence-tick`.

**Tech Stack:** Vercel serverless (`@vercel/node`, ESM), Supabase (service role), Close REST API, vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-call-reminder-design.md`

Run tests: `npm test`. Single file: `npx vitest run <path>`.

---

## File structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260601130000_calendly_bookings_reminder.sql` | Add `reminder_sent_at` + partial index. |
| `lib/close.js` (modify) | Add `sendEmail(...)`. |
| `lib/reminders.js` (new) | `findDueReminders`, `claimReminder`, `buildReminderEmail`. |
| `api/cron/booking-reminders.js` (new) | Cron: find → claim → send → log. |
| `vercel.json` (modify) | Register the new cron. |
| `.env.example` (modify) | `CLOSE_REMINDER_FROM`, `CLOSE_CF_CALL_TIME`. |
| `api/calendly-webhook.js` (modify) | Write `CLOSE_CF_CALL_TIME` on matched + created leads. |

---

## Task 1: Migration — `reminder_sent_at`

**Files:** Create `supabase/migrations/20260601130000_calendly_bookings_reminder.sql`

- [ ] **Step 1: Write the migration**

```sql
-- One-time reminder tracking for Calendly bookings.
alter table public.calendly_bookings
  add column if not exists reminder_sent_at timestamptz;

-- Supports the reminder cron's "due and not yet reminded" scan.
create index if not exists calendly_bookings_due_reminder_idx
  on public.calendly_bookings (scheduled_at)
  where reminder_sent_at is null;
```

- [ ] **Step 2: Commit** (apply to remote happens in Task 8)

```bash
git add supabase/migrations/20260601130000_calendly_bookings_reminder.sql
git commit -m "feat(db): reminder_sent_at on calendly_bookings"
```

---

## Task 2: `sendEmail` in `lib/close.js`

**Files:** Modify `lib/close.js`; Test `lib/__tests__/close.test.js`

- [ ] **Step 1: Add the failing test**

First update the import at the top of `lib/__tests__/close.test.js`:
```js
import { findLeadByEmail, createNote, sendEmail } from '../close.js'
```
Then append this describe block:
```js
describe('sendEmail', () => {
  it('throws without leadId/to/sender', async () => {
    await expect(sendEmail({ to: 'a@b.com', sender: 's@x.com' })).rejects.toThrow('leadId required')
    await expect(sendEmail({ leadId: 'lead_1', sender: 's@x.com' })).rejects.toThrow('to required')
    await expect(sendEmail({ leadId: 'lead_1', to: 'a@b.com' })).rejects.toThrow('sender required')
  })
  it('POSTs an outbox email to Close', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ id: 'acti_email_1' }))
    const r = await sendEmail({ leadId: 'lead_1', to: 'jane@example.com', sender: 'hello@x.com', subject: 'Hi', bodyText: 'T', bodyHtml: '<p>T</p>' })
    expect(r).toEqual({ id: 'acti_email_1' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/activity/email/')
    expect(JSON.parse(opts.body)).toMatchObject({
      lead_id: 'lead_1', to: ['jane@example.com'], sender: 'hello@x.com',
      subject: 'Hi', body_text: 'T', body_html: '<p>T</p>', status: 'outbox'
    })
  })
  it('throws on non-ok', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ error: 'no' }, false, 400))
    await expect(sendEmail({ leadId: 'lead_1', to: 'a@b.com', sender: 's@x.com' })).rejects.toThrow('Close send email failed: 400')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`sendEmail is not a function`)

Run: `npx vitest run lib/__tests__/close.test.js -t sendEmail`

- [ ] **Step 3: Implement** — add to `lib/close.js` after `createNote`:

```js
// Send an email to a lead via Close (routes through the connected email
// account). status 'outbox' tells Close to actually send, not just log a draft.
export async function sendEmail({ leadId, to, sender, subject, bodyText, bodyHtml }) {
  if (!leadId) throw new Error('sendEmail: leadId required')
  if (!to) throw new Error('sendEmail: to required')
  if (!sender) throw new Error('sendEmail: sender required')
  const body = {
    lead_id: leadId,
    to: Array.isArray(to) ? to : [to],
    sender,
    subject: subject || '',
    status: 'outbox'
  }
  if (bodyText) body.body_text = bodyText
  if (bodyHtml) body.body_html = bodyHtml
  const res = await fetch(`${BASE}/activity/email/`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close send email failed: ${res.status} ${text}`)
  }
  return res.json()
}
```

- [ ] **Step 4: Run — expect PASS** (`npx vitest run lib/__tests__/close.test.js`)

- [ ] **Step 5: Commit**

```bash
git add lib/close.js lib/__tests__/close.test.js
git commit -m "feat(lib): sendEmail via Close (/activity/email outbox)"
```

---

## Task 3: `findDueReminders` + `claimReminder` in `lib/reminders.js`

**Files:** Create `lib/reminders.js`; Test `lib/__tests__/reminders.test.js`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/reminders.test.js`:
```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))
const { getSupabase } = await import('../supabase.js')
const { findDueReminders, claimReminder } = await import('../reminders.js')

afterEach(() => vi.clearAllMocks())

describe('findDueReminders', () => {
  it('queries the 30-minute window, unreminded, future, ordered', async () => {
    const calls = {}
    const chain = {
      select(c) { calls.select = c; return this },
      is(col, val) { calls.is = [col, val]; return this },
      gt(col) { calls.gt = col; return this },
      lte(col) { calls.lte = col; return this },
      order(col, o) { calls.order = [col, o]; return this },
      limit() { return Promise.resolve({ data: [{ id: 'b1' }], error: null }) }
    }
    getSupabase.mockReturnValue({ from: () => chain })
    const out = await findDueReminders({ now: new Date('2026-06-03T17:30:00Z'), limit: 50 })
    expect(out).toEqual([{ id: 'b1' }])
    expect(calls.is).toEqual(['reminder_sent_at', null])
    expect(calls.gt).toBe('scheduled_at')
    expect(calls.lte).toBe('scheduled_at')
    expect(calls.select).toContain('raw')
  })
  it('throws on error', async () => {
    const chain = { select() { return this }, is() { return this }, gt() { return this }, lte() { return this }, order() { return this }, limit() { return Promise.resolve({ data: null, error: { message: 'boom' } }) } }
    getSupabase.mockReturnValue({ from: () => chain })
    await expect(findDueReminders({ now: new Date() })).rejects.toThrow('findDueReminders failed: boom')
  })
})

describe('claimReminder', () => {
  it('returns true when a row is claimed', async () => {
    const chain = { update() { return this }, eq() { return this }, is() { return this }, select() { return Promise.resolve({ data: [{ id: 'b1' }], error: null }) } }
    getSupabase.mockReturnValue({ from: () => chain })
    expect(await claimReminder('b1')).toBe(true)
  })
  it('returns false when no row is claimed (lost race)', async () => {
    const chain = { update() { return this }, eq() { return this }, is() { return this }, select() { return Promise.resolve({ data: [], error: null }) } }
    getSupabase.mockReturnValue({ from: () => chain })
    expect(await claimReminder('b1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run lib/__tests__/reminders.test.js`)

- [ ] **Step 3: Implement** — create `lib/reminders.js`:

```js
import { getSupabase } from './supabase.js'

const WINDOW_MS = 30 * 60 * 1000

// Bookings whose call starts within the next 30 minutes and haven't been
// reminded. scheduled_at > now excludes calls already started/past.
export async function findDueReminders({ now, limit = 50 }) {
  const sb = getSupabase()
  const nowIso = now.toISOString()
  const cutoffIso = new Date(now.getTime() + WINDOW_MS).toISOString()
  const { data, error } = await sb
    .from('calendly_bookings')
    .select('id, lead_id, close_lead_id, scheduled_at, raw')
    .is('reminder_sent_at', null)
    .gt('scheduled_at', nowIso)
    .lte('scheduled_at', cutoffIso)
    .order('scheduled_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`findDueReminders failed: ${error.message}`)
  return data || []
}

// Atomically claim a booking: set reminder_sent_at only if still null. Returns
// true if we won the claim, false if another tick already took it.
export async function claimReminder(id) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('calendly_bookings')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', id)
    .is('reminder_sent_at', null)
    .select('id')
  if (error) throw new Error(`claimReminder failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/reminders.js lib/__tests__/reminders.test.js
git commit -m "feat(lib): findDueReminders + claimReminder"
```

---

## Task 4: `buildReminderEmail` in `lib/reminders.js`

**Files:** Modify `lib/reminders.js`; Test `lib/__tests__/reminders.test.js`

- [ ] **Step 1: Add the failing test**

Append to `lib/__tests__/reminders.test.js`:
```js
import { buildReminderEmail } from '../reminders.js'

function booking(extra = {}) {
  return {
    id: 'b1', close_lead_id: 'lead_1',
    raw: { payload: {
      name: 'Jane Doe', email: 'jane@example.com', timezone: 'America/New_York',
      reschedule_url: 'https://calendly.com/reschedulings/AAA',
      cancel_url: 'https://calendly.com/cancellations/BBB',
      scheduled_event: { start_time: '2026-06-03T18:00:00Z' },
      ...extra
    } }
  }
}

describe('buildReminderEmail', () => {
  it('renders subject, recipient, first name, and both links', () => {
    const e = buildReminderEmail(booking())
    expect(e.to).toBe('jane@example.com')
    expect(e.subject).toContain('Reminder')
    expect(e.bodyText).toContain('Hi Jane,')
    expect(e.bodyText).toContain('Reschedule: https://calendly.com/reschedulings/AAA')
    expect(e.bodyText).toContain('Cancel: https://calendly.com/cancellations/BBB')
    expect(e.bodyHtml).toContain('href="https://calendly.com/reschedulings/AAA"')
    expect(e.bodyHtml).toContain('href="https://calendly.com/cancellations/BBB"')
  })
  it('omits a link line when its URL is absent', () => {
    const e = buildReminderEmail(booking({ cancel_url: undefined }))
    expect(e.bodyText).toContain('Reschedule:')
    expect(e.bodyText).not.toContain('Cancel:')
  })
  it('is robust to a missing name', () => {
    const e = buildReminderEmail(booking({ name: undefined }))
    expect(e.bodyText).toContain('Hi there,')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`-t buildReminderEmail`)

- [ ] **Step 3: Implement** — append to `lib/reminders.js`:

```js
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

// Build the reminder email from a booking row's stored Calendly payload.
export function buildReminderEmail(booking) {
  const p = (booking.raw && booking.raw.payload) || {}
  const to = (p.email || '').trim()
  const firstName = ((p.name || '').trim().split(/\s+/)[0]) || 'there'
  const tz = p.timezone || 'UTC'
  const startIso = p.scheduled_event && p.scheduled_event.start_time
  let when = startIso || ''
  if (startIso) {
    try {
      when = new Date(startIso).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })
    } catch { when = startIso }
  }
  const reschedule = p.reschedule_url || ''
  const cancel = p.cancel_url || ''

  const subject = `Reminder: your Lushful consult is at ${when}`

  const text = [`Hi ${firstName},`, '',
    `A quick reminder that your Lushful Aesthetics consultation is coming up at ${when} (${tz}) — about 30 minutes away.`]
  if (reschedule || cancel) {
    text.push('', 'Need to make a change?')
    if (reschedule) text.push(`• Reschedule: ${reschedule}`)
    if (cancel) text.push(`• Cancel: ${cancel}`)
  }
  text.push('', 'Talk soon!', '— Lushful Aesthetics')

  const html = [`<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>A quick reminder that your Lushful Aesthetics consultation is coming up at <strong>${escapeHtml(when)}</strong> (${escapeHtml(tz)}) — about 30 minutes away.</p>`]
  if (reschedule || cancel) {
    const links = []
    if (reschedule) links.push(`<a href="${escapeAttr(reschedule)}">Reschedule</a>`)
    if (cancel) links.push(`<a href="${escapeAttr(cancel)}">Cancel</a>`)
    html.push(`<p>Need to make a change? ${links.join(' &middot; ')}</p>`)
  }
  html.push('<p>Talk soon!<br>— Lushful Aesthetics</p>')

  return { to, subject, bodyText: text.join('\n'), bodyHtml: html.join('\n') }
}
```

- [ ] **Step 4: Run — expect PASS** (`npx vitest run lib/__tests__/reminders.test.js`)

- [ ] **Step 5: Commit**

```bash
git add lib/reminders.js lib/__tests__/reminders.test.js
git commit -m "feat(lib): buildReminderEmail (text + html, defensive links)"
```

---

## Task 5: `api/cron/booking-reminders.js`

**Files:** Create `api/cron/booking-reminders.js`; Test `api/__tests__/booking-reminders.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/__tests__/booking-reminders.test.js`:
```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({ getSupabase: vi.fn() }))
vi.mock('../../lib/close.js', () => ({ sendEmail: vi.fn() }))
vi.mock('../../lib/reminders.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, findDueReminders: vi.fn(), claimReminder: vi.fn() }
})

const { getSupabase } = await import('../../lib/supabase.js')
const close = await import('../../lib/close.js')
const reminders = await import('../../lib/reminders.js')
const handler = (await import('../cron/booking-reminders.js')).default

function makeReqRes(over = {}) {
  const req = { method: 'POST', headers: { authorization: 'Bearer test-cron' }, ...over }
  const res = { statusCode: 200, _json: null, status(c) { this.statusCode = c; return this }, json(o) { this._json = o; return this } }
  return { req, res }
}

function booking() {
  return { id: 'b1', lead_id: 'sb1', close_lead_id: 'lead_1', scheduled_at: '2026-06-03T18:00:00Z',
    raw: { payload: { name: 'Jane Doe', email: 'jane@example.com', timezone: 'America/New_York',
      reschedule_url: 'https://calendly.com/r/AAA', cancel_url: 'https://calendly.com/c/BBB',
      scheduled_event: { start_time: '2026-06-03T18:00:00Z' } } } }
}

function mockSupabaseErrors() {
  const calls = { inserts: {} }
  getSupabase.mockReturnValue({ from: (t) => ({ insert(row) { calls.inserts[t] = (calls.inserts[t] || []).concat([row]); return Promise.resolve({ error: null }) } }) })
  return calls
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-cron'
  process.env.CLOSE_REMINDER_FROM = 'hello@startlushfulaesthetics.com'
  reminders.claimReminder.mockResolvedValue(true)
})
afterEach(() => vi.clearAllMocks())

describe('GET-cron /api/cron/booking-reminders', () => {
  it('401 on bad cron auth', async () => {
    const { req, res } = makeReqRes({ headers: {} })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })
  it('200 nothing due', async () => {
    reminders.findDueReminders.mockResolvedValue([])
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.sent).toBe(0)
  })
  it('claims + sends a due reminder', async () => {
    reminders.findDueReminders.mockResolvedValue([booking()])
    close.sendEmail.mockResolvedValue({ id: 'acti_1' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(reminders.claimReminder).toHaveBeenCalledWith('b1')
    expect(close.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead_1', to: 'jane@example.com', sender: 'hello@startlushfulaesthetics.com'
    }))
    expect(res._json.sent).toBe(1)
  })
  it('skips when claim is lost (race)', async () => {
    reminders.findDueReminders.mockResolvedValue([booking()])
    reminders.claimReminder.mockResolvedValue(false)
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(close.sendEmail).not.toHaveBeenCalled()
  })
  it('logs to lead_sync_errors when send fails', async () => {
    const calls = mockSupabaseErrors()
    reminders.findDueReminders.mockResolvedValue([booking()])
    close.sendEmail.mockRejectedValue(new Error('smtp boom'))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res._json.failed).toBe(1)
    expect(calls.inserts.lead_sync_errors[0]).toMatchObject({ service: 'calendly-reminder' })
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (cannot import handler)

- [ ] **Step 3: Implement** — create `api/cron/booking-reminders.js`:

```js
import { findDueReminders, claimReminder, buildReminderEmail } from '../../lib/reminders.js'
import { sendEmail } from '../../lib/close.js'
import { getSupabase } from '../../lib/supabase.js'

// Same auth as api/cron/sequence-tick: Vercel Cron sends Bearer CRON_SECRET
// (and x-vercel-cron on Vercel). Verify both.
function verifyCron(req) {
  const auth = req.headers?.authorization
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  if (req.headers?.['x-vercel-cron'] === '1') return true
  return false
}

export default async function handler(req, res) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'unauthorized cron call' })

  let due
  try {
    due = await findDueReminders({ now: new Date(), limit: 50 })
  } catch (err) {
    console.error('booking-reminders: findDueReminders failed', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
  if (due.length === 0) return res.status(200).json({ ok: true, sent: 0, message: 'nothing due' })

  const results = await Promise.allSettled(due.map(b => fireOne(b)))
  const sent = results.filter(r => r.status === 'fulfilled' && r.value.sent).length
  const failed = results.filter(r => r.status === 'fulfilled' && r.value.error).length
  return res.status(200).json({ ok: true, due: due.length, sent, failed })
}

async function fireOne(booking) {
  const claimed = await claimReminder(booking.id)
  if (!claimed) return { sent: false, skipped: 'lost race' }

  const { to, subject, bodyText, bodyHtml } = buildReminderEmail(booking)
  const sender = process.env.CLOSE_REMINDER_FROM
  if (!to || !sender || !booking.close_lead_id) {
    await logErr(booking, `missing fields (to=${!!to} sender=${!!sender} lead=${!!booking.close_lead_id})`)
    return { error: 'missing fields' }
  }
  try {
    await sendEmail({ leadId: booking.close_lead_id, to, sender, subject, bodyText, bodyHtml })
  } catch (err) {
    await logErr(booking, String(err?.message || err))
    return { error: String(err?.message || err) }
  }
  return { sent: true }
}

async function logErr(booking, message) {
  try {
    await getSupabase().from('lead_sync_errors').insert({
      lead_id: booking.lead_id || null,
      service: 'calendly-reminder',
      operation: 'send-reminder',
      error_message: message,
      payload: { calendly_booking_id: booking.id, close_lead_id: booking.close_lead_id }
    })
  } catch (e) {
    console.error('booking-reminders: lead_sync_errors insert threw', e)
  }
}
```

- [ ] **Step 4: Run — expect PASS** (`npx vitest run api/__tests__/booking-reminders.test.js`)

- [ ] **Step 5: Commit**

```bash
git add api/cron/booking-reminders.js api/__tests__/booking-reminders.test.js
git commit -m "feat(api): booking-reminders cron — email ~30 min before the call"
```

---

## Task 6: Register cron + document env

**Files:** Modify `vercel.json`, `.env.example`

- [ ] **Step 1: Add the cron to `vercel.json`**

Replace the `crons` array so it contains both:
```json
{
  "cleanUrls": true,
  "crons": [
    { "path": "/api/cron/sequence-tick", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/booking-reminders", "schedule": "*/5 * * * *" }
  ]
}
```

- [ ] **Step 2: Document env in `.env.example`** — add after the `CALENDLY_WEBHOOK_SECRET` line:

```bash
# Booking reminder email (api/cron/booking-reminders). Sender must be an email
# account connected to Close; CLOSE_CF_CALL_TIME is the "Scheduled Call Time"
# datetime custom field (cf_xxx) the webhook writes the start time to.
CLOSE_REMINDER_FROM=
CLOSE_CF_CALL_TIME=
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json .env.example
git commit -m "chore: register booking-reminders cron + document env"
```

---

## Task 7: Webhook writes `CLOSE_CF_CALL_TIME`

**Files:** Modify `api/calendly-webhook.js`; Test `api/__tests__/calendly-webhook.test.js`

- [ ] **Step 1: Update tests first**

In `api/__tests__/calendly-webhook.test.js`, add to the `beforeEach` env block:
```js
  process.env.CLOSE_CF_CALL_TIME = 'cf_calltime'
```
Change the **matched-lead** assertion (the `updateLead` call in "matches an existing lead by email…") to:
```js
    expect(close.updateLead).toHaveBeenCalledWith({
      leadId: 'lead_1',
      statusId: 'stat_call',
      customFields: { cf_booked: 'Call', cf_calltime: '2026-06-03T18:00:00Z' }
    })
```
Change the **created-lead** assertion (`createLead` customFields in "creates a tagged lead with UTM…") to add `cf_calltime`:
```js
      customFields: expect.objectContaining({
        cf_source: 'calendly-direct',
        cf_booked: 'Call',
        cf_utm_source: 'email',
        cf_utm_campaign: 'reactivation',
        cf_calltime: '2026-06-03T18:00:00Z'
      })
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run api/__tests__/calendly-webhook.test.js`)

- [ ] **Step 3: Implement** in `api/calendly-webhook.js`:

In `createDirectLead`, after the UTM-fields loop and before `createLead(...)`, add:
```js
  if (process.env.CLOSE_CF_CALL_TIME && parsed.startTime) {
    customFields[process.env.CLOSE_CF_CALL_TIME] = parsed.startTime
  }
```

In `handler`, replace the matched-lead update block:
```js
    if (!resolved.created) {
      await updateLead({
        leadId: resolved.closeLeadId,
        statusId: process.env.CLOSE_STATUS_CALL_BOOKED,
        customFields: { [process.env.CLOSE_CF_BOOKED]: 'Call' }
      })
    }
```
with:
```js
    if (!resolved.created) {
      const matchedFields = { [process.env.CLOSE_CF_BOOKED]: 'Call' }
      if (process.env.CLOSE_CF_CALL_TIME && parsed.startTime) {
        matchedFields[process.env.CLOSE_CF_CALL_TIME] = parsed.startTime
      }
      await updateLead({
        leadId: resolved.closeLeadId,
        statusId: process.env.CLOSE_STATUS_CALL_BOOKED,
        customFields: matchedFields
      })
    }
```

- [ ] **Step 4: Run — expect PASS**, then full suite

Run: `npx vitest run api/__tests__/calendly-webhook.test.js` then `npm test`
Expected: all green except the pre-existing `js/__tests__/geo-gate.test.js` failure.

- [ ] **Step 5: Commit**

```bash
git add api/calendly-webhook.js api/__tests__/calendly-webhook.test.js
git commit -m "feat(api): webhook writes Scheduled Call Time to Close"
```

---

## Task 8: Setup + deploy + verify (ops)

> Not code. Do after merge.

- [ ] **Step 1: Create the Close datetime field**

```bash
curl -s -u "$CLOSE_API_KEY:" -X POST https://api.close.com/api/v1/custom_field/lead/ \
  -H 'Content-Type: application/json' \
  -d '{"name":"Scheduled Call Time","type":"datetime"}'
```
Copy the returned `id` (`cf_…`).

- [ ] **Step 2: Set env in Vercel (Production)** and redeploy:
  - `CLOSE_CF_CALL_TIME=<cf_… from step 1>`
  - `CLOSE_REMINDER_FROM=hello@startlushfulaesthetics.com`

- [ ] **Step 3: Apply the migration** (`reminder_sent_at`) to the Supabase project.

- [ ] **Step 4: Deploy** (`vercel --prod` or git push) — the new cron registers from `vercel.json`.

- [ ] **Step 5: Verify**
  - `vercel env ls production` shows both new vars.
  - Book a test slot ≤30 min out → within ~5 min, the invitee gets the reminder email and it's logged on the Close lead timeline; `calendly_bookings.reminder_sent_at` is set; the lead's "Scheduled Call Time" shows the start time.

---

## Self-review notes

- **Spec coverage:** Close datetime field write (T7), migration (T1), `sendEmail` (T2), `findDueReminders`/`claimReminder` (T3), `buildReminderEmail` with defensive reschedule+cancel links (T4), cron with claim/send/log + 401 auth (T5), cron registration + env (T6), setup/deploy/verify (T8). Cancellations intentionally out of scope.
- **Type consistency:** `buildReminderEmail` returns `{ to, subject, bodyText, bodyHtml }`; the cron destructures exactly those and passes `{ leadId, to, sender, subject, bodyText, bodyHtml }` to `sendEmail`, whose signature matches. `findDueReminders` selects `id, lead_id, close_lead_id, scheduled_at, raw` — every field the cron/`logErr` reads.
- **Timing:** `scheduled_at > now AND <= now+30min` → fires ~25–30 min before; never reminds past calls; once-only via `reminder_sent_at` + atomic claim.
