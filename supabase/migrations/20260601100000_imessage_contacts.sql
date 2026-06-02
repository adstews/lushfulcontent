-- Tracks the first time we opened an iMessage conversation with a phone, so the
-- new-conversation throttle can stay under Blooio's shared-plan daily cap.
-- RLS OFF -- service-role only.
create table public.imessage_contacts (
  phone text primary key,                       -- normalized E.164
  first_contacted_at timestamptz not null default now()
);
create index imessage_contacts_first_contacted_idx
  on public.imessage_contacts (first_contacted_at);
