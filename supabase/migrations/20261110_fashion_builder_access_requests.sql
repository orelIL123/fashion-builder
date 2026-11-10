-- Fashion Builder invite-only access (public.fb_access_requests).
-- RLS is on with no policies for anon/authenticated; grants are revoked from those roles.
-- Edge functions use the service role, which bypasses RLS.

create table if not exists public.fb_access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  token text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create unique index if not exists fb_access_requests_email_unique
  on public.fb_access_requests (lower(email));

create index if not exists fb_access_requests_token_idx
  on public.fb_access_requests (token);

alter table public.fb_access_requests enable row level security;

revoke all on table public.fb_access_requests from public, anon, authenticated;
grant all on table public.fb_access_requests to postgres, service_role;
