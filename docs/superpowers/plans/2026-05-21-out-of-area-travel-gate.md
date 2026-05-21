# Out-of-Area Travel Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a conditional "willing to travel?" form step into `girthfill-form.html` that fires only when the visitor's phone area code AND IP location are both >100mi from the lander's anchor city (NYC or SD).

**Architecture:** Three-signal cascade evaluated at Contact-step submit. Phone area code lookup against a hardcoded per-anchor allowlist short-circuits to "skip" for likely-local visitors. Otherwise an eagerly-fetched `/api/geo` response (reading Vercel's free IP geo headers) provides the IP-based fallback. If both signals say out-of-area, a new `stepTravel` is shown; "No" routes to the existing `stepNoThanks` disqualification path with `qualified: false` + `travel_status: declined_travel`. "Yes" advances to `stepOptions` with `travel_status: willing_to_travel`. Locals get `travel_status: local` without seeing the step.

**Tech Stack:** Vanilla JS IIFE (matching `js/attribution.js` pattern), Vercel serverless function (Node, no extra deps), Vitest for tests, Supabase migration for the new column, Zod for the API schema.

**Reference spec:** `docs/superpowers/specs/2026-05-21-out-of-area-travel-gate-design.md`

---

## File Structure

**Create:**
- `api/geo.js` — serverless function reading Vercel `x-vercel-ip-*` headers.
- `api/__tests__/geo.test.js` — unit tests.
- `js/geo-gate.js` — IIFE attaching `window.lushfulGeoGate` with anchors, area-code allowlist, helpers, and `evaluateGate`.
- `js/__tests__/geo-gate.test.js` — VM-context unit tests (matches `attribution.test.js` pattern).
- `supabase/migrations/20260521120000_add_travel_status.sql` — adds `travel_status` column to `public.leads`.

**Modify:**
- `api/lead-update.js` — extend `BodySchema` to accept `travel_status`; add Close custom-field write.
- `api/__tests__/lead-update.test.js` — extend tests for the new branch.
- `girthfill-form.html` — add `stepTravel` markup; wire eager geo fetch, cascade evaluation, and `answerTravel(willing)`.
- `girthfill-form-google.html` — mirror the same edits.

**Manual setup (deploy step, not code):**
- Create custom field "Travel Status" in Close (choice; options: `Local`, `Willing to Travel`, `Declined Travel`).
- Set Vercel env var `CLOSE_CF_TRAVEL_STATUS` to the field's Close ID.
- Apply the Supabase migration.

---

## Task 1: Supabase migration for `travel_status`

**Files:**
- Create: `supabase/migrations/20260521120000_add_travel_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add travel_status to leads. Set by /api/lead-update when the user
-- answers the in-person travel confirmation step on girthfill-form.
-- NULL means the gate didn't run (legacy rows or non-girthfill sources).
alter table public.leads
  add column travel_status text;

-- Optional sanity check at write time. Keep aligned with the JS enum and
-- the Zod schema in api/lead-update.js.
alter table public.leads
  add constraint leads_travel_status_check
  check (travel_status is null or travel_status in (
    'local', 'willing_to_travel', 'declined_travel'
  ));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260521120000_add_travel_status.sql
git commit -m "feat(leads): add travel_status column for out-of-area gate"
```

**Note:** Don't apply the migration to production yet — it'll go live with the rest of the change.

---

## Task 2: `/api/geo` endpoint

Returns the visitor's lat/lng/city from Vercel's edge headers. No external API, no key.

**Files:**
- Create: `api/geo.js`
- Test: `api/__tests__/geo.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/__tests__/geo.test.js
import { describe, it, expect } from 'vitest'
import handler from '../geo.js'

function makeReqRes(headers = {}) {
  const req = { method: 'GET', headers }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

describe('GET /api/geo', () => {
  it('returns 405 for non-GET', async () => {
    const { req, res } = makeReqRes()
    req.method = 'POST'
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns coords from Vercel headers', async () => {
    const { req, res } = makeReqRes({
      'x-vercel-ip-latitude': '40.7589',
      'x-vercel-ip-longitude': '-73.9851',
      'x-vercel-ip-city': 'New%20York',
      'x-vercel-ip-country': 'US'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({
      lat: 40.7589,
      lng: -73.9851,
      city: 'New York',
      country: 'US'
    })
  })

  it('returns nulls when headers missing', async () => {
    const { req, res } = makeReqRes({})
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({ lat: null, lng: null, city: null, country: null })
  })

  it('returns nulls when headers are unparseable', async () => {
    const { req, res } = makeReqRes({
      'x-vercel-ip-latitude': 'not-a-number',
      'x-vercel-ip-longitude': ''
    })
    await handler(req, res)
    expect(res._json.lat).toBeNull()
    expect(res._json.lng).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/__tests__/geo.test.js`
Expected: FAIL — file not found.

- [ ] **Step 3: Write the implementation**

```js
// api/geo.js
// Reads visitor location from Vercel's automatic IP-geo headers and returns
// it as JSON. No external dependency — Vercel attaches these headers to
// every serverless function request based on its own GeoIP DB.
// https://vercel.com/docs/edge-network/headers#x-vercel-ip-*
function parseFloatOrNull(v) {
  if (typeof v !== 'string' || v.length === 0) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function decodeOrNull(v) {
  if (typeof v !== 'string' || v.length === 0) return null
  try { return decodeURIComponent(v) } catch { return v }
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  const h = req.headers || {}
  return res.status(200).json({
    lat: parseFloatOrNull(h['x-vercel-ip-latitude']),
    lng: parseFloatOrNull(h['x-vercel-ip-longitude']),
    city: decodeOrNull(h['x-vercel-ip-city']),
    country: decodeOrNull(h['x-vercel-ip-country'])
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/__tests__/geo.test.js`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/geo.js api/__tests__/geo.test.js
git commit -m "feat(api): add /api/geo reading Vercel IP-geo headers"
```

---

## Task 3: `js/geo-gate.js` browser helpers

IIFE attaching `window.lushfulGeoGate` with the anchor table, area-code allowlist, and pure helpers. Matches the `js/attribution.js` pattern so we can test it with a VM context.

**Files:**
- Create: `js/geo-gate.js`
- Test: `js/__tests__/geo-gate.test.js`

- [ ] **Step 1: Write the failing test**

```js
// js/__tests__/geo-gate.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(resolve(__dirname, '../geo-gate.js'), 'utf8')

function makeContext() {
  const win = {}
  const ctx = vm.createContext({ window: win, globalThis: win })
  vm.runInContext(SRC, ctx)
  return win.lushfulGeoGate
}

let G
beforeAll(() => { G = makeContext() })

describe('anchorFromSource', () => {
  it('maps girthfill-sd to sd', () => {
    expect(G.anchorFromSource('girthfill-sd')).toBe('sd')
  })
  it('maps girthfill-nyc to nyc', () => {
    expect(G.anchorFromSource('girthfill-nyc')).toBe('nyc')
  })
  it('maps girthfill-landing to nyc (default lander)', () => {
    expect(G.anchorFromSource('girthfill-landing')).toBe('nyc')
  })
  it('falls back to nyc for unknown/empty', () => {
    expect(G.anchorFromSource('')).toBe('nyc')
    expect(G.anchorFromSource(null)).toBe('nyc')
    expect(G.anchorFromSource('something-else')).toBe('nyc')
  })
})

describe('extractAreaCode', () => {
  it('parses common US formats', () => {
    expect(G.extractAreaCode('(212) 555-1234')).toBe('212')
    expect(G.extractAreaCode('212-555-1234')).toBe('212')
    expect(G.extractAreaCode('212.555.1234')).toBe('212')
    expect(G.extractAreaCode('2125551234')).toBe('212')
  })
  it('strips leading country code 1', () => {
    expect(G.extractAreaCode('+1 (212) 555-1234')).toBe('212')
    expect(G.extractAreaCode('12125551234')).toBe('212')
  })
  it('returns null for too-short numbers', () => {
    expect(G.extractAreaCode('555-1234')).toBeNull()
    expect(G.extractAreaCode('')).toBeNull()
    expect(G.extractAreaCode(null)).toBeNull()
  })
  it('returns null for non-US country codes', () => {
    // +44 UK; +52 MX — these aren't NANP so we shouldn't treat the next 3
    // digits as a US area code.
    expect(G.extractAreaCode('+44 20 7946 0958')).toBeNull()
    expect(G.extractAreaCode('+52 55 1234 5678')).toBeNull()
  })
})

describe('haversineMiles', () => {
  it('returns 0 for identical points', () => {
    expect(G.haversineMiles([40, -74], [40, -74])).toBeCloseTo(0, 5)
  })
  it('computes NYC to LA roughly (~2450mi)', () => {
    const d = G.haversineMiles([40.7589, -73.9851], [34.0522, -118.2437])
    expect(d).toBeGreaterThan(2400)
    expect(d).toBeLessThan(2500)
  })
  it('computes NYC to Philly roughly (~80mi)', () => {
    const d = G.haversineMiles([40.7589, -73.9851], [39.9526, -75.1652])
    expect(d).toBeGreaterThan(70)
    expect(d).toBeLessThan(95)
  })
})

describe('evaluateGate', () => {
  const NYC_IP = [40.7589, -73.9851]
  const LA_IP = [34.0522, -118.2437]
  const SD_IP = [32.7157, -117.1611]

  it("returns 'local' when phone area code is in NYC allowlist", () => {
    expect(G.evaluateGate({ phone: '212-555-1234', ipCoords: LA_IP, anchorKey: 'nyc' })).toBe('local')
  })
  it("returns 'local' when phone area code is in SD allowlist", () => {
    expect(G.evaluateGate({ phone: '619-555-1234', ipCoords: NYC_IP, anchorKey: 'sd' })).toBe('local')
  })
  it("returns 'local' when IP is within 100mi (phone non-local)", () => {
    expect(G.evaluateGate({ phone: '415-555-1234', ipCoords: NYC_IP, anchorKey: 'nyc' })).toBe('local')
    expect(G.evaluateGate({ phone: '212-555-1234', ipCoords: SD_IP, anchorKey: 'sd' })).toBe('local')
  })
  it("returns 'show-step' when both signals out of range", () => {
    expect(G.evaluateGate({ phone: '415-555-1234', ipCoords: LA_IP, anchorKey: 'nyc' })).toBe('show-step')
  })
  it("returns 'show-step' when phone non-local and IP unavailable", () => {
    expect(G.evaluateGate({ phone: '415-555-1234', ipCoords: null, anchorKey: 'nyc' })).toBe('show-step')
    expect(G.evaluateGate({ phone: '415-555-1234', ipCoords: { lat: null, lng: null }, anchorKey: 'nyc' })).toBe('show-step')
  })
  it("returns 'show-step' when both signals unavailable", () => {
    expect(G.evaluateGate({ phone: '', ipCoords: null, anchorKey: 'nyc' })).toBe('show-step')
  })
  it("ignores NYC area codes when anchor is SD", () => {
    // 212 is NY, but if user is on the SD lander we want to ask them about
    // traveling to SD specifically.
    expect(G.evaluateGate({ phone: '212-555-1234', ipCoords: LA_IP, anchorKey: 'sd' })).toBe('show-step')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run js/__tests__/geo-gate.test.js`
Expected: FAIL — file not found.

- [ ] **Step 3: Write the implementation**

Area-code allowlist rationale: per-anchor sets of NANP codes whose geographic footprint sits substantially within 100mi of the anchor. Borderline metros (Hartford 860/959, Scranton 570/272) are intentionally excluded — borderline visitors get asked, which is the safer disposition.

```js
// js/geo-gate.js
// Travel-gate helpers for girthfill-form. Decides whether a visitor likely
// lives near the lander's anchor city (NYC or SD) using their phone area
// code first, then their IP-derived coordinates. The form module reads the
// result and either skips or shows the stepTravel confirmation step.
//
// Browser-only: attaches window.lushfulGeoGate. Tested via Node vm context.
(function () {
  var ANCHORS = {
    nyc: {
      coords: [40.7589, -73.9851],
      areaCodes: new Set([
        // NYC core
        '212', '332', '646', '718', '917', '347', '929',
        // NY suburbs (Long Island, Westchester, Hudson Valley)
        '516', '631', '914', '845',
        // Northern + central NJ + South Jersey
        '201', '551', '973', '862', '732', '848', '908', '609', '856',
        // Southwest CT
        '203', '475',
        // Eastern PA (Philly metro + Lehigh Valley)
        '215', '267', '445', '610', '484'
      ])
    },
    sd: {
      coords: [32.7157, -117.1611],
      areaCodes: new Set([
        // SD core
        '619', '858',
        // SD County (north + east), Inland Empire, Orange County
        '760', '951', '949', '714'
      ])
    }
  }

  // Anchor selection mirrors the existing allowlist in girthfill-form.html:
  // ['girthfill-landing', 'girthfill-nyc', 'girthfill-sd']. Direct hits to
  // /girthfill-form (with no ?source=) become 'girthfill-landing' which
  // defaults to NYC, matching the recent / default-NYC commit.
  function anchorFromSource(source) {
    if (source === 'girthfill-sd') return 'sd'
    return 'nyc'
  }

  // Returns first NANP area code from a phone string, or null. Strips the
  // optional leading 1 (US country code) but explicitly rejects non-US
  // country codes (+44, +52, etc.) by requiring either no + or +1.
  function extractAreaCode(phone) {
    if (typeof phone !== 'string' || phone.length === 0) return null
    var trimmed = phone.trim()
    var hasIntlPrefix = trimmed.charAt(0) === '+'
    var digits = trimmed.replace(/\D/g, '')
    if (hasIntlPrefix) {
      // Only accept +1 (NANP). Anything else (+44, +52, ...) is not US.
      if (digits.charAt(0) !== '1') return null
      digits = digits.slice(1)
    } else if (digits.length === 11 && digits.charAt(0) === '1') {
      // 11-digit with leading 1, no plus: 12125551234 → strip the 1.
      digits = digits.slice(1)
    }
    if (digits.length < 10) return null
    return digits.slice(0, 3)
  }

  // Great-circle distance in miles between two [lat, lng] pairs.
  function haversineMiles(a, b) {
    var R = 3958.7613 // Earth radius in miles
    var toRad = function (d) { return d * Math.PI / 180 }
    var dLat = toRad(b[0] - a[0])
    var dLng = toRad(b[1] - a[1])
    var lat1 = toRad(a[0])
    var lat2 = toRad(b[0])
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
    return 2 * R * Math.asin(Math.sqrt(h))
  }

  // Accepts either [lat, lng] tuple or {lat, lng} object; returns tuple or null.
  function normalizeCoords(c) {
    if (!c) return null
    if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number') return c
    if (typeof c === 'object' && typeof c.lat === 'number' && typeof c.lng === 'number') return [c.lat, c.lng]
    return null
  }

  // Three-signal cascade. Returns 'local' if phone OR IP indicate the
  // visitor is in-area; 'show-step' otherwise (including when both signals
  // are missing — the conservative default is to ask).
  function evaluateGate(opts) {
    var anchor = ANCHORS[opts.anchorKey]
    if (!anchor) return 'show-step'

    var npa = extractAreaCode(opts.phone)
    if (npa && anchor.areaCodes.has(npa)) return 'local'

    var ip = normalizeCoords(opts.ipCoords)
    if (ip && haversineMiles(ip, anchor.coords) < 100) return 'local'

    return 'show-step'
  }

  window.lushfulGeoGate = {
    ANCHORS: ANCHORS,
    anchorFromSource: anchorFromSource,
    extractAreaCode: extractAreaCode,
    haversineMiles: haversineMiles,
    evaluateGate: evaluateGate
  }
})()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run js/__tests__/geo-gate.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add js/geo-gate.js js/__tests__/geo-gate.test.js
git commit -m "feat(js): add geo-gate helpers + area-code allowlist"
```

---

## Task 4: Extend `/api/lead-update` for `travel_status`

Add `travel_status` to the Zod body schema, write it to Close as a custom field, and persist to Supabase.

**Files:**
- Modify: `api/lead-update.js`
- Modify: `api/__tests__/lead-update.test.js`

- [ ] **Step 1: Add the failing test**

Append the following inside the existing `describe('POST /api/lead-update', () => {...})` block in `api/__tests__/lead-update.test.js`:

```js
  it('writes travel_status to Close custom field', async () => {
    process.env.CLOSE_CF_TRAVEL_STATUS = 'cf_ts'
    mockSupabase({
      leadRow: {
        id: '00000000-0000-0000-0000-000000000000',
        email: 'a@b.com',
        source: 'girthfill-nyc',
        close_lead_id: 'lead_abc'
      }
    })
    updateLead.mockResolvedValue({})
    const { req, res } = makeReqRes({
      lead_id: '00000000-0000-0000-0000-000000000000',
      travel_status: 'willing_to_travel'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead_abc',
      customFields: expect.objectContaining({ cf_ts: 'Willing to Travel' })
    }))
  })

  it('accepts travel_status as the sole mutation', async () => {
    process.env.CLOSE_CF_TRAVEL_STATUS = 'cf_ts'
    mockSupabase({
      leadRow: {
        id: '00000000-0000-0000-0000-000000000000',
        email: 'a@b.com',
        source: 'girthfill-nyc',
        close_lead_id: 'lead_abc'
      }
    })
    const { req, res } = makeReqRes({
      lead_id: '00000000-0000-0000-0000-000000000000',
      travel_status: 'local'
    })
    await handler(req, res)
    // 400 is the failure mode if the schema refine rejects travel_status-only.
    expect(res.statusCode).toBe(200)
  })

  it('combines declined_travel with qualified=false', async () => {
    process.env.CLOSE_CF_TRAVEL_STATUS = 'cf_ts'
    mockSupabase({
      leadRow: {
        id: '00000000-0000-0000-0000-000000000000',
        email: 'a@b.com',
        source: 'girthfill-nyc',
        close_lead_id: 'lead_abc'
      }
    })
    updateLead.mockResolvedValue({})
    addTags.mockResolvedValue({})
    const { req, res } = makeReqRes({
      lead_id: '00000000-0000-0000-0000-000000000000',
      qualified: false,
      travel_status: 'declined_travel'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    // Bad-fit status flows through the existing path; travel_status piggy-backs
    // on the same Close update.
    expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
      statusId: 'stat_bf',
      customFields: expect.objectContaining({
        cf_q: 'No',
        cf_ts: 'Declined Travel'
      })
    }))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run api/__tests__/lead-update.test.js`
Expected: FAIL — three new tests fail (schema rejects `travel_status`, or `cf_ts` not present in `customFields`).

- [ ] **Step 3: Update `api/lead-update.js`**

Apply all four edits below.

**Edit 1:** Replace the `BodySchema` block:

```js
const BodySchema = z.object({
  lead_id: z.string().optional(),
  close_lead_id: z.string().optional(),
  qualified: z.boolean().optional(),
  cta_clicked: z.enum(['book', 'book-calendly', 'call', 'tap-to-call']).optional(),
  travel_status: z.enum(['local', 'willing_to_travel', 'declined_travel']).optional()
}).refine(
  d => d.lead_id !== undefined || d.close_lead_id !== undefined,
  { message: 'one of lead_id or close_lead_id is required' }
).refine(
  d => d.qualified !== undefined || d.cta_clicked !== undefined || d.travel_status !== undefined,
  { message: 'one of qualified, cta_clicked, or travel_status is required' }
)
```

**Edit 2:** Add a label constant near the existing `CTA_LABELS`:

```js
const TRAVEL_STATUS_LABELS = {
  'local': 'Local',
  'willing_to_travel': 'Willing to Travel',
  'declined_travel': 'Declined Travel'
}
```

**Edit 3:** Inside the Supabase update block (where `updates.cta_clicked = body.cta_clicked` is set), add:

```js
if (body.travel_status !== undefined) {
  updates.travel_status = body.travel_status
}
```

**Edit 4:** Inside the Close fanout task, after the existing `if (body.cta_clicked !== undefined) { requiredCloseEnvVars.push(...) }` block, add:

```js
if (body.travel_status !== undefined) {
  requiredCloseEnvVars.push('CLOSE_CF_TRAVEL_STATUS')
}
```

And after the `if (body.cta_clicked !== undefined) { customFields[...] = CTA_LABELS[body.cta_clicked] }` line, add:

```js
if (body.travel_status !== undefined) {
  customFields[process.env.CLOSE_CF_TRAVEL_STATUS] = TRAVEL_STATUS_LABELS[body.travel_status]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/__tests__/lead-update.test.js`
Expected: PASS — all tests (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add api/lead-update.js api/__tests__/lead-update.test.js
git commit -m "feat(api): accept travel_status on /api/lead-update"
```

---

## Task 5: Wire the gate into `girthfill-form.html`

Add the `stepTravel` markup, load `js/geo-gate.js`, fire `/api/geo` eagerly on page load, evaluate the gate after the Contact submit, and add the `answerTravel(willing)` handler.

**Files:**
- Modify: `girthfill-form.html`

This is a static HTML file with inline `<script>` — no test framework covers it. We'll verify by serving the form locally and exercising both paths in a browser.

- [ ] **Step 1: Add the `<script src="/js/geo-gate.js">` tag**

In `girthfill-form.html`, find where `js/attribution.js` is loaded (search for `attribution.js`) and add `geo-gate.js` on the next line:

```html
<script src="/js/attribution.js"></script>
<script src="/js/geo-gate.js"></script>
```

If `attribution.js` is loaded inline rather than via `<script src>`, place the new `<script src="/js/geo-gate.js"></script>` immediately before the form's main `<script>` block (the one containing `submitContact`).

- [ ] **Step 2: Add the `stepTravel` markup**

In `girthfill-form.html`, locate the `<div class="form-step" id="stepOptions">` block (around line 430) and insert `stepTravel` immediately before it:

```html
<!-- Conditional Step: visitors who appear to be out of the anchor city
     get one confirmation before reaching the booking options. Hidden by
     default; submitContact triggers it only when evaluateGate returns
     'show-step'. -->
<div class="form-step" id="stepTravel">
  <h2>Can you travel to <span id="travelCity">NYC</span> for your consultation?</h2>
  <p>Our consultations are in-person at our <span id="travelCityFull">Midtown Manhattan</span> office. We don't currently offer virtual visits for GirthFill.</p>
  <div class="step-label">One more thing</div>
  <button class="btn-yes" onclick="answerTravel(true)">Yes, I can travel</button>
  <button class="btn-no" onclick="answerTravel(false)">Not Right Now</button>
</div>
```

- [ ] **Step 3: Add eager geo-fetch and gate evaluation**

In the main `<script>` block (the one containing `showStep`, `answerQualification`, `submitContact`), add the following helpers near the top of the block — anywhere after `function showStep(id)`:

```js
  /* ── Out-of-area travel gate ── */

  // Fire IP geolocation eagerly on page load so the cascade has its IP
  // signal ready by the time the user finishes typing. Cached as a
  // promise so multiple awaits are cheap.
  var __geoPromise = fetch('/api/geo', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : { lat: null, lng: null } })
    .catch(function () { return { lat: null, lng: null } })

  function resolveSource() {
    var allowed = ['girthfill-landing', 'girthfill-nyc', 'girthfill-sd']
    var p = new URLSearchParams(window.location.search).get('source')
    return allowed.indexOf(p) >= 0 ? p : 'girthfill-landing'
  }

  function applyTravelCopyForAnchor(anchorKey) {
    var labels = {
      'nyc': { short: 'NYC', full: 'Midtown Manhattan' },
      'sd':  { short: 'San Diego', full: 'San Diego' }
    }
    var l = labels[anchorKey] || labels.nyc
    var s = document.getElementById('travelCity')
    var f = document.getElementById('travelCityFull')
    if (s) s.textContent = l.short
    if (f) f.textContent = l.full
  }

  // Race a promise against a timeout. Used so a slow /api/geo doesn't
  // block the cascade decision past ~1.5s — we just fall through to the
  // phone-only result (which on its own returns 'show-step' for any non-
  // local NPA, the conservative path).
  function withTimeout(p, ms, fallback) {
    return new Promise(function (resolve) {
      var done = false
      var t = setTimeout(function () { if (!done) { done = true; resolve(fallback) } }, ms)
      p.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v) } },
             function () { if (!done) { done = true; clearTimeout(t); resolve(fallback) } })
    })
  }

  async function evaluateTravelGate(phone) {
    var G = window.lushfulGeoGate
    if (!G) return 'show-step' // gate script failed to load; conservative
    var anchorKey = G.anchorFromSource(resolveSource())
    var geo = await withTimeout(__geoPromise, 1500, { lat: null, lng: null })
    var ipCoords = (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number')
      ? [geo.lat, geo.lng]
      : null
    return {
      decision: G.evaluateGate({ phone: phone, ipCoords: ipCoords, anchorKey: anchorKey }),
      anchorKey: anchorKey
    }
  }

  function postTravelStatus(travel_status) {
    if (!window.__leadId) return
    fetch('/api/lead-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: window.__leadId, travel_status: travel_status })
    }).catch(function () { /* fire-and-forget */ })
  }

  function postDeclinedTravel() {
    if (!window.__leadId) return
    fetch('/api/lead-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: window.__leadId,
        qualified: false,
        travel_status: 'declined_travel'
      })
    }).catch(function () { /* fire-and-forget */ })
  }

  async function answerTravel(willing) {
    var btns = document.querySelectorAll('#stepTravel button')
    btns.forEach(function (b) { b.disabled = true })
    if (willing) {
      postTravelStatus('willing_to_travel')
      showStep('stepOptions')
    } else {
      postDeclinedTravel()
      showStep('stepNoThanks')
    }
  }
```

- [ ] **Step 4: Modify `submitContact` to call the gate**

In `girthfill-form.html`, replace the existing line `showStep('stepOptions');` inside `submitContact`'s `try` block (just after `if (typeof fbq === 'function') fbq('track', 'CompleteRegistration');`) with:

```js
      var gate = await evaluateTravelGate(phone)
      if (gate.decision === 'local') {
        postTravelStatus('local')
        showStep('stepOptions')
      } else {
        applyTravelCopyForAnchor(gate.anchorKey)
        showStep('stepTravel')
      }
```

- [ ] **Step 5: Smoke-test locally**

Run: `npm run dev`
(That starts `vercel dev`, which serves both the static HTML and the API routes.)

Open: `http://localhost:3000/girthfill-form?source=girthfill-nyc`

**Path A — local user (should skip stepTravel):**
1. Click "Yes, I'm Interested".
2. Enter Name "Test User", Email "test+local@example.com", Phone "(212) 555-1234".
3. Submit.
Expected: page shows stepOptions (booking options), NOT stepTravel.

**Path B — out-of-area, willing (should show stepTravel, then go to options):**
1. Hard-refresh.
2. Click "Yes, I'm Interested".
3. Enter Name "Test User 2", Email "test+far@example.com", Phone "(415) 555-1234".
4. Submit.
Expected: page shows stepTravel ("Can you travel to NYC..."). Click "Yes, I can travel". Page advances to stepOptions.

**Path C — out-of-area, decline (should show stepTravel, then stepNoThanks):**
1. Hard-refresh.
2. Click "Yes, I'm Interested".
3. Enter Name "Test User 3", Email "test+decline@example.com", Phone "(415) 555-1234".
4. Submit.
Expected: stepTravel appears. Click "Not Right Now". Page shows stepNoThanks.

**Path D — SD lander:**
1. Open `http://localhost:3000/girthfill-form?source=girthfill-sd`.
2. Submit "Yes" → phone "(619) 555-1234" → stepOptions (local).
3. Hard-refresh, submit "Yes" → phone "(212) 555-1234" → stepTravel with "San Diego" in the copy.

If `/api/geo` returns `{lat: null, lng: null}` in local dev (Vercel doesn't always populate those headers locally), Paths B/C/D will still work — the phone-only signal drives them to `show-step`. Path A still passes via the phone allowlist.

- [ ] **Step 6: Commit**

```bash
git add girthfill-form.html
git commit -m "feat(landers): out-of-area travel-gate step on girthfill-form"
```

---

## Task 6: Mirror the wiring into `girthfill-form-google.html`

Same edits as Task 5, applied to the Google-ads variant. The two files share an identical form-step skeleton; the only meaningful diff is analytics tags.

**Files:**
- Modify: `girthfill-form-google.html`

- [ ] **Step 1: Diff the two files first**

Run: `diff girthfill-form.html girthfill-form-google.html | head -60`
Expected: a handful of analytics-related diffs, no diffs inside the form-step blocks. If the diff reveals form-step differences, stop and reconcile by hand rather than blind-copying.

- [ ] **Step 2: Apply the same five edits from Task 5 (steps 1–4)**

Same script-tag insertion, same `stepTravel` block, same helpers in the main `<script>`, same modification to `submitContact`. Reuse identical code.

- [ ] **Step 3: Smoke-test the Google variant**

Open: `http://localhost:3000/girthfill-form-google?source=girthfill-nyc`
Re-run Path A and Path B from Task 5 Step 5 against this URL. Expect identical behavior.

- [ ] **Step 4: Commit**

```bash
git add girthfill-form-google.html
git commit -m "feat(landers): mirror travel-gate into girthfill-form-google"
```

---

## Task 7: Deploy checklist (no code)

This task is a deployment runbook, not a code change. Don't commit anything new — execute these in order before the next prod deploy.

- [ ] **Step 1: Create the Close custom field**

In Close → Settings → Custom Fields → Leads, add:
- **Name:** Travel Status
- **Type:** Choices (single)
- **Options:** `Local`, `Willing to Travel`, `Declined Travel`

Copy the generated field ID (looks like `cf_xxxxxxxxxxxx`).

- [ ] **Step 2: Set the Vercel env var**

Vercel → Project → Settings → Environment Variables:
- **Name:** `CLOSE_CF_TRAVEL_STATUS`
- **Value:** the Close field ID from Step 1
- **Environments:** Production + Preview

- [ ] **Step 3: Apply the Supabase migration**

Apply `supabase/migrations/20260521120000_add_travel_status.sql` to production (whatever migration command the team uses — `supabase db push`, dashboard SQL editor, or manual `psql`).

Verify with:
```sql
select column_name, data_type from information_schema.columns
where table_name = 'leads' and column_name = 'travel_status';
```

- [ ] **Step 4: Deploy + verify**

Deploy to Vercel (push to main, or trigger a manual deploy). Once live:
1. Open production `https://[domain]/girthfill-form?source=girthfill-nyc` from a phone or browser geolocated outside the NYC region (or use a VPN endpoint in another state).
2. Submit with a non-NY phone.
3. Confirm stepTravel appears.
4. In Close, locate the new lead and confirm Travel Status reads `Willing to Travel` or `Declined Travel` matching your answer.

---

## Spec coverage check

Every spec section has a task:

| Spec section                              | Task(s)       |
|-------------------------------------------|---------------|
| Three-signal cascade                      | Task 3        |
| Anchor selection from `?source=`          | Task 3        |
| `js/area-codes.js` + `js/geo-gate.js`     | Task 3 (collapsed into one IIFE — rationale in plan header) |
| `/api/geo` Vercel-header endpoint         | Task 2        |
| `girthfill-form.html` wiring              | Task 5        |
| `girthfill-form-google.html` wiring       | Task 6        |
| `/api/lead-update` schema + Close write   | Task 4        |
| Supabase `travel_status` column           | Task 1        |
| Edge cases (VPN, missing IP, intl)        | Task 3 tests cover; Task 5 timeout fallback |
| Manual Close field + env var setup        | Task 7        |
| Non-goals (B&A modals, consultation-book) | Not modified — confirmed by file list |
