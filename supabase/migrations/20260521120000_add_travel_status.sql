-- Add travel_status to leads. Set by /api/lead-update when the user
-- answers the in-person travel confirmation step on girthfill-form.
-- NULL means the gate didn't run (legacy rows or non-girthfill sources).
alter table public.leads
  add column travel_status text;

-- Optional sanity check at write time. Keep aligned with the JS enum and
-- the Zod schema in api/lead-update.js.
alter table public.leads
  add constraint leads_travel_status_check
  check (travel_status is null or travel_status in (
    'local', 'willing_to_travel', 'declined_travel'
  ));
