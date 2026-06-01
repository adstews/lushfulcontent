# Sequence Stop Conditions + Appointment Reminder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop iMessage drips when a lead replies (pause), books (unenroll), or texts STOP (permanent opt-out, never text again); and send one reminder text 30 minutes before a Calendly appointment.

**Architecture:** A new `imessage_opt_outs` table + `lib/opt-outs.js` give a hard, phone-keyed suppression list enforced at the single send chokepoint (`sendImessage`) and at enrollment. Booking-unenroll hangs off the existing Close `lead.updated` webhook. The appointment reminder is a one-off absolute-time message in a new `imessage_scheduled_messages` table, scheduled by the Calendly webhook and drained by the existing 5-minute cron.

**Tech Stack:** Node (@vercel/node serverless), Supabase (service-role), SendBlue iMessage API, Close CRM, vitest (`globals: false`).

**Spec:** `docs/superpowers/specs/2026-06-01-sequence-stop-conditions-design.md`

---

## Prerequisites (do once before Task 1)

- [ ] **Symlink node_modules into the worktree** (worktrees don't carry it):

```bash
cd /Users/nicholasstewart/Claude/lushfulcontent/.worktrees/sequence-stop-conditions
ln -s /Users/nicholasstewart/Claude/lushfulcontent/node_modules node_modules
npm test -- --run lib/__tests__/sequences.test.js
```
Expected: the existing suite runs and passes (proves vitest works in the worktree).

- **Branch note:** this branch is rebased on local `main` (which has the unpushed Calendly feature). **Task 11 edits `api/calendly-webhook.js`, which the other session owns** — do it last, ideally after their push lands on `origin/main`; re-rebase first if their commits changed.

## File Structure

**New files:**
- `supabase/migrations/<ts>_imessage_opt_outs.sql` — opt-out table (Behavior 3).
- `supabase/migrations/<ts>_imessage_scheduled_messages.sql` — one-off reminder table (Behavior 4).
- `lib/opt-outs.js` — `suppressPhone`, `isSuppressed`.
- `lib/scheduled-messages.js` — `scheduleMessage`, `findDueScheduledMessages`, `claimScheduledMessage`, `markScheduledSent`, `markScheduledFailed`.
- `lib/__tests__/opt-outs.test.js`, `lib/__tests__/scheduled-messages.test.js`.

**Modified files:**
- `lib/imessage-bridge.js` — suppression guard in `sendImessage`.
- `lib/sequences.js` — suppression guard in `enrollLead`.
- `api/sendblue/inbound.js` — STOP suppresses before the lead gate.
- `api/sendblue/close-webhook.js` — unenroll on booked-status transition.
- `api/cron/sequence-tick.js` — drain due scheduled messages; defensive opted-out unenroll.
- `api/sendblue/console/thread.js` — `optedOut` flag.
- `imessage.html` — opted-out banner + disabled composer.
- `api/calendly-webhook.js` — schedule the 30-min reminder (Task 11, last).
- Test files modified: `lib/__tests__/imessage-bridge.test.js`, `lib/__tests__/sequences.test.js`, `api/sendblue/__tests__/inbound.test.js`, `api/sendblue/__tests__/close-webhook.test.js`, `api/cron/__tests__/sequence-tick.test.js`, `api/sendblue/console/__tests__/thread.test.js`, `api/__tests__/calendly-webhook.test.js`.

**Single-file test command:** `npx vitest run <path>` · **Full suite:** `npm test`

---

## Task 1: `imessage_opt_outs` migration

**Files:**
- Create: `supabase/migrations/20260601090000_imessage_opt_outs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Permanent opt-out (STOP) list. Phone-keyed so it survives lead churn.
-- RLS intentionally OFF, consistent with public.leads / calendly_bookings —
-- only Vercel functions (service-role key) ever touch this table.
create table public.imessage_opt_outs (
  phone text primary key,            -- normalized E.164
  close_lead_id text,                -- set when the STOP matched a Close lead
  reason text,                       -- e.g. 'stop-keyword'
  created_at timestamptz not null default now()
);

create index imessage_opt_outs_close_lead_id_idx
  on public.imessage_opt_outs (close_lead_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260601090000_imessage_opt_outs.sql
git commit -m "feat(db): imessage_opt_outs table for STOP suppression"
```

---

## Task 2: `lib/opt-outs.js` (suppression read/write)

**Files:**
- Create: `lib/opt-outs.js`
- Test: `lib/__tests__/opt-outs.test.js`

- [ ] **Step 1: Write the failing test**

```js
// lib/__tests__/opt-outs.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))
const { getSupabase } = await import('../supabase.js')
const { suppressPhone, isSuppressed } = await import('../opt-outs.js')

afterEach(() => { vi.clearAllMocks() })

describe('suppressPhone', () => {
  it('upserts the normalized phone', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockReturnValue({ from: () => ({ upsert }) })
    const r = await suppressPhone({ phone: '5550100123', leadId: 'lead_1', reason: 'stop-keyword' })
    expect(r.ok).toBe(true)
    expect(upsert).toHaveBeenCalledWith(
      { phone: '+15550100123', close_lead_id: 'lead_1', reason: 'stop-keyword' },
      { onConflict: 'phone' }
    )
  })

  it('is a no-op when phone cannot be normalized', async () => {
    const upsert = vi.fn()
    getSupabase.mockReturnValue({ from: () => ({ upsert }) })
    const r = await suppressPhone({ phone: '' })
    expect(r.ok).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('isSuppressed', () => {
  function mockResult(rows) {
    getSupabase.mockReturnValue({
      from: () => ({
        select: () => ({
          or: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }),
          eq: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) })
        })
      })
    })
  }

  it('true when a row matches', async () => {
    mockResult([{ phone: '+15550100123' }])
    expect(await isSuppressed({ phone: '+15550100123' })).toBe(true)
  })

  it('false when no row matches', async () => {
    mockResult([])
    expect(await isSuppressed({ phone: '+15550100123' })).toBe(false)
  })

  it('false (no query) when neither phone nor leadId given', async () => {
    const from = vi.fn()
    getSupabase.mockReturnValue({ from })
    expect(await isSuppressed({})).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('matches by leadId alone', async () => {
    mockResult([{ phone: '+1999' }])
    expect(await isSuppressed({ leadId: 'lead_1' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/opt-outs.test.js`
Expected: FAIL — `Cannot find module '../opt-outs.js'`.

- [ ] **Step 3: Write the implementation**

```js
// lib/opt-outs.js
import { getSupabase } from './supabase.js'
import { normalizePhone } from './sendblue.js'

// Add a phone to the permanent opt-out list. Idempotent (upsert on phone PK).
// No-op when the phone can't be normalized.
export async function suppressPhone({ phone, leadId = null, reason = 'stop-keyword' }) {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, skipped: 'no phone' }
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_opt_outs')
    .upsert(
      { phone: normalized, close_lead_id: leadId ?? null, reason },
      { onConflict: 'phone' }
    )
  if (error) throw new Error(error.message)
  return { ok: true, phone: normalized }
}

// True if the phone OR the close_lead_id is on the opt-out list. Either
// identifier is sufficient — a number can change leads, a lead its number.
export async function isSuppressed({ phone = null, leadId = null }) {
  const normalized = phone ? normalizePhone(phone) : null
  if (!normalized && !leadId) return false
  const sb = getSupabase()
  let q = sb.from('imessage_opt_outs').select('phone')
  if (normalized && leadId) {
    q = q.or(`phone.eq.${normalized},close_lead_id.eq.${leadId}`)
  } else if (normalized) {
    q = q.eq('phone', normalized)
  } else {
    q = q.eq('close_lead_id', leadId)
  }
  const { data, error } = await q.limit(1)
  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/opt-outs.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/opt-outs.js lib/__tests__/opt-outs.test.js
git commit -m "feat(lib): opt-out suppression (suppressPhone, isSuppressed)"
```

---

## Task 3: Suppression guard in `sendImessage`

The single chokepoint every outbound send passes through. A suppressed number must never be sent to.

**Files:**
- Modify: `lib/imessage-bridge.js`
- Test: `lib/__tests__/imessage-bridge.test.js`

- [ ] **Step 1: Add the failing test**

Add the opt-outs mock near the other `vi.mock` calls at the top of `lib/__tests__/imessage-bridge.test.js`:

```js
vi.mock('../opt-outs.js', () => ({ isSuppressed: vi.fn() }))
```

Add to the imports block:

```js
const { isSuppressed } = await import('../opt-outs.js')
```

Default it to `false` so existing tests are unaffected — add this line inside the **first** `beforeEach` (the one setting `process.env.CLOSE_*`):

```js
  isSuppressed.mockResolvedValue(false)
```

Add this test inside the `describe('sendImessage', ...)` block:

```js
  it('throws and does not send when the recipient is opted out', async () => {
    isSuppressed.mockResolvedValue(true)
    await expect(
      sendImessage({ phone: '+15550100123', message: 'hi', leadId: 'lead_1' })
    ).rejects.toThrow(/opted out/)
    expect(sendMessage).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/imessage-bridge.test.js`
Expected: FAIL — the new test errors (`isSuppressed` import missing / send still called).

- [ ] **Step 3: Implement the guard**

In `lib/imessage-bridge.js`, add the import at the top:

```js
import { isSuppressed } from './opt-outs.js'
```

In `sendImessage`, insert the guard immediately after the message/media validation and before the `sendMessage(...)` call:

```js
  if (!hasMessage && !hasMedia) throw new Error('message or mediaUrl is required')

  if (await isSuppressed({ phone: normalized })) {
    throw new Error('recipient opted out (STOP)')
  }

  const sendResult = await sendMessage({
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/imessage-bridge.test.js`
Expected: PASS (all `logImessageActivity` + `sendImessage` tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add lib/imessage-bridge.js lib/__tests__/imessage-bridge.test.js
git commit -m "feat(send): block sendImessage for opted-out numbers"
```

---

## Task 4: Suppression guard in `enrollLead`

Blocks future re-enrollment (status triggers, manual enroll) of an opted-out lead.

**Files:**
- Modify: `lib/sequences.js`
- Test: `lib/__tests__/sequences.test.js`

- [ ] **Step 1: Add the failing test**

Add the opt-outs mock at the top of `lib/__tests__/sequences.test.js` (after the supabase mock):

```js
vi.mock('../opt-outs.js', () => ({ isSuppressed: vi.fn() }))
```

Add to the imports:

```js
const { isSuppressed } = await import('../opt-outs.js')
const { enrollLead } = await import('../sequences.js')
```

Add this describe block:

```js
describe('enrollLead suppression guard', () => {
  it('skips and does not touch supabase when the lead is opted out', async () => {
    isSuppressed.mockResolvedValue(true)
    const from = vi.fn()
    getSupabase.mockReturnValue({ from })
    const r = await enrollLead({ sequenceId: 's1', leadId: 'lead_1', phone: '+15550100123' })
    expect(r.skipped).toBe('opted-out')
    expect(from).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/sequences.test.js`
Expected: FAIL — `enrollLead` proceeds to the supabase lookup instead of skipping.

- [ ] **Step 3: Implement the guard**

In `lib/sequences.js`, add the import at the top:

```js
import { isSuppressed } from './opt-outs.js'
```

In `enrollLead`, add the guard right after the existing argument validation, before `const sb = getSupabase()`:

```js
  if (!sequenceId) throw new Error('sequenceId required')
  if (!leadId) throw new Error('leadId required')

  if (await isSuppressed({ phone, leadId })) {
    return { skipped: 'opted-out', sequenceId, leadId }
  }

  const sb = getSupabase()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/sequences.test.js`
Expected: PASS (existing tests + the new suppression test).

- [ ] **Step 5: Commit**

```bash
git add lib/sequences.js lib/__tests__/sequences.test.js
git commit -m "feat(sequences): skip enrollLead for opted-out leads"
```

---

## Task 5: STOP suppresses in `inbound.js` (even with no lead)

STOP must opt the number out regardless of whether it matches a Close lead. Today STOP handling sits inside the `if (lead)` path and is skipped for unmatched numbers.

**Files:**
- Modify: `api/sendblue/inbound.js`
- Test: `api/sendblue/__tests__/inbound.test.js`

- [ ] **Step 1: Add the failing tests + new mocks**

In `api/sendblue/__tests__/inbound.test.js`, add two mocks after the existing `vi.mock` calls:

```js
vi.mock('../../../lib/opt-outs.js', () => ({ suppressPhone: vi.fn() }))
vi.mock('../../../lib/sequences.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, unenrollAllForLead: vi.fn(), pauseEnrollmentsForLead: vi.fn() }
})
```

Add to the imports:

```js
const { suppressPhone } = await import('../../../lib/opt-outs.js')
const { unenrollAllForLead, pauseEnrollmentsForLead } = await import('../../../lib/sequences.js')
```

Add defaults inside `beforeEach`:

```js
  pauseEnrollmentsForLead.mockResolvedValue({ affected: 0 })
```

Add these tests inside the `describe('POST /api/sendblue/inbound', ...)` block:

```js
  it('STOP with no matched lead still suppresses the number', async () => {
    findLeadByPhone.mockResolvedValue(null)
    const { req, res } = makeReqRes({ from_number: '+15550100123', content: 'STOP' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.matched).toBe(false)
    expect(suppressPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15550100123', leadId: null })
    )
    expect(unenrollAllForLead).not.toHaveBeenCalled()
  })

  it('STOP with a matched lead suppresses + unenrolls + still logs', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_s', contactId: null, displayName: 'S' })
    logImessageActivity.mockResolvedValue({ ok: true })
    const { req, res } = makeReqRes({ from_number: '+15550100123', content: 'stop' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(suppressPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15550100123', leadId: 'lead_s' })
    )
    expect(unenrollAllForLead).toHaveBeenCalledWith('lead_s', expect.any(String))
    expect(logImessageActivity).toHaveBeenCalled()
    expect(pauseEnrollmentsForLead).not.toHaveBeenCalled()
  })

  it('non-STOP reply pauses, does not suppress', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_p', contactId: null, displayName: 'P' })
    logImessageActivity.mockResolvedValue({ ok: true })
    pauseEnrollmentsForLead.mockResolvedValue({ affected: 1 })
    const { req, res } = makeReqRes({ from_number: '+15550100123', content: 'sounds good' })
    await handler(req, res)
    expect(suppressPhone).not.toHaveBeenCalled()
    expect(pauseEnrollmentsForLead).toHaveBeenCalledWith('lead_p', expect.any(String))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run api/sendblue/__tests__/inbound.test.js`
Expected: FAIL — STOP-without-lead doesn't call `suppressPhone`.

- [ ] **Step 3: Implement the restructure**

In `api/sendblue/inbound.js`, update the import line for sequences and add opt-outs:

```js
import { pauseEnrollmentsForLead, unenrollAllForLead, isStopKeyword } from '../../lib/sequences.js'
import { suppressPhone } from '../../lib/opt-outs.js'
```

Replace the lead lookup + the old sequence side-effect block. The new flow: detect STOP, look up the lead, suppress on STOP (always), unenroll if a lead is known, return early for unmatched numbers, then log/push for matched leads. Replace from the `let lead = null` block through the end of the existing `// Sequence side effects` block with:

```js
  const stop = isStopKeyword(message)

  let lead = null
  try {
    lead = await findLeadByPhone(phone)
  } catch (err) {
    console.error('sendblue/inbound: Close lookup failed', err)
    return res.status(502).json({ error: `Close lookup failed: ${err.message}` })
  }

  // STOP opts the number out permanently — regardless of whether it maps to a
  // Close lead. Suppression is phone-keyed; unenroll only when a lead is known.
  if (stop) {
    try {
      await suppressPhone({ phone, leadId: lead?.closeLeadId ?? null, reason: 'stop-keyword' })
    } catch (err) {
      console.error('inbound: suppressPhone failed', err)
    }
    if (lead) {
      try { await unenrollAllForLead(lead.closeLeadId, 'stop keyword') } catch (err) {
        console.error('inbound: unenrollAllForLead failed', err)
      }
    }
  }

  if (!lead) {
    return res.status(200).json({
      ok: true,
      matched: false,
      phone,
      suppressed: stop,
      note: 'no Close lead found for this phone — message received but not logged'
    })
  }

  const logResult = await logImessageActivity({
    leadId: lead.closeLeadId,
    leadName: lead.displayName,
    contactId: lead.contactId,
    direction: 'inbound',
    message: message || '',
    phone,
    mediaUrl,
    sendblueHandle
  })

  // Non-STOP replies pause the lead's active sequences (STOP already unenrolled).
  let sequenceAction = null
  try {
    if (stop) {
      sequenceAction = 'unenrolled-all-stop'
    } else {
      const r = await pauseEnrollmentsForLead(lead.closeLeadId, 'inbound reply')
      if (r.affected > 0) sequenceAction = `paused-${r.affected}`
    }
  } catch (err) {
    console.error('inbound: sequence side-effect failed', err)
  }
```

(The existing push-fan-out block and final `res.status(200).json({...})` stay as they are, below this.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/sendblue/__tests__/inbound.test.js`
Expected: PASS (existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add api/sendblue/inbound.js api/sendblue/__tests__/inbound.test.js
git commit -m "feat(inbound): STOP opts the number out even without a Close lead"
```

---

## Task 6: Booking → unenroll in `close-webhook.js`

**Files:**
- Modify: `api/sendblue/close-webhook.js`
- Test: `api/sendblue/__tests__/close-webhook.test.js`

- [ ] **Step 1: Add the failing tests**

Open `api/sendblue/__tests__/close-webhook.test.js`. Ensure `unenrollAllForLead` is in the `lib/sequences.js` mock — update that mock to include it (keep `findSequencesForStatusTrigger` and `enrollLead`):

```js
vi.mock('../../../lib/sequences.js', () => ({
  findSequencesForStatusTrigger: vi.fn(),
  enrollLead: vi.fn(),
  unenrollAllForLead: vi.fn()
}))
```

Add to imports:

```js
const { unenrollAllForLead } = await import('../../../lib/sequences.js')
```

Set the booked-status env in `beforeEach`:

```js
  process.env.CLOSE_STATUS_CALL_BOOKED = 'stat_call'
  process.env.CLOSE_STATUS_APPT_BOOKED = 'stat_appt'
```

Add these tests (match the existing file's `makeReqRes`/body shape — a Close `lead.updated` event with `data.status_id` + `previous_data.status_id`):

```js
  it('unenrolls and does not enroll when the new status is a booked status', async () => {
    const { req, res } = makeReqRes({
      event: 'lead.updated', object_type: 'lead', action: 'updated',
      data: { id: 'lead_b', status_id: 'stat_call' },
      previous_data: { status_id: 'stat_potential' }
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(unenrollAllForLead).toHaveBeenCalledWith('lead_b', 'booked')
    expect(res._json.unenrolled).toBe(true)
    expect(findSequencesForStatusTrigger).not.toHaveBeenCalled()
  })

  it('still enrolls on a non-booked status transition', async () => {
    findSequencesForStatusTrigger.mockResolvedValue([{ id: 'seq1', name: 'Drip' }])
    enrollLead.mockResolvedValue({ id: 'enr1' })
    const { req, res } = makeReqRes({
      event: 'lead.updated', object_type: 'lead', action: 'updated',
      data: { id: 'lead_c', status_id: 'stat_qualified', contacts: [{ id: 'c1', phones: [{ phone: '+15550100123' }] }] },
      previous_data: { status_id: 'stat_potential' }
    })
    await handler(req, res)
    expect(unenrollAllForLead).not.toHaveBeenCalled()
    expect(enrollLead).toHaveBeenCalled()
  })
```

> If the existing file's `makeReqRes` wraps the body differently (e.g. under an `event` envelope), mirror that shape — read the top of the file and match its existing passing tests exactly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run api/sendblue/__tests__/close-webhook.test.js`
Expected: FAIL — booked status still flows into the enroll path; `unenrolled` undefined.

- [ ] **Step 3: Implement the unenroll branch**

In `api/sendblue/close-webhook.js`, update the import:

```js
import { findSequencesForStatusTrigger, enrollLead, unenrollAllForLead } from '../../lib/sequences.js'
```

Insert this block immediately after the `if (action === 'updated' && newStatusId === oldStatusId) { ... }` guard and before `let sequences`:

```js
  // Booking → unenroll. Every booking path (Calendly webhook, client ping,
  // manual Close change, Close workflow) ends in a status flip to a booked
  // status, which lands here. Unenroll takes precedence over enroll.
  const stopStatusIds = [
    process.env.CLOSE_STATUS_CALL_BOOKED,
    process.env.CLOSE_STATUS_APPT_BOOKED
  ].filter(Boolean)
  if (stopStatusIds.includes(newStatusId)) {
    try {
      await unenrollAllForLead(leadId, 'booked')
    } catch (err) {
      console.error('close-webhook: unenrollAllForLead failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
    return res.status(200).json({ ok: true, leadId, statusId: newStatusId, unenrolled: true })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/sendblue/__tests__/close-webhook.test.js`
Expected: PASS (existing enroll tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add api/sendblue/close-webhook.js api/sendblue/__tests__/close-webhook.test.js
git commit -m "feat(close-webhook): unenroll all sequences on booked-status transition"
```

---

## Task 7: Console `optedOut` flag + banner

**Files:**
- Modify: `api/sendblue/console/thread.js`
- Modify: `imessage.html`
- Test: `api/sendblue/console/__tests__/thread.test.js`

- [ ] **Step 1: Add the failing test**

In `api/sendblue/console/__tests__/thread.test.js`, add the opt-outs mock and import (match the file's existing mock style):

```js
vi.mock('../../../../lib/opt-outs.js', () => ({ isSuppressed: vi.fn() }))
const { isSuppressed } = await import('../../../../lib/opt-outs.js')
```

Default `isSuppressed.mockResolvedValue(false)` in `beforeEach`, then add:

```js
  it('returns optedOut:true when the reply phone is suppressed', async () => {
    isSuppressed.mockResolvedValue(true)
    // (reuse this file's existing happy-path setup that yields a 200 with a replyPhone)
    const { req, res } = makeThreadReqRes('lead_1')   // use the file's existing helper
    await handler(req, res)
    expect(res._json.optedOut).toBe(true)
  })
```

> Use the existing test's helpers/mocks for the messages + `getLead` setup that already produces a 200 with a `replyPhone`; only the `optedOut` assertion + `isSuppressed` mock are new.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/sendblue/console/__tests__/thread.test.js`
Expected: FAIL — `optedOut` is `undefined`.

- [ ] **Step 3: Implement in `thread.js`**

Add the import:

```js
import { isSuppressed } from '../../../lib/opt-outs.js'
```

Just before the final `return res.status(200).json({...})`, compute the flag, then add it to the payload:

```js
  let optedOut = false
  try {
    optedOut = await isSuppressed({ phone: replyPhone, leadId })
  } catch (err) {
    console.error('console/thread opt-out check failed', err)
  }

  return res.status(200).json({
    leadId,
    leadName: lead?.display_name || null,
    statusLabel: lead?.status_label || null,
    replyPhone,
    optedOut,
    messages
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/sendblue/console/__tests__/thread.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the banner into `imessage.html`**

In `imessage.html`, in the thread-rendering code that builds the composer, gate it on the thread's `optedOut`. Find where the thread response is stored (e.g. `state.thread`) and where the composer/`.composer` element is rendered, and replace the composer render with:

```js
// when rendering the open thread:
state.thread?.optedOut
  ? h('div', { class: 'opted-out-banner' }, '⛔ Opted out (STOP) — messaging disabled')
  : renderComposer()   // the existing composer markup
```

Add the style near the other rules:

```css
.opted-out-banner { padding: 12px; text-align: center; color: var(--danger);
  border-top: 1px solid var(--line); background: var(--panel); font-size: 13px; }
```

- [ ] **Step 6: Manual verification (no unit test for the DOM)**

Run the console locally, open a thread whose number is in `imessage_opt_outs`, confirm the composer is replaced by the banner. Note this as a manual check in the PR.

- [ ] **Step 7: Commit**

```bash
git add api/sendblue/console/thread.js api/sendblue/console/__tests__/thread.test.js imessage.html
git commit -m "feat(console): show opted-out banner + disable composer for STOP'd threads"
```

---

## Task 8: `imessage_scheduled_messages` migration

**Files:**
- Create: `supabase/migrations/20260601090100_imessage_scheduled_messages.sql`

- [ ] **Step 1: Write the migration**

```sql
-- One-off absolute-time outbound messages (e.g. the 30-min appointment
-- reminder). Distinct from drip sequences, which are relative-to-enrollment.
-- RLS OFF — service-role only.
create table public.imessage_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  phone text not null,                  -- normalized E.164
  close_lead_id text,
  message text,
  media_url text,
  send_at timestamptz not null,         -- absolute fire time
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','canceled')),
  source text,                          -- e.g. 'calendly-reminder'
  dedup_key text unique,                -- e.g. Calendly invitee_uri
  message_handle text,
  sent_at timestamptz,
  error text,
  constraint scheduled_msg_must_have_payload
    check ((message is not null and length(message) > 0)
        or (media_url is not null and length(media_url) > 0))
);

create index imessage_scheduled_messages_due_idx
  on public.imessage_scheduled_messages (status, send_at) where status = 'pending';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260601090100_imessage_scheduled_messages.sql
git commit -m "feat(db): imessage_scheduled_messages table for one-off reminders"
```

---

## Task 9: `lib/scheduled-messages.js`

**Files:**
- Create: `lib/scheduled-messages.js`
- Test: `lib/__tests__/scheduled-messages.test.js`

- [ ] **Step 1: Write the failing test**

```js
// lib/__tests__/scheduled-messages.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))
const { getSupabase } = await import('../supabase.js')
const {
  scheduleMessage, findDueScheduledMessages, claimScheduledMessage,
  markScheduledSent, markScheduledFailed
} = await import('../scheduled-messages.js')

afterEach(() => { vi.clearAllMocks() })

describe('scheduleMessage', () => {
  it('inserts a normalized pending row', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockReturnValue({ from: () => ({ insert }) })
    const r = await scheduleMessage({
      phone: '5550100123', closeLeadId: 'lead_1', message: 'hi',
      sendAt: new Date('2026-06-03T17:30:00Z'), dedupKey: 'inv_1', source: 'calendly-reminder'
    })
    expect(r.ok).toBe(true)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15550100123', close_lead_id: 'lead_1', message: 'hi',
      send_at: '2026-06-03T17:30:00.000Z', status: 'pending',
      dedup_key: 'inv_1', source: 'calendly-reminder'
    }))
  })

  it('treats a duplicate-key error as a successful dedup', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint' } })
    getSupabase.mockReturnValue({ from: () => ({ insert }) })
    const r = await scheduleMessage({ phone: '+15550100123', message: 'hi', sendAt: new Date(), dedupKey: 'inv_1' })
    expect(r).toEqual({ ok: true, deduped: true })
  })

  it('no-op without a usable phone', async () => {
    const insert = vi.fn()
    getSupabase.mockReturnValue({ from: () => ({ insert }) })
    const r = await scheduleMessage({ phone: '', message: 'hi', sendAt: new Date() })
    expect(r.ok).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('findDueScheduledMessages', () => {
  it('selects pending rows at/under now', async () => {
    const rows = [{ id: 'm1', phone: '+1', message: 'hi', send_at: 'x', close_lead_id: null, media_url: null }]
    const lte = vi.fn().mockReturnValue({ limit: () => Promise.resolve({ data: rows, error: null }) })
    const eq = vi.fn().mockReturnValue({ lte })
    getSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) })
    const due = await findDueScheduledMessages({ now: new Date('2026-06-03T17:30:00Z') })
    expect(due).toEqual(rows)
    expect(eq).toHaveBeenCalledWith('status', 'pending')
  })
})

describe('claimScheduledMessage', () => {
  function mockClaim(rows) {
    getSupabase.mockReturnValue({
      from: () => ({
        update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: rows, error: null }) }) }) })
      })
    })
  }
  it('true when the row was claimed', async () => {
    mockClaim([{ id: 'm1' }])
    expect(await claimScheduledMessage('m1')).toBe(true)
  })
  it('false when already claimed (race)', async () => {
    mockClaim([])
    expect(await claimScheduledMessage('m1')).toBe(false)
  })
})

describe('markScheduledSent / markScheduledFailed', () => {
  it('marks sent', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    getSupabase.mockReturnValue({ from: () => ({ update }) })
    await markScheduledSent('m1', { handle: 'h1' })
    expect(update.mock.calls[0][0]).toMatchObject({ status: 'sent', message_handle: 'h1' })
  })
  it('marks failed', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    getSupabase.mockReturnValue({ from: () => ({ update }) })
    await markScheduledFailed('m1', 'boom')
    expect(update.mock.calls[0][0]).toMatchObject({ status: 'failed', error: 'boom' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/scheduled-messages.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// lib/scheduled-messages.js
import { getSupabase } from './supabase.js'
import { normalizePhone } from './sendblue.js'

const iso = (d) => (d instanceof Date ? d.toISOString() : d)

// Schedule a one-off message. Idempotent on dedup_key (unique). No-op without
// a usable phone or any payload.
export async function scheduleMessage({ phone, closeLeadId = null, message = null, mediaUrl = null, sendAt, dedupKey = null, source = 'manual' }) {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, skipped: 'no phone' }
  if (!message && !mediaUrl) return { ok: false, skipped: 'no payload' }
  const sb = getSupabase()
  const { error } = await sb.from('imessage_scheduled_messages').insert({
    phone: normalized,
    close_lead_id: closeLeadId,
    message,
    media_url: mediaUrl,
    send_at: iso(sendAt),
    status: 'pending',
    source,
    dedup_key: dedupKey
  })
  if (error) {
    if (String(error.message).includes('duplicate key')) return { ok: true, deduped: true }
    throw new Error(error.message)
  }
  return { ok: true }
}

export async function findDueScheduledMessages({ now = new Date(), limit = 50 } = {}) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_scheduled_messages')
    .select('id, phone, close_lead_id, message, media_url, send_at')
    .eq('status', 'pending')
    .lte('send_at', iso(now))
    .limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

// Atomic claim: pending -> sending. Returns true if we won the row.
export async function claimScheduledMessage(id) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_scheduled_messages')
    .update({ status: 'sending' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}

export async function markScheduledSent(id, { sentAt = new Date(), handle = null } = {}) {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_scheduled_messages')
    .update({ status: 'sent', sent_at: iso(sentAt), message_handle: handle })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function markScheduledFailed(id, errMsg) {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_scheduled_messages')
    .update({ status: 'failed', error: String(errMsg) })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/scheduled-messages.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scheduled-messages.js lib/__tests__/scheduled-messages.test.js
git commit -m "feat(lib): scheduled-messages (one-off absolute-time sends)"
```

---

## Task 10: Cron drains due scheduled messages + defensive opt-out unenroll

**Files:**
- Modify: `api/cron/sequence-tick.js`
- Test: `api/cron/__tests__/sequence-tick.test.js`

- [ ] **Step 1: Add the failing tests + mocks**

In `api/cron/__tests__/sequence-tick.test.js`, add the scheduled-messages mock and add `unenrollAllForLead` to the sequences mock:

```js
vi.mock('../../../lib/scheduled-messages.js', () => ({
  findDueScheduledMessages: vi.fn(),
  claimScheduledMessage: vi.fn(),
  markScheduledSent: vi.fn(),
  markScheduledFailed: vi.fn()
}))
```

Update the existing sequences mock to add `unenrollAllForLead: vi.fn()`. Add imports:

```js
const { findDueScheduledMessages, claimScheduledMessage, markScheduledSent, markScheduledFailed } =
  await import('../../../lib/scheduled-messages.js')
```

In `beforeEach`, default the scheduled-message drain to empty so existing tests are unaffected:

```js
  findDueScheduledMessages.mockResolvedValue([])
```

Add tests:

```js
  it('drains a due scheduled message via sendImessage', async () => {
    findDueSends.mockResolvedValue([])
    findDueScheduledMessages.mockResolvedValue([
      { id: 'm1', phone: '+15550100123', message: 'reminder', media_url: null, close_lead_id: 'lead_1' }
    ])
    claimScheduledMessage.mockResolvedValue(true)
    sendImessage.mockResolvedValue({ send: { message_handle: 'h1' }, log: { ok: true } })

    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(sendImessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15550100123', message: 'reminder', leadId: 'lead_1'
    }))
    expect(markScheduledSent).toHaveBeenCalledWith('m1', expect.objectContaining({ handle: 'h1' }))
    expect(res._json.reminders).toMatchObject({ sent: 1 })
  })

  it('marks a scheduled message failed when the recipient is opted out', async () => {
    findDueSends.mockResolvedValue([])
    findDueScheduledMessages.mockResolvedValue([
      { id: 'm2', phone: '+15550100124', message: 'reminder', media_url: null, close_lead_id: 'lead_2' }
    ])
    claimScheduledMessage.mockResolvedValue(true)
    sendImessage.mockRejectedValue(new Error('recipient opted out (STOP)'))

    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(markScheduledFailed).toHaveBeenCalledWith('m2', expect.stringContaining('opted out'))
    expect(res._json.reminders).toMatchObject({ failed: 1 })
  })

  it('skips a scheduled message it cannot claim (race)', async () => {
    findDueSends.mockResolvedValue([])
    findDueScheduledMessages.mockResolvedValue([{ id: 'm3', phone: '+1', message: 'x', media_url: null, close_lead_id: null }])
    claimScheduledMessage.mockResolvedValue(false)
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(sendImessage).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run api/cron/__tests__/sequence-tick.test.js`
Expected: FAIL — `res._json.reminders` undefined; drain not implemented.

- [ ] **Step 3: Implement the drain (restructure the handler)**

In `api/cron/sequence-tick.js`, update imports:

```js
import { sendImessage } from '../../lib/imessage-bridge.js'
import { getLead } from '../../lib/close.js'
import {
  findDueSends, tryAdvanceEnrollment, recordSend, markCompleted, renderTemplate, unenrollAllForLead
} from '../../lib/sequences.js'
import {
  findDueScheduledMessages, claimScheduledMessage, markScheduledSent, markScheduledFailed
} from '../../lib/scheduled-messages.js'
```

Replace the handler body after the `verifyCron` check so it always also drains scheduled messages (no early return on empty sequence sends):

```js
export default async function handler(req, res) {
  if (!verifyCron(req)) {
    return res.status(401).json({ error: 'unauthorized cron call' })
  }

  const now = new Date()

  let due = []
  try {
    due = await findDueSends({ now, limit: 50 })
  } catch (err) {
    console.error('sequence-tick: findDueSends failed', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }

  const results = await Promise.allSettled(due.map(item => fireOne(item)))
  const fired = results.filter(r => r.status === 'fulfilled' && r.value.fired).length
  const failed = results.filter(r => r.status === 'fulfilled' && r.value.error).length
  const completed = results.filter(r => r.status === 'fulfilled' && r.value.completed).length

  const reminders = await drainScheduledMessages(now)

  return res.status(200).json({ ok: true, due: due.length, fired, failed, completed, reminders })
}

async function drainScheduledMessages(now) {
  let dueMsgs = []
  try {
    dueMsgs = await findDueScheduledMessages({ now, limit: 50 })
  } catch (err) {
    console.error('sequence-tick: findDueScheduledMessages failed', err)
    return { due: 0, sent: 0, failed: 0, error: String(err?.message || err) }
  }
  let sent = 0, failed = 0
  for (const m of dueMsgs) {
    const claimed = await claimScheduledMessage(m.id)
    if (!claimed) continue
    try {
      const r = await sendImessage({
        phone: m.phone,
        message: m.message || '',
        mediaUrl: m.media_url || undefined,
        leadId: m.close_lead_id || undefined
      })
      await markScheduledSent(m.id, { handle: r?.send?.message_handle })
      sent++
    } catch (err) {
      await markScheduledFailed(m.id, String(err?.message || err))
      failed++
    }
  }
  return { due: dueMsgs.length, sent, failed }
}
```

Then add the defensive opted-out unenroll inside `fireOne`'s existing `catch` around `sendImessage` — after `recordSend(... error ...)`, before `return { error }`:

```js
  } catch (err) {
    await recordSend({
      enrollmentId: enrollment.id, stepId: step.id, scheduledFor,
      error: String(err?.message || err)
    })
    if (String(err?.message || err).includes('opted out')) {
      try { await unenrollAllForLead(enrollment.lead_id, 'opted-out') } catch (e) { console.error('fireOne unenroll failed', e) }
    }
    return { error: String(err?.message || err) }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/cron/__tests__/sequence-tick.test.js`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add api/cron/sequence-tick.js api/cron/__tests__/sequence-tick.test.js
git commit -m "feat(cron): drain due scheduled messages; unenroll on opted-out send"
```

---

## Task 11: Calendly reminder scheduling (LAST — shared file)

> **Do this task last.** It edits `api/calendly-webhook.js`, owned by the other session. Re-rebase onto their final commits first if they changed: `git -C <worktree> rebase main`.

**Files:**
- Modify: `api/calendly-webhook.js`
- Test: `api/__tests__/calendly-webhook.test.js`

- [ ] **Step 1: Add the failing tests**

In `api/__tests__/calendly-webhook.test.js`, add the scheduled-messages mock + import:

```js
vi.mock('../../lib/scheduled-messages.js', () => ({ scheduleMessage: vi.fn() }))
const { scheduleMessage } = await import('../../lib/scheduled-messages.js')
```

Pin time deterministically (INVITEE's `start_time` is `2026-06-03T18:00:00Z`). Add to `beforeEach`:

```js
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
  scheduleMessage.mockResolvedValue({ ok: true })
```

Add to `afterEach`:

```js
  vi.useRealTimers()
```

Add tests:

```js
  it('schedules a reminder 30 min before the appointment', async () => {
    mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(scheduleMessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15551234567',
      closeLeadId: 'lead_1',
      sendAt: new Date('2026-06-03T17:30:00Z'),
      dedupKey: INVITEE.payload.uri,
      source: 'calendly-reminder'
    }))
  })

  it('does not schedule a reminder when the appointment is <=30 min out', async () => {
    vi.setSystemTime(new Date('2026-06-03T17:45:00Z')) // 15 min before appt
    mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(scheduleMessage).not.toHaveBeenCalled()
  })

  it('does not schedule a reminder when no phone is present', async () => {
    calendly.readRawBody.mockResolvedValue(JSON.stringify({
      event: 'invitee.created',
      payload: { uri: 'inv_np', email: 'np@example.com',
        scheduled_event: { name: 'X', start_time: '2026-06-03T18:00:00Z' } }
    }))
    mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(scheduleMessage).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run api/__tests__/calendly-webhook.test.js`
Expected: FAIL — `scheduleMessage` never called.

- [ ] **Step 3: Implement the reminder scheduling**

In `api/calendly-webhook.js`, add the import:

```js
import { scheduleMessage } from '../lib/scheduled-messages.js'
```

Insert this **after** the `await sb.from('calendly_bookings').insert({...})` call and **before** the `return res.status(200).json({ ok: true, ... })`, inside the same `try`:

```js
    // Best-effort: schedule a one-off reminder 30 min before the appointment.
    // Skipped when no phone, or the appointment is <=30 min away. Never fails
    // the booking response. Cancel/reschedule are out of scope (see spec).
    try {
      if (parsed.phone && parsed.startTime) {
        const sendAt = new Date(new Date(parsed.startTime).getTime() - 30 * 60 * 1000)
        if (sendAt.getTime() > Date.now()) {
          let when = parsed.startTime
          try {
            when = new Date(parsed.startTime).toLocaleString('en-US', {
              timeZone: parsed.timezone || 'UTC', dateStyle: 'medium', timeStyle: 'short'
            })
          } catch { /* keep ISO */ }
          await scheduleMessage({
            phone: parsed.phone,
            closeLeadId: resolved.closeLeadId,
            message: `Hi ${parsed.name || 'there'} — reminder: your Lushful Aesthetics consult is at ${when}. Reply here if you need anything.`,
            sendAt,
            dedupKey: parsed.inviteeUri,
            source: 'calendly-reminder'
          })
        }
      }
    } catch (err) {
      console.error('calendly-webhook: reminder scheduling failed', err)
    }
```

> **Reminder copy is a placeholder** (spec Open question 2) — confirm wording with the owner before merge.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/__tests__/calendly-webhook.test.js`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS across the repo.

- [ ] **Step 6: Commit**

```bash
git add api/calendly-webhook.js api/__tests__/calendly-webhook.test.js
git commit -m "feat(calendly): schedule a 30-min appointment reminder on booking"
```

---

## Task 12: Verification (Behavior 1 + ops) — no code

- [ ] **Confirm reply→pause is live.** In production, verify the SendBlue inbound webhook is configured to POST `/api/sendblue/inbound`. Send a test reply from a known Close-lead phone enrolled in an active sequence; confirm the enrollment flips to `paused`.
- [ ] **Confirm sequence config.** Check the live `imessage_sequences.on_reply_behavior` for the scheduling sequences. Any set to `continue` won't pause on reply — flip to `pause` (via the console sequence editor or SQL).
- [ ] **Apply migrations** to the Supabase project: `imessage_opt_outs`, `imessage_scheduled_messages`.
- [ ] **Confirm env** in Vercel production: `CLOSE_STATUS_CALL_BOOKED`, `CLOSE_STATUS_APPT_BOOKED`.
- [ ] **Confirm Close `lead.updated` webhook** delivers booked statuses to `/api/sendblue/close-webhook` (the enroll-on-status feature already depends on it).
- [ ] **Behavior 4 prod dependency:** the Calendly feature must be on `origin/main` + deployed, and the Calendly `invitee.created` subscription must point at the deployed endpoint.

---

## Self-Review

**Spec coverage:**
- Behavior 1 (reply→pause) → Task 12 (verify-only, as designed). ✓
- Behavior 2 (booking→unenroll) → Task 6. ✓
- Behavior 3 (STOP→opt-out, hard everywhere) → Tasks 1–5, 7 (table, lib, send guard, enroll guard, inbound STOP, console banner). ✓
- Behavior 4 (30-min reminder) → Tasks 8–11 (table, lib, cron drain, calendly scheduling). ✓
- Edge cases: STOP without lead (Task 5), suppressed re-enroll blocked (Task 4), suppressed send blocked (Task 3), appt ≤30 min / no phone (Task 11), opted-out reminder suppressed at send (Task 10). ✓

**Placeholder scan:** Migration filenames use concrete timestamps. Console DOM banner (Task 7 Step 5) references the existing composer render by description because `imessage.html` markup wasn't quoted here — the executor reads the file and matches; a manual verification step covers it. No "TODO/handle edge cases" placeholders in code steps.

**Type consistency:** `isSuppressed({ phone, leadId })` and `suppressPhone({ phone, leadId, reason })` signatures match across opt-outs.js, imessage-bridge.js, sequences.js, inbound.js, thread.js. `scheduleMessage({ phone, closeLeadId, message, mediaUrl, sendAt, dedupKey, source })` matches between scheduled-messages.js and calendly-webhook.js. Cron drain reads `m.media_url` / `m.close_lead_id` (DB column names from the select). `unenrollAllForLead(leadId, reason)` matches existing signature.
