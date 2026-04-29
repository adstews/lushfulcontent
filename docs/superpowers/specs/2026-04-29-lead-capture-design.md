# Lead Capture: Supabase + Mailchimp + Close

**Date:** 2026-04-29
**Status:** Approved design, ready for implementation plan

## Problem

The Lushful Aesthetics GirthFill landing site (`start.lushfulaesthetics.com`) currently captures form submissions to `console.log` only. Two separate forms — the consultation form (`girthfill-form.html`) and the email-gated before/after carousel on the landing page (`index.html`) — drop every lead on the floor. We are spending paid-social budget to drive this traffic and have no way to follow up, segment for nurture, or measure campaign ROI.

## Goals

1. Persist every lead to Supabase as the source of truth.
2. Sync every lead to Mailchimp for email nurture.
3. Sync **consultation-form leads only** to Close CRM for sales follow-up. Carousel leads stay out of the sales pipeline.
4. Capture full attribution (UTM params, click IDs, referrer) so leads can be tied back to the campaign that produced them.
5. Capture the qualification answer ($8,500 yes/no) on the consultation form.
6. Capture which booking CTA was clicked when a qualified lead proceeds.
7. Never block the user funnel because a third-party API hiccupped.

## Non-Goals

- Backfilling historical leads (there are none).
- Email send automation in Mailchimp (the user manages campaigns separately).
- Sales automation in Close (the user works leads manually).
- Replatforming the static site — it stays static HTML.

## Architecture

The site stays a static HTML site on Vercel. We add two Vercel Serverless Functions (`/api/lead`, `/api/lead-update`) that own all third-party communication. All secret keys live in Vercel env vars; nothing sensitive ships to the browser.

### Request flow

**Step 1 — Contact submit (both forms):**
```
Browser POST /api/lead { name, email, phone, source, ...attribution }
  → Supabase: upsert into leads (unique on email + source)
  → Mailchimp: PUT subscriber (upsert), tag girthfill-landing or girthfill-carousel
  → Close: POST lead — ONLY if source === 'girthfill-landing'
           (carousel leads are low-intent and skip Close to keep the sales
            pipeline clean)
  → Persist mailchimp_subscriber_hash (always) and close_lead_id (consultation only)
  → Respond { lead_id }
Browser stores lead_id in memory, advances form
```

**Step 2 — Qualification answer (consultation form only):**
```
Browser POST /api/lead-update { lead_id, qualified: true|false }
  → Supabase: update leads (qualified, qualified_at, updated_at)
  → Mailchimp: tag girthfill-qualified or girthfill-not-qualified
  → Close: PUT lead — update status (Qualified or Bad Fit) and qualification custom field
  → Respond { ok: true }
Browser advances to Step 3 or Step 4
```

**Step 3 — CTA click (yes path only):**
```
Browser POST /api/lead-update { lead_id, cta_clicked: 'book'|'call'|'tap-to-call' }
  → Supabase: update leads
  → Close: PUT lead — update CTA Clicked custom field
  → Respond { ok: true }  (fire-and-forget; doesn't block navigation to Boulevard)
```

### Error handling

- **Supabase failure** is fatal. Return a 500 to the browser, show "Something went wrong, please try again." Don't advance the form. Supabase is the source of truth — if it doesn't store, we lose the lead.
- **Mailchimp or Close failure** is best-effort. Log to Vercel logs and write a row to `lead_sync_errors` so we can replay manually later. Return success to the browser. The lead is captured; a Mailchimp outage shouldn't break the funnel.
- For Step 2/3 updates, even Supabase failure is logged but does not block the user from advancing — the lead already exists and a partial qualification update is recoverable from request logs.

## Database Schema

Two tables in a fresh Supabase project for Lushful (separate from Jobalina).

```sql
create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- contact info (Step 1)
  name text not null,
  email text not null,
  phone text,

  -- qualification (Step 2)
  qualified boolean,            -- null until they answer
  qualified_at timestamptz,

  -- outcome (Step 3, optional)
  cta_clicked text,             -- 'book' | 'call' | 'tap-to-call' | null

  -- attribution
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  gclid text,
  referrer text,
  landing_page text,
  user_agent text,

  -- source / dedupe
  source text not null,         -- 'girthfill-landing' | 'girthfill-carousel'

  -- sync status
  mailchimp_synced_at timestamptz,
  mailchimp_subscriber_hash text,
  close_synced_at timestamptz,
  close_lead_id text,

  unique (email, source)
);

create index leads_created_at_idx on leads (created_at desc);
create index leads_email_idx on leads (email);

create table lead_sync_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid references leads(id) on delete cascade,
  service text not null,        -- 'mailchimp' | 'close'
  operation text not null,      -- 'create' | 'update'
  error_message text not null,
  payload jsonb,
  resolved_at timestamptz
);
```

**RLS:** Disabled on both tables. Writes go through Vercel functions using the Supabase service-role key. The browser never talks to Supabase directly. A comment in the migration documents this choice.

**`unique (email, source)`** keeps the carousel and the consultation form independent — someone can be in both lists but each is its own row, with its own qualification state.

## Mailchimp Behavior

**Operation:** `PUT /lists/{audience_id}/members/{subscriber_hash}` where `subscriber_hash = MD5(lowercase(email))`. This upsert pattern works for both Step 1 (create) and Step 2 (re-call to update tags).

**Subscriber status:** `subscribed` (single opt-in). The form adds a small consent line under Step 1's submit button: *"By submitting you agree to receive occasional emails from Lushful Aesthetics. Unsubscribe anytime."*

**Merge fields** (one-time setup in the Mailchimp UI before launch):
- `FNAME` — first name
- `PHONE` — phone
- `SOURCE` — 'girthfill-landing' or 'girthfill-carousel'
- `UTM_SRC` — utm_source
- `UTM_CAMP` — utm_campaign
- `UTM_CONT` — utm_content

**Tags** (applied via `POST /lists/{audience_id}/members/{subscriber_hash}/tags`):
- Step 1, consultation form: `girthfill-landing`
- Step 1, carousel: `girthfill-carousel`
- Step 2 yes: add `girthfill-qualified`
- Step 2 no: add `girthfill-not-qualified`

## Close CRM Behavior

**Scope:** Close sync runs **only for consultation-form leads** (`source === 'girthfill-landing'`). Carousel leads (`source === 'girthfill-carousel'`) are intent-light — they just want to see before/after photos — so we keep them in Supabase + Mailchimp only. Sending them to Close would clutter the sales pipeline with leads who never asked to talk to anyone.

**Lead structure:** B2C, one person = one Close Lead with one Contact attached.

**Endpoints:**
- Create: `POST /api/v1/lead/`
- Update: `PUT /api/v1/lead/{id}/`

**Lead fields on create:**
- `name`: person's name
- `contacts`: one entry with email + phone
- `status_id`: matches the "Potential" status (env var `CLOSE_STATUS_NEW`)
- Custom fields (one-time setup in Close UI): `Source`, `UTM Source`, `UTM Campaign`, `UTM Content`, `FBCLID`, `GCLID`, `Qualified for $8,500`, `CTA Clicked`

**Status transitions:**
- Step 1 → status "Potential" (env: `CLOSE_STATUS_NEW`)
- Step 2 yes → status "Qualified" (env: `CLOSE_STATUS_QUALIFIED`)
- Step 2 no → status "Bad Fit" (env: `CLOSE_STATUS_BAD_FIT`)

**No Opportunity** is created at form submit. Opportunities get created by the salesperson after a real conversation; auto-creating them at lead capture pollutes the pipeline.

## Frontend Changes

### `girthfill-form.html` (consultation form, multi-step)

**On page load:** parse URL params for `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`. Capture `referrer`, `landing_page` (current URL), `user_agent`. Stash in a module-level object.

**Step 1 submit handler** (currently `console.log`, line ~338):
- Disable submit button, show loading state
- `fetch('/api/lead', { method: 'POST', body: JSON.stringify({ name, email, phone, source: 'girthfill-landing', ...attribution }) })`
- On 2xx: stash `lead_id` from response, advance to Step 2
- On error: re-enable button, show inline error "Something went wrong, please try again."

**Step 2 yes/no buttons:**
- Loading state on button
- `fetch('/api/lead-update', { method: 'POST', body: JSON.stringify({ lead_id, qualified: true|false }) })`
- Always advance after the call returns (success or failure logged but doesn't block UX)

**Step 3 CTA buttons (yes path):**
- Before navigation, fire `fetch('/api/lead-update', { method: 'POST', body: JSON.stringify({ lead_id, cta_clicked: 'book'|'call'|'tap-to-call' }) })` — async, doesn't await before navigating

**Add consent line** under Step 1 submit button.

### `index.html` (landing, email-gated carousel)

The carousel form (`#baForm`, submit handler `submitBaForm`, currently `console.log` at line ~967):
- Same attribution capture on page load
- `fetch('/api/lead', { method: 'POST', body: JSON.stringify({ name, email, phone, source: 'girthfill-carousel', ...attribution }) })`
- On 2xx: reveal carousel as today
- On error: show inline error, don't reveal carousel
- Add the same consent line

This carousel never advances to a Step 2, so no `lead-update` call from here.

## API Handlers

### `POST /api/lead`

```ts
body: {
  name: string,
  email: string,
  phone: string | null,
  source: 'girthfill-landing' | 'girthfill-carousel',
  utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?,
  fbclid?, gclid?, referrer?, landing_page?, user_agent?
}
```

1. Validate body with Zod. Reject 400 on bad input.
2. Upsert into `leads` (on conflict `(email, source)`, update mutable fields). Return existing or new `lead_id`.
3. In parallel via `Promise.allSettled`:
   - Mailchimp upsert + tag (always)
   - Close create — **only if `source === 'girthfill-landing'`**; skipped for carousel
4. Persist `mailchimp_subscriber_hash` (always) and `close_lead_id` (consultation only) back to the row.
5. For each failure, insert a row into `lead_sync_errors`.
6. Respond `{ lead_id }`.

### `POST /api/lead-update`

```ts
body: {
  lead_id: string (uuid),
  qualified?: boolean,
  cta_clicked?: 'book' | 'call' | 'tap-to-call'
}
```

1. Validate body with Zod. At least one of `qualified` or `cta_clicked` required.
2. Fetch the row. Return 404 if not found.
3. Update Supabase (`qualified`, `qualified_at`, `cta_clicked`, `updated_at`).
4. In parallel: Mailchimp tag update (only if `qualified` changed), Close lead update (status + custom fields). `Promise.allSettled`.
5. Log failures to `lead_sync_errors`.
6. Respond `{ ok: true }`.

## Dependencies

`package.json`:
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2",
    "zod": "^3"
  }
}
```

Vercel runs Node 24.x — `fetch` is built in. No `node-fetch` needed. No build step; static files stay served from the repo root, and `/api/*` runs as functions.

## One-Time Configuration

Before launch we configure:

1. **Supabase** — create a fresh project for Lushful, run the migration, generate a service-role key.
2. **Mailchimp** — identify or create the audience for Lushful; add the 6 merge fields listed above; generate an API key; note the audience ID and the datacenter (e.g., `us21`).
3. **Close** — create the 8 custom fields on Lead; confirm the status names (or note the `status_id`s); generate an API key.
4. **Vercel** — set env vars (see below).

## Environment Variables

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

MAILCHIMP_API_KEY=
MAILCHIMP_AUDIENCE_ID=
MAILCHIMP_DC=                 # e.g., us21

CLOSE_API_KEY=
CLOSE_STATUS_NEW=             # status_id for "Potential"
CLOSE_STATUS_QUALIFIED=       # status_id for "Qualified"
CLOSE_STATUS_BAD_FIT=         # status_id for "Bad Fit"
```

A `.env.example` file documents these. A `.gitignore` is added (none exists today) to keep `.env.local` and `node_modules/` out of the repo.

## Local Development

- `npm install`
- Vercel CLI (one-time install): `npm i -g vercel`
- `vercel dev` serves static files at `localhost:3000` and runs `/api/*` as functions
- Env vars in `.env.local` (gitignored)

## Out of Scope (deferred)

- Retry worker for `lead_sync_errors`. For v1, retries are manual via a one-off script. Build automation only if the error volume justifies it.
- Email/SMS notifications to the salesperson on new lead.
- Webhook from Close back to Supabase for status changes (one-way sync only for v1).
- Replatforming to a framework. Stays static HTML.

## Files Touched

- `package.json` (new)
- `.gitignore` (new)
- `.env.example` (new)
- `api/lead.js` (new)
- `api/lead-update.js` (new)
- `lib/supabase.js` (new — server-only client singleton, imported by `/api/*`)
- `lib/mailchimp.js` (new — server-only upsert + tag helpers, imported by `/api/*`)
- `lib/close.js` (new — server-only create + update helpers, imported by `/api/*`)
- `js/attribution.js` (new — frontend helper for parsing URL params, loaded via `<script src="/js/attribution.js">` in both HTML files)
- `supabase/migrations/<timestamp>_init_leads.sql` (new)
- `index.html` (modify — wire `submitBaForm` to fetch)
- `girthfill-form.html` (modify — wire all three step transitions to fetch, add consent line)
- `docs/superpowers/specs/2026-04-29-lead-capture-design.md` (this file)
