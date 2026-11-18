-- Per-account limits, enforced where the row is inserted. Checking a count in
-- the application and then inserting lets parallel requests go over the limit;
-- these triggers lock the account row first, so inserts for one account take
-- turns and each one counts what the others have already committed.
-- Arguments: the limit's name (reported back as "quizzlet_limit:<name>") and its size,
-- which must match MAX_PROFILES, MAX_DECKS and MAX_FILES in src/account-shared.ts.

create or replace function quizzlet_enforce_limit() returns trigger language plpgsql as $$
declare
  current_count bigint;
begin
  perform 1 from accounts where id = new.account_id for update;
  execute format('select count(*) from %I where account_id = $1', tg_table_name)
    into current_count using new.account_id;
  if current_count >= tg_argv[1]::bigint then
    raise exception 'quizzlet_limit:%', tg_argv[0] using errcode = 'QZ001';
  end if;
  return new;
end
$$;

drop trigger if exists kid_profiles_limit on kid_profiles;

create trigger kid_profiles_limit before insert on kid_profiles
  for each row execute function quizzlet_enforce_limit('profiles', '20');

drop trigger if exists decks_limit on decks;

create trigger decks_limit before insert on decks
  for each row execute function quizzlet_enforce_limit('decks', '50');

drop trigger if exists files_limit on files;

create trigger files_limit before insert on files
  for each row execute function quizzlet_enforce_limit('files', '20');
