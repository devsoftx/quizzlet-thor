-- Uploads count against the account's quota from the moment they start.
-- "pending": the browser was given room for a file of the declared size and
-- has until expires_at to upload and confirm it. "ready": a saved file.

alter table files add column if not exists status text not null default 'ready' check (status in ('pending', 'ready'));

alter table files add column if not exists expires_at timestamptz;

create index if not exists files_pending_idx on files (account_id, expires_at) where status = 'pending';
