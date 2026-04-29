# Lead Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire both lead-capture forms (the multi-step consultation form and the email-gated before/after carousel) to a real backend that persists to Supabase, syncs to Mailchimp, and (for consultation leads only) syncs to Close CRM.

**Architecture:** Static HTML stays static. Two new Vercel Serverless Functions (`/api/lead`, `/api/lead-update`) own all third-party communication. Supabase is the source of truth (fail loudly on insert errors); Mailchimp + Close are best-effort fan-outs (failures logged to a `lead_sync_errors` table for later replay). Two-phase capture: Step 1 creates the lead in all systems, Step 2 updates it with the qualification answer.

**Tech Stack:** Node 24.x (Vercel runtime, native `fetch`), `@supabase/supabase-js`, `zod` for request validation, Vitest for unit tests, Supabase CLI for migrations. Vanilla JS on the frontend (no framework).

**Spec:** See [`2026-04-29-lead-capture-design.md`](../specs/2026-04-29-lead-capture-design.md).

---

## File Structure

```
~/Claude/lushfulcontent/
├── package.json                  (NEW) — deps + scripts
├── .gitignore                    (NEW) — node_modules, .env*, .vercel
├── .env.example                  (NEW) — documents all env vars
├── vitest.config.js              (NEW) — test config
├── api/
│   ├── lead.js                   (NEW) — POST handler for Step 1
│   └── lead-update.js            (NEW) — POST handler for Step 2/3
├── lib/
│   ├── supabase.js               (NEW) — server client singleton
│   ├── mailchimp.js              (NEW) — upsertSubscriber + addTags
│   └── close.js                  (NEW) — createLead + updateLead
├── lib/__tests__/
│   ├── mailchimp.test.js         (NEW) — unit tests w/ fetch mock
│   └── close.test.js             (NEW) — unit tests w/ fetch mock
├── api/__tests__/
│   ├── lead.test.js              (NEW) — handler tests w/ lib mocks
│   └── lead-update.test.js       (NEW) — handler tests w/ lib mocks
├── js/
│   └── attribution.js            (NEW) — frontend URL-param parser
├── supabase/
│   ├── config.toml               (NEW — created by `supabase init`)
│   └── migrations/
│       └── <ts>_init_leads.sql   (NEW)
├── index.html                    (MODIFY) — wire carousel form to /api/lead
└── girthfill-form.html           (MODIFY) — wire all three step transitions
```

**File responsibilities:**
- `lib/*` — pure, testable helpers. No HTTP, no Vercel-specific code. Each one has one external service.
- `api/*` — thin handler shell. Validates input (zod), orchestrates lib calls, writes errors to `lead_sync_errors`, returns JSON.
- `js/attribution.js` — single function `getAttribution()` that returns an object of UTM/click/referrer values. Browser-side only.
- `supabase/migrations/*` — DDL only. Idempotent SQL.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `vitest.config.js`

- [ ] **Step 1: Initialize package.json**

Create `package.json`:

```json
{
  "name": "lushfulcontent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "vercel dev"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create .gitignore**

Create `.gitignore`:

```
node_modules/
.env
.env.local
.env.*.local
.vercel/
coverage/
.DS_Store
```

- [ ] **Step 3: Create .env.example**

Create `.env.example`:

```
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Mailchimp
MAILCHIMP_API_KEY=
MAILCHIMP_AUDIENCE_ID=
MAILCHIMP_DC=

# Close CRM
CLOSE_API_KEY=
CLOSE_STATUS_NEW=
CLOSE_STATUS_QUALIFIED=
CLOSE_STATUS_BAD_FIT=

# Close custom field IDs (created in Close UI; format: cf_xxxxxxxxx)
CLOSE_CF_SOURCE=
CLOSE_CF_UTM_SOURCE=
CLOSE_CF_UTM_MEDIUM=
CLOSE_CF_UTM_CAMPAIGN=
CLOSE_CF_UTM_CONTENT=
CLOSE_CF_FBCLID=
CLOSE_CF_GCLID=
CLOSE_CF_QUALIFIED=
CLOSE_CF_CTA_CLICKED=
```

- [ ] **Step 4: Create vitest.config.js**

Create `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['**/__tests__/**/*.test.js']
  }
})
```

- [ ] **Step 5: Install dependencies**

Run: `cd ~/Claude/lushfulcontent && npm install`
Expected: dependencies install, `package-lock.json` and `node_modules/` created.

- [ ] **Step 6: Verify vitest runs (no tests yet)**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: `No test files found, exiting with code 0` (or similar; exits 0).

- [ ] **Step 7: Commit**

```bash
cd ~/Claude/lushfulcontent
git add package.json package-lock.json .gitignore .env.example vitest.config.js
git commit -m "chore: scaffold node deps, vitest, env template"
```

---

## Task 2: Supabase Project + Migration

**Files:**
- Create: `supabase/config.toml` (auto-generated by `supabase init`)
- Create: `supabase/migrations/<timestamp>_init_leads.sql`

- [ ] **Step 1: Create the Supabase project (manual, in UI)**

In the Supabase dashboard (https://supabase.com/dashboard):
1. Click **New project**
2. Name: `lushfulcontent`
3. Region: pick closest to NYC (e.g., `us-east-1`)
4. Generate a strong DB password and save it to a password manager
5. Wait for the project to provision (~2 min)
6. Settings → API: copy `Project URL` and `service_role` key into `.env.local` as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
7. Settings → General: copy the **Project Ref** (a 20-char string) — needed in Step 3

- [ ] **Step 2: Initialize supabase locally**

Run: `cd ~/Claude/lushfulcontent && npx supabase init`
Expected: creates `supabase/config.toml` and `supabase/.gitignore`. Answer "no" to any extra prompts (we don't need Deno or Edge Functions).

- [ ] **Step 3: Link local repo to remote project**

Run: `cd ~/Claude/lushfulcontent && npx supabase link --project-ref <PROJECT_REF>`
You'll be prompted for the DB password from Step 1.

Expected: `Finished supabase link.`

- [ ] **Step 4: Create migration file**

Run: `cd ~/Claude/lushfulcontent && npx supabase migration new init_leads`
Expected: creates `supabase/migrations/<timestamp>_init_leads.sql` (empty).

- [ ] **Step 5: Write the migration SQL**

Replace the contents of the new migration file with:

```sql
-- Lead capture tables for the GirthFill landing.
-- Writes go through Vercel functions using the service-role key.
-- RLS is intentionally OFF — the browser never queries these tables.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  name text not null,
  email text not null,
  phone text,

  qualified boolean,
  qualified_at timestamptz,
  cta_clicked text,

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

  source text not null,

  mailchimp_synced_at timestamptz,
  mailchimp_subscriber_hash text,
  close_synced_at timestamptz,
  close_lead_id text,

  unique (email, source)
);

create index leads_created_at_idx on public.leads (created_at desc);
create index leads_email_idx on public.leads (email);

create table public.lead_sync_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid references public.leads(id) on delete cascade,
  service text not null,
  operation text not null,
  error_message text not null,
  payload jsonb,
  resolved_at timestamptz
);

-- updated_at auto-bump
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();
```

- [ ] **Step 6: Push the migration to the remote project**

Run: `cd ~/Claude/lushfulcontent && npx supabase db push`
Expected: `Applying migration <timestamp>_init_leads.sql ... Finished supabase db push.`

- [ ] **Step 7: Verify in dashboard**

In Supabase dashboard → Table Editor: confirm `leads` and `lead_sync_errors` exist with all columns.

- [ ] **Step 8: Commit**

```bash
cd ~/Claude/lushfulcontent
git add supabase/
git commit -m "feat(supabase): init leads + lead_sync_errors tables"
```

---

## Task 3: Mailchimp Setup (Manual UI)

No files; this is account configuration. The output is values written into `.env.local`.

- [ ] **Step 1: Identify or create the Lushful audience**

In Mailchimp → Audience → All contacts: confirm there is a "Lushful Aesthetics" audience (or whichever exists). If not, create one.

Audience → Settings → Audience name and defaults → copy the **Audience ID** (looks like `a1b2c3d4e5`). Add to `.env.local` as `MAILCHIMP_AUDIENCE_ID`.

- [ ] **Step 2: Note the datacenter**

Look at the URL when logged into Mailchimp: `https://us21.admin.mailchimp.com/...` — the `us21` (or whatever follows `https://`) is your datacenter. Add to `.env.local` as `MAILCHIMP_DC`.

- [ ] **Step 3: Create the merge fields**

Audience → Settings → Audience fields and *|MERGE|* tags → Add A Field. Create these six (Type = Text for all):

| Label | Tag (sets the API key) |
|---|---|
| First Name | FNAME (already exists by default) |
| Phone | PHONE (already exists by default — set type to Phone) |
| Source | SOURCE |
| UTM Source | UTM_SRC |
| UTM Campaign | UTM_CAMP |
| UTM Content | UTM_CONT |

Save. None should be marked Required (Step 1 might not have all values).

- [ ] **Step 4: Generate an API key**

Account & billing → Extras → API keys → Create A Key. Label it `lushfulcontent-vercel`. Copy the value (starts with a hex string and ends with `-us21` or your DC). Add to `.env.local` as `MAILCHIMP_API_KEY`.

- [ ] **Step 5: Verify access from terminal**

Run (replace `<KEY>` and `<DC>`):
```bash
curl -u "any:<KEY>" "https://<DC>.api.mailchimp.com/3.0/" | head -20
```
Expected: JSON response with `account_name`, etc. (not a 401).

---

## Task 4: Close CRM Setup (Manual UI)

No files; this is account configuration. Output is values for `.env.local`.

- [ ] **Step 1: Generate an API key**

Close → Settings → Developer → API Keys → New API Key. Name: `lushfulcontent-vercel`. Copy the key (starts with `api_`). Add to `.env.local` as `CLOSE_API_KEY`.

- [ ] **Step 2: Confirm / record Lead Statuses**

Close → Settings → Statuses & Pipelines → Lead Statuses. Confirm these exist (or rename existing ones to match):
- **Potential** — for new untouched leads
- **Qualified** — for leads who said yes to the $8,500 question
- **Bad Fit** — for leads who said no

For each, click into it to see the URL — the status ID is in the URL (`stat_xxxxxxxxxxxxxxxx`). Add to `.env.local`:
- `CLOSE_STATUS_NEW=stat_<id-of-Potential>`
- `CLOSE_STATUS_QUALIFIED=stat_<id-of-Qualified>`
- `CLOSE_STATUS_BAD_FIT=stat_<id-of-Bad Fit>`

- [ ] **Step 3: Create custom fields on Lead**

Close → Settings → Custom Fields → Lead → New Custom Field. Create these (all Type = Text unless noted):

| Field name | Type | Notes |
|---|---|---|
| Source | Text | |
| UTM Source | Text | |
| UTM Medium | Text | |
| UTM Campaign | Text | |
| UTM Content | Text | |
| FBCLID | Text | |
| GCLID | Text | |
| Qualified for $8,500 | Choice (Yes/No) | Choices: `Yes`, `No` |
| CTA Clicked | Choice | Choices: `Book Appointment`, `Schedule a Call`, `Tap to Call` |

After saving each, the field detail URL contains its ID (`cf_xxxxxxxxxxxxxxxx`). Record each into `.env.local`:
- `CLOSE_CF_SOURCE=cf_...`
- `CLOSE_CF_UTM_SOURCE=cf_...`
- `CLOSE_CF_UTM_MEDIUM=cf_...`
- `CLOSE_CF_UTM_CAMPAIGN=cf_...`
- `CLOSE_CF_UTM_CONTENT=cf_...`
- `CLOSE_CF_FBCLID=cf_...`
- `CLOSE_CF_GCLID=cf_...`
- `CLOSE_CF_QUALIFIED=cf_...`
- `CLOSE_CF_CTA_CLICKED=cf_...`

- [ ] **Step 4: Verify access from terminal**

Run (replace `<KEY>`):
```bash
curl -u "<KEY>:" "https://api.close.com/api/v1/me/" | head -20
```
Expected: JSON with your Close user info (not a 401).

---

## Task 5: lib/supabase.js (server client singleton)

**Files:**
- Create: `lib/supabase.js`

- [ ] **Step 1: Write the singleton**

Create `lib/supabase.js`:

```js
import { createClient } from '@supabase/supabase-js'

let _client = null

export function getSupabase() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase env vars missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  return _client
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/Claude/lushfulcontent
git add lib/supabase.js
git commit -m "feat(lib): add server-side supabase client singleton"
```

(No tests for this — it's a singleton wrapper around the supabase-js client. Behavior is exercised by the API handler tests.)

---

## Task 6: lib/mailchimp.js + tests

**Files:**
- Create: `lib/mailchimp.js`
- Test: `lib/__tests__/mailchimp.test.js`

- [ ] **Step 1: Write the failing test for upsertSubscriber URL/method**

Create `lib/__tests__/mailchimp.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { upsertSubscriber, addTags } from '../mailchimp.js'

beforeEach(() => {
  process.env.MAILCHIMP_API_KEY = 'test-key'
  process.env.MAILCHIMP_AUDIENCE_ID = 'aud123'
  process.env.MAILCHIMP_DC = 'us21'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('upsertSubscriber', () => {
  it('PUTs to MD5(lowercase(email)) endpoint with merge fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    const result = await upsertSubscriber({
      email: 'TEST@Example.COM',
      mergeFields: { FNAME: 'Test', PHONE: '555' }
    })
    // MD5 of 'test@example.com' = '55502f40dc8b7c769880b10874abc9d0'
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://us21.api.mailchimp.com/3.0/lists/aud123/members/55502f40dc8b7c769880b10874abc9d0',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          email_address: 'TEST@Example.COM',
          status_if_new: 'subscribed',
          merge_fields: { FNAME: 'Test', PHONE: '555' }
        })
      })
    )
    expect(result).toEqual({
      subscriberHash: '55502f40dc8b7c769880b10874abc9d0'
    })
  })

  it('throws when Mailchimp returns non-OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"detail":"bad"}'
    })
    await expect(
      upsertSubscriber({ email: 'a@b.com', mergeFields: {} })
    ).rejects.toThrow('Mailchimp upsert failed: 400')
  })

  it('throws when env vars are missing', async () => {
    delete process.env.MAILCHIMP_API_KEY
    await expect(
      upsertSubscriber({ email: 'a@b.com', mergeFields: {} })
    ).rejects.toThrow('MAILCHIMP_API_KEY not set')
  })
})

describe('addTags', () => {
  it('POSTs tags as active to the tags endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => ''
    })
    await addTags({
      email: 'test@example.com',
      tags: ['girthfill-landing', 'girthfill-qualified']
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://us21.api.mailchimp.com/3.0/lists/aud123/members/55502f40dc8b7c769880b10874abc9d0/tags',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tags: [
            { name: 'girthfill-landing', status: 'active' },
            { name: 'girthfill-qualified', status: 'active' }
          ]
        })
      })
    )
  })

  it('throws when Mailchimp returns non-OK on tags', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'oops'
    })
    await expect(
      addTags({ email: 'a@b.com', tags: ['x'] })
    ).rejects.toThrow('Mailchimp tag failed: 500')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: FAIL — module `../mailchimp.js` does not exist.

- [ ] **Step 3: Write lib/mailchimp.js**

Create `lib/mailchimp.js`:

```js
import crypto from 'node:crypto'

function md5Lower(s) {
  return crypto.createHash('md5').update(s.toLowerCase()).digest('hex')
}

function authHeader() {
  const key = process.env.MAILCHIMP_API_KEY
  if (!key) throw new Error('MAILCHIMP_API_KEY not set')
  return 'Basic ' + Buffer.from('any:' + key).toString('base64')
}

function baseUrl() {
  const dc = process.env.MAILCHIMP_DC
  if (!dc) throw new Error('MAILCHIMP_DC not set')
  return `https://${dc}.api.mailchimp.com/3.0`
}

function audienceId() {
  const id = process.env.MAILCHIMP_AUDIENCE_ID
  if (!id) throw new Error('MAILCHIMP_AUDIENCE_ID not set')
  return id
}

export async function upsertSubscriber({ email, mergeFields, status = 'subscribed' }) {
  const hash = md5Lower(email)
  const res = await fetch(
    `${baseUrl()}/lists/${audienceId()}/members/${hash}`,
    {
      method: 'PUT',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email_address: email,
        status_if_new: status,
        merge_fields: mergeFields
      })
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Mailchimp upsert failed: ${res.status} ${text}`)
  }
  return { subscriberHash: hash }
}

export async function addTags({ email, tags }) {
  const hash = md5Lower(email)
  const res = await fetch(
    `${baseUrl()}/lists/${audienceId()}/members/${hash}/tags`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tags: tags.map(name => ({ name, status: 'active' }))
      })
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Mailchimp tag failed: ${res.status} ${text}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Claude/lushfulcontent
git add lib/mailchimp.js lib/__tests__/mailchimp.test.js
git commit -m "feat(lib): add mailchimp upsert + tag helpers with tests"
```

---

## Task 7: lib/close.js + tests

**Files:**
- Create: `lib/close.js`
- Test: `lib/__tests__/close.test.js`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/close.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLead, updateLead } from '../close.js'

beforeEach(() => {
  process.env.CLOSE_API_KEY = 'api_test'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createLead', () => {
  it('POSTs to /lead/ with name, contact, status, and custom fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'lead_abc123' })
    })
    const result = await createLead({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-0100',
      statusId: 'stat_new',
      customFields: { cf_src: 'girthfill-landing' }
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.close.com/api/v1/lead/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Jane Doe',
          status_id: 'stat_new',
          contacts: [{
            name: 'Jane Doe',
            emails: [{ email: 'jane@example.com', type: 'office' }],
            phones: [{ phone: '555-0100', type: 'office' }]
          }],
          custom: { cf_src: 'girthfill-landing' }
        })
      })
    )
    expect(result).toEqual({ closeLeadId: 'lead_abc123' })
  })

  it('omits phone array when phone is null', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'lead_x' })
    })
    await createLead({
      name: 'X',
      email: 'x@y.com',
      phone: null,
      statusId: 'stat_new',
      customFields: {}
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.contacts[0].phones).toEqual([])
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'invalid'
    })
    await expect(
      createLead({
        name: 'X',
        email: 'x@y.com',
        phone: null,
        statusId: 'stat_new',
        customFields: {}
      })
    ).rejects.toThrow('Close create failed: 422')
  })
})

describe('updateLead', () => {
  it('PUTs to /lead/{id}/ with only provided fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => ''
    })
    await updateLead({
      leadId: 'lead_abc',
      statusId: 'stat_qualified',
      customFields: { cf_q: 'Yes' }
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.close.com/api/v1/lead/lead_abc/',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          status_id: 'stat_qualified',
          custom: { cf_q: 'Yes' }
        })
      })
    )
  })

  it('omits status_id when not provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => ''
    })
    await updateLead({
      leadId: 'lead_abc',
      customFields: { cf_cta: 'Book Appointment' }
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body).toEqual({ custom: { cf_cta: 'Book Appointment' } })
    expect(body.status_id).toBeUndefined()
  })

  it('throws on non-OK update', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found'
    })
    await expect(
      updateLead({ leadId: 'lead_x', statusId: 's' })
    ).rejects.toThrow('Close update failed: 404')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: FAIL — `../close.js` does not exist.

- [ ] **Step 3: Write lib/close.js**

Create `lib/close.js`:

```js
const BASE = 'https://api.close.com/api/v1'

function authHeader() {
  const key = process.env.CLOSE_API_KEY
  if (!key) throw new Error('CLOSE_API_KEY not set')
  return 'Basic ' + Buffer.from(key + ':').toString('base64')
}

export async function createLead({ name, email, phone, statusId, customFields }) {
  const body = {
    name,
    status_id: statusId,
    contacts: [{
      name,
      emails: email ? [{ email, type: 'office' }] : [],
      phones: phone ? [{ phone, type: 'office' }] : []
    }],
    custom: customFields
  }
  const res = await fetch(`${BASE}/lead/`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close create failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  return { closeLeadId: data.id }
}

export async function updateLead({ leadId, statusId, customFields }) {
  const body = {}
  if (statusId) body.status_id = statusId
  if (customFields) body.custom = customFields
  const res = await fetch(`${BASE}/lead/${leadId}/`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close update failed: ${res.status} ${text}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: all tests in `mailchimp.test.js` and `close.test.js` pass (10 total so far).

- [ ] **Step 5: Commit**

```bash
cd ~/Claude/lushfulcontent
git add lib/close.js lib/__tests__/close.test.js
git commit -m "feat(lib): add close lead create + update helpers with tests"
```

---

## Task 8: api/lead.js handler + tests

**Files:**
- Create: `api/lead.js`
- Test: `api/__tests__/lead.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/__tests__/lead.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the lib modules before importing the handler
vi.mock('../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))
vi.mock('../../lib/mailchimp.js', () => ({
  upsertSubscriber: vi.fn(),
  addTags: vi.fn()
}))
vi.mock('../../lib/close.js', () => ({
  createLead: vi.fn()
}))

const { getSupabase } = await import('../../lib/supabase.js')
const { upsertSubscriber, addTags } = await import('../../lib/mailchimp.js')
const { createLead } = await import('../../lib/close.js')
const handler = (await import('../lead.js')).default

function makeReqRes(body) {
  const req = { method: 'POST', body }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

function mockSupabase({ upsertResult, leadRow, updateResult }) {
  const chain = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(upsertResult),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue(updateResult ?? { error: null }),
    insert: vi.fn().mockResolvedValue({ error: null })
  }
  getSupabase.mockReturnValue({
    from: vi.fn(() => chain)
  })
  return chain
}

beforeEach(() => {
  process.env.CLOSE_STATUS_NEW = 'stat_new'
  process.env.CLOSE_CF_SOURCE = 'cf_src'
  process.env.CLOSE_CF_UTM_SOURCE = 'cf_utms'
  process.env.CLOSE_CF_UTM_MEDIUM = 'cf_utmm'
  process.env.CLOSE_CF_UTM_CAMPAIGN = 'cf_utmc'
  process.env.CLOSE_CF_UTM_CONTENT = 'cf_utmcon'
  process.env.CLOSE_CF_FBCLID = 'cf_fb'
  process.env.CLOSE_CF_GCLID = 'cf_gc'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/lead', () => {
  it('returns 405 on non-POST', async () => {
    const { req, res } = makeReqRes({})
    req.method = 'GET'
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 on invalid body', async () => {
    const { req, res } = makeReqRes({ name: '' })  // missing email
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res._json.error).toMatch(/validation/i)
  })

  it('upserts to Supabase, calls Mailchimp + Close, returns lead_id (consultation source)', async () => {
    mockSupabase({
      upsertResult: { data: { id: 'lead-uuid' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'hash123' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_lead_xyz' })

    const { req, res } = makeReqRes({
      name: 'Jane',
      email: 'jane@example.com',
      phone: '555-0100',
      source: 'girthfill-landing',
      utm_source: 'meta',
      utm_campaign: 'q2_girthfill'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({ lead_id: 'lead-uuid' })
    expect(upsertSubscriber).toHaveBeenCalled()
    expect(addTags).toHaveBeenCalledWith({
      email: 'jane@example.com',
      tags: ['girthfill-landing']
    })
    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane',
      email: 'jane@example.com',
      statusId: 'stat_new'
    }))
  })

  it('skips Close for carousel source', async () => {
    mockSupabase({
      upsertResult: { data: { id: 'lead-uuid-2' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()

    const { req, res } = makeReqRes({
      name: 'Bob',
      email: 'bob@example.com',
      phone: null,
      source: 'girthfill-carousel'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(createLead).not.toHaveBeenCalled()
    expect(addTags).toHaveBeenCalledWith({
      email: 'bob@example.com',
      tags: ['girthfill-carousel']
    })
  })

  it('returns 500 when Supabase upsert fails', async () => {
    mockSupabase({
      upsertResult: { data: null, error: { message: 'db down' } }
    })
    const { req, res } = makeReqRes({
      name: 'X',
      email: 'x@y.com',
      phone: null,
      source: 'girthfill-landing'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(createLead).not.toHaveBeenCalled()
  })

  it('still returns success when Mailchimp fails (best-effort)', async () => {
    const chain = mockSupabase({
      upsertResult: { data: { id: 'lead-id' }, error: null }
    })
    upsertSubscriber.mockRejectedValue(new Error('mailchimp down'))
    createLead.mockResolvedValue({ closeLeadId: 'cl_x' })

    const { req, res } = makeReqRes({
      name: 'X',
      email: 'x@y.com',
      phone: null,
      source: 'girthfill-landing'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    // verify lead_sync_errors got a row
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      service: 'mailchimp',
      operation: 'create'
    }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: FAIL — `../lead.js` does not exist.

- [ ] **Step 3: Write api/lead.js**

Create `api/lead.js`:

```js
import { z } from 'zod'
import { getSupabase } from '../lib/supabase.js'
import { upsertSubscriber, addTags } from '../lib/mailchimp.js'
import { createLead } from '../lib/close.js'

const BodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
  source: z.enum(['girthfill-landing', 'girthfill-carousel']),
  utm_source: z.string().optional().nullable(),
  utm_medium: z.string().optional().nullable(),
  utm_campaign: z.string().optional().nullable(),
  utm_content: z.string().optional().nullable(),
  utm_term: z.string().optional().nullable(),
  fbclid: z.string().optional().nullable(),
  gclid: z.string().optional().nullable(),
  referrer: z.string().optional().nullable(),
  landing_page: z.string().optional().nullable(),
  user_agent: z.string().optional().nullable()
})

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation failed',
      details: parsed.error.flatten()
    })
  }
  const body = parsed.data
  const sb = getSupabase()

  // 1. Supabase upsert (fatal if it fails)
  const { data: leadRow, error: upsertErr } = await sb
    .from('leads')
    .upsert({
      name: body.name,
      email: body.email,
      phone: body.phone ?? null,
      source: body.source,
      utm_source: body.utm_source ?? null,
      utm_medium: body.utm_medium ?? null,
      utm_campaign: body.utm_campaign ?? null,
      utm_content: body.utm_content ?? null,
      utm_term: body.utm_term ?? null,
      fbclid: body.fbclid ?? null,
      gclid: body.gclid ?? null,
      referrer: body.referrer ?? null,
      landing_page: body.landing_page ?? null,
      user_agent: body.user_agent ?? null
    }, {
      onConflict: 'email,source'
    })
    .select('id')
    .single()

  if (upsertErr) {
    console.error('supabase upsert failed', upsertErr)
    return res.status(500).json({ error: 'failed to save lead' })
  }
  const leadId = leadRow.id

  // 2. Best-effort fanout
  const tag = body.source === 'girthfill-carousel'
    ? 'girthfill-carousel'
    : 'girthfill-landing'

  const tasks = [
    (async () => {
      const { subscriberHash } = await upsertSubscriber({
        email: body.email,
        mergeFields: {
          FNAME: body.name,
          PHONE: body.phone ?? '',
          SOURCE: body.source,
          UTM_SRC: body.utm_source ?? '',
          UTM_CAMP: body.utm_campaign ?? '',
          UTM_CONT: body.utm_content ?? ''
        }
      })
      await addTags({ email: body.email, tags: [tag] })
      await sb.from('leads').update({
        mailchimp_subscriber_hash: subscriberHash,
        mailchimp_synced_at: new Date().toISOString()
      }).eq('id', leadId)
      return { service: 'mailchimp', ok: true }
    })()
  ]

  if (body.source === 'girthfill-landing') {
    tasks.push((async () => {
      const customFields = {
        [process.env.CLOSE_CF_SOURCE]: body.source,
        [process.env.CLOSE_CF_UTM_SOURCE]: body.utm_source ?? '',
        [process.env.CLOSE_CF_UTM_MEDIUM]: body.utm_medium ?? '',
        [process.env.CLOSE_CF_UTM_CAMPAIGN]: body.utm_campaign ?? '',
        [process.env.CLOSE_CF_UTM_CONTENT]: body.utm_content ?? '',
        [process.env.CLOSE_CF_FBCLID]: body.fbclid ?? '',
        [process.env.CLOSE_CF_GCLID]: body.gclid ?? ''
      }
      const { closeLeadId } = await createLead({
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        statusId: process.env.CLOSE_STATUS_NEW,
        customFields
      })
      await sb.from('leads').update({
        close_lead_id: closeLeadId,
        close_synced_at: new Date().toISOString()
      }).eq('id', leadId)
      return { service: 'close', ok: true }
    })())
  }

  const results = await Promise.allSettled(tasks)
  for (const r of results) {
    if (r.status === 'rejected') {
      const err = r.reason
      console.error('sync failed', err)
      const service = err?.message?.startsWith('Mailchimp') ? 'mailchimp' : 'close'
      await sb.from('lead_sync_errors').insert({
        lead_id: leadId,
        service,
        operation: 'create',
        error_message: String(err?.message || err),
        payload: body
      })
    }
  }

  return res.status(200).json({ lead_id: leadId })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: all 6 tests in `lead.test.js` pass; total 16 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Claude/lushfulcontent
git add api/lead.js api/__tests__/lead.test.js
git commit -m "feat(api): add /api/lead handler with two-source routing"
```

---

## Task 9: api/lead-update.js handler + tests

**Files:**
- Create: `api/lead-update.js`
- Test: `api/__tests__/lead-update.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/__tests__/lead-update.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))
vi.mock('../../lib/mailchimp.js', () => ({
  addTags: vi.fn()
}))
vi.mock('../../lib/close.js', () => ({
  updateLead: vi.fn()
}))

const { getSupabase } = await import('../../lib/supabase.js')
const { addTags } = await import('../../lib/mailchimp.js')
const { updateLead } = await import('../../lib/close.js')
const handler = (await import('../lead-update.js')).default

function makeReqRes(body) {
  const req = { method: 'POST', body }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

function mockSupabase({ leadRow, leadError }) {
  const fromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: leadRow ?? null, error: leadError ?? null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null })
  }
  // The .update().eq() chain needs eq to resolve (not chain to single)
  fromChain.update = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null })
  }))
  getSupabase.mockReturnValue({
    from: vi.fn(() => fromChain)
  })
  return fromChain
}

beforeEach(() => {
  process.env.CLOSE_STATUS_QUALIFIED = 'stat_q'
  process.env.CLOSE_STATUS_BAD_FIT = 'stat_bf'
  process.env.CLOSE_CF_QUALIFIED = 'cf_q'
  process.env.CLOSE_CF_CTA_CLICKED = 'cf_cta'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/lead-update', () => {
  it('returns 405 on non-POST', async () => {
    const { req, res } = makeReqRes({})
    req.method = 'GET'
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 when neither qualified nor cta_clicked is provided', async () => {
    const { req, res } = makeReqRes({ lead_id: '00000000-0000-0000-0000-000000000000' })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when lead row is missing', async () => {
    mockSupabase({ leadRow: null, leadError: { code: 'PGRST116' } })
    const { req, res } = makeReqRes({
      lead_id: '00000000-0000-0000-0000-000000000000',
      qualified: true
    })
    await handler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('updates Supabase, tags Mailchimp qualified, updates Close (qualified=true, consultation lead)', async () => {
    mockSupabase({
      leadRow: {
        id: 'lead-uuid',
        email: 'jane@example.com',
        source: 'girthfill-landing',
        close_lead_id: 'close_x'
      }
    })
    addTags.mockResolvedValue()
    updateLead.mockResolvedValue()

    const { req, res } = makeReqRes({ lead_id: 'lead-uuid', qualified: true })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(addTags).toHaveBeenCalledWith({
      email: 'jane@example.com',
      tags: ['girthfill-qualified']
    })
    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'close_x',
      statusId: 'stat_q',
      customFields: { cf_q: 'Yes' }
    })
  })

  it('uses not-qualified tag and Bad Fit status when qualified=false', async () => {
    mockSupabase({
      leadRow: {
        id: 'lead-uuid',
        email: 'jane@example.com',
        source: 'girthfill-landing',
        close_lead_id: 'close_x'
      }
    })
    const { req, res } = makeReqRes({ lead_id: 'lead-uuid', qualified: false })
    await handler(req, res)
    expect(addTags).toHaveBeenCalledWith({
      email: 'jane@example.com',
      tags: ['girthfill-not-qualified']
    })
    expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
      statusId: 'stat_bf',
      customFields: { cf_q: 'No' }
    }))
  })

  it('skips Close when source is carousel', async () => {
    mockSupabase({
      leadRow: {
        id: 'lead-uuid',
        email: 'jane@example.com',
        source: 'girthfill-carousel',
        close_lead_id: null
      }
    })
    const { req, res } = makeReqRes({ lead_id: 'lead-uuid', qualified: true })
    await handler(req, res)
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('only updates Close (no Mailchimp tag) when only cta_clicked is sent', async () => {
    mockSupabase({
      leadRow: {
        id: 'lead-uuid',
        email: 'jane@example.com',
        source: 'girthfill-landing',
        close_lead_id: 'close_x'
      }
    })
    const { req, res } = makeReqRes({ lead_id: 'lead-uuid', cta_clicked: 'book' })
    await handler(req, res)
    expect(addTags).not.toHaveBeenCalled()
    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'close_x',
      statusId: undefined,
      customFields: { cf_cta: 'Book Appointment' }
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: FAIL — `../lead-update.js` does not exist.

- [ ] **Step 3: Write api/lead-update.js**

Create `api/lead-update.js`:

```js
import { z } from 'zod'
import { getSupabase } from '../lib/supabase.js'
import { addTags } from '../lib/mailchimp.js'
import { updateLead } from '../lib/close.js'

const BodySchema = z.object({
  lead_id: z.string().uuid(),
  qualified: z.boolean().optional(),
  cta_clicked: z.enum(['book', 'call', 'tap-to-call']).optional()
}).refine(
  d => d.qualified !== undefined || d.cta_clicked !== undefined,
  { message: 'one of qualified or cta_clicked is required' }
)

const CTA_LABELS = {
  'book': 'Book Appointment',
  'call': 'Schedule a Call',
  'tap-to-call': 'Tap to Call'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation failed',
      details: parsed.error.flatten()
    })
  }
  const body = parsed.data
  const sb = getSupabase()

  // Fetch the lead so we know email + source + close_lead_id
  const { data: lead, error: fetchErr } = await sb
    .from('leads')
    .select('id, email, source, close_lead_id')
    .eq('id', body.lead_id)
    .single()

  if (fetchErr || !lead) {
    return res.status(404).json({ error: 'lead not found' })
  }

  // 1. Update Supabase
  const updates = { updated_at: new Date().toISOString() }
  if (body.qualified !== undefined) {
    updates.qualified = body.qualified
    updates.qualified_at = new Date().toISOString()
  }
  if (body.cta_clicked !== undefined) {
    updates.cta_clicked = body.cta_clicked
  }
  const { error: updateErr } = await sb
    .from('leads')
    .update(updates)
    .eq('id', body.lead_id)
  if (updateErr) {
    console.error('supabase update failed', updateErr)
    // log but continue — don't block the user funnel on a DB blip here
    await sb.from('lead_sync_errors').insert({
      lead_id: body.lead_id,
      service: 'supabase',
      operation: 'update',
      error_message: updateErr.message,
      payload: body
    })
  }

  // 2. Best-effort fanout
  const tasks = []

  if (body.qualified !== undefined) {
    tasks.push((async () => {
      const tag = body.qualified ? 'girthfill-qualified' : 'girthfill-not-qualified'
      await addTags({ email: lead.email, tags: [tag] })
      return { service: 'mailchimp' }
    })())
  }

  if (lead.source === 'girthfill-landing' && lead.close_lead_id) {
    tasks.push((async () => {
      const customFields = {}
      let statusId
      if (body.qualified !== undefined) {
        customFields[process.env.CLOSE_CF_QUALIFIED] = body.qualified ? 'Yes' : 'No'
        statusId = body.qualified
          ? process.env.CLOSE_STATUS_QUALIFIED
          : process.env.CLOSE_STATUS_BAD_FIT
      }
      if (body.cta_clicked !== undefined) {
        customFields[process.env.CLOSE_CF_CTA_CLICKED] = CTA_LABELS[body.cta_clicked]
      }
      await updateLead({
        leadId: lead.close_lead_id,
        statusId,
        customFields
      })
      return { service: 'close' }
    })())
  }

  const results = await Promise.allSettled(tasks)
  for (const r of results) {
    if (r.status === 'rejected') {
      const err = r.reason
      console.error('sync failed', err)
      const service = err?.message?.startsWith('Mailchimp') ? 'mailchimp' : 'close'
      await sb.from('lead_sync_errors').insert({
        lead_id: body.lead_id,
        service,
        operation: 'update',
        error_message: String(err?.message || err),
        payload: body
      })
    }
  }

  return res.status(200).json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Claude/lushfulcontent && npm test`
Expected: all tests across all suites pass (~23 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Claude/lushfulcontent
git add api/lead-update.js api/__tests__/lead-update.test.js
git commit -m "feat(api): add /api/lead-update for qualification + CTA"
```

---

## Task 10: js/attribution.js (frontend helper)

**Files:**
- Create: `js/attribution.js`

This is browser code; we test it manually in Task 13. It's small and pure.

- [ ] **Step 1: Write the helper**

Create `js/attribution.js`:

```js
// Returns the current page's attribution context as a flat object.
// Safe to call multiple times; reads from window.location each call.
window.lushfulAttribution = function getAttribution() {
  var params = new URLSearchParams(window.location.search);
  var pick = function (key) {
    var v = params.get(key);
    return v && v.length ? v : null;
  };
  return {
    utm_source:   pick('utm_source'),
    utm_medium:   pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
    utm_content:  pick('utm_content'),
    utm_term:     pick('utm_term'),
    fbclid:       pick('fbclid'),
    gclid:        pick('gclid'),
    referrer:     document.referrer || null,
    landing_page: window.location.href,
    user_agent:   navigator.userAgent || null
  };
};
```

- [ ] **Step 2: Commit**

```bash
cd ~/Claude/lushfulcontent
git add js/attribution.js
git commit -m "feat(js): add frontend attribution helper"
```

---

## Task 11: Wire girthfill-form.html

**Files:**
- Modify: `girthfill-form.html`

Three wire-ups: Step 1 submit, Step 2 yes/no buttons, Step 3 CTA buttons. Plus consent line + script tag for `attribution.js`.

- [ ] **Step 1: Read the current form file**

Open `girthfill-form.html` and locate:
- The `<head>` (to add the script tag)
- The Step 1 form (around line 260) and its consent area
- The Step 1 submit handler (around line 331-340, currently `console.log('Lead captured:', ...)`)
- The Step 2 yes/no buttons
- The Step 3 CTA buttons (Book / Schedule a Call / Tap to Call)

- [ ] **Step 2: Add the attribution script to <head>**

In the `<head>`, before the closing `</head>`, add:

```html
<script src="/js/attribution.js"></script>
```

- [ ] **Step 3: Add the consent line under the Step 1 submit button**

In Step 1, immediately below the submit button, add:

```html
<p class="consent-line">By submitting you agree to receive occasional emails from Lushful Aesthetics. Unsubscribe anytime.</p>
```

Add a small style for it (in the existing `<style>` block):

```css
.consent-line {
  font-size: 0.75rem;
  color: rgba(245, 240, 235, 0.65);
  text-align: center;
  margin-top: 0.75rem;
  line-height: 1.4;
}
```

- [ ] **Step 4: Replace Step 1 submit handler**

Find the existing Step 1 submit handler (the one with `console.log('Lead captured:', ...)` near line 338). Replace it so it POSTs to `/api/lead`:

```js
async function submitStep1(event) {
  event.preventDefault();
  var name  = document.getElementById('formName').value.trim();
  var email = document.getElementById('formEmail').value.trim();
  var phone = document.getElementById('formPhone').value.trim();
  if (!name || !email || !phone) {
    showError('Please fill in all fields.');
    return;
  }

  var btn = document.querySelector('#step1 button[type="submit"]');
  var originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    var attribution = window.lushfulAttribution();
    var body = Object.assign(
      { name: name, email: email, phone: phone, source: 'girthfill-landing' },
      attribution
    );
    var res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('lead-post-failed:' + res.status);
    var data = await res.json();
    window.__leadId = data.lead_id;
    advanceToStep(2);
  } catch (err) {
    console.error('lead capture failed', err);
    showError('Something went wrong. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
```

Bind it to the form:

```html
<form id="step1Form" onsubmit="submitStep1(event)">
```

Notes:
- The existing form file already has a step-transition function and CSS classes (e.g., `.step.active`). Reuse them — don't re-invent the visibility logic. If the existing function is named differently than `advanceToStep`, either rename it or call the existing name in `submitStep1` instead.
- If there is no existing error-display element, add this minimal one inside `#step1` just above the submit button:
  ```html
  <div id="formError" style="color: #c44; font-size: 0.85rem; min-height: 1.2em; margin-bottom: 0.5rem;"></div>
  ```
  And this minimal helper near the other handlers:
  ```js
  function showError(msg) {
    var el = document.getElementById('formError');
    if (el) el.textContent = msg;
  }
  ```
- Remove the previous `console.log` submit handler from the file.

- [ ] **Step 5: Wire Step 2 yes/no buttons**

Replace the existing Step 2 yes/no click handlers with:

```js
async function answerQualification(qualified) {
  var btns = document.querySelectorAll('#step2 button');
  btns.forEach(function (b) { b.disabled = true; });
  try {
    await fetch('/api/lead-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: window.__leadId,
        qualified: qualified
      })
    });
  } catch (err) {
    console.error('lead-update failed', err);
    // best-effort: log but still advance
  } finally {
    btns.forEach(function (b) { b.disabled = false; });
    advanceToStep(qualified ? 3 : 4);
  }
}
```

Bind:
```html
<button onclick="answerQualification(true)">Yes</button>
<button onclick="answerQualification(false)">No</button>
```

- [ ] **Step 6: Wire Step 3 CTA buttons**

For each CTA button, fire-and-forget a CTA update before navigating. Replace each button's click handler:

```js
function recordCta(kind) {
  // fire-and-forget; do not await before navigation
  fetch('/api/lead-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lead_id: window.__leadId,
      cta_clicked: kind
    })
  }).catch(function () { /* swallow */ });
}
```

Bind on the three CTA elements:

```html
<!-- Book Appointment -->
<a href="https://www.joinblvd.com/b/lushful-aesthetics/widget#/locations"
   target="_blank"
   onclick="recordCta('book')">Book Appointment</a>

<!-- Schedule a Call -->
<a href="https://www.joinblvd.com/b/lushful-aesthetics/widget#/locations"
   target="_blank"
   onclick="recordCta('call')">Schedule a Call</a>

<!-- Tap to Call -->
<a href="tel:+19172773398"
   onclick="recordCta('tap-to-call')">(917) 277-3398</a>
```

- [ ] **Step 7: Smoke-check (manual, in browser)**

Save the file. We'll do the full E2E test in Task 13. For now, just open `girthfill-form.html` directly in the browser (file://) and confirm:
- The consent line appears under Step 1 submit
- No JS errors in the console on page load
- Clicking submit on Step 1 (with values) triggers a network request to `/api/lead` (which will fail because there's no server yet — that's expected)

- [ ] **Step 8: Commit**

```bash
cd ~/Claude/lushfulcontent
git add girthfill-form.html
git commit -m "feat(form): wire consultation form to /api/lead + /api/lead-update"
```

---

## Task 12: Wire index.html (carousel)

**Files:**
- Modify: `index.html`

The carousel email gate is the `submitBaForm` handler at ~line 967, currently `console.log` only.

- [ ] **Step 1: Add the attribution script to <head>**

In the `<head>` of `index.html`, before `</head>`:

```html
<script src="/js/attribution.js"></script>
```

- [ ] **Step 2: Add the consent line under the carousel form submit button**

Below the submit button inside `#baForm`:

```html
<p class="ba-consent">By submitting you agree to receive occasional emails from Lushful Aesthetics. Unsubscribe anytime.</p>
```

CSS in the existing `<style>`:

```css
.ba-consent {
  font-size: 0.75rem;
  color: rgba(30, 42, 33, 0.6);
  text-align: center;
  margin-top: 0.5rem;
}
```

- [ ] **Step 3: Replace submitBaForm**

Find the existing `submitBaForm` (around line 957-970) and replace it with:

```js
async function submitBaForm(event) {
  event.preventDefault();
  var name  = document.getElementById('baName').value.trim();
  var email = document.getElementById('baEmail').value.trim();
  var phone = document.getElementById('baPhone').value.trim();
  if (!name || !email || !phone) return;

  var btn = document.querySelector('#baForm button[type="submit"]');
  var originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    var attribution = window.lushfulAttribution();
    var body = Object.assign(
      { name: name, email: email, phone: phone, source: 'girthfill-carousel' },
      attribution
    );
    var res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('ba-post-failed:' + res.status);
    // success — reveal carousel as before
    document.getElementById('baForm').style.display = 'none';
    document.getElementById('baCarousel').classList.add('active');
  } catch (err) {
    console.error('B&A lead capture failed', err);
    var errEl = document.getElementById('baError');
    if (errEl) errEl.textContent = 'Something went wrong. Please try again.';
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
```

If there's no `<div id="baError">` already, add one inside `#baForm` just below the submit button (above the consent line):

```html
<div id="baError" style="color: #c44; font-size: 0.85rem; min-height: 1.2em;"></div>
```

- [ ] **Step 4: Smoke-check (manual)**

Same as Task 11 step 7 — open the file in the browser and confirm no console errors and consent line is visible.

- [ ] **Step 5: Commit**

```bash
cd ~/Claude/lushfulcontent
git add index.html
git commit -m "feat(landing): wire carousel email gate to /api/lead"
```

---

## Task 13: Local end-to-end test with vercel dev

No file changes; this is full-flow manual verification before we deploy.

- [ ] **Step 1: Install Vercel CLI (if not present)**

Run: `which vercel`
If not installed: `npm i -g vercel`. Verify with `vercel --version`.

- [ ] **Step 2: Link the local repo to the Vercel project**

Run: `cd ~/Claude/lushfulcontent && vercel link`
Follow prompts: select team `Nick Stewart's projects`, project `lushfulcontent`. This creates `.vercel/` (already gitignored).

- [ ] **Step 3: Pull production env vars locally (optional baseline)**

Run: `cd ~/Claude/lushfulcontent && vercel env pull .env.local`
This pulls any env vars already configured on Vercel (likely none for this feature). Then **manually fill in** all the values from Tasks 2–4 in `.env.local`.

- [ ] **Step 4: Start vercel dev**

Run: `cd ~/Claude/lushfulcontent && vercel dev`
Expected: serves at `http://localhost:3000`.

- [ ] **Step 5: Test the carousel form**

In the browser, open `http://localhost:3000/?utm_source=test&utm_campaign=local_e2e&fbclid=fb_test`. Scroll to the before/after section. Submit the form with a real test email you control.

Expected:
- The carousel reveals
- Vercel dev terminal logs show `POST /api/lead 200`
- In Supabase Table Editor, a new row in `leads` with `source = 'girthfill-carousel'`, your contact info, and `utm_source=test`, `utm_campaign=local_e2e`, `fbclid=fb_test`
- In Mailchimp, the subscriber appears tagged `girthfill-carousel`
- In Close, **no new lead** (carousel skips Close)

- [ ] **Step 6: Test the consultation form Step 1**

Open `http://localhost:3000/girthfill-form.html?utm_source=test&utm_campaign=local_e2e2`. Fill Step 1 with a different test email. Submit.

Expected:
- Form advances to Step 2
- Vercel dev logs `POST /api/lead 200`
- Supabase row with `source = 'girthfill-landing'`, attribution captured
- Mailchimp subscriber tagged `girthfill-landing`
- Close lead created with status "Potential" and custom fields populated

- [ ] **Step 7: Test the qualification answer (yes path)**

In the same form session, click Yes on Step 2.

Expected:
- Form advances to Step 3 with booking options
- Vercel dev logs `POST /api/lead-update 200`
- Supabase row updated: `qualified=true`, `qualified_at` set
- Mailchimp subscriber now also tagged `girthfill-qualified`
- Close lead status updated to "Qualified", "Qualified for $8,500" custom field = "Yes"

- [ ] **Step 8: Test the CTA click**

Click "Book Appointment" on Step 3.

Expected:
- Boulevard widget opens in new tab
- Vercel dev logs `POST /api/lead-update 200`
- Supabase row `cta_clicked = 'book'`
- Close lead "CTA Clicked" custom field = "Book Appointment"

- [ ] **Step 9: Test the no path**

Open the consultation form again, use a third test email, submit Step 1, click No on Step 2.

Expected:
- Form advances to Step 4 (mailing list acknowledgement)
- Supabase: `qualified=false`
- Mailchimp tagged `girthfill-not-qualified`
- Close lead status updated to "Bad Fit"

- [ ] **Step 10: Test the failure path (force a Mailchimp error)**

In `.env.local`, temporarily set `MAILCHIMP_API_KEY=bogus`. Restart `vercel dev`. Submit the consultation form with another test email.

Expected:
- Form still advances to Step 2 (user sees success)
- Supabase row created
- Close lead created
- A row in `lead_sync_errors` with `service='mailchimp'`, the bogus error message captured

Restore the real `MAILCHIMP_API_KEY` and restart.

- [ ] **Step 11: Test duplicate submission (upsert)**

Submit the carousel form twice with the same email. Expected: only one row in `leads` (with `source='girthfill-carousel'`), but the `updated_at` advances.

- [ ] **Step 12: Clean up test data**

Delete the test leads from Supabase, Mailchimp, and Close so they don't pollute production. (Test emails should be ones you control, e.g. `+test1@yourdomain.com`.)

---

## Task 14: Production deploy + smoke test

- [ ] **Step 1: Set production env vars in Vercel**

Run for each variable in `.env.local` (replace `<NAME>` and `<VALUE>`):

```bash
cd ~/Claude/lushfulcontent
echo "<VALUE>" | vercel env add <NAME> production
```

Or use the Vercel dashboard: Project → Settings → Environment Variables. Add all of:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `MAILCHIMP_API_KEY`, `MAILCHIMP_AUDIENCE_ID`, `MAILCHIMP_DC`
- `CLOSE_API_KEY`, `CLOSE_STATUS_NEW`, `CLOSE_STATUS_QUALIFIED`, `CLOSE_STATUS_BAD_FIT`
- `CLOSE_CF_*` (all nine)

Scope each to **Production** (also set Preview if you want preview deploys to work; do NOT set Development if you want to keep `.env.local` as the dev source).

- [ ] **Step 2: Push to main and let autodeploy run**

Run:
```bash
cd ~/Claude/lushfulcontent
git push origin main
```

Watch Vercel: a deploy should kick off automatically. Wait for it to go live.

- [ ] **Step 3: Production smoke test**

Open https://start.lushfulaesthetics.com/?utm_source=prod_smoke in an incognito window. Submit the carousel form with a test email you control.

Expected:
- Carousel reveals
- Supabase row created with `utm_source=prod_smoke`
- Mailchimp + tag applied
- No Close lead (carousel)

Then open https://start.lushfulaesthetics.com/girthfill-form.html?utm_source=prod_smoke. Walk Step 1 → Step 2 yes → Step 3 click Book.

Expected: full pipeline runs as in Task 13.

- [ ] **Step 4: Clean up smoke test data**

Delete the smoke-test leads from all three systems.

- [ ] **Step 5: Confirm Vercel function logs are clean**

In Vercel dashboard → Deployments → latest → Functions → Logs. Spot-check the smoke-test invocations: 200s, no thrown exceptions.

- [ ] **Step 6: Save final state to memory**

Once all the above passes, save a memory note that the lead-capture pipeline is live and which env vars feed it, so future sessions don't have to re-derive.

---

## Summary

After all 14 tasks: every form submission lands in Supabase as the source of truth, syncs to Mailchimp for nurture, and (for consultation-form leads only) creates a tracked lead in Close with status reflecting the qualification answer. Failures in third-party systems are logged for manual replay but don't break the user funnel. Full attribution travels with each lead so paid-social campaigns can be measured end to end.
