-- A kid's device link now ends on the server too, 180 days after it was made
-- (the same as the device's cookie), instead of only when the browser forgets it.

alter table kid_devices add column if not exists expires_at timestamptz;

update kid_devices set expires_at = created_at + interval '180 days' where expires_at is null;

alter table kid_devices alter column expires_at set not null;
