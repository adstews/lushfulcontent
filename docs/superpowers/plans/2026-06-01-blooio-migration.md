# SendBlue → Blooio Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all outbound iMessage from SendBlue to Blooio behind a swappable provider interface, with a daily new-conversation throttle + backfill queue so we stay under Blooio's shared-plan cap.

**Architecture:** A thin `lib/imessage-provider.js` selects the active provider (`blooio` default). `lib/blooio.js` implements `sendMessage` against `POST /chats/{phone}/messages`. Inbound arrives at a new HMAC-verified `api/imessage/inbound.js` and feeds the existing STOP/suppress/pause/log pipeline. A `lib/new-convo-throttle.js` + `imessage_contacts` table gates *first-contact* sends in the cron so organic (~5/day) + backfill (115 leads) stay under the cap. The sequence engine, opt-outs, scheduled-messages, Close sync, and console UI are unchanged.

**Tech Stack:** Node (@vercel/node serverless), Supabase (service-role), Blooio iMessage REST API (Bearer), vitest (`globals: false`).

**Spec:** `docs/superpowers/specs/2026-06-01-blooio-migration-design.md`
**Branch:** `blooio-migration` (stacked on `sequence-stop-conditions`).

---

## Prerequisites
- [ ] node_modules is symlinked in this worktree (done at setup). Verify: `cd /Users/nicholasstewart/Claude/lushfulcontent/.worktrees/blooio-migration && npm test -- --run lib/__tests__/sequences.test.js` passes.
- **Spec correction applied here:** `lib/hmac-signature.js` is NEW (Blooio HMAC); `lib/calendly.js` is NOT modified (it uses a URL secret post-refactor). `sendReaction` for Blooio is deferred (endpoint not in the docs we pulled) — see Task 9.

**Single-file test:** `npx vitest run <path>` · **Full suite:** `npm test`

## File Structure
- **New:** `lib/phone.js`, `lib/blooio.js`, `lib/hmac-signature.js`, `lib/new-convo-throttle.js`, `lib/imessage-provider.js`, `api/imessage/inbound.js`, `supabase/migrations/20260601100000_imessage_contacts.sql`, + tests.
- **Modify:** `lib/sendblue.js` (re-export normalizePhone from phone.js), `lib/imessage-bridge.js` (import provider interface), `api/cron/sequence-tick.js` (throttle gate), `.env.example`, `api/sendblue/health.js`.
- **Unchanged:** sequences, opt-outs, scheduled-messages, Close, console UI, calendly.

---

## Task 1: Extract `normalizePhone` to `lib/phone.js`

**Files:** Create `lib/phone.js`, `lib/__tests__/phone.test.js`; Modify `lib/sendblue.js`.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/phone.test.js`

```js
import { describe, it, expect } from 'vitest'
import { normalizePhone } from '../phone.js'

describe('normalizePhone', () => {
  it('keeps E.164 with +', () => expect(normalizePhone('+15550100123')).toBe('+15550100123'))
  it('adds +1 for 10-digit US', () => expect(normalizePhone('5550100123')).toBe('+15550100123'))
  it('adds + for 11-digit leading 1', () => expect(normalizePhone('15550100123')).toBe('+15550100123'))
  it('strips formatting', () => expect(normalizePhone('(555) 010-0123')).toBe('+15550100123'))
  it('returns null for empty', () => expect(normalizePhone('')).toBe(null))
  it('returns null for null', () => expect(normalizePhone(null)).toBe(null))
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run lib/__tests__/phone.test.js` → module not found.

- [ ] **Step 3: Create `lib/phone.js`** (move the function verbatim from sendblue.js)

```js
// Normalize a phone string to E.164-ish form. Strips all but digits and a
// leading +; assumes US (+1) for bare 10-digit numbers.
export function normalizePhone(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (hasPlus) return '+' + digits
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return '+' + digits
}
```

- [ ] **Step 4: Re-export from `lib/sendblue.js`** — replace the `export function normalizePhone(...) {...}` block (lines ~16-29) with:

```js
export { normalizePhone } from './phone.js'
```
(Leave the rest of `sendblue.js` as-is; its internal `normalizePhone(phone)` calls still resolve via the re-export.)

- [ ] **Step 5: Run** — `npx vitest run lib/__tests__/phone.test.js lib/__tests__/sendblue.test.js` → PASS (existing sendblue tests unaffected).

- [ ] **Step 6: Commit**
```bash
git add lib/phone.js lib/__tests__/phone.test.js lib/sendblue.js
git commit -m "refactor(phone): extract normalizePhone to lib/phone.js"
```

---

## Task 2: `lib/blooio.js` — Blooio send client

**Files:** Create `lib/blooio.js`, `lib/__tests__/blooio.test.js`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const { sendMessage } = await import('../blooio.js')

beforeEach(() => {
  process.env.BLOOIO_API_KEY = 'bk_test'
  delete process.env.BLOOIO_FROM_NUMBER
  globalThis.fetch = vi.fn()
})
afterEach(() => { vi.restoreAllMocks() })

describe('blooio.sendMessage', () => {
  it('POSTs to /chats/{phone}/messages with Bearer auth and returns message_handle', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm_123' }) })
    const r = await sendMessage({ phone: '5550100123', message: 'hi' })
    const [url, opts] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('https://backend.blooio.com/v2/api/chats/+15550100123/messages')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer bk_test')
    expect(JSON.parse(opts.body).text).toBe('hi')
    expect(r.message_handle).toBe('m_123')
  })

  it('sends media as attachments array', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm_2' }) })
    await sendMessage({ phone: '+15550100123', message: '', mediaUrl: 'https://x/y.jpg' })
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).attachments).toEqual(['https://x/y.jpg'])
  })

  it('throws on phone missing', async () => {
    await expect(sendMessage({ phone: '', message: 'x' })).rejects.toThrow(/phone is required/)
  })
  it('throws on no message and no media', async () => {
    await expect(sendMessage({ phone: '+15550100123', message: '' })).rejects.toThrow(/message or mediaUrl/)
  })
  it('throws on non-ok response', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'bad' })
    await expect(sendMessage({ phone: '+15550100123', message: 'hi' })).rejects.toThrow(/Blooio send failed: 422/)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run lib/__tests__/blooio.test.js`.

- [ ] **Step 3: Create `lib/blooio.js`**

```js
import crypto from 'node:crypto'
import { normalizePhone } from './phone.js'

const BASE = 'https://backend.blooio.com/v2/api'

function authHeaders() {
  const key = process.env.BLOOIO_API_KEY
  if (!key) throw new Error('Blooio env var missing: BLOOIO_API_KEY')
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

// chatId = recipient phone in E.164; Blooio auto-creates the chat.
export async function sendMessage({ phone, message, mediaUrl, fromNumber }) {
  const number = normalizePhone(phone)
  if (!number) throw new Error('Blooio sendMessage: phone is required')
  const hasMessage = typeof message === 'string' && message.length > 0
  const hasMedia = typeof mediaUrl === 'string' && mediaUrl.length > 0
  if (!hasMessage && !hasMedia) throw new Error('Blooio sendMessage: message or mediaUrl is required')

  const body = { text: hasMessage ? message : '', 'Idempotency-Key': crypto.randomUUID() }
  if (hasMedia) body.attachments = [mediaUrl]
  const from = fromNumber || process.env.BLOOIO_FROM_NUMBER
  if (from) body.from_number = from

  const res = await fetch(`${BASE}/chats/${encodeURIComponent(number)}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Blooio send failed: ${res.status} ${text}`)
  }
  const json = await res.json()
  return { ...json, message_handle: json.message_id ?? json.id ?? null }
}

// Health check: list webhooks (auth-scoped, read-only) to verify the key.
export async function checkAuth() {
  const res = await fetch(`${BASE}/webhooks`, { method: 'GET', headers: authHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Blooio auth check failed: ${res.status} ${text}`)
  }
  return res.json()
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run lib/__tests__/blooio.test.js`.

- [ ] **Step 5: Commit**
```bash
git add lib/blooio.js lib/__tests__/blooio.test.js
git commit -m "feat(blooio): send client (POST /chats/{phone}/messages)"
```

---

## Task 3: `lib/hmac-signature.js` — Blooio webhook verification

**Files:** Create `lib/hmac-signature.js`, `lib/__tests__/hmac-signature.test.js`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { verifyHmacSignature, readRawBody } from '../hmac-signature.js'

function sign(secret, t, body) {
  return crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
}

afterEach(() => { vi.useRealTimers() })

describe('verifyHmacSignature', () => {
  const secret = 'whsec_test'; const body = '{"event":"message.received"}'
  it('accepts a valid current signature', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    const t = Math.floor(Date.now() / 1000)
    expect(verifyHmacSignature(body, `t=${t},v1=${sign(secret, t, body)}`, secret)).toBe(true)
  })
  it('rejects a wrong signature', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    const t = Math.floor(Date.now() / 1000)
    expect(verifyHmacSignature(body, `t=${t},v1=deadbeef`, secret)).toBe(false)
  })
  it('rejects an expired timestamp (>5 min)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:10:00Z'))
    const t = Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000) // 10 min old
    expect(verifyHmacSignature(body, `t=${t},v1=${sign(secret, t, body)}`, secret)).toBe(false)
  })
  it('returns false when secret missing or header malformed', () => {
    expect(verifyHmacSignature(body, 't=1,v1=x', '')).toBe(false)
    expect(verifyHmacSignature(body, 'garbage', secret)).toBe(false)
  })
})

describe('readRawBody', () => {
  it('returns req.rawBody when present', async () => {
    expect(await readRawBody({ rawBody: '{"a":1}' })).toBe('{"a":1}')
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run lib/__tests__/hmac-signature.test.js`.

- [ ] **Step 3: Create `lib/hmac-signature.js`**

```js
import crypto from 'node:crypto'

// Verify an HMAC-SHA256 signature header of the form "t=<unix>,v1=<hex>" over
// `${t}.${rawBody}`. Rejects signatures older than 5 minutes (replay guard).
export function verifyHmacSignature(rawBody, signatureHeader, secret, maxAgeSec = 300) {
  if (!secret || !signatureHeader) return false
  const parts = {}
  for (const seg of String(signatureHeader).split(',')) {
    const i = seg.indexOf('=')
    if (i !== -1) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim()
  }
  const { t, v1 } = parts
  if (!t || !v1) return false
  const age = Math.floor(Date.now() / 1000) - parseInt(t, 10)
  if (!Number.isFinite(age) || age > maxAgeSec || age < -maxAgeSec) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  let a, b
  try { a = Buffer.from(expected, 'hex'); b = Buffer.from(v1, 'hex') } catch { return false }
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Buffer the raw request body (needed because the HMAC is over exact bytes).
// Honors req.rawBody if the platform exposes it; route must set bodyParser:false.
export function readRawBody(req) {
  if (req.rawBody) return Promise.resolve(typeof req.rawBody === 'string' ? req.rawBody : req.rawBody.toString('utf8'))
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add lib/hmac-signature.js lib/__tests__/hmac-signature.test.js
git commit -m "feat(lib): HMAC webhook signature verification + readRawBody"
```

---

## Task 4: `imessage_contacts` migration

**Files:** Create `supabase/migrations/20260601100000_imessage_contacts.sql`.

- [ ] **Step 1: Write the migration**
```sql
-- Tracks the first time we opened an iMessage conversation with a phone, so the
-- new-conversation throttle can stay under Blooio's shared-plan daily cap.
-- RLS OFF -- service-role only.
create table public.imessage_contacts (
  phone text primary key,                       -- normalized E.164
  first_contacted_at timestamptz not null default now()
);
create index imessage_contacts_first_contacted_idx
  on public.imessage_contacts (first_contacted_at);
```
- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/20260601100000_imessage_contacts.sql
git commit -m "feat(db): imessage_contacts table for new-conversation throttle"
```

---

## Task 5: `lib/new-convo-throttle.js`

**Files:** Create `lib/new-convo-throttle.js`, `lib/__tests__/new-convo-throttle.test.js`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))
const { getSupabase } = await import('../supabase.js')
const { isNewConversation, tryReserveNewConversation } = await import('../new-convo-throttle.js')
afterEach(() => { vi.clearAllMocks() })

describe('isNewConversation', () => {
  it('false when a contact row exists', async () => {
    getSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ phone: '+1' }], error: null }) }) }) }) })
    expect(await isNewConversation('+15550100123')).toBe(false)
  })
  it('true when no row', async () => {
    getSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) })
    expect(await isNewConversation('+15550100123')).toBe(true)
  })
})

describe('tryReserveNewConversation', () => {
  function mock({ existing = [], todayCount = 0, insertError = null }) {
    return {
      from: (t) => ({
        select: (cols, opts) => ({
          eq: () => ({ limit: () => Promise.resolve({ data: existing, error: null }) }),
          gte: () => Promise.resolve({ count: todayCount, error: null })
        }),
        insert: () => Promise.resolve({ error: insertError })
      })
    }
  }
  it('returns isNew:false when already contacted (no count against cap)', async () => {
    getSupabase.mockReturnValue(mock({ existing: [{ phone: '+1' }] }))
    expect(await tryReserveNewConversation('+15550100123', 14)).toEqual({ ok: true, isNew: false })
  })
  it('reserves when new and under cap', async () => {
    getSupabase.mockReturnValue(mock({ existing: [], todayCount: 5 }))
    const r = await tryReserveNewConversation('+15550100123', 14)
    expect(r).toEqual({ ok: true, isNew: true })
  })
  it('defers when new and at cap', async () => {
    getSupabase.mockReturnValue(mock({ existing: [], todayCount: 14 }))
    const r = await tryReserveNewConversation('+15550100123', 14)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('daily-cap')
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Create `lib/new-convo-throttle.js`**

```js
import { getSupabase } from './supabase.js'
import { normalizePhone } from './phone.js'

function startOfUtcDayIso(now) {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

export async function isNewConversation(phone) {
  const n = normalizePhone(phone)
  if (!n) return false
  const sb = getSupabase()
  const { data, error } = await sb.from('imessage_contacts').select('phone').eq('phone', n).limit(1)
  if (error) throw new Error(error.message)
  return !(Array.isArray(data) && data.length > 0)
}

async function newConvosToday(sb, now) {
  const { count, error } = await sb
    .from('imessage_contacts')
    .select('phone', { count: 'exact', head: true })
    .gte('first_contacted_at', startOfUtcDayIso(now))
  if (error) throw new Error(error.message)
  return count || 0
}

// Reserve a new-conversation slot. Already-contacted phones return ok:true,
// isNew:false and do NOT count. New phones consume a slot only if under cap.
export async function tryReserveNewConversation(phone, cap, now = new Date()) {
  const n = normalizePhone(phone)
  if (!n) return { ok: false, reason: 'bad-phone' }
  const sb = getSupabase()
  const { data: existing, error: exErr } = await sb.from('imessage_contacts').select('phone').eq('phone', n).limit(1)
  if (exErr) throw new Error(exErr.message)
  if (Array.isArray(existing) && existing.length > 0) return { ok: true, isNew: false }
  if ((await newConvosToday(sb, now)) >= cap) return { ok: false, reason: 'daily-cap' }
  const { error: insErr } = await sb.from('imessage_contacts').insert({ phone: n, first_contacted_at: new Date(now).toISOString() })
  if (insErr) {
    if (String(insErr.message).includes('duplicate key')) return { ok: true, isNew: false } // raced; already contacted
    throw new Error(insErr.message)
  }
  return { ok: true, isNew: true }
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add lib/new-convo-throttle.js lib/__tests__/new-convo-throttle.test.js
git commit -m "feat(lib): new-conversation daily throttle"
```

---

## Task 6: Provider interface + wire `imessage-bridge`

**Files:** Create `lib/imessage-provider.js`; Modify `lib/imessage-bridge.js`, `lib/__tests__/imessage-bridge.test.js`.

- [ ] **Step 1: Create `lib/imessage-provider.js`**
```js
// Selects the active iMessage provider. Default blooio; set IMESSAGE_PROVIDER=sendblue to fall back.
import * as blooio from './blooio.js'
import * as sendblue from './sendblue.js'
export { normalizePhone } from './phone.js'

function active() {
  return process.env.IMESSAGE_PROVIDER === 'sendblue' ? sendblue : blooio
}
export function sendMessage(args) { return active().sendMessage(args) }
export function sendReaction(args) {
  const p = active()
  if (typeof p.sendReaction !== 'function') throw new Error('sendReaction not supported by active provider')
  return p.sendReaction(args)
}
```

- [ ] **Step 2: Update the failing test** in `lib/__tests__/imessage-bridge.test.js` — change the provider mock. Replace the `vi.mock('../sendblue.js', ...)` block with a mock of the provider interface:
```js
vi.mock('../imessage-provider.js', () => ({
  sendMessage: vi.fn(),
  normalizePhone: (await import('../phone.js')).normalizePhone
}))
```
and change `const { sendMessage } = await import('../sendblue.js')` to `const { sendMessage } = await import('../imessage-provider.js')`. (Keep `isSuppressed` opt-outs mock + the existing `close.js`/`supabase.js` mocks.)

- [ ] **Step 3: Run, expect FAIL** (bridge still imports from sendblue) — `npx vitest run lib/__tests__/imessage-bridge.test.js`.

- [ ] **Step 4: Modify `lib/imessage-bridge.js`** — change the top import:
```js
import { sendMessage, normalizePhone } from './imessage-provider.js'
```
(Everything else in `sendImessage` — including the `isSuppressed` guard — stays identical.)

- [ ] **Step 5: Run, expect PASS** — `npx vitest run lib/__tests__/imessage-bridge.test.js`.

- [ ] **Step 6: Commit**
```bash
git add lib/imessage-provider.js lib/imessage-bridge.js lib/__tests__/imessage-bridge.test.js
git commit -m "feat(provider): route sendImessage through a swappable provider interface (blooio default)"
```

---

## Task 7: `api/imessage/inbound.js` — Blooio inbound webhook

**Files:** Create `api/imessage/inbound.js`, `api/__tests__/imessage-inbound.test.js`.

The handler mirrors `api/sendblue/inbound.js`'s downstream logic (STOP→suppress/unenroll, log, pause, push) but parses Blooio's payload and verifies the HMAC signature.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
vi.mock('../../lib/close.js', () => ({ findLeadByPhone: vi.fn() }))
vi.mock('../../lib/imessage-bridge.js', () => ({ logImessageActivity: vi.fn() }))
vi.mock('../../lib/web-push.js', () => ({ pushToAll: vi.fn() }))
vi.mock('../../lib/opt-outs.js', () => ({ suppressPhone: vi.fn() }))
vi.mock('../../lib/sequences.js', async (orig) => ({ ...(await orig()), unenrollAllForLead: vi.fn(), pauseEnrollmentsForLead: vi.fn() }))

const { findLeadByPhone } = await import('../../lib/close.js')
const { logImessageActivity } = await import('../../lib/imessage-bridge.js')
const { pushToAll } = await import('../../lib/web-push.js')
const { suppressPhone } = await import('../../lib/opt-outs.js')
const { unenrollAllForLead, pauseEnrollmentsForLead } = await import('../../lib/sequences.js')
const handler = (await import('../imessage/inbound.js')).default

const SECRET = 'whsec_test'
function signed(payload) {
  const raw = JSON.stringify(payload)
  const t = Math.floor(Date.now() / 1000)
  const v1 = crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')
  return { raw, header: `t=${t},v1=${v1}` }
}
function makeReqRes(payload) {
  const { raw, header } = signed(payload)
  const req = { method: 'POST', rawBody: raw, headers: { 'x-blooio-signature': header } }
  const res = { statusCode: 200, _json: null, status(c){this.statusCode=c;return this}, json(o){this._json=o;return this} }
  return { req, res }
}

beforeEach(() => {
  process.env.BLOOIO_WEBHOOK_SIGNING_SECRET = SECRET
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
  pushToAll.mockResolvedValue({ ok: true, sent: 0 })
  pauseEnrollmentsForLead.mockResolvedValue({ affected: 0 })
})
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('POST /api/imessage/inbound', () => {
  it('401 on bad signature', async () => {
    const { req, res } = makeReqRes({ event: 'message.received', sender: '+15550100123', text: 'hi' })
    req.headers['x-blooio-signature'] = 't=1,v1=bad'
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })
  it('message.received with no lead → suppress only on STOP, matched:false', async () => {
    findLeadByPhone.mockResolvedValue(null)
    const { req, res } = makeReqRes({ event: 'message.received', sender: '+15550100123', text: 'STOP' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.matched).toBe(false)
    expect(suppressPhone).toHaveBeenCalledWith(expect.objectContaining({ phone: '+15550100123', leadId: null }))
  })
  it('message.received with lead → logs + pauses on a normal reply', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_1', contactId: null, displayName: 'A' })
    logImessageActivity.mockResolvedValue({ ok: true })
    pauseEnrollmentsForLead.mockResolvedValue({ affected: 1 })
    const { req, res } = makeReqRes({ event: 'message.received', sender: '+15550100123', text: 'hello', message_id: 'm1' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(logImessageActivity).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_1', direction: 'inbound', message: 'hello', phone: '+15550100123' }))
    expect(pauseEnrollmentsForLead).toHaveBeenCalled()
    expect(suppressPhone).not.toHaveBeenCalled()
  })
  it('ignores non-message events (200 skip)', async () => {
    const { req, res } = makeReqRes({ event: 'message.delivered', message_id: 'm1' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(findLeadByPhone).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Create `api/imessage/inbound.js`**
```js
import { normalizePhone } from '../../lib/phone.js'
import { findLeadByPhone } from '../../lib/close.js'
import { logImessageActivity } from '../../lib/imessage-bridge.js'
import { pushToAll } from '../../lib/web-push.js'
import { suppressPhone } from '../../lib/opt-outs.js'
import { pauseEnrollmentsForLead, unenrollAllForLead, isStopKeyword } from '../../lib/sequences.js'
import { verifyHmacSignature, readRawBody } from '../../lib/hmac-signature.js'

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const raw = await readRawBody(req)
  const secret = process.env.BLOOIO_WEBHOOK_SIGNING_SECRET
  if (!verifyHmacSignature(raw, req.headers['x-blooio-signature'], secret)) {
    return res.status(401).json({ error: 'invalid signature' })
  }
  let body
  try { body = JSON.parse(raw) } catch { return res.status(400).json({ error: 'invalid json' }) }

  if (body.event !== 'message.received') {
    return res.status(200).json({ ok: true, skipped: body.event || 'unknown event' })
  }

  const phone = normalizePhone(body.sender)
  const message = body.text ?? ''
  const mediaUrl = Array.isArray(body.attachments) && body.attachments.length ? body.attachments[0] : null
  const handle = body.message_id ?? null
  if (!phone) return res.status(400).json({ error: 'invalid sender' })
  if (!message && !mediaUrl) return res.status(400).json({ error: 'empty message' })

  const stop = isStopKeyword(message)

  let lead = null
  try { lead = await findLeadByPhone(phone) }
  catch (err) { return res.status(502).json({ error: `Close lookup failed: ${err.message}` }) }

  if (stop) {
    try { await suppressPhone({ phone, leadId: lead?.closeLeadId ?? null, reason: 'stop-keyword' }) }
    catch (err) { console.error('imessage/inbound suppressPhone failed', err) }
    if (lead) { try { await unenrollAllForLead(lead.closeLeadId, 'stop keyword') } catch (err) { console.error(err) } }
  }

  if (!lead) return res.status(200).json({ ok: true, matched: false, phone, suppressed: stop })

  const logResult = await logImessageActivity({
    leadId: lead.closeLeadId, leadName: lead.displayName, contactId: lead.contactId,
    direction: 'inbound', message: message || '', phone, mediaUrl, sendblueHandle: handle
  })

  let sequenceAction = null
  try {
    if (stop) sequenceAction = 'unenrolled-all-stop'
    else { const r = await pauseEnrollmentsForLead(lead.closeLeadId, 'inbound reply'); if (r.affected > 0) sequenceAction = `paused-${r.affected}` }
  } catch (err) { console.error('imessage/inbound sequence side-effect failed', err) }

  let pushed = 0
  try { pushed = (await pushToAll({ title: lead.displayName || phone, body: message || (mediaUrl ? '📎 Attachment' : ''), tag: `lead:${lead.closeLeadId}`, data: { leadId: lead.closeLeadId, phone, url: '/imessage' } })).sent || 0 }
  catch (err) { console.error('imessage/inbound push failed', err) }

  return res.status(200).json({ ok: true, matched: true, phone, leadId: lead.closeLeadId, logged: logResult.ok, pushed, sequenceAction })
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add api/imessage/inbound.js api/__tests__/imessage-inbound.test.js
git commit -m "feat(inbound): Blooio inbound webhook (HMAC-verified) feeding the existing pipeline"
```

---

## Task 8: Throttle-gate first-contact sends in the cron

**Files:** Modify `api/cron/sequence-tick.js`, `api/cron/__tests__/sequence-tick.test.js`.

Gate the drip-step send (`fireOne`) and the scheduled-message (reminder) drain on the new-conversation budget. Reuse the helper from Task 5.

- [ ] **Step 1: Add the failing tests** — in `sequence-tick.test.js`, mock the throttle:
```js
vi.mock('../../../lib/new-convo-throttle.js', () => ({ isNewConversation: vi.fn(), tryReserveNewConversation: vi.fn() }))
const { isNewConversation, tryReserveNewConversation } = await import('../../../lib/new-convo-throttle.js')
```
Defaults in `beforeEach`: `isNewConversation.mockResolvedValue(false); tryReserveNewConversation.mockResolvedValue({ ok: true, isNew: false })` (so existing tests treat everyone as already-contacted → ungated). Add:
```js
  it('defers a drip step to a NEW contact when the daily cap is exhausted', async () => {
    findDueSends.mockResolvedValue([{ enrollment: { id: 'e1', sequence_id: 's1', lead_id: 'L1', next_step_position: 0, phone: '+15550100199' }, step: { id: 'st1', message_template: 'hi' }, scheduledFor: new Date(), totalSteps: 2 }])
    tryAdvanceEnrollment.mockResolvedValue(true)
    isNewConversation.mockResolvedValue(true)
    tryReserveNewConversation.mockResolvedValue({ ok: false, reason: 'daily-cap' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(sendImessage).not.toHaveBeenCalled()
    expect(res._json.deferred).toBeGreaterThanOrEqual(1)
  })
```
> Note: `fireOne` must check the throttle **before** `tryAdvanceEnrollment` so a deferred step isn't advanced. Adjust the deferral test/impl so the enrollment is not advanced when deferred.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Modify `api/cron/sequence-tick.js`** — add import and gate. At top:
```js
import { isNewConversation, tryReserveNewConversation } from '../../lib/new-convo-throttle.js'
const NEW_CONVO_CAP = parseInt(process.env.IMESSAGE_NEW_CONVO_DAILY_CAP || '14', 10)
```
In `fireOne`, immediately after resolving `phone` and BEFORE `tryAdvanceEnrollment`, add:
```js
  // New-conversation throttle: a first-contact drip step consumes a daily slot.
  if (await isNewConversation(phone)) {
    const r = await tryReserveNewConversation(phone, NEW_CONVO_CAP)
    if (!r.ok) return { deferred: true }
  }
```
(Move the `phone` resolution above `tryAdvanceEnrollment` if needed; today `fireOne` advances first. Re-order so: resolve phone → throttle check → `tryAdvanceEnrollment` → send.) In `drainScheduledMessages`, before `sendImessage`, add the same gate keyed on `m.phone`; on defer, leave the row `pending` (don't claim) — i.e. check the throttle BEFORE `claimScheduledMessage`. Tally `deferred` and include it in the handler's JSON response.

- [ ] **Step 4: Run, expect PASS** (existing cron tests still green — they default to already-contacted).

- [ ] **Step 5: Commit**
```bash
git add api/cron/sequence-tick.js api/cron/__tests__/sequence-tick.test.js
git commit -m "feat(cron): gate first-contact sends on the new-conversation daily budget"
```

---

## Task 9: Env, health, and deferred reactions

**Files:** Modify `.env.example`, `api/sendblue/health.js` (or a neutral health), and document deferred `sendReaction`.

- [ ] **Step 1:** Append to `.env.example`:
```
# iMessage provider (blooio default; sendblue legacy fallback)
IMESSAGE_PROVIDER=blooio
BLOOIO_API_KEY=
BLOOIO_WEBHOOK_SIGNING_SECRET=
BLOOIO_FROM_NUMBER=
IMESSAGE_NEW_CONVO_DAILY_CAP=14
```
- [ ] **Step 2:** In the health endpoint, when `IMESSAGE_PROVIDER!== 'sendblue'`, call `blooio.checkAuth()` instead of SendBlue's; report `{ service: 'blooio', ok }`. (Add a test mirroring the existing health test.)
- [ ] **Step 3:** Add a one-line code comment in `lib/imessage-provider.js` `sendReaction` that Blooio's reaction-send endpoint is unconfirmed (the console tap-back button is non-critical and may surface a clear error until confirmed). **Follow-up task (not blocking):** confirm Blooio's reaction-send endpoint and implement `blooio.sendReaction`.
- [ ] **Step 4: Commit**
```bash
git add .env.example api/sendblue/health.js api/sendblue/__tests__/health.test.js lib/imessage-provider.js
git commit -m "chore(blooio): env, health check, document deferred reactions"
```

---

## Task 10: Cutover + backfill (ops, no app code)

- [ ] Create the Blooio Commercial Shared account; generate API key + create the inbound webhook pointed at `https://lushfulcontent.vercel.app/api/imessage/inbound`; **capture the one-time `whsec_` signing secret**.
- [ ] Set Vercel prod env: `IMESSAGE_PROVIDER=blooio`, `BLOOIO_API_KEY`, `BLOOIO_WEBHOOK_SIGNING_SECRET`, `BLOOIO_FROM_NUMBER` (after number assignment/port), `IMESSAGE_NEW_CONVO_DAILY_CAP` (confirm Blooio's real cap first).
- [ ] Apply migrations (`imessage_contacts` + the stop-conditions migrations if not already deployed).
- [ ] Smoke test on a preview/prod deploy: one outbound (drip), one inbound (verify HMAC + STOP suppression + throttle row written).
- [ ] **Port the SendBlue number to Blooio** (3–5 business days) for continuity, OR start on a Blooio number.
- [ ] **Backfill the 115 leads:** enroll them (warmest-first) into a single-step reactivation sequence; the throttle drains them at ≤ `(cap − organic)`/day (~10/day → ~12 days). Confirm reactivation copy before enabling.
- [ ] Decommission SendBlue once verified (`IMESSAGE_PROVIDER` can flip back as a safety valve; remove `lib/sendblue.js` + `/api/sendblue/*` in a later cleanup).

---

## Self-Review

**Spec coverage:** provider interface (T6) ✓; blooio client (T2) ✓; HMAC inbound (T3+T7) ✓; throttle table+lib (T4+T5) ✓; throttle gate in cron (T8) ✓; backfill (T10) ✓; env/health (T9) ✓; engine/opt-outs/scheduled-messages/Close/console unchanged ✓. **Correction vs spec:** `lib/calendly.js` is NOT modified (post-refactor it uses a URL secret, not HMAC), so `lib/hmac-signature.js` is new rather than a shared extraction — noted in Prerequisites. `sendReaction` for Blooio is explicitly deferred (T9) since its endpoint wasn't in the pulled docs.

**Placeholder scan:** migration timestamp is concrete; the only deferred item (`blooio.sendReaction`) is called out as a non-blocking follow-up with a clear runtime error, not a silent stub. No "TODO/handle edge cases" in code steps.

**Type consistency:** `sendMessage` returns `{ ...json, message_handle }`, matching what `imessage-bridge.sendImessage` reads (`sent?.send?.message_handle` via the bridge's existing wrapper). `tryReserveNewConversation(phone, cap)` and `isNewConversation(phone)` signatures match between T5 and T8. `verifyHmacSignature(rawBody, header, secret)` / `readRawBody(req)` match between T3 and T7. `normalizePhone` is imported from `lib/phone.js` everywhere after T1.
