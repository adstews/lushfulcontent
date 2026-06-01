-- One-off absolute-time outbound messages (e.g. the 30-min appointment
-- reminder). Distinct from drip sequences, which are relative-to-enrollment.
-- RLS OFF -- service-role only.
create table public.imessage_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  phone text not null,                  -- normalized E.164
  close_lead_id text,
  message text,
  media_url text,
  send_at timestamptz not null,         -- absolute fire time
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','canceled')),
  source text,                          -- e.g. 'calendly-reminder'
  dedup_key text unique,                -- e.g. Calendly invitee_uri
  message_handle text,
  sent_at timestamptz,
  error text,
  constraint scheduled_msg_must_have_payload
    check ((message is not null and length(message) > 0)
        or (media_url is not null and length(media_url) > 0))
);

create index imessage_scheduled_messages_due_idx
  on public.imessage_scheduled_messages (status, send_at) where status = 'pending';
