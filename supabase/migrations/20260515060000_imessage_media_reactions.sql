-- Media + reactions support for the iMessage console.

-- Public Storage bucket that hosts uploaded media so SendBlue can fetch
-- it for outbound MMS-over-iMessage. Files are 10MB max and limited to
-- common image/video types. Public read because SendBlue downloads the
-- file without auth before relaying it; the URL is unguessable
-- (UUID-prefixed path).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imessage-media',
  'imessage-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Reactions on iMessages (both directions). Joined onto messages by the
-- SendBlue message_handle. One row per (handle, direction, reaction) —
-- iMessage allows changing your reaction by tapping again, and we record
-- each event but the latest per direction is what's displayed.
create table public.imessage_console_reactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message_handle text not null,
  lead_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  reaction text not null,
  -- iMessage's six tap-backs: love, like, dislike, laugh, emphasize, question
  -- (plus -love, -like, etc. when removed). Validate loosely.
  removed boolean not null default false
);

create index imessage_console_reactions_handle_idx
  on public.imessage_console_reactions (message_handle, created_at desc);
