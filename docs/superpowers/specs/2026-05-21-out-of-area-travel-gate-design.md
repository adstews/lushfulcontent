# Out-of-Area Travel Gate — Design

**Date:** 2026-05-21
**Scope:** `girthfill-form.html` (+ `girthfill-form-google.html`)

## Problem

A handful of leads who booked consultations via the girthfill form turned out to live nowhere near NYC. We want a soft gate inserted into the form that detects out-of-area visitors and asks them to confirm they'll travel before they can book a Calendly slot. The gate must be invisible to locals so the existing happy path doesn't gain a friction step.

## Solution overview

A new conditional step `stepTravel` is inserted between `stepContact` and `stepOptions`. Whether it fires is decided by a three-signal cascade evaluated when the user submits the Contact step:

1. **Phone area code** — parsed client-side, looked up against a hardcoded NANP area-code → centroid coords table. Compute great-circle distance to the lander's anchor city. If <100mi → skip the step.
2. **IP geolocation** — Vercel automatically attaches `x-vercel-ip-latitude` / `x-vercel-ip-longitude` headers to all serverless function requests. A new `/api/geo` endpoint returns `{lat, lng, city}`. Fired eagerly on page load so the result is ready by the time the user finishes the form. If <100mi → skip the step.
3. **Fallback** — if both signals are out-of-range, OR either signal is unavailable, show `stepTravel`.

If the user answers **Yes**, advance to `stepOptions` as usual. If **No**, route to `stepNoThanks` (same as the existing "Not Right Now" disqualification path).

## Anchor selection

The anchor city is derived from `?source=` on the form URL. The existing form already resolves source against an allowlist (`girthfill-landing`, `girthfill-nyc`, `girthfill-sd`) with `girthfill-landing` as the fallback for direct hits, so we reuse that same resolved value:

| Resolved source     | Anchor | Coordinates              |
|---------------------|--------|--------------------------|
| `girthfill-nyc`     | NYC    | 40.7589, -73.9851        |
| `girthfill-landing` | NYC    | 40.7589, -73.9851        |
| `girthfill-sd`      | SD     | 32.7157, -117.1611       |

The 100mi radius is the same for both. (NYC is the default to match the recent `/` attribution change in commit a1c457e.)

## Files to create

### `js/area-codes.js`
Static export: NANP area code → `[lat, lng]` centroid. Covers all ~330 active US area codes. Compiled once from a public dataset; no runtime updates needed.

```js
export const AREA_CODE_COORDS = {
  "212": [40.7589, -73.9851],
  "619": [32.7157, -117.1611],
  // ...
};
```

### `js/geo-gate.js`
Pure helpers — no DOM, no fetches. Exports:

- `extractAreaCode(phone: string): string | null` — strip non-digits, return first NPA after optional country code `1`.
- `haversineMiles(a: [lat, lng], b: [lat, lng]): number` — standard great-circle distance.
- `ANCHORS = { nyc: [...], sd: [...] }` and `anchorFromSource(source: string): [lat, lng]`.
- `evaluateGate({ phone, ipCoords, anchor }): 'local' | 'out-of-area' | 'unknown'` — runs the cascade described above. Returns `'local'` if either phone or IP says <100mi, `'out-of-area'` if both say ≥100mi, `'unknown'` if neither signal is usable (treated as out-of-area for prompt purposes).

Unit-testable in `js/__tests__/geo-gate.test.js`.

### `api/geo.js`
Minimal Vercel function. Reads `x-vercel-ip-latitude`, `x-vercel-ip-longitude`, `x-vercel-ip-city`, `x-vercel-ip-country` from request headers and returns:

```json
{ "lat": 40.7589, "lng": -73.9851, "city": "New York", "country": "US" }
```

Returns `{ "lat": null, "lng": null }` if headers are missing (local dev, header stripped by proxy, etc.). No external API calls, no secrets, no rate limiting needed.

## Files to modify

### `girthfill-form.html`
1. Import the new modules in the existing `<script>` block (or inline them — the file is a single-file static page).
2. On `DOMContentLoaded`, fire `fetch('/api/geo')` and stash the promise as `window.__geoPromise` so `submitContact` can `await` it. Eager fetch keeps the gate decision latency-free.
3. Add the new `stepTravel` markup between `stepContact` and `stepOptions`. Note the step label is intentionally not numbered ("One more thing"): the existing labels say "Step 1 of 2" / "Step 2 of 2" and most users never see stepTravel, so renumbering everything would be misleading for the local-user majority.
   ```html
   <div class="form-step" id="stepTravel">
     <h2>Can you travel to <span id="travelCity">NYC</span> for your consultation?</h2>
     <p>Our consultations are in-person at our <span id="travelCityFull">Midtown Manhattan</span> office. We don't currently offer virtual visits for GirthFill.</p>
     <div class="step-label">One more thing</div>
     <button class="btn-yes" onclick="answerTravel(true)">Yes, I can travel</button>
     <button class="btn-no" onclick="answerTravel(false)">Not Right Now</button>
   </div>
   ```
4. Extend `submitContact` so that after the existing `/api/lead` POST succeeds (which already stashes `window.__leadId` and sends `qualified: true`) it runs `evaluateGate(...)`:
   - `'local'` → fire-and-forget `lead-update` with `{ lead_id: window.__leadId, travel_status: 'local' }`, then `showStep('stepOptions')`.
   - `'out-of-area'` / `'unknown'` → populate the city span(s) based on the resolved anchor source, then `showStep('stepTravel')`.
5. New `answerTravel(willing)` function (uses `window.__leadId` set during `submitContact`):
   - `willing === true` → fire-and-forget `lead-update` with `{ lead_id, travel_status: 'willing_to_travel' }`, then `showStep('stepOptions')`.
   - `willing === false` → fire-and-forget `lead-update` with `{ lead_id, qualified: false, travel_status: 'declined_travel' }`, then `showStep('stepNoThanks')`. Using `qualified: false` reuses the existing bad-fit Close status transition + Mailchimp `girthfill-not-qualified` tag.

### `girthfill-form-google.html`
Same edits. The two files diverge only on analytics tags; the form-step skeleton is identical.

### `api/lead-update.js`
Extend `BodySchema`:
```js
travel_status: z.enum(['local', 'willing_to_travel', 'declined_travel']).optional()
```
Relax the existing refine so `travel_status` also counts as a valid mutation. Add the Close write in the fanout block:
```js
if (body.travel_status !== undefined) {
  requiredCloseEnvVars.push('CLOSE_CF_TRAVEL_STATUS')
  // ... after assembling customFields:
  customFields[process.env.CLOSE_CF_TRAVEL_STATUS] = TRAVEL_STATUS_LABELS[body.travel_status]
}
```
Where `TRAVEL_STATUS_LABELS = { local: 'Local', willing_to_travel: 'Willing to Travel', declined_travel: 'Declined Travel' }`. Add a matching Supabase column (`travel_status text`) via a new migration in `supabase/migrations/`.

### `lib/__tests__/` / `js/__tests__/`
- `geo-gate.test.js` — area code parsing, haversine sanity, cascade decisions.
- `lead-update.test.js` — extend existing tests to cover the `travel_status` branch.

## Manual setup (one-time)

Before deploying:

1. Create a custom field in Close called **Travel Status** (choice, options: `Local`, `Willing to Travel`, `Declined Travel`). Copy its ID into `CLOSE_CF_TRAVEL_STATUS` in Vercel env.
2. Run the Supabase migration to add the `travel_status` column.

## Edge cases

- **No phone area code parseable** (e.g., user typed just digits with country code only) → phone signal returns `null`, falls through to IP.
- **IP headers missing** (local dev, future proxy change) → `/api/geo` returns nulls, IP signal returns `null`. If phone also `null` → result is `'unknown'` → we show the step. Conservative default: better to ask one extra question than book a bad consult.
- **VPN users** in non-anchor regions → false positive prompt. They can still say "Yes" and proceed. Minor friction; not a correctness issue.
- **Phone number portability** (e.g., 212 number carried to Los Angeles) → false negative, the step is skipped. We accept this — a kept-NYC-number usually correlates with NYC ties, and IP is unlikely to also say NYC. We trust the phone signal.
- **International users** → area code lookup will miss, IP will be far from anchor, step shows. Correct behavior.
- **Sequential timing** — `/api/geo` is fired on page load. By the time the user finishes typing a phone number (multiple seconds), it has resolved. If it hasn't, `submitContact` awaits with a 1.5s timeout, then treats IP as `null` and proceeds with phone-only.

## Non-goals

- **B&A modals on long landers** (`girthfill-nyc.html`, `girthfill-sd.html`, -google variants). These are photo-reveal gates, not consultation bookings. Out of scope.
- **`consultation-book.html`** — direct Calendly entry point used in Close email outreach. Those leads are already vetted by the patient-care team. Out of scope.
- **`deposit-appointment.html`** — deposit flow, not initial consult. Out of scope.
- **Reverse-geocoding the IP coords to a ZIP**. Vercel headers don't include ZIP, and adding a geocode dep isn't worth it for a ±50mi precision win. Lat/lng + haversine to anchor is enough.
- **Tracking which signal triggered the prompt** (phone vs IP vs both). Could be useful later for tuning the radius but adds DB columns. Defer.

## Open questions

None at design time. All clarifications have been answered:
- Scope: both NYC and SD landers, anchor follows `?source=`.
- Disposition for "No": existing `stepNoThanks` (route + `qualified: false`).
- Form scope: `girthfill-form.html` + `-google` variant only.
- Tagging: new `travel_status` custom field in Close.
