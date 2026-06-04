# Holetox Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Holetox ($900 anal Botox) paid-traffic funnel for Lushful Aesthetics — NYC + SD landers → shared capture/travel-gate form → Calendly booking — reusing the GirthFill lead→Close→Mailchimp plumbing, distinguished by hyphenated Close statuses.

**Architecture:** Two long content landers (`holetox-nyc.html`, `holetox-sd.html`) link to one shared multistep form (`holetox-form.html`, cloned from `girthfill-form.html` with the affordability qualifier removed), which on a local/willing-to-travel visitor redirects to `holetox-book.html` (cloned from `consultation-book.html`). Backend: widen `api/lead.js` (source enum + Holetox status routing) and make `api/lead-update.js`'s disqualify path source-aware so Holetox out-of-area "No" lands in `Holetox - Bad Fit`, not GirthFill's. `/api/geo`, `js/geo-gate.js`, and the `travel_status` plumbing are reused unchanged.

**Tech Stack:** Static HTML + `@vercel/node` ESM functions, Supabase (service-role), Mailchimp, Close CRM, Calendly, vitest. Deploy = push `main` → Vercel auto-deploy.

**Spec:** `docs/superpowers/specs/2026-06-04-holetox-funnel-design.md`

## File map

- **Create** `holetox-nyc.html` — long NYC content lander (hero, video, how-it-works, benefits, $900, FAQ, social proof). CTAs → `/holetox-form?source=holetox-nyc`.
- **Create** `holetox-sd.html` — SD variant of the above. CTAs → `/holetox-form?source=holetox-sd`.
- **Create** `holetox-form.html` — shared multistep: contact → (travel-gate) → redirect to `/holetox-book`. Disqualify on out-of-area "No".
- **Create** `holetox-book.html` — Calendly placeholder page (15-min consult), clone of `consultation-book.html`.
- **Modify** `api/lead.js` — `source` enum + Holetox status routing + `Holetox` Mailchimp tag.
- **Modify** `api/lead-update.js` — source-aware disqualify (Holetox → `CLOSE_STATUS_HOLETOX_BAD_FIT` + `holetox-not-qualified`).
- **Modify** `api/__tests__/lead.test.js`, `api/__tests__/lead-update.test.js` — Holetox cases.
- **Modify** `.env.example` — document the two new env vars.
- **Ops** — create Close statuses `Holetox - New` + `Holetox - Bad Fit`; set `CLOSE_STATUS_HOLETOX_NEW` + `CLOSE_STATUS_HOLETOX_BAD_FIT` in Vercel prod.

---

### Task 1: `api/lead.js` — Holetox source + status routing

**Files:**
- Modify: `api/lead.js`
- Test: `api/__tests__/lead.test.js`

- [ ] **Step 1: Add the mocked env var to the test `beforeEach`**

In `api/__tests__/lead.test.js`, inside `beforeEach`, add:

```js
  process.env.CLOSE_STATUS_HOLETOX_NEW = 'stat_holetox_new'
```

- [ ] **Step 2: Write the failing tests** (append inside the `describe('POST /api/lead', ...)` block)

```js
  it('routes holetox-nyc to the Holetox - New status and adds the Holetox tag', async () => {
    mockSupabase({ upsertResult: { data: { id: 'lead-holetox' }, error: null } })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_holetox' })

    const { req, res } = makeReqRes({
      name: 'Sam', email: 'sam@example.com', phone: '555-0400', source: 'holetox-nyc'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(addTags).toHaveBeenCalledWith({
      email: 'sam@example.com',
      tags: ['holetox-nyc', 'SQ Lander', 'Holetox']
    })
    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({ statusId: 'stat_holetox_new' }))
  })

  it('accepts source = holetox-sd and routes to Holetox - New', async () => {
    mockSupabase({ upsertResult: { data: { id: 'lead-holetox-sd' }, error: null } })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_holetox_sd' })

    const { req, res } = makeReqRes({
      name: 'Lee', email: 'lee@example.com', phone: '555-0500', source: 'holetox-sd'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({ statusId: 'stat_holetox_new' }))
  })
```

- [ ] **Step 3: Run the tests, verify they FAIL**

Run: `npx vitest run api/__tests__/lead.test.js`
Expected: the two new tests fail — `holetox-nyc` is rejected by the zod enum (validation 400) so `createLead` is never called.

- [ ] **Step 4: Implement in `api/lead.js`**

(a) Extend the `source` enum:

```js
  source: z.enum([
    'girthfill-landing',
    'girthfill-carousel',
    'girthfill-nyc',
    'girthfill-sd',
    'girthfill-nyc-google',
    'girthfill-sd-google',
    'holetox-nyc',
    'holetox-sd'
  ]),
```

(b) After `const body = parsed.data`, add:

```js
  const isHoletox = body.source.startsWith('holetox')
```

(c) Change the Mailchimp tag block (currently `const mailchimpTags = [body.source, 'SQ Lander']`) to append the umbrella tag:

```js
  const mailchimpTags = [body.source, 'SQ Lander']
  if (isHoletox) mailchimpTags.push('Holetox')
  if (body.qualified === true) mailchimpTags.push('girthfill-qualified')
  if (body.qualified === false) mailchimpTags.push('girthfill-not-qualified')
```

(d) In the Close fanout, change the status-var selection:

```js
      let statusVar = isHoletox ? 'CLOSE_STATUS_HOLETOX_NEW' : 'CLOSE_STATUS_NEW'
      if (!isHoletox && body.qualified === true) statusVar = 'CLOSE_STATUS_QUALIFIED'
      if (!isHoletox && body.qualified === false) statusVar = 'CLOSE_STATUS_BAD_FIT'
```

- [ ] **Step 5: Run the tests, verify they PASS**

Run: `npx vitest run api/__tests__/lead.test.js`
Expected: all tests pass (new Holetox tests + all existing GirthFill tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add api/lead.js api/__tests__/lead.test.js
git commit -m "feat(lead): route holetox-nyc/sd source to Holetox - New status + tag"
```

---

### Task 2: `api/lead-update.js` — source-aware Holetox disqualify

**Files:**
- Modify: `api/lead-update.js`
- Test: `api/__tests__/lead-update.test.js`

- [ ] **Step 1: Write the failing test** (append inside `describe('POST /api/lead-update', ...)`)

```js
  it('holetox lead + qualified=false routes to Holetox - Bad Fit + holetox-not-qualified tag', async () => {
    process.env.CLOSE_STATUS_HOLETOX_BAD_FIT = 'stat_holetox_bf'
    process.env.CLOSE_CF_TRAVEL_STATUS = 'cf_ts'
    mockSupabase({
      leadRow: { id: 'lead-h', email: 'h@x.com', source: 'holetox-nyc', close_lead_id: 'close_h' }
    })
    updateLead.mockResolvedValue({})
    addTags.mockResolvedValue({})
    const { req, res } = makeReqRes({
      lead_id: 'lead-h', qualified: false, travel_status: 'declined_travel'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(addTags).toHaveBeenCalledWith({ email: 'h@x.com', tags: ['holetox-not-qualified'] })
    expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
      statusId: 'stat_holetox_bf',
      customFields: expect.objectContaining({ cf_q: 'No', cf_ts: 'Declined Travel' })
    }))
  })
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npx vitest run api/__tests__/lead-update.test.js`
Expected: fails — `updateLead` is called with `statusId: 'stat_bf'` (GirthFill bad-fit) and the tag is `girthfill-not-qualified`.

- [ ] **Step 3: Implement in `api/lead-update.js`**

(a) After the `const body = parsed.data` / lead fetch (right after the `if (fetchErr || !lead)` 404 guard), add:

```js
  const isHoletox = (lead.source || '').startsWith('holetox')
```

(b) Replace the Mailchimp `qualified` task tag line:

```js
  if (body.qualified !== undefined) {
    tasks.push(taggedTask('mailchimp', async () => {
      const prefix = isHoletox ? 'holetox' : 'girthfill'
      const tag = body.qualified ? `${prefix}-qualified` : `${prefix}-not-qualified`
      await addTags({ email: lead.email, tags: [tag] })
      return { service: 'mailchimp' }
    }))
  }
```

(c) In the Close fanout's `requiredCloseEnvVars` block, replace the `qualified` branch:

```js
      if (body.qualified !== undefined) {
        requiredCloseEnvVars.push('CLOSE_CF_QUALIFIED')
        if (isHoletox) {
          if (body.qualified === false) requiredCloseEnvVars.push('CLOSE_STATUS_HOLETOX_BAD_FIT')
        } else {
          requiredCloseEnvVars.push('CLOSE_STATUS_QUALIFIED', 'CLOSE_STATUS_BAD_FIT')
        }
      }
```

(d) In the `customFields` / `statusId` assignment, replace the `qualified` branch:

```js
      if (body.qualified !== undefined) {
        customFields[process.env.CLOSE_CF_QUALIFIED] = body.qualified ? 'Yes' : 'No'
        if (isHoletox) {
          if (body.qualified === false) statusId = process.env.CLOSE_STATUS_HOLETOX_BAD_FIT
        } else {
          statusId = body.qualified
            ? process.env.CLOSE_STATUS_QUALIFIED
            : process.env.CLOSE_STATUS_BAD_FIT
        }
      }
```

- [ ] **Step 4: Run the tests, verify they PASS**

Run: `npx vitest run api/__tests__/lead-update.test.js`
Expected: new Holetox test passes; existing GirthFill tests (`uses not-qualified tag and Bad Fit status when qualified=false`, `combines declined_travel with qualified=false`, etc.) still pass.

- [ ] **Step 5: Commit**

```bash
git add api/lead-update.js api/__tests__/lead-update.test.js
git commit -m "feat(lead-update): source-aware disqualify — holetox -> Holetox - Bad Fit"
```

---

### Task 3: `holetox-book.html` — Calendly placeholder booking page

**Files:**
- Create: `holetox-book.html` (clone of `consultation-book.html`)

- [ ] **Step 1: Copy the file**

```bash
cp consultation-book.html holetox-book.html
```

- [ ] **Step 2: Edit `holetox-book.html`**

- `<title>` → `Book Your Holetox Consultation | Lushful Aesthetics`.
- Change the Calendly widget `data-url` to a **placeholder** and add a visible pending note above the widget:
  ```html
  <p style="font-family:'Playfair Display',serif;color:var(--text);font-size:20px;margin:8px 0 4px;">Your 15-minute Holetox consult</p>
  <p style="color:var(--text-light);font-size:13px;margin-bottom:16px;">Pick a time below. <!-- TODO: replace data-url with the real 15-min Holetox Calendly event link --></p>
  <div id="calendlyWidget" class="calendly-inline-widget"
       data-url="https://calendly.com/lushfulaesthetics/holetox-15min?hide_gdpr_banner=1"></div>
  ```
- Leave the prefill + `calendly.event_scheduled` → `/api/lead-update` (`book-calendly`) + FB Schedule logic **unchanged** (it already keys off `lead_id`/`close_lead_id`/`name`/`email` query params, which the form will pass).

- [ ] **Step 3: Verify it renders**

Serve the repo root statically and load `/holetox-book.html?name=Test&email=test@example.com`. Confirm: page renders with the "15-minute Holetox consult" note, footer present, no console errors (the Calendly iframe will 404 on the placeholder slug — expected until the real link is set).

- [ ] **Step 4: Commit**

```bash
git add holetox-book.html
git commit -m "feat(holetox): booking page (Calendly placeholder, 15-min consult)"
```

---

### Task 4: `holetox-form.html` — shared capture + travel-gate

**Files:**
- Create: `holetox-form.html` (clone of `girthfill-form.html`, qualifier removed)

- [ ] **Step 1: Copy the file**

```bash
cp girthfill-form.html holetox-form.html
```

- [ ] **Step 2: Edit `holetox-form.html` — structure**

- `<title>` → `Book a Holetox Consultation | Lushful Aesthetics`.
- **Delete the `stepQualify` step** entirely (the `<div class="form-step active" id="stepQualify">…</div>` block) and the `answerQualification()` function. There is no affordability gate.
- Make `stepContact` the initial step: change its class to `form-step active`. Simplify its progress bar to a single dot or remove the "Step 1 of 2"/"Step 2 of 2" labels (Holetox has no qualifier step). Keep name/email/phone inputs + `submitContact`.
- **Delete `stepOptions`, `stepBookCall`, and the Boulevard "Book An Appointment" markup + the SD-Boulevard-URL swap IIFE** (the `bookAppointmentBtn` / `SD_URL` block) — Holetox routes straight to the Calendly booking page, no deposit/Boulevard path.
- Keep `stepTravel` and `stepNoThanks`.

- [ ] **Step 3: Edit `holetox-form.html` — script**

- `resolveSource()` and the inline `allowedSources` in `submitContact`: change the allowlist to `['holetox-nyc', 'holetox-sd']` with `'holetox-nyc'` as the fallback.
- Derive the anchor locally (do **not** call `G.anchorFromSource`, which only knows GirthFill sources). In `evaluateTravelGate`, replace the anchor line with:
  ```js
  var src = resolveSource()
  var anchorKey = src.indexOf('-sd') >= 0 ? 'sd' : 'nyc'
  ```
  Keep the rest (`evaluateGate({ phone, ipCoords, anchorKey })`).
- `applyTravelCopyForAnchor`: update the body copy to Holetox/15-min wording, e.g. NYC → "Your Holetox treatment takes place in person at our Midtown Manhattan office near Bryant Park. The consult can be virtual, but the procedure must be in person." SD → same with "our San Diego office in Hillcrest."
- In `submitContact`, the `/api/lead` POST body: send `{ name, email, phone, source }` **without** `qualified: true` (Holetox has no qualifier). Keep attribution spread, `__leadId` capture, the `gtag_report_conversion()` + `fbq('CompleteRegistration')` calls.
- Replace both "advance to booking" transitions (`gate.decision === 'local'` path, and `answerTravel(true)`) so that instead of `showStep('stepOptions')` they **redirect to the booking page**, passing identity:
  ```js
  function goToBooking() {
    var name  = document.getElementById('formName').value.trim();
    var email = document.getElementById('formEmail').value.trim();
    var qs = new URLSearchParams({ lead_id: window.__leadId || '', name: name, email: email });
    window.location.href = '/holetox-book?' + qs.toString();
  }
  ```
  - local: `postTravelStatus('local'); goToBooking();`
  - `answerTravel(true)`: `postTravelStatus('willing_to_travel'); goToBooking();`
- `answerTravel(false)` → `postDeclinedTravel(); showStep('stepNoThanks');` (unchanged; `postDeclinedTravel` already posts `{ lead_id, qualified:false, travel_status:'declined_travel' }`, which Task 2 routes to `Holetox - Bad Fit`).
- `stepNoThanks` copy: replace "GirthFill" with "Holetox".
- Remove the now-unused `recordCta`, the `calendly.event_scheduled` listener, and the `previewTravelStep` block only if they reference deleted steps; otherwise leave the Calendly listener out since booking now lives on `holetox-book.html`. (The booking page owns the `book-calendly` post.)

- [ ] **Step 4: Verify it renders + flows**

Serve statically, load `/holetox-form.html?source=holetox-sd`. Confirm: contact step shows first (no qualifier), the travel step preview works via `?previewTravelStep=1&source=holetox-sd` if that block was kept (SD/Hillcrest copy), no console errors, no references to deleted `stepOptions`/`stepQualify` ids. (Form POST to `/api/lead` requires prod env; full submit is smoke-tested in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add holetox-form.html
git commit -m "feat(holetox): shared capture + travel-gate form (no affordability qualifier)"
```

---

### Task 5: `holetox-nyc.html` — NYC content lander

**Files:**
- Create: `holetox-nyc.html` (clone `girthfill-nyc.html`, swap content)

- [ ] **Step 1: Copy + read the source structure**

```bash
cp girthfill-nyc.html holetox-nyc.html
```
Read `holetox-nyc.html` fully to learn its section structure (hero, video block, benefits, pricing, FAQ, footer) before editing.

- [ ] **Step 2: Swap content (keep layout, CSS, GTM/Pixel/GAds tags)**

- `<title>` + meta description: `Holetox in NYC — Anal Botox for Easier, More Comfortable Bottoming | Lushful Aesthetics`.
- Hero headline/positioning — **bottoming-ease, direct** (match the client's page voice): e.g. "Bottoming, Without the Pain." / subhead about relaxing the anal sphincter for easier, more comfortable receptive sex.
- **Video:** point the hero/explainer `<iframe>` at `https://www.youtube.com/embed/_3XEqy_OZ10` (keep the existing responsive `.hero-video iframe` wrapper). Remove the self-hosted `<video controls>` block if it referenced a GirthFill asset.
- **How it works:** Botox into the internal anal sphincter, ~3-min treatment, ~4 injection sites, ProNox (laughing gas) for comfort.
- **Benefits:** easier/more comfortable bottoming; relief from anal fissures, rectal spasms, tension; hemorrhoid prevention.
- **Pricing:** **$900 flat** (same regardless of units) + Cherry financing (soft credit check). Remove all GirthFill $8,500 pricing.
- **FAQ:** swap to Holetox Q&A (does it hurt — quick pinch + ProNox; lasts 3–4 months; no major side effects, no working out 24h / no anal play 3 days; doesn't cause incontinence; **no before/after** since it's performance-based; not for active fissures/inflamed hemorrhoids — see a proctologist first).
- **Social proof:** keep press-logo treatment if present (Daily Mail / GQ / NY Post / Gay Times). **Remove any before/after photo gallery.**
- **CTAs:** every "book"/CTA button → `href="/holetox-form?source=holetox-nyc"`. Remove any embedded age-gate carousel mini-form / `girthfill-carousel` POST.
- Keep the office-map iframe if present (NYC/Bryant Park); otherwise remove.

- [ ] **Step 3: Verify it renders**

Serve statically, load `/holetox-nyc.html`. Confirm: hero + Holetox copy, the YouTube video embeds and plays, $900 pricing shows, FAQ present, no before/after, CTAs point to `/holetox-form?source=holetox-nyc`, no console errors, no leftover GirthFill copy (grep the file for `girthfill`/`GirthFill`/`8,500`).

- [ ] **Step 4: Commit**

```bash
git add holetox-nyc.html
git commit -m "feat(holetox): NYC content lander with embedded explainer video"
```

---

### Task 6: `holetox-sd.html` — San Diego content lander

**Files:**
- Create: `holetox-sd.html` (clone `holetox-nyc.html`, SD copy)

- [ ] **Step 1: Copy**

```bash
cp holetox-nyc.html holetox-sd.html
```

- [ ] **Step 2: SD-localize**

- `<title>`/meta: `Holetox in San Diego — Anal Botox for Easier, More Comfortable Bottoming | Lushful Aesthetics`.
- Swap NYC location references → San Diego (Hillcrest office); office-map iframe → SD if present.
- **CTAs** → `href="/holetox-form?source=holetox-sd"`.
- Keep everything else identical (video, pricing, FAQ).

- [ ] **Step 3: Verify**

Load `/holetox-sd.html`; confirm SD copy + CTAs → `source=holetox-sd`; grep for stray `nyc`/`New York`/`girthfill`.

- [ ] **Step 4: Commit**

```bash
git add holetox-sd.html
git commit -m "feat(holetox): San Diego content lander"
```

---

### Task 7: `.env.example` — document new env vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the two vars** near the other `CLOSE_STATUS_*` entries:

```bash
# Holetox funnel lead statuses (Close lead status IDs)
CLOSE_STATUS_HOLETOX_NEW=
CLOSE_STATUS_HOLETOX_BAD_FIT=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): document CLOSE_STATUS_HOLETOX_* vars"
```

---

### Task 8: Ops — Close statuses, Vercel env, full test run, deploy, smoke test

**No code; uses MCP + Vercel CLI + git.**

- [ ] **Step 1: Create the two Close lead statuses** via the Close MCP (`create_lead_status`): `Holetox - New` and `Holetox - Bad Fit`. Record the returned `stat_…` IDs.

- [ ] **Step 2: Set Vercel production env** to those IDs:

```bash
printf '%s' '<stat_holetox_new_id>'  | vercel env add CLOSE_STATUS_HOLETOX_NEW production
printf '%s' '<stat_holetox_bf_id>'   | vercel env add CLOSE_STATUS_HOLETOX_BAD_FIT production
```

- [ ] **Step 2b:** Verify with `vercel env ls production | grep CLOSE_STATUS_HOLETOX`.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: green (pre-existing `js/__tests__/geo-gate.test.js` SD failure is unrelated and tracked separately — confirm no NEW failures).

- [ ] **Step 4: Open a PR and merge to main**

```bash
git push -u origin holetox-funnel
gh pr create --title "feat: Holetox funnel (NYC/SD landers + capture/travel-gate + booking)" --body "<summary + links to spec/plan>"
```
Merge after review → Vercel auto-deploys `main`.

- [ ] **Step 5: Smoke-test production**

```bash
for p in holetox-nyc holetox-sd holetox-form holetox-book; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" "https://lushfulcontent.vercel.app/$p"
done
```
Expected: all `200`. Optionally submit one real test lead end-to-end and confirm it lands in Close as `Holetox - New`, then clean it up.

---

## Self-review

- **Spec coverage:** landers (T5/T6), shared form + travel-gate (T4), booking placeholder (T3), `api/lead.js` routing (T1), `api/lead-update.js` source-aware disqualify (T2), env doc (T7), Close statuses + env + deploy (T8). Reused-unchanged items (`/api/geo`, `js/geo-gate.js`, travel_status plumbing) need no task. ✓ All spec sections mapped.
- **Placeholder scan:** backend code + tests are complete and literal. HTML tasks are "clone + explicit content edits" (appropriate for ~1300-line static files) with concrete copy, the exact video URL, and exact CTA hrefs — no "TBD". The Calendly slug is an intentional, documented placeholder. ✓
- **Type/name consistency:** `isHoletox` defined per-file; env vars `CLOSE_STATUS_HOLETOX_NEW` / `CLOSE_STATUS_HOLETOX_BAD_FIT` and Mailchimp tags `Holetox` / `holetox-not-qualified` are spelled identically across tasks and tests; `goToBooking` redirects to `/holetox-book` which T3 creates; form `?source=` values (`holetox-nyc`/`holetox-sd`) match the T1 enum. ✓
