-- Permanent opt-out (STOP) list. Phone-keyed so it survives lead churn.
-- RLS intentionally OFF, consistent with public.leads / calendly_bookings --
-- only Vercel functions (service-role key) ever touch this table.
create table public.imessage_opt_outs (
  phone text primary key,            -- normalized E.164
  close_lead_id text,                -- set when the STOP matched a Close lead
  reason text,                       -- e.g. 'stop-keyword'
  created_at timestamptz not null default now()
);

create index imessage_opt_outs_close_lead_id_idx
  on public.imessage_opt_outs (close_lead_id);
