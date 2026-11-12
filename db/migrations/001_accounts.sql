-- Parent/teacher accounts (keyed by Clerk user id) and their kids' nickname-only profiles.

create table if not exists accounts (
  id text primary key,
  display_name text not null,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kid_profiles (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  nickname text not null,
  grade_band text check (grade_band in ('k-2', '3-5', '6-8', '9-12')),
  color text not null,
  emoji text not null,
  show_on_leaderboard boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kid_profiles_account_idx on kid_profiles (account_id);
