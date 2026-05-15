-- Tables backing the iMessage reply console at /imessage.
-- All writes happen through Vercel functions using the service-role key.
-- RLS off — same model as the leads table.

-- Per-lead "last read" timestamp. The console marks a thread read when the
-- user opens it; the inbox uses this to count unread inbound messages.
create table public.imessage_console_read_state (
  lead_id text primary key,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger imessage_console_read_state_touch
  before update on public.imessage_console_read_state
  for each row execute function public.touch_updated_at();

-- Web push subscriptions registered by the console (one row per device).
-- We push to every active subscription when an inbound iMessage matches a lead.
create table public.imessage_console_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  failed_at timestamptz,
  fail_reason text
);

create index imessage_console_push_subscriptions_active_idx
  on public.imessage_console_push_subscriptions (last_seen_at desc)
  where failed_at is null;
