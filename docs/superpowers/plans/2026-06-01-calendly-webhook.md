# Calendly → Close Booking Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed, idempotent server-side Calendly `invitee.created` webhook that marks the matching Close lead "Call Booked", logs the Calendly Q&A, and creates+tags a lead when none matches — capturing every booking including bare-link email bookings where the person never did the funnel form.

**Architecture:** A new Vercel function `api/calendly-webhook.js` verifies Calendly's HMAC signature over the raw request body, then resolves the booker to a Close lead by the email Calendly forces them to enter (Supabase → Close), then phone, else creates one. Pure helpers live in `lib/calendly.js`; Close I/O reuses `lib/close.js`. A `calendly_bookings` table keyed on the invitee URI provides idempotency against Calendly retries.

**Tech Stack:** Vercel serverless functions (`@vercel/node`, ESM), Supabase (`@supabase/supabase-js`, service role), Close REST API, Node `crypto`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-calendly-webhook-design.md`

**Branch:** `calendly-webhook` (already checked out; the spec commit is the tip).

---

## File structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260601120000_calendly_bookings.sql` | Dedup/idempotency table. |
| `lib/calendly.js` | Pure helpers: `readRawBody`, `verifySignature`, `parseInviteeCreated`. No HTTP, no Close. |
| `lib/close.js` (modify) | Add `findLeadByEmail` + `createNote`. |
| `api/calendly-webhook.js` | HTTP handler: verify → dedup → resolve lead → write Close → record. |
| `lib/__tests__/calendly.test.js` | Unit tests for the pure helpers. |
| `lib/__tests__/close.test.js` | Unit tests for the two new Close helpers (mock `fetch`). |
| `api/__tests__/calendly-webhook.test.js` | Handler routing/matching tests (mock `lib/close.js`, `lib/supabase.js`; stub signature + raw-body). |
| `.env.example` (modify) | Document `CALENDLY_WEBHOOK_SIGNING_KEY`. |
| `docs/calendly-setup.md` | One-time subscription registration + verification runbook. |

Run all tests with: `npm test` (vitest). Single file: `npx vitest run <path>`.

---

## Task 1: `calendly_bookings` dedup table

**Files:**
- Create: `supabase/migrations/20260601120000_calendly_bookings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Calendly booking idempotency / dedup. One row per processed invitee.created.
-- RLS intentionally OFF, consistent with public.leads — only Vercel functions
-- (service-role key) ever touch this table; the browser never queries it.
create table public.calendly_bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  invitee_uri text not null unique,        -- Calendly invitee URI = idempotency key
  event_uri text,                          -- Calendly scheduled_event URI
  lead_id uuid references public.leads(id) on delete set null,
  close_lead_id text,
  scheduled_at timestamptz,
  matched_by text,                         -- 'email' | 'phone' | 'created'
  raw jsonb
);

create index calendly_bookings_close_lead_id_idx
  on public.calendly_bookings (close_lead_id);
```

- [ ] **Step 2: Apply the migration to the remote project**

Use the Supabase MCP `apply_migration` (name `calendly_bookings`, body = the SQL above), or run `supabase db push` if the CLI is linked. Do NOT hand-edit the DB without recording the migration file.

- [ ] **Step 3: Verify the table exists**

Via Supabase MCP `list_tables` (schema `public`) or `execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'calendly_bookings'
order by ordinal_position;
```
Expected: rows for `id, created_at, invitee_uri, event_uri, lead_id, close_lead_id, scheduled_at, matched_by, raw`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260601120000_calendly_bookings.sql
git commit -m "feat(db): calendly_bookings dedup table"
```

---

## Task 2: `findLeadByEmail` in `lib/close.js`

**Files:**
- Modify: `lib/close.js`
- Test: `lib/__tests__/close.test.js`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/close.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { findLeadByEmail, createNote } from '../close.js'

beforeEach(() => {
  process.env.CLOSE_API_KEY = 'test_key'
  global.fetch = vi.fn()
})
afterEach(() => {
  vi.restoreAllMocks()
})

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  })
}

describe('findLeadByEmail', () => {
  it('returns null when email is empty', async () => {
    expect(await findLeadByEmail('')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('queries Close by email and returns the first match + matching contact', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({
      data: [{
        id: 'lead_abc',
        display_name: 'Jane Doe',
        contacts: [
          { id: 'cont_1', emails: [{ email: 'other@x.com' }] },
          { id: 'cont_2', emails: [{ email: 'JANE@example.com' }] }
        ]
      }]
    }))

    const result = await findLeadByEmail('jane@example.com')

    expect(result).toEqual({ closeLeadId: 'lead_abc', contactId: 'cont_2', displayName: 'Jane Doe' })
    const calledUrl = global.fetch.mock.calls[0][0]
    expect(calledUrl).toContain('/lead/?query=')
    expect(decodeURIComponent(calledUrl)).toContain('email:"jane@example.com"')
  })

  it('returns null when Close has no match', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ data: [] }))
    expect(await findLeadByEmail('nobody@x.com')).toBeNull()
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ error: 'boom' }, false, 500))
    await expect(findLeadByEmail('x@y.com')).rejects.toThrow('Close lead search failed: 500')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/close.test.js`
Expected: FAIL — `findLeadByEmail is not a function` (and `createNote` import also undefined; that's fine, Task 3 adds it).

- [ ] **Step 3: Implement `findLeadByEmail`**

In `lib/close.js`, add after the existing `findLeadByPhone` function:

```js
// Search Close by email. Returns the first matching lead (with its primary
// contact id when available) or null.
export async function findLeadByEmail(email) {
  if (!email) return null
  const url = `${BASE}/lead/?query=${encodeURIComponent(`email:"${email}"`)}&_fields=id,display_name,contacts`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader() }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close lead search failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  const lead = data?.data?.[0]
  if (!lead) return null
  let contactId = null
  if (Array.isArray(lead.contacts) && lead.contacts.length > 0) {
    const match = lead.contacts.find(c =>
      Array.isArray(c.emails) && c.emails.some(e => (e.email || '').toLowerCase() === email.toLowerCase())
    )
    contactId = (match || lead.contacts[0]).id || null
  }
  return { closeLeadId: lead.id, contactId, displayName: lead.display_name }
}
```

- [ ] **Step 4: Run the test to verify `findLeadByEmail` passes**

Run: `npx vitest run lib/__tests__/close.test.js -t findLeadByEmail`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/close.js lib/__tests__/close.test.js
git commit -m "feat(lib): findLeadByEmail in Close client"
```

---

## Task 3: `createNote` in `lib/close.js`

**Files:**
- Modify: `lib/close.js`
- Test: `lib/__tests__/close.test.js`

- [ ] **Step 1: Add the failing test**

Append to `lib/__tests__/close.test.js` (inside the file, after the `findLeadByEmail` describe block):

```js
describe('createNote', () => {
  it('throws without leadId', async () => {
    await expect(createNote({ note: 'hi' })).rejects.toThrow('leadId required')
  })

  it('throws without note', async () => {
    await expect(createNote({ leadId: 'lead_1' })).rejects.toThrow('note required')
  })

  it('POSTs a note activity to Close', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ id: 'acti_1' }))
    const result = await createNote({ leadId: 'lead_1', note: 'Booked a call' })
    expect(result).toEqual({ id: 'acti_1' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/activity/note/')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ lead_id: 'lead_1', note: 'Booked a call' })
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ error: 'nope' }, false, 400))
    await expect(createNote({ leadId: 'lead_1', note: 'x' })).rejects.toThrow('Close create note failed: 400')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/close.test.js -t createNote`
Expected: FAIL — `createNote is not a function`.

- [ ] **Step 3: Implement `createNote`**

In `lib/close.js`, add after `findLeadByEmail`:

```js
// Create a plain note on a lead's timeline.
export async function createNote({ leadId, note }) {
  if (!leadId) throw new Error('createNote: leadId required')
  if (!note) throw new Error('createNote: note required')
  const res = await fetch(`${BASE}/activity/note/`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ lead_id: leadId, note })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close create note failed: ${res.status} ${text}`)
  }
  return res.json()
}
```

- [ ] **Step 4: Run the whole close test file**

Run: `npx vitest run lib/__tests__/close.test.js`
Expected: PASS (all `findLeadByEmail` + `createNote` tests).

- [ ] **Step 5: Commit**

```bash
git add lib/close.js lib/__tests__/close.test.js
git commit -m "feat(lib): createNote in Close client"
```

---

## Task 4: `verifySignature` in `lib/calendly.js`

**Files:**
- Create: `lib/calendly.js`
- Test: `lib/__tests__/calendly.test.js`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/calendly.test.js`:

```js
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { verifySignature } from '../calendly.js'

function sign(raw, key, t = '1700000000') {
  const v1 = crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')
  return `t=${t},v1=${v1}`
}

describe('verifySignature', () => {
  const key = 'whsec_test'
  const raw = '{"event":"invitee.created"}'

  it('accepts a valid signature', () => {
    expect(verifySignature(raw, sign(raw, key), key)).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(verifySignature(raw + ' ', sign(raw, key), key)).toBe(false)
  })
  it('rejects a signature made with a different key', () => {
    expect(verifySignature(raw, sign(raw, 'other_key'), key)).toBe(false)
  })
  it('rejects when the signing key is missing', () => {
    expect(verifySignature(raw, sign(raw, key), '')).toBe(false)
  })
  it('rejects a malformed header', () => {
    expect(verifySignature(raw, 'garbage', key)).toBe(false)
    expect(verifySignature(raw, '', key)).toBe(false)
    expect(verifySignature(raw, undefined, key)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/calendly.test.js`
Expected: FAIL — cannot import `verifySignature` (module/file missing).

- [ ] **Step 3: Implement the file with `verifySignature`**

Create `lib/calendly.js`:

```js
import crypto from 'node:crypto'

// Parse a Calendly signature header "t=<unix>,v1=<hex>" into parts.
function parseSignatureHeader(header) {
  const parts = {}
  for (const seg of String(header || '').split(',')) {
    const idx = seg.indexOf('=')
    if (idx === -1) continue
    parts[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim()
  }
  return parts
}

// Verify Calendly's HMAC-SHA256 signature over `${t}.${rawBody}`.
// Replay protection is handled by the calendly_bookings dedup table, so we do
// NOT enforce a timestamp window here — that would reject Calendly's legitimate
// delayed retries (the signature `t` is the original send time).
export function verifySignature(rawBody, signatureHeader, signingKey) {
  if (!signingKey) return false
  const { t, v1 } = parseSignatureHeader(signatureHeader)
  if (!t || !v1) return false
  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`${t}.${rawBody}`)
    .digest('hex')
  let a, b
  try {
    a = Buffer.from(expected, 'hex')
    b = Buffer.from(v1, 'hex')
  } catch {
    return false
  }
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/calendly.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/calendly.js lib/__tests__/calendly.test.js
git commit -m "feat(lib): Calendly HMAC signature verification"
```

---

## Task 5: `parseInviteeCreated` in `lib/calendly.js`

**Files:**
- Modify: `lib/calendly.js`
- Test: `lib/__tests__/calendly.test.js`

- [ ] **Step 1: Add the failing test**

Append to `lib/__tests__/calendly.test.js`:

```js
import { parseInviteeCreated } from '../calendly.js'

describe('parseInviteeCreated', () => {
  const body = {
    event: 'invitee.created',
    payload: {
      name: 'Jane Doe',
      email: 'Jane@Example.com',
      text_reminder_number: '+15551234567',
      timezone: 'America/New_York',
      uri: 'https://api.calendly.com/scheduled_events/EVT/invitees/INV',
      event: 'https://api.calendly.com/scheduled_events/EVT',
      questions_and_answers: [{ question: 'Goal?', answer: 'Bigger', position: 0 }],
      tracking: { utm_source: 'email', utm_campaign: 'reactivation' },
      scheduled_event: { name: '30 Minute Meeting', start_time: '2026-06-03T18:00:00Z' }
    }
  }

  it('extracts core fields and lowercases the email', () => {
    const p = parseInviteeCreated(body)
    expect(p.inviteeUri).toBe('https://api.calendly.com/scheduled_events/EVT/invitees/INV')
    expect(p.eventUri).toBe('https://api.calendly.com/scheduled_events/EVT')
    expect(p.email).toBe('jane@example.com')
    expect(p.name).toBe('Jane Doe')
    expect(p.phone).toBe('+15551234567')
    expect(p.eventName).toBe('30 Minute Meeting')
    expect(p.startTime).toBe('2026-06-03T18:00:00Z')
    expect(p.timezone).toBe('America/New_York')
    expect(p.utm).toEqual({ source: 'email', medium: null, campaign: 'reactivation', content: null, term: null })
    expect(p.questionsAndAnswers).toEqual([{ question: 'Goal?', answer: 'Bigger' }])
  })

  it('falls back to a phone-like Q&A when no text_reminder_number', () => {
    const b = {
      ...body,
      payload: {
        ...body.payload,
        text_reminder_number: null,
        questions_and_answers: [{ question: 'Best phone number', answer: '(555) 000-1111' }]
      }
    }
    expect(parseInviteeCreated(b).phone).toBe('(555) 000-1111')
  })

  it('is null-safe on a sparse payload', () => {
    const p = parseInviteeCreated({ payload: {} })
    expect(p.email).toBeNull()
    expect(p.phone).toBeNull()
    expect(p.questionsAndAnswers).toEqual([])
    expect(p.utm).toEqual({ source: null, medium: null, campaign: null, content: null, term: null })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/calendly.test.js -t parseInviteeCreated`
Expected: FAIL — `parseInviteeCreated is not a function`.

- [ ] **Step 3: Implement `parseInviteeCreated`**

Append to `lib/calendly.js`:

```js
// Normalize a Calendly invitee.created webhook body into the fields we use.
export function parseInviteeCreated(body) {
  const p = (body && body.payload) || {}
  const sched = p.scheduled_event || {}
  const qa = Array.isArray(p.questions_and_answers) ? p.questions_and_answers : []
  const tracking = p.tracking || {}

  let phone = p.text_reminder_number || null
  if (!phone) {
    const phoneQa = qa.find(x => /phone|mobile|cell/i.test((x && x.question) || ''))
    phone = (phoneQa && phoneQa.answer) || null
  }

  return {
    inviteeUri: p.uri || null,
    eventUri: p.event || sched.uri || null,
    name: p.name || null,
    email: (p.email || '').trim().toLowerCase() || null,
    phone,
    timezone: p.timezone || null,
    eventName: sched.name || null,
    startTime: sched.start_time || null,
    questionsAndAnswers: qa.map(x => ({ question: x.question, answer: x.answer })),
    utm: {
      source: tracking.utm_source || null,
      medium: tracking.utm_medium || null,
      campaign: tracking.utm_campaign || null,
      content: tracking.utm_content || null,
      term: tracking.utm_term || null
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/calendly.test.js`
Expected: PASS (all `verifySignature` + `parseInviteeCreated` tests).

- [ ] **Step 5: Commit**

```bash
git add lib/calendly.js lib/__tests__/calendly.test.js
git commit -m "feat(lib): parse Calendly invitee.created payload"
```

---

## Task 6: `readRawBody` in `lib/calendly.js`

**Files:**
- Modify: `lib/calendly.js`
- Test: `lib/__tests__/calendly.test.js`

- [ ] **Step 1: Add the failing test**

Append to `lib/__tests__/calendly.test.js`:

```js
import { Readable } from 'node:stream'
import { readRawBody } from '../calendly.js'

describe('readRawBody', () => {
  it('buffers a request stream into a utf8 string', async () => {
    const req = Readable.from(['{"event":', '"invitee.created"}'])
    expect(await readRawBody(req)).toBe('{"event":"invitee.created"}')
  })

  it('prefers an already-buffered req.rawBody', async () => {
    const req = { rawBody: Buffer.from('{"x":1}') }
    expect(await readRawBody(req)).toBe('{"x":1}')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/calendly.test.js -t readRawBody`
Expected: FAIL — `readRawBody is not a function`.

- [ ] **Step 3: Implement `readRawBody`**

Append to `lib/calendly.js`:

```js
// Buffer the raw request body. The Calendly handler must use this instead of
// req.body: the HMAC is computed over the exact bytes, and a re-serialized
// parsed body is not byte-identical. Requires `bodyParser: false` on the route.
export function readRawBody(req) {
  if (req.rawBody) {
    return Promise.resolve(
      typeof req.rawBody === 'string' ? req.rawBody : req.rawBody.toString('utf8')
    )
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/calendly.test.js`
Expected: PASS (all helper tests).

- [ ] **Step 5: Commit**

```bash
git add lib/calendly.js lib/__tests__/calendly.test.js
git commit -m "feat(lib): readRawBody helper for Calendly webhook"
```

---

## Task 7: `api/calendly-webhook.js` handler

**Files:**
- Create: `api/calendly-webhook.js`
- Test: `api/__tests__/calendly-webhook.test.js`

- [ ] **Step 1: Write the failing test (full handler suite)**

Create `api/__tests__/calendly-webhook.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({ getSupabase: vi.fn() }))
vi.mock('../../lib/close.js', () => ({
  createLead: vi.fn(),
  updateLead: vi.fn(),
  createNote: vi.fn(),
  findLeadByEmail: vi.fn(),
  findLeadByPhone: vi.fn()
}))
// Keep parseInviteeCreated real; stub the signature + raw-body helpers.
vi.mock('../../lib/calendly.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, readRawBody: vi.fn(), verifySignature: vi.fn() }
})

const { getSupabase } = await import('../../lib/supabase.js')
const close = await import('../../lib/close.js')
const calendly = await import('../../lib/calendly.js')
const handler = (await import('../calendly-webhook.js')).default

function makeReqRes() {
  const req = { method: 'POST', headers: { 'calendly-webhook-signature': 't=1,v1=sig' } }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

// Flexible Supabase stub. Captures inserts/upserts for assertions.
function mockSupabase({ dedup = [], leadsByEmail = [], upsertId = 'sb-new' } = {}) {
  const calls = { inserts: {}, upserts: {} }
  function from(table) {
    return {
      select() { return this },
      eq() { return this },
      ilike() { return this },
      not() { return this },
      limit() {
        if (table === 'calendly_bookings') return Promise.resolve({ data: dedup, error: null })
        if (table === 'leads') return Promise.resolve({ data: leadsByEmail, error: null })
        return Promise.resolve({ data: [], error: null })
      },
      insert(row) {
        calls.inserts[table] = (calls.inserts[table] || []).concat([row])
        return Promise.resolve({ error: null })
      },
      upsert(row) {
        calls.upserts[table] = (calls.upserts[table] || []).concat([row])
        return { select() { return { single() { return Promise.resolve({ data: { id: upsertId }, error: null }) } } } }
      }
    }
  }
  getSupabase.mockReturnValue({ from })
  return calls
}

const INVITEE = {
  event: 'invitee.created',
  payload: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    text_reminder_number: '+15551234567',
    timezone: 'America/New_York',
    uri: 'https://api.calendly.com/scheduled_events/EVT/invitees/INV',
    event: 'https://api.calendly.com/scheduled_events/EVT',
    questions_and_answers: [{ question: 'Goal?', answer: 'Bigger' }],
    tracking: { utm_source: 'email', utm_campaign: 'reactivation' },
    scheduled_event: { name: '30 Minute Meeting', start_time: '2026-06-03T18:00:00Z' }
  }
}

beforeEach(() => {
  process.env.CALENDLY_WEBHOOK_SIGNING_KEY = 'whsec_test'
  process.env.CLOSE_STATUS_CALL_BOOKED = 'stat_call'
  process.env.CLOSE_CF_BOOKED = 'cf_booked'
  process.env.CLOSE_CF_SOURCE = 'cf_source'
  process.env.CLOSE_CF_UTM_SOURCE = 'cf_utm_source'
  process.env.CLOSE_CF_UTM_CAMPAIGN = 'cf_utm_campaign'
  calendly.verifySignature.mockReturnValue(true)
  calendly.readRawBody.mockResolvedValue(JSON.stringify(INVITEE))
})
afterEach(() => { vi.clearAllMocks() })

describe('POST /api/calendly-webhook', () => {
  it('405 on non-POST', async () => {
    const { req, res } = makeReqRes()
    req.method = 'GET'
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('401 on bad signature', async () => {
    calendly.verifySignature.mockReturnValue(false)
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(close.updateLead).not.toHaveBeenCalled()
  })

  it('200 skip for non invitee.created', async () => {
    calendly.readRawBody.mockResolvedValue(JSON.stringify({ event: 'invitee.canceled' }))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.skipped).toBeDefined()
    expect(close.updateLead).not.toHaveBeenCalled()
  })

  it('200 skip when already processed (dedup)', async () => {
    mockSupabase({ dedup: [{ id: 'existing' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.skipped).toBe('already processed')
    expect(close.updateLead).not.toHaveBeenCalled()
    expect(close.createLead).not.toHaveBeenCalled()
  })

  it('matches an existing lead by email via Supabase → Call Booked + note', async () => {
    const calls = mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(close.findLeadByEmail).not.toHaveBeenCalled()
    expect(close.updateLead).toHaveBeenCalledWith({
      leadId: 'lead_1',
      statusId: 'stat_call',
      customFields: { cf_booked: 'Call' }
    })
    expect(close.createNote).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_1' }))
    expect(calls.inserts.calendly_bookings[0]).toMatchObject({
      invitee_uri: INVITEE.payload.uri,
      close_lead_id: 'lead_1',
      matched_by: 'email'
    })
  })

  it('falls back to Close email search when not in Supabase', async () => {
    mockSupabase({ leadsByEmail: [] })
    close.findLeadByEmail.mockResolvedValue({ closeLeadId: 'lead_2' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(close.updateLead).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_2' }))
  })

  it('falls back to phone search when email finds nothing', async () => {
    mockSupabase({ leadsByEmail: [] })
    close.findLeadByEmail.mockResolvedValue(null)
    close.findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_3' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(close.findLeadByPhone).toHaveBeenCalledWith('+15551234567')
    expect(close.updateLead).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_3' }))
  })

  it('creates a tagged lead with UTM when nothing matches', async () => {
    const calls = mockSupabase({ leadsByEmail: [] })
    close.findLeadByEmail.mockResolvedValue(null)
    close.findLeadByPhone.mockResolvedValue(null)
    close.createLead.mockResolvedValue({ closeLeadId: 'lead_new' })
    const { req, res } = makeReqRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(close.updateLead).not.toHaveBeenCalled()
    expect(close.createLead).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+15551234567',
      statusId: 'stat_call',
      customFields: expect.objectContaining({
        cf_source: 'calendly-direct',
        cf_booked: 'Call',
        cf_utm_source: 'email',
        cf_utm_campaign: 'reactivation'
      })
    }))
    expect(close.createNote).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_new' }))
    expect(calls.upserts.leads[0]).toMatchObject({
      source: 'calendly-direct',
      cta_clicked: 'book-calendly',
      close_lead_id: 'lead_new',
      utm_source: 'email'
    })
    expect(calls.inserts.calendly_bookings[0]).toMatchObject({ matched_by: 'created' })
  })

  it('logs a note containing the booking summary + answers', async () => {
    mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)
    const note = close.createNote.mock.calls[0][0].note
    expect(note).toContain('Calendly booking confirmed')
    expect(note).toContain('30 Minute Meeting')
    expect(note).toContain('Goal?: Bigger')
  })

  it('200 skip when payload has no email', async () => {
    calendly.readRawBody.mockResolvedValue(JSON.stringify({
      event: 'invitee.created',
      payload: { uri: 'u', email: '' }
    }))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.skipped).toBeDefined()
    expect(close.updateLead).not.toHaveBeenCalled()
  })

  it('500 + records lead_sync_errors when a Close write throws', async () => {
    const calls = mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    close.updateLead.mockRejectedValue(new Error('close boom'))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(calls.inserts.lead_sync_errors[0]).toMatchObject({ service: 'calendly' })
    expect(calls.inserts.calendly_bookings).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run api/__tests__/calendly-webhook.test.js`
Expected: FAIL — cannot import `../calendly-webhook.js` (handler not created).

- [ ] **Step 3: Implement the handler**

Create `api/calendly-webhook.js`:

```js
import { getSupabase } from '../lib/supabase.js'
import { readRawBody, verifySignature, parseInviteeCreated } from '../lib/calendly.js'
import {
  createLead,
  updateLead,
  createNote,
  findLeadByEmail,
  findLeadByPhone
} from '../lib/close.js'

// Calendly signs the raw bytes; the parsed body is not byte-identical, so we
// disable Vercel's body parser and read the stream ourselves.
export const config = { api: { bodyParser: false } }

function normalizePhone(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

function buildNote(parsed) {
  const lines = ['📅 Calendly booking confirmed']
  if (parsed.eventName) lines.push(`Event: ${parsed.eventName}`)
  if (parsed.startTime) {
    let when = parsed.startTime
    try {
      when = new Date(parsed.startTime).toLocaleString('en-US', {
        timeZone: parsed.timezone || 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    } catch { /* keep ISO */ }
    lines.push(`When: ${when}${parsed.timezone ? ` (${parsed.timezone})` : ''}`)
  }
  const campaign = [parsed.utm.source, parsed.utm.campaign].filter(Boolean).join(' / ')
  if (campaign) lines.push(`Campaign: ${campaign}`)
  const answered = parsed.questionsAndAnswers.filter(qa => qa.answer)
  if (answered.length > 0) {
    lines.push('— Answers —')
    for (const qa of answered) lines.push(`${qa.question}: ${qa.answer}`)
  }
  return lines.join('\n')
}

async function createDirectLead(sb, parsed) {
  const SOURCE = 'calendly-direct'
  const customFields = {}
  if (process.env.CLOSE_CF_SOURCE) customFields[process.env.CLOSE_CF_SOURCE] = SOURCE
  if (process.env.CLOSE_CF_BOOKED) customFields[process.env.CLOSE_CF_BOOKED] = 'Call'
  const utmFields = [
    ['CLOSE_CF_UTM_SOURCE', parsed.utm.source],
    ['CLOSE_CF_UTM_MEDIUM', parsed.utm.medium],
    ['CLOSE_CF_UTM_CAMPAIGN', parsed.utm.campaign],
    ['CLOSE_CF_UTM_CONTENT', parsed.utm.content],
    ['CLOSE_CF_UTM_TERM', parsed.utm.term]
  ]
  for (const [envName, val] of utmFields) {
    if (val && process.env[envName]) customFields[process.env[envName]] = val
  }

  const { closeLeadId } = await createLead({
    name: parsed.name,
    email: parsed.email,
    phone: parsed.phone,
    statusId: process.env.CLOSE_STATUS_CALL_BOOKED,
    customFields
  })

  let leadRowId = null
  try {
    const { data: row } = await sb
      .from('leads')
      .upsert({
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone,
        source: SOURCE,
        cta_clicked: 'book-calendly',
        utm_source: parsed.utm.source,
        utm_medium: parsed.utm.medium,
        utm_campaign: parsed.utm.campaign,
        utm_content: parsed.utm.content,
        utm_term: parsed.utm.term,
        close_lead_id: closeLeadId,
        close_synced_at: new Date().toISOString()
      }, { onConflict: 'email,source' })
      .select('id')
      .single()
    leadRowId = row ? row.id : null
  } catch (err) {
    console.error('calendly-webhook: supabase mirror failed', err)
  }

  return { closeLeadId, leadRowId, matchedBy: 'created', created: true }
}

async function resolveLead(sb, parsed) {
  // 1. Supabase leads by email (we own the close_lead_id mapping).
  const { data: rows } = await sb
    .from('leads')
    .select('id, close_lead_id')
    .ilike('email', parsed.email)
    .not('close_lead_id', 'is', null)
    .limit(1)
  const sbLead = rows && rows[0]
  if (sbLead && sbLead.close_lead_id) {
    return { closeLeadId: sbLead.close_lead_id, leadRowId: sbLead.id, matchedBy: 'email', created: false }
  }

  // 2. Close by email.
  const byEmail = await findLeadByEmail(parsed.email)
  if (byEmail && byEmail.closeLeadId) {
    return { closeLeadId: byEmail.closeLeadId, leadRowId: null, matchedBy: 'email', created: false }
  }

  // 3. Close by phone.
  const phone = normalizePhone(parsed.phone)
  if (phone) {
    const byPhone = await findLeadByPhone(phone)
    if (byPhone && byPhone.closeLeadId) {
      return { closeLeadId: byPhone.closeLeadId, leadRowId: null, matchedBy: 'phone', created: false }
    }
  }

  // 4. No match → create.
  return createDirectLead(sb, parsed)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const raw = await readRawBody(req)
  if (!verifySignature(raw, req.headers['calendly-webhook-signature'], process.env.CALENDLY_WEBHOOK_SIGNING_KEY)) {
    return res.status(401).json({ error: 'invalid signature' })
  }

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return res.status(400).json({ error: 'invalid json' })
  }

  if (!body || body.event !== 'invitee.created') {
    return res.status(200).json({ ok: true, skipped: 'not invitee.created' })
  }

  const parsed = parseInviteeCreated(body)
  if (!parsed.inviteeUri || !parsed.email) {
    return res.status(200).json({ ok: true, skipped: 'missing invitee uri or email' })
  }

  const sb = getSupabase()

  // Idempotency: Calendly retries failed deliveries; skip ones we've handled.
  const { data: dup } = await sb
    .from('calendly_bookings')
    .select('id')
    .eq('invitee_uri', parsed.inviteeUri)
    .limit(1)
  if (dup && dup.length > 0) {
    return res.status(200).json({ ok: true, skipped: 'already processed' })
  }

  try {
    const missing = ['CLOSE_STATUS_CALL_BOOKED', 'CLOSE_CF_BOOKED'].filter(v => !process.env[v])
    if (missing.length > 0) throw new Error(`Close env vars missing: ${missing.join(', ')}`)

    const resolved = await resolveLead(sb, parsed)

    if (!resolved.created) {
      await updateLead({
        leadId: resolved.closeLeadId,
        statusId: process.env.CLOSE_STATUS_CALL_BOOKED,
        customFields: { [process.env.CLOSE_CF_BOOKED]: 'Call' }
      })
    }

    await createNote({ leadId: resolved.closeLeadId, note: buildNote(parsed) })

    await sb.from('calendly_bookings').insert({
      invitee_uri: parsed.inviteeUri,
      event_uri: parsed.eventUri,
      lead_id: resolved.leadRowId,
      close_lead_id: resolved.closeLeadId,
      scheduled_at: parsed.startTime,
      matched_by: resolved.matchedBy,
      raw: body
    })

    return res.status(200).json({ ok: true, matchedBy: resolved.matchedBy, closeLeadId: resolved.closeLeadId })
  } catch (err) {
    console.error('calendly-webhook processing failed', err)
    try {
      await sb.from('lead_sync_errors').insert({
        lead_id: null,
        service: 'calendly',
        operation: 'invitee.created',
        error_message: String((err && err.message) || err),
        payload: body
      })
    } catch (insertErr) {
      console.error('lead_sync_errors insert threw', insertErr)
    }
    return res.status(500).json({ error: 'processing failed' })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run api/__tests__/calendly-webhook.test.js`
Expected: PASS (all 12 cases).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — new files plus all existing tests (lead, lead-update, geo, etc.).

- [ ] **Step 6: Commit**

```bash
git add api/calendly-webhook.js api/__tests__/calendly-webhook.test.js
git commit -m "feat(api): Calendly invitee.created webhook → Close"
```

---

## Task 8: Env documentation + setup runbook

**Files:**
- Modify: `.env.example`
- Create: `docs/calendly-setup.md`

- [ ] **Step 1: Document the new env var**

In `.env.example`, add a new block (place it after the `# Close CRM` block, before `# SendBlue`):

```bash
# Calendly webhook (invitee.created → Close "Call Booked")
# Signing key returned when you create the webhook subscription. See
# docs/calendly-setup.md. Missing key → the webhook rejects all requests (401).
CALENDLY_WEBHOOK_SIGNING_KEY=
```

- [ ] **Step 2: Write the setup runbook**

Create `docs/calendly-setup.md`:

````markdown
# Calendly → Close webhook setup

Marks a Close lead "Call Booked" (and logs the Q&A) whenever someone books the
30-min consult on Calendly — funnel embed, `/consultation-book`, or a bare
Calendly link in an email. Handler: `api/calendly-webhook.js`.

## One-time registration

Calendly webhook subscriptions are created via API (paid-plan feature) and
require a Personal Access Token (PAT): Calendly → Integrations → API & Webhooks.

1. Get your organization URI:

   ```bash
   curl https://api.calendly.com/users/me \
     -H "Authorization: Bearer $CALENDLY_PAT"
   # → resource.current_organization
   ```

2. Create the subscription (only `invitee.created`):

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

3. Copy `resource.signing_key` from the response and set it in Vercel
   (Production + Preview):

   ```
   CALENDLY_WEBHOOK_SIGNING_KEY=<signing_key>
   ```

   Redeploy so the function picks it up.

## Close prerequisite

If the Close `Source` custom field is a **choice (dropdown)** field rather than
free text, add a `calendly-direct` option in the Close UI first, or creating a
direct-booking lead will fail.

## Verify

- Book a test event on the 30-min Calendly. Confirm in Close: the lead is
  **Call Booked** with a "Calendly booking confirmed" note. Check the
  `calendly_bookings` table got a row.
- Re-deliver the same event from Calendly's webhook log → handler returns 200
  `skipped: already processed` (no duplicate writes).
- A booking with a brand-new email creates a `calendly-direct` lead at Call
  Booked.

## Notes

- The link needs no params: Calendly's own booking form always collects the
  name + email, which is what we match on.
- Replay protection is the `calendly_bookings.invitee_uri` unique key, so the
  signature check deliberately does not enforce a timestamp window (that would
  reject Calendly's delayed retries).
````

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/calendly-setup.md
git commit -m "docs(calendly): env var + webhook setup runbook"
```

---

## Task 9 (OPTIONAL): Funnel-page Calendly email prefill

> Optional hardening. The webhook already matches funnel bookings by the typed
> email, and the existing client-side `book-calendly` ping already covers them.
> This just pre-fills the funnel visitor's email into Calendly so they don't
> retype it and the webhook match is exact. Skip if you want to ship the webhook
> alone. `consultation-book.html` needs no change (email links are bare).

**Files:**
- Modify: `girthfill-form.html` (Calendly widget init)
- Modify: `girthfill-form-google.html` (same)

- [ ] **Step 1: Capture name/email on the form submit**

In `girthfill-form.html`, the submit handler already sets `window.__leadId` from
`/api/lead` (around line 669). Right after that line, also stash the contact:

```js
window.__leadId = data.lead_id;
window.__leadContact = { name: name, email: email };
```

- [ ] **Step 2: Re-init the Calendly widget with prefill when the booking step shows**

The widget is a static auto-initialized inline embed (`data-url` at ~line 464).
When the booking step (`stepOptions`) is revealed, re-init it with prefill. In
the function that shows that step, after it becomes visible, add:

```js
// Prefill the booker's name/email so the webhook matches the lead exactly.
(function prefillCalendly() {
  var el = document.querySelector('.calendly-inline-widget');
  var c = window.__leadContact;
  if (!el || !c || !window.Calendly || el.dataset.prefilled) return;
  el.dataset.prefilled = '1';
  el.innerHTML = '';
  window.Calendly.initInlineWidget({
    url: el.getAttribute('data-url'),
    parentElement: el,
    prefill: { name: c.name, email: c.email }
  });
})();
```

Place this so it runs when the Calendly step is shown (not on page load).

- [ ] **Step 3: Repeat for `girthfill-form-google.html`**

Apply the identical two edits (Step 1 and Step 2) to `girthfill-form-google.html`.

- [ ] **Step 4: Manual verification**

Run `npm run dev` (vercel dev). Complete the funnel to the booking step and
confirm the Calendly widget shows the name/email pre-filled. (No automated test —
this is third-party-widget DOM behavior.)

- [ ] **Step 5: Commit**

```bash
git add girthfill-form.html girthfill-form-google.html
git commit -m "feat(landers): prefill name/email into funnel Calendly widget"
```

---

## Task 10: Register subscription + end-to-end verification

> Not code — operational. Do this after the branch is merged and deployed so the
> public URL is live.

- [ ] **Step 1: Deploy** the branch (merge → Vercel production deploy per the repo's normal flow).

- [ ] **Step 2: Register the Calendly subscription** following `docs/calendly-setup.md` (needs the Calendly PAT). Set `CALENDLY_WEBHOOK_SIGNING_KEY` in Vercel and redeploy.

- [ ] **Step 3: Live test** — book a test slot on the 30-min Calendly with a brand-new email. Confirm:
  - Close: a `calendly-direct` lead at **Call Booked** with the booking note.
  - Supabase: a `leads` row + a `calendly_bookings` row.
- [ ] **Step 4: Existing-lead test** — book with the email of an existing Close lead. Confirm that lead flips to **Call Booked** (no duplicate created) and gets the note.
- [ ] **Step 5: Retry/dedup test** — in Calendly's webhook delivery log, re-send the test delivery. Confirm the handler returns 200 `already processed` and no second note/row appears.

---

## Self-review notes

- **Spec coverage:** signature verification (T4), raw-body requirement (T6 + handler `config`), `invitee.created` filtering + dedup + match precedence email→phone→create (T7), Close status/Booked/note + UTM-on-create (T7), `findLeadByEmail`/`createNote` helpers (T2/T3), `calendly_bookings` table (T1), bare-link/no-form handling (T7 create path; runbook notes), env + setup (T8), optional funnel prefill (T9), live verification (T10). Cancellations intentionally out of scope per spec.
- **Deviation from spec:** signature verification does NOT enforce a timestamp tolerance window — documented in T4 and the runbook, because Calendly's retries reuse the original timestamp and dedup already covers replay.
- **Type consistency:** `resolveLead` returns `{ closeLeadId, leadRowId, matchedBy, created }` and every caller/test uses those exact keys; `parseInviteeCreated` returns `{ inviteeUri, eventUri, name, email, phone, timezone, eventName, startTime, questionsAndAnswers, utm:{source,medium,campaign,content,term} }`, matched by the handler and tests.
