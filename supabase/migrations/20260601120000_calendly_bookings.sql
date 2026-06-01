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
