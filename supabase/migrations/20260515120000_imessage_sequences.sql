-- iMessage sequence engine (drip campaigns).
-- A "sequence" is an ordered list of message templates with cumulative delays
-- from enrollment start. Enrollments get paused automatically when a lead
-- replies (configurable per sequence). A Vercel Cron tick fires due sends.

create table public.imessage_sequences (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  -- 'manual' = only manual enrollment from the console
  -- 'lead_status' = auto-enroll when a Close lead reaches `trigger_status_id`
  trigger_type text not null default 'manual'
    check (trigger_type in ('manual', 'lead_status')),
  trigger_status_id text, -- Close lead status id when trigger_type='lead_status'
  on_reply_behavior text not null default 'pause'
    check (on_reply_behavior in ('pause', 'unenroll', 'continue')),
  active boolean not null default true
);

create index imessage_sequences_active_idx
  on public.imessage_sequences (active) where active = true;
create index imessage_sequences_trigger_status_idx
  on public.imessage_sequences (trigger_status_id)
  where trigger_type = 'lead_status' and active = true;

create trigger imessage_sequences_touch
  before update on public.imessage_sequences
  for each row execute function public.touch_updated_at();

-- Steps belong to a sequence. delay_seconds is cumulative from enrollment start,
-- so step ordering is sort by delay_seconds asc. position is just a stable tie-
-- breaker for steps with the same delay (rare).
create table public.imessage_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.imessage_sequences(id) on delete cascade,
  position integer not null default 0,
  delay_seconds integer not null check (delay_seconds >= 0),
  message_template text,
  media_url text,
  -- Guarantee a step has at least one of message or media
  constraint step_must_have_payload
    check ((message_template is not null and length(message_template) > 0)
        or (media_url is not null and length(media_url) > 0))
);

create index imessage_sequence_steps_seq_idx
  on public.imessage_sequence_steps (sequence_id, delay_seconds, position);

-- One row per lead-in-sequence. `next_step_position` is the 0-based index of
-- the next step to fire (ordered by delay_seconds asc, position asc).
create table public.imessage_sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sequence_id uuid not null references public.imessage_sequences(id) on delete cascade,
  lead_id text not null,
  phone text,
  contact_id text,
  -- 'active' = scheduled sends will fire
  -- 'paused' = sends skipped until resumed; auto-set when a reply lands
  -- 'unenrolled' = permanently removed (STOP keyword, manual remove, etc.)
  -- 'completed' = ran through all steps successfully
  status text not null default 'active'
    check (status in ('active', 'paused', 'unenrolled', 'completed')),
  next_step_position integer not null default 0,
  enrolled_at timestamptz not null default now(),
  paused_at timestamptz,
  paused_reason text,
  completed_at timestamptz,
  unique (sequence_id, lead_id)
);

create index imessage_sequence_enrollments_due_idx
  on public.imessage_sequence_enrollments (sequence_id, status, enrolled_at)
  where status = 'active';
create index imessage_sequence_enrollments_lead_idx
  on public.imessage_sequence_enrollments (lead_id, status);

create trigger imessage_sequence_enrollments_touch
  before update on public.imessage_sequence_enrollments
  for each row execute function public.touch_updated_at();

-- Audit log: one row per attempted send. Used to prevent duplicate sends
-- (idempotency on Cron retries) and to power per-enrollment progress views.
create table public.imessage_sequence_sends (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.imessage_sequence_enrollments(id) on delete cascade,
  step_id uuid not null references public.imessage_sequence_steps(id) on delete cascade,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  message_handle text,
  error text,
  unique (enrollment_id, step_id)
);

create index imessage_sequence_sends_enrollment_idx
  on public.imessage_sequence_sends (enrollment_id, scheduled_for);
