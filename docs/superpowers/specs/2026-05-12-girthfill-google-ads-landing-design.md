---
date: 2026-05-12
status: design
summary: New city-specific landing pages and contact-first qualification form, dedicated to Google Ads traffic. NYC built first, SD follows. Lives alongside (does not replace) the existing Meta-side qualifier-first funnel.
---

# GirthFill Google Ads Landing Design

## Background

The current GirthFill landing pages (`girthfill-nyc.html`, `girthfill-sd.html`) and consultation form (`girthfill-form.html`) implement a **qualifier-first** funnel: the user is shown the $8,500 price gate before submitting contact info. Only qualified leads enter Close, Mailchimp, and the Meta `CompleteRegistration` event. That filter optimizes Meta Ads for high-quality conversion signal.

For Google Ads we want a different optimization strategy: a **contact-first** funnel that captures every lead (qualified or not) and exposes two conversion signals to Google Smart Bidding — a high-volume "Lead Submission" early signal and a high-quality "Qualified Lead" later signal. We use the high-volume signal to give Smart Bidding faster learning, then transition to the qualified signal once volume is sufficient.

This spec covers the NYC build. A parallel SD build follows the same design with city-specific copy and office swap.

## Goals

- New `girthfill-nyc-google.html` landing page modeled on the structure of `https://lushfulaesthetics.com/lushful-aesthetics-signup`, incorporating the existing hero video and trust elements, NYC office only
- New `girthfill-form-google.html` contact-first qualification form (Step 1: contact → Step 2: qualifier → Step 3: book OR follow on social)
- Capture every Step-1 contact submission in Supabase + Mailchimp + Close (including disqualified leads, which existing flow does NOT capture)
- Distinguish Google traffic from Meta traffic in CRM via new `source` values: `girthfill-nyc-google` (now), `girthfill-sd-google` (later)
- Two Google Ads conversion actions firing at two points: Step 1 contact submit (new "Lead Submission" action) and Step 2 qualified=yes (existing "Qualified Lead" action)
- Mirror Meta to two-tier: `Lead` event on Step 1, `CompleteRegistration` on Step 2 yes
- Zero regression risk to the existing Meta funnel — net-new files, additive API enum change only

## Non-Goals

- No changes to existing `girthfill-nyc.html`, `girthfill-sd.html`, or `girthfill-form.html`. Meta traffic continues to use the qualifier-first flow unchanged.
- No new Supabase schema migrations. No new Mailchimp merge fields. No new Close custom fields.
- No tracking on Step 3b social/homepage buttons (disqualified leads are already captured at Step 2; granular post-disqualification clicks add complexity for minimal value).
- No SD build in this spec. SD will follow the same pattern in a separate spec.

## Architecture

```
                                 ┌─────────────────────────────────────┐
                                 │  girthfill-nyc-google.html          │
                                 │  (Google Ads NYC landing)           │
                                 └─────────────────────────────────────┘
                                                  │
                                                  │ CTA buttons
                                                  ▼
                                 ┌─────────────────────────────────────┐
                                 │  girthfill-form-google.html         │
                                 │  ?source=girthfill-nyc-google       │
                                 │                                     │
                                 │  Step 1: Contact info ──────────┐   │
                                 │     ↓                           │   │
                                 │  Step 2: $8,500 qualifier ──────┤   │
                                 │     ↓               ↓           │   │
                                 │  Step 3a: Book      Step 3b:    │   │
                                 │  (yes path)         Social      │   │
                                 │                     (no path)   │   │
                                 └─────────────────────────────────┼───┘
                                                                   │
                                  POST /api/lead at Step 1         │
                                  POST /api/lead-update at         │
                                  Step 2 + Step 3a CTAs            │
                                                                   ▼
                                 ┌─────────────────────────────────────┐
                                 │  Supabase leads (source = nyc-google)│
                                 │  Mailchimp (tag = girthfill-nyc-google)│
                                 │  Close (status: New → Q or Bad Fit)  │
                                 └─────────────────────────────────────┘
```

## Detailed Design

### 1. Landing Page: `girthfill-nyc-google.html`

**Section order (top to bottom):**

1. **Nav** — dark (`#1E2A21`), Lushful logo on left, single "Request More Info" CTA on right. No anchor links — conversion-focused page; fewer escape hatches.
2. **Hero** — split layout. Left column: "What is GirthFill?" headline + checkmark benefits list (Increased girth, Longer flaccid length, No effect on erectile function, FDA-approved fillers, Immediate confidence boost) + primary CTA "Request More Info". Right column: existing self-hosted hero video `/videos/girthfill-consult.mp4` with poster `/videos/girthfill-consult-poster.jpg`, click-to-play (zero video bytes load until user clicks play).
3. **Trust bar** — five stats: 5,000+ procedures, 1-2" girth increase, FDA-approved, 3+ year results, 100% reversible. Cream background.
4. **Press logos** — GQ / VICE / Cosmopolitan / NY Post / The Late Show / Men's Health.
5. **Before/After carousel** — age-gated modal pattern from existing landing. Posts to `/api/lead` with `source: 'girthfill-carousel'` (stays out of Close pipeline, consistent with existing carousel). 10 case images from `images/`.
6. **"Who is GirthFill For?"** — new section adapted from reference page. Describes ideal candidates + customization for individual anatomy and goals.
7. **Transparent pricing card** — dark card. $8,500 starting price for 10 syringes. Bullet list of inclusions (FDA filler, 1-2" girth, additional syringes $700, 2-3 year results, performed by InjectorChris, Cherry financing). CTA: "Request More Info".
8. **Provider section** — Chris Bustamante, DNP, NP-C credentials + headshot from main site.
9. **Testimonials** — 3 cards (M.R., T.K., D.L., same copy as existing landing).
10. **NYC Office** — address (18 E 41st St, 14th Floor, New York, NY 10017), phone `(917) 277-3398`, Get Directions link, embedded Google Maps iframe. **NYC only** — no SD office card.
11. **FAQ** — top 5 questions only: pain, results duration, sensitivity, reversibility, recovery. (Trimmed from existing 7 to keep page focused.)
12. **CTA banner** — dark, "Ready to Take the Next Step?" headline + single "Request More Info" button.
13. **Footer** — copyright + city list.

**Design system:** keeps existing palette (`#1E2A21` dark, `#F5F0EB` cream, `#FAF8F5` warm white, `#C4A882` accent) and fonts (Playfair Display headers + Inter body). Same CSS structure as existing `girthfill-nyc.html` — single `<style>` block in head, no external CSS.

**CTA targets:** every "Request More Info" button opens `/girthfill-form-google?source=girthfill-nyc-google` in a new tab via `window.open(..., '_blank')`.

**Deliberate omissions from reference page:**
- No financing detail section (covered in pricing card)
- No travel assistance section (less relevant for geo-targeted Google Ads NYC traffic)
- No SD location card (NYC-only page)

**Deliberate additions vs reference page:**
- Hero video (not on reference page)
- Trust bar + press logos (not on reference page; both are high converters per existing performance)

### 2. Form Page: `girthfill-form-google.html`

**Visual style:** matches existing `girthfill-form.html` — dark body (`#1E2A21`), white card centered with shadow, Playfair headers + Inter body, same palette.

**Source resolution:** form reads `?source=` query param against allowlist `['girthfill-nyc-google', 'girthfill-sd-google']`, defaults to `'girthfill-nyc-google'` for direct hits. Single form file serves both NYC and (later) SD landing pages.

**Steps:**

#### Step 1 — Contact info (active first)

- Progress dots: "Step 1 of 2" (filled-empty)
- Header: "Tell Us About Yourself"
- Subtitle: "We'll use this to reach out about your consultation."
- Inputs: First Name, Last Name, Email, Phone (all required)
- Button: "Continue"
- Consent line: same as existing form ("By submitting you agree to receive occasional emails from Lushful Aesthetics. Unsubscribe anytime.")

On submit:
1. Concatenate `first_name + ' ' + last_name` → `name`
2. POST `/api/lead` with `{ name, email, phone, source: <resolved>, ...attribution }`. No `qualified` field.
3. Stash returned `lead_id` in `window.__leadId`
4. Fire `gtag_report_lead_submission()` (guarded)
5. Fire `fbq('track', 'Lead')` (guarded)
6. Advance to Step 2

#### Step 2 — $8,500 qualifier

- Progress dots: "Step 2 of 2" (both filled)
- Header: "Before We Begin"
- Highlight: "GirthFill is not covered by insurance."
- Body: "Treatments start at **$8,500 for 10 syringes** and typically add **1-2 inches of girth**. Financing is available through Cherry."
- Question: "Are you still interested?"
- Buttons: "Yes, I'm Interested" / "Not Right Now"

On Yes:
1. POST `/api/lead-update` with `{ lead_id, qualified: true }` (fire-and-forget — UI advances immediately)
2. Fire `gtag_report_qualified_lead()` (guarded)
3. Fire `fbq('track', 'CompleteRegistration')` (guarded)
4. Advance to Step 3a

On No:
1. POST `/api/lead-update` with `{ lead_id, qualified: false }` (fire-and-forget)
2. No ads conversions fired
3. Advance to Step 3b

#### Step 3a — Yes path (Options)

- No progress dots (destination state)
- Header: "Great! Here are your options:"
- Primary button: **Book An Appointment** → `https://www.joinblvd.com/b/lushful-aesthetics/widget#/locations`. Note: "$1,000 Deposit, applied to procedure". On click: POST `/api/lead-update` with `{ lead_id, cta_clicked: 'book' }` (fire-and-forget).
- Tap-to-call card: "You can also call our office to discuss details. **(917) 277-3398**" → `tel:+19172773398`. On click: `cta_clicked: 'tap-to-call'`.

#### Step 3b — No path (Social follow)

- No progress dots (destination state)
- Header: "Stay In Touch"
- Body: "GirthFill might not be right for you today — and that's okay. Follow us for results and educational content. If anything changes, we'd love to hear from you."
- **Instagram button** → `https://www.instagram.com/lushfulaesthetics/` (target=_blank)
- **YouTube button** → `https://www.youtube.com/channel/UCh6HankCyOK9CgsS-uvTjGg/` (target=_blank)
- Tertiary: "Visit Our Homepage" → `https://lushfulaesthetics.com`
- No tracking on these buttons (lead is already captured as Bad Fit at Step 2)

**Name handling:** form UI has separate First Name + Last Name inputs; client concatenates to single `name` string before POST. Mailchimp `FNAME` will receive "First Last" (same as today — pre-existing behavior, not introducing new debt).

### 3. Tracking

**Both pages get:**
- GTM container `GTM-PSX5GNZ` (head script + body noscript)
- Meta Pixel `24843507025240186` head snippet → automatic PageView
- `js/attribution.js` on page load → captures `utm_*`, `fbclid`, `gclid`, `referrer`, `landing_page`, `user_agent` for the eventual `/api/lead` POST

**Form page additionally gets:**
- `gtag.js` loader for `AW-11150884432`
- Two global helpers:
  - `gtag_report_lead_submission()` → fires the new "Lead Submission" conversion (label TBD — placeholder `LEAD_SUBMISSION_LABEL` in code, swapped at launch with the real label from Google Ads UI)
  - `gtag_report_qualified_lead()` → fires existing `AW-11150884432/o557CJi-86UcEND8k8Up`

**Firing matrix:**

| Trigger | Google Ads | Meta Pixel |
|---|---|---|
| Step 1 submit success (after `/api/lead` 200) | `gtag_report_lead_submission()` | `fbq('track', 'Lead')` |
| Step 2 qualifier = Yes | `gtag_report_qualified_lead()` | `fbq('track', 'CompleteRegistration')` |
| Step 2 qualifier = No | none | none |
| Step 3a Book / Tap-to-Call | none (server-side via Close) | none |
| Step 3b Social / Homepage | none | none |

All `gtag` and `fbq` calls wrapped in `typeof === 'function'` guards so ad blockers cannot break the form (same hardening pattern as existing form).

### 4. API Changes

**`api/lead.js`** — single change: widen the `source` enum.

```js
source: z.enum([
  'girthfill-landing',
  'girthfill-carousel',
  'girthfill-nyc',
  'girthfill-sd',
  'girthfill-nyc-google',  // new
  'girthfill-sd-google'    // new (for SD pass)
])
```

No other code changes needed. The existing flow handles `qualified: undefined` correctly:
- Supabase upsert skips `qualified` and `qualified_at` columns
- Mailchimp tags = `[source, 'SQ Lander']` (no qualified tag at Step 1)
- Close createLead uses `CLOSE_STATUS_NEW` (Potential status)

**`api/lead-update.js`** — no changes. Existing schema already accepts:
- `qualified: boolean` — used at Step 2 to flip Close status to Qualified or Bad Fit
- `cta_clicked: 'book' | 'call' | 'tap-to-call'` — used at Step 3a for Book and Tap-to-Call

Step 3b social buttons do not call this endpoint.

### 5. CRM Mapping

**Step 1 — contact submit** (via `/api/lead`, no `qualified`):

| System | Action |
|---|---|
| Supabase `leads` | insert with `source = 'girthfill-nyc-google'`, attribution fields. `qualified` and `qualified_at` left NULL. |
| Mailchimp | upsertSubscriber with FNAME/PHONE/SOURCE/UTM_*. addTags `['girthfill-nyc-google', 'SQ Lander']`. |
| Close | createLead with status `CLOSE_STATUS_NEW` (Potential). Custom fields: `CLOSE_CF_SOURCE = 'girthfill-nyc-google'`, plus any present utm_*/fbclid/gclid. `CLOSE_CF_QUALIFIED` not set. |

**Step 2 — qualifier = Yes** (via `/api/lead-update`, `qualified: true`):

| System | Action |
|---|---|
| Supabase | update `qualified = true`, `qualified_at = now()` |
| Mailchimp | addTags `['girthfill-qualified']` |
| Close | updateLead with `statusId = CLOSE_STATUS_QUALIFIED`. `CLOSE_CF_QUALIFIED = 'Yes'`. |

**Step 2 — qualifier = No** (via `/api/lead-update`, `qualified: false`):

| System | Action |
|---|---|
| Supabase | update `qualified = false`, `qualified_at = now()` |
| Mailchimp | addTags `['girthfill-not-qualified']` |
| Close | updateLead with `statusId = CLOSE_STATUS_BAD_FIT`. `CLOSE_CF_QUALIFIED = 'No'`. |

**Step 3a — Book / Tap-to-Call** (via `/api/lead-update`, `cta_clicked: ...`):

| System | Action |
|---|---|
| Supabase | update `cta_clicked` |
| Close | updateLead with `CLOSE_CF_CTA_CLICKED = 'Book Appointment'` or `'Tap to Call'` |

**Step 3b — social / homepage:** no CRM writes.

**Segmentation enabled by this design:**

Mailchimp segments:
- `girthfill-nyc-google` + `girthfill-qualified` → Google-Ads NYC qualified prospects (bullseye nurture)
- `girthfill-nyc-google` + `girthfill-not-qualified` → disqualified-from-Google-NYC (lighter nurture cadence)
- `girthfill-nyc-google` alone → all Google-Ads NYC leads regardless of qualification

Close Smart Views:
- `Source = girthfill-nyc-google` AND `Status = Qualified` → active sales pipeline
- `Source = girthfill-nyc-google` AND `Status = Bad Fit` → cohort to size disqualification rate per Google campaign

## Files Touched

**New files:**
- `girthfill-nyc-google.html` — Google-Ads NYC landing page (~600 lines)
- `girthfill-form-google.html` — contact-first qualification form (~400 lines)

**Modified files:**
- `api/lead.js` — widen `source` enum by 2 values
- `api/__tests__/lead.test.js` (or wherever existing tests live) — add cases for new source values
- (Optional) `api/__tests__/lead-update.test.js` — verify existing flow handles new sources without regression

**No changes to:**
- `index.html`, `girthfill-nyc.html`, `girthfill-sd.html`, `girthfill-form.html` (existing Meta funnel untouched)
- `api/lead-update.js` (no schema changes needed)
- `lib/close.js`, `lib/mailchimp.js`, `lib/supabase.js` (no client lib changes needed)
- Supabase schema (no migrations)
- `vercel.json` (no routing changes; `cleanUrls: true` already in place)

## Launch Prerequisites

Before `/girthfill-nyc-google` can go live:

1. **Create Google Ads conversion action** — in Google Ads UI: Tools → Conversions → New conversion action → Website → "Lead Submission" (or similar name). Configure as Lead category, count = One per click, attribution = data-driven. Copy the conversion label string (the part after `AW-11150884432/`).
2. **Paste conversion label** into `girthfill-form-google.html` to replace `LEAD_SUBMISSION_LABEL` placeholder.
3. **Verify conversion firing** in Google Ads → Tools → Conversions → "Lead Submission" should show Recording within 24h of first form submit.
4. **Verify Meta `Lead` event** in Meta Events Manager → Test Events.
5. **Verify Close lead creation** — submit a test lead end-to-end; confirm row appears in Close as Potential, then transitions to Qualified or Bad Fit at Step 2.

## Testing

**Unit tests (Vitest):**
- `api/lead.test.js`: BodySchema accepts both new source values. Mailchimp tags include `girthfill-nyc-google`. Close createLead called with `CLOSE_STATUS_NEW` when `qualified` is undefined. (Extend existing test fixtures with new source value.)
- `api/lead-update.test.js`: existing test coverage handles new sources transparently (no source-specific branching in this endpoint). Smoke-test that a lead created with `source: 'girthfill-nyc-google'` can be transitioned to Qualified.

**Form unit tests:** existing repo has no form-level JS unit tests; the new form follows the same hand-written pattern as `girthfill-form.html`. Manual E2E verification required (see below).

**Manual E2E verification (before announcing launch):**
1. Visit `/girthfill-nyc-google` — confirm hero video loads, CTAs all link to `/girthfill-form-google?source=girthfill-nyc-google`.
2. Submit Step 1 with a test contact → confirm Supabase row created with `source = 'girthfill-nyc-google'`, Close lead created as Potential, Mailchimp tags applied.
3. Click "Yes" on Step 2 → confirm Supabase `qualified = true`, Close status flipped to Qualified, Mailchimp `girthfill-qualified` tag added. Confirm Google Ads "Qualified Lead" + Meta `CompleteRegistration` fired in respective Test Events tooling.
4. Click "Book an Appointment" on Step 3a → confirm Boulevard widget opens; Close `CLOSE_CF_CTA_CLICKED = 'Book Appointment'`.
5. Repeat with a second test contact, click "Not Right Now" on Step 2 → confirm Supabase `qualified = false`, Close status flipped to Bad Fit, Mailchimp `girthfill-not-qualified` tag added. Confirm Step 3b social buttons open IG and YouTube in new tabs.
6. Verify Google Ads "Lead Submission" conversion fired exactly once per Step-1 submit in Test Events tooling.

## Open Questions / Future Work

- **SD page** — `girthfill-sd-google.html` will be a parallel build with NYC office swapped for SD office (3503 Fourth Ave, San Diego, CA 92103, same phone), `?source=girthfill-sd-google`, separate spec to keep change sets reviewable.
- **Offline conversions** — once we have Google Ads optimization running, consider uploading actual sale outcomes from Close back into Google Ads via offline conversion imports. Out of scope for this build.
- **Smart Bidding strategy switch** — plan to start Google Ads campaigns optimizing for "Lead Submission" (high volume signal), then switch primary conversion to "Qualified Lead" once conversion volume is sufficient (~30/month per CPC best practice). Marketing decision, not engineering.

## Architectural Notes

**Why net-new files instead of parameterizing existing ones:**
The existing form is qualifier-first by design (Meta optimization). Adding a `?flow=` parameter to switch flows would intermix two product strategies in a single file, making both harder to evolve. Net-new files keep the surfaces separable and let us deprecate either funnel independently in the future.

**Why no DB schema changes:**
The existing `leads` table already supports nullable `qualified` + `qualified_at`, which is exactly what we need for the two-phase capture (Step 1 leaves them NULL, Step 2 fills them). The `cta_clicked` column already exists. First/last name UX is purely client-side concatenation; storing combined `name` is consistent with the rest of the dataset.

**Why no `/api/lead-update.js` changes:**
Its schema already accepts `qualified` independently of `cta_clicked`, and the Close update logic already handles either or both. The "legacy" qualifier-update path noted in commit history is exactly the path we want to use for the new contact-first flow — re-activating a code path that's preserved-for-back-compat, not introducing new code.

**Why mirror Meta to two-tier (`Lead` + `CompleteRegistration`):**
Symmetric with the Google Ads strategy and gives Meta Smart Bidding two signals. The existing qualifier-first form only fires `CompleteRegistration` because contact info is gated; in the new contact-first flow, Step 1 is a legitimate Meta `Lead` event by definition. The existing Meta funnel is unchanged and keeps firing only `CompleteRegistration`.
