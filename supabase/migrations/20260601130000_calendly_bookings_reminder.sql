-- One-time reminder tracking for Calendly bookings.
alter table public.calendly_bookings
  add column if not exists reminder_sent_at timestamptz;

-- Supports the reminder cron's "due and not yet reminded" scan.
create index if not exists calendly_bookings_due_reminder_idx
  on public.calendly_bookings (scheduled_at)
  where reminder_sent_at is null;
