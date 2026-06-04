# Holetox Funnel — Design

**Date:** 2026-06-04
**Scope:** A second paid-traffic funnel for Lushful Aesthetics — the **Holetox**
($900 anal Botox) offer — reusing the existing GirthFill lead → Close → Mailchimp
plumbing. NYC + San Diego landers, capture + travel-gate, Calendly booking.

## Problem

The funnel and CRM were built solely around GirthFill. Lushful wants to test a
second procedure (Holetox) on paid traffic. We need a Holetox landing funnel that
captures leads into Close, keeps them distinguishable from GirthFill, and ends at
a Calendly booking — **without rebuilding the CRM**. This is a small test that may
not continue, so minimize blast radius on the live GirthFill funnel and defer the
"real" procedure modeling.

## Decisions (from brainstorming)

- **Geo:** NYC + San Diego variants. No Google-Ads variant, no age-gate.
- **Qualifier:** none (no affordability/medical gate) — capture name/email/phone, then book.
- **Travel-gate:** KEPT. Consults are in-person NYC/SD only; out-of-area "No" → **hard-disqualify** (mirror GirthFill).
- **Positioning:** bottoming-ease, direct (matches the client's own page; sex-positive, clinical-but-approachable).
- **Booking:** placeholder Calendly link labeled "15-minute Holetox consult"; user swaps the real link in later.
- **Procedure differentiation:** hyphenated Close statuses (`Holetox - New`, `Holetox - Bad Fit`) + the existing free-text **Source** custom field. **No** procedure custom field yet (deferred).

## Funnel flow

```
holetox-nyc.html / holetox-sd.html  (capture: name, email, phone)
  → POST /api/lead { source: holetox-nyc | holetox-sd }
      → lead created in "Holetox - New"; returns { lead_id }
  → client runs evaluateGate({ phone, ipCoords (from /api/geo), anchorKey })
      • 'local'      → fire-and-forget /api/lead-update { lead_id, travel_status:'local' } → redirect holetox-book.html
      • 'show-step'  → show travel interstitial
          - "Yes, I can travel" → /api/lead-update { lead_id, travel_status:'willing_to_travel' } → redirect holetox-book.html
          - "No"                → /api/lead-update { lead_id, qualified:false, travel_status:'declined_travel' } → "not a fit right now" message (no booking)

holetox-book.html  → Calendly (placeholder, 15-min)
  → on calendly.event_scheduled: existing prefill + /api/lead-update { lead_id, cta_clicked:'book-calendly' } → shared "Call Booked" + FB Schedule pixel
```

## Content (landers)

- Direct bottoming-ease positioning; sex-positive, clinical-but-approachable (match client tone).
- Hero + embedded YouTube explainer: `https://www.youtube.com/embed/_3XEqy_OZ10` (the client's own Holetox video).
- How it works (Botox into the internal anal sphincter, ~3-min treatment, ~4 injection sites, ProNox for comfort).
- Benefits: easier/more comfortable bottoming, fissure & rectal-spasm relief, hemorrhoid prevention.
- Pricing: **$900 flat** (regardless of units) + Cherry financing (soft credit check).
- FAQ: pulled from research (does it hurt, how long it lasts 3–4 mo, side effects, incontinence myth, sex-after-3-days, no before/after).
- Social proof: press logos (Daily Mail / GQ / NY Post / Gay Times). **No before/after** (performance-based; none exist).
- NYC vs SD copy differences (local office mention).
- Analytics tags identical to existing pages: GTM `GTM-PSX5GNZ`, Meta Pixel `24843507025240186`, Google Ads `AW-11150884432`.

## Files to create

- `holetox-nyc.html`, `holetox-sd.html` — landers. Clone the GirthFill geo-lander structure for look/sections, and the **capture + travel-gate step machine** from `girthfill-form.html` (simplified: contact step → optional travel step → redirect/disqualify; no affordability qualifier, no options step).
- `holetox-book.html` — clone of `consultation-book.html`. Calendly `data-url` set to a **placeholder** (e.g. `calendly.com/lushfulaesthetics/holetox-15min`) with a visible "15-minute consult — booking link pending" note; keep name/email prefill, post-booking `/api/lead-update`, and FB Schedule pixel.

## Files to modify

### `api/lead.js`
- `source` enum: add `holetox-nyc`, `holetox-sd`.
- Status routing: `const isHoletox = body.source.startsWith('holetox')`. Holetox → `CLOSE_STATUS_HOLETOX_NEW`. GirthFill `qualified` logic unchanged and only applies when `!isHoletox`.
- Mailchimp: when `isHoletox`, push a `Holetox` umbrella tag (the per-source tag — `holetox-nyc`/`holetox-sd` — comes free from the existing `source`-as-tag behavior).

### `api/lead-update.js`
- Make the `qualified` branch **source-aware** (it already fetches `lead.source`): when `lead.source` starts with `holetox` and `qualified === false`, route `statusId` to `CLOSE_STATUS_HOLETOX_BAD_FIT` and use the `holetox-not-qualified` Mailchimp tag (instead of GirthFill's `CLOSE_STATUS_BAD_FIT` / `girthfill-not-qualified`). Require `CLOSE_STATUS_HOLETOX_BAD_FIT` in `requiredCloseEnvVars` for that path. Holetox never sends `qualified:true`, so only the false path needs handling. GirthFill behavior unchanged.

### `.env.example`
- Document `CLOSE_STATUS_HOLETOX_NEW` and `CLOSE_STATUS_HOLETOX_BAD_FIT`.

## Reused unchanged

- `/api/geo` and `js/geo-gate.js` — **NYC + SD are the same anchor cities**, so the anchor coords + area-code tables already cover Holetox. Each lander passes its `anchorKey` (`'nyc'`/`'sd'`) directly.
- `travel_status` plumbing — Close `Travel Status` custom field (`CLOSE_CF_TRAVEL_STATUS`) and the Supabase `travel_status` column (added by GirthFill migration `20260521120000_add_travel_status.sql`) already exist.

## Close + env setup (done via MCP/CLI — no user action)

- Create lead statuses: **`Holetox - New`**, **`Holetox - Bad Fit`** (procedure-prefixed so all Holetox statuses cluster in the Close list).
- Set Vercel **production** env: `CLOSE_STATUS_HOLETOX_NEW`, `CLOSE_STATUS_HOLETOX_BAD_FIT` to the new status IDs.

## Tests (vitest, TDD)

- `api/__tests__/lead.test.js`: `holetox-nyc`/`holetox-sd` accepted by the schema; creates the Close lead with `CLOSE_STATUS_HOLETOX_NEW`; `Holetox` Mailchimp tag present; GirthFill cases still pass.
- `api/__tests__/lead-update.test.js`: a Holetox-source lead with `qualified:false` calls `updateLead` with `CLOSE_STATUS_HOLETOX_BAD_FIT` and tags `holetox-not-qualified`; GirthFill disqualify path unchanged.

## Non-goals / deferred

- Procedure custom field in Close (use hyphenated statuses + Source for now).
- Holetox-specific appointment statuses (share `Call Booked` → `Appt Showed`; Source distinguishes).
- `Holetox - Qualified` status (no auto-qualify path in this funnel; add later if a manual lane is wanted).
- Google-Ads variant, age-gate, before/after gallery, virtual-consult option.
- The real Calendly event (placeholder until the user provides the 15-min link).

## Edge cases

- `/api/lead` returns only `lead_id`; `/api/lead-update` looks up `close_lead_id` from the row — `lead_id` alone is sufficient for the gate calls.
- Holetox reuses the `qualified` boolean purely as the disqualify signal; `CLOSE_CF_QUALIFIED` gets set to "No" on disqualify (harmless).
- Placeholder Calendly: bookings won't complete until the real link is set; the rest of the funnel is fully functional and testable.
- Geo "unknown" (no parseable area code AND missing IP headers) → show-step → visitor can still answer "Yes" and proceed. Conservative default, same as GirthFill.

## Open questions

None at design time — all resolved in brainstorming (geo scope, qualifier, travel-gate disposition, positioning, booking placeholder, status naming).
