-- Fashion Builder beta access codes (isolated from TooLive tables).
-- RLS is on with no policies for anon/authenticated; grants are revoked from those roles.
-- Edge functions use the service role, which bypasses RLS.
-- Access codes are stored as SHA-256 hashes (pepper + payload). Plaintext codes are never kept.

create table if not exists public.fb_beta_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.fb_beta_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_hint text not null,
  status text not null default 'active' check (status in ('active', 'used', 'revoked')),
  used_by_email text,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note text
);

create table if not exists public.fb_beta_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  code_id uuid not null references public.fb_beta_codes(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists fb_beta_codes_status_idx on public.fb_beta_codes (status);
create index if not exists fb_beta_codes_email_idx on public.fb_beta_codes (used_by_email);
create index if not exists fb_beta_sessions_code_idx on public.fb_beta_sessions (code_id);
create index if not exists fb_beta_sessions_email_idx on public.fb_beta_sessions (email);

alter table public.fb_beta_settings enable row level security;
alter table public.fb_beta_codes enable row level security;
alter table public.fb_beta_sessions enable row level security;

revoke all on table public.fb_beta_settings from public, anon, authenticated;
revoke all on table public.fb_beta_codes from public, anon, authenticated;
revoke all on table public.fb_beta_sessions from public, anon, authenticated;
grant all on table public.fb_beta_settings to postgres, service_role;
grant all on table public.fb_beta_codes to postgres, service_role;
grant all on table public.fb_beta_sessions to postgres, service_role;
