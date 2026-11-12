-- Private decks and files for each parent/teacher account.

-- Lets other tables require that a profile and a deck belong to the same account.
alter table kid_profiles add constraint kid_profiles_account_id_id_key unique (account_id, id);

create table if not exists decks (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  title text not null,
  description text,
  card_count integer not null check (card_count > 0),
  yaml text not null,
  enabled boolean not null default true,
  -- true: every kid profile sees the deck; false: only those in deck_assignments.
  all_profiles boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

create index if not exists decks_account_idx on decks (account_id);

-- Both sides carry account_id, so a deck can never be assigned to another account's kid.
create table if not exists deck_assignments (
  account_id text not null,
  deck_id text not null,
  profile_id text not null,
  primary key (deck_id, profile_id),
  foreign key (account_id, deck_id) references decks (account_id, id) on delete cascade,
  foreign key (account_id, profile_id) references kid_profiles (account_id, id) on delete cascade
);

-- The index of what's in private Blob storage (listing Blob itself costs operations).
create table if not exists files (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  pathname text not null unique,
  name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists files_account_idx on files (account_id);
