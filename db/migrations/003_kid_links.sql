-- Kid device links: a parent's invitation link lets a kid's own device study as
-- their profile, without an email, password or sign-in account for the kid.
-- Only SHA-256 fingerprints of the secrets are stored.

create table if not exists kid_invites (
  token_hash text primary key,
  account_id text not null,
  profile_id text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  foreign key (account_id, profile_id) references kid_profiles (account_id, id) on delete cascade
);

create index if not exists kid_invites_profile_idx on kid_invites (account_id, profile_id);

create table if not exists kid_devices (
  id text primary key,
  token_hash text not null unique,
  account_id text not null,
  profile_id text not null,
  label text not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  foreign key (account_id, profile_id) references kid_profiles (account_id, id) on delete cascade
);

create index if not exists kid_devices_profile_idx on kid_devices (account_id, profile_id);
