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
