-- A kid profile's answers, card by card, for the parent's Progress page:
-- whether it was right, how long it took, which answers were tried before
-- submitting, and whether it was a "practice the missed ones" round.
-- Only kid profiles' answers are stored (never a guest's). They go when the
-- profile or the account does (cascade), and the daily cleanup deletes
-- answers older than 180 days (PROGRESS_RETENTION_DAYS in src/attempts.ts).

create table if not exists study_attempts (
  id bigserial primary key,
  account_id text not null,
  profile_id text not null,
  -- The score batch this answer came in, and its place in it: a batch that is
  -- sent again (a retry after a lost connection) is stored once.
  batch_id text not null,
  position smallint not null check (position >= 0),
  deck_key text not null check (length(deck_key) <= 200),
  deck_title text not null check (length(deck_title) <= 120),
  card_key text not null check (card_key ~ '^[0-9a-f]{16}$'),
  question text not null check (length(question) <= 200),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  correct boolean not null,
  retry boolean not null,
  response_ms integer not null check (response_ms between 0 and 600000),
  -- Answers picked before submitting, by their position in the deck file; the last was submitted.
  picks smallint[] not null check (cardinality(picks) between 1 and 20),
  answer_index smallint not null,
  option_count smallint not null check (option_count between 2 and 10),
  answered_at timestamptz not null,
  unique (profile_id, batch_id, position),
  foreign key (account_id, profile_id) references kid_profiles (account_id, id) on delete cascade
);

create index if not exists study_attempts_profile_time_idx on study_attempts (account_id, profile_id, answered_at desc);

create index if not exists study_attempts_time_idx on study_attempts (answered_at);
