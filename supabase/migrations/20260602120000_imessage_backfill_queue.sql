-- Frozen queue for the GirthFill iMessage re-engagement backfill.
--
-- Seeded ONCE with a fixed roster (~100 Qualified leads, deduped, opt-outs and
-- the founder's own number already removed). The daily `backfill-tick` cron
-- drains it newest-first (position asc), a fixed batch per day, and NEVER
-- re-queries Close — so leads that arrive after the freeze can never enter the
-- campaign. RLS OFF -- service-role only.
create table if not exists public.imessage_backfill_queue (
  id             bigint generated always as identity primary key,
  position       int  not null,                  -- 0 = newest = contacted first
  close_lead_id  text not null,
  phone          text not null unique,           -- normalized E.164; unique guards against double-enqueue
  name           text,
  status         text not null default 'queued', -- queued | sent | skipped_optout | failed
  message_handle text,
  sent_at        timestamptz,                    -- null = still queued
  enqueued_at    timestamptz not null default now()
);

-- Partial index over the still-queued rows, ordered the way the cron pulls them.
create index if not exists imessage_backfill_queue_next_idx
  on public.imessage_backfill_queue (position) where sent_at is null;
