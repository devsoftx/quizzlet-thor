-- Upload reservations: a path set aside when an upload starts. A reservation
-- counts against the account's file quota (count and bytes) until the file is
-- confirmed or the reservation expires, so uploads that are never confirmed
-- can't pile up outside the quota. Upload URLs are only signed for a reserved path.

create table if not exists file_reservations (
  pathname text primary key,
  account_id text not null references accounts (id) on delete cascade,
  declared_bytes bigint not null check (declared_bytes > 0),
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists file_reservations_account_idx on file_reservations (account_id);

-- Checks the quota where the reservation is written. Locking the account row
-- first makes parallel reservations wait for each other; under READ COMMITTED
-- each statement below then sees what the others committed, so the count is exact.
-- Arguments: the file limit and the byte limit (MAX_FILES, MAX_TOTAL_FILE_BYTES).
create or replace function quizzlet_reserve_upload() returns trigger language plpgsql as $$
declare
  used_count bigint;
  used_bytes bigint;
begin
  perform 1 from accounts where id = new.account_id for update;
  delete from file_reservations where account_id = new.account_id and expires_at <= new.created_at;
  select count(*), coalesce(sum(size_bytes), 0) into used_count, used_bytes
    from files where account_id = new.account_id;
  select used_count + count(*), used_bytes + coalesce(sum(declared_bytes), 0) into used_count, used_bytes
    from file_reservations where account_id = new.account_id;
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
