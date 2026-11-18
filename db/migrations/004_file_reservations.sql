-- Upload reservations: a path set aside when an upload starts. A live
-- reservation counts against the account's file quota (count and bytes) until
-- the file is saved, so uploads that are never saved can't pile up outside the
-- quota. Upload URLs are only signed for a reserved path.
--
-- An expired reservation stays here for a while. It is the record that
-- whatever was uploaded to that path was never saved, and the only thing that
-- lets the cleanup delete stored bytes; the daily job removes the row once it
-- has deleted them.

create table if not exists file_reservations (
  pathname text primary key,
  account_id text not null references accounts (id) on delete cascade,
  declared_bytes bigint not null check (declared_bytes > 0),
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists file_reservations_account_idx on file_reservations (account_id);

create index if not exists file_reservations_expiry_idx on file_reservations (expires_at);

-- Checks the quota where the reservation is written. Locking the account row
-- first makes parallel reservations wait for each other; under READ COMMITTED
-- each statement below then sees what the others committed, so the count is exact.
-- "Now" is the new row's created_at, so the application's clock decides what is live.
-- Arguments: the file limit and the byte limit (MAX_FILES, MAX_TOTAL_FILE_BYTES).
create or replace function quizzlet_reserve_upload() returns trigger language plpgsql as $$
declare
  used_count bigint;
  used_bytes bigint;
begin
  perform 1 from accounts where id = new.account_id for update;
  -- A reservation for a path that already holds a saved file would later read as
  -- "started, never saved" and get that file's bytes deleted: never allow one.
  if exists (select 1 from files where pathname = new.pathname) then
    raise exception 'quizzlet_reservation: a file is already saved at this path' using errcode = 'QZ002';
  end if;
  select count(*), coalesce(sum(size_bytes), 0) into used_count, used_bytes
    from files where account_id = new.account_id;
  select used_count + count(*), used_bytes + coalesce(sum(declared_bytes), 0) into used_count, used_bytes
    from file_reservations where account_id = new.account_id and expires_at > new.created_at;
  if used_count >= tg_argv[0]::bigint then
    raise exception 'quizzlet_limit:files' using errcode = 'QZ001';
  end if;
  if used_bytes + new.declared_bytes > tg_argv[1]::bigint then
    raise exception 'quizzlet_limit:storage' using errcode = 'QZ001';
  end if;
  return new;
end
$$;

drop trigger if exists file_reservations_quota on file_reservations;

create trigger file_reservations_quota before insert on file_reservations
  for each row execute function quizzlet_reserve_upload('20', '52428800');
