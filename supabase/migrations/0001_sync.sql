-- Patchbook for Reliq: device sync (end-to-end encrypted).
--
-- How it works
--   Devices share a private sync key, which never leaves the devices. From it, each device
--   derives three things locally (HKDF-SHA-256):
--     * a vault token, sent to these functions to identify the sync space. The database stores
--       only its SHA-256 hash ("vault");
--     * an AES-GCM key that encrypts every record before upload;
--     * an HMAC key that turns each record's kind and id into an opaque item id.
--   So the database holds only hashes, opaque ids, ciphertext and timestamps. Whoever runs
--   the database can't read anyone's patches.
--
-- Access
--   The table has row-level security on and no policies, and table privileges are revoked:
--   the public API can't touch it directly. Everything goes through the SECURITY DEFINER
--   functions below, which need the vault token. (Supabase's advisor flags these functions
--   as callable without signing in; that's by design.)
--
-- Limits (protect a free-tier project from accidental or deliberate overuse)
--   * 200 items per push, 48 KB per encrypted item (a typical patch is about 2–3 KB)
--   * per sync space: 1,000 live items and 2 MB
--   * whole table: 300 MB
--   * daily budget across everyone: 50 MB uploaded, 120 MB downloaded. Past it, sync pauses
--     until the next day (UTC); patches keep working on each device.
--   * timestamps more than a day in the future are clamped
--
-- Housekeeping (daily, via pg_cron)
--   * sync spaces untouched for 12 months are deleted
--   * deletion records older than 90 days are removed
--   * usage counters older than 90 days are removed

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.sync_vault_items (
  vault             bytea       not null,
  item              text        not null check (item ~ '^[0-9a-f]{64}$'),
  blob              text,
  deleted           boolean     not null default false,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (vault, item),
  constraint sync_vault_items_blob_size check (blob is null or octet_length(blob) <= 49152),
  constraint sync_vault_items_blob_state check ((deleted and blob is null) or (not deleted and blob is not null))
);
create index if not exists sync_vault_items_vault_time on public.sync_vault_items (vault, server_updated_at);
create index if not exists sync_vault_items_time on public.sync_vault_items (server_updated_at);

create table if not exists public.sync_usage (
  day       date   primary key,
  bytes_in  bigint not null default 0,
  bytes_out bigint not null default 0
);

alter table public.sync_vault_items enable row level security;
alter table public.sync_usage enable row level security;
revoke all on public.sync_vault_items from anon, authenticated;
revoke all on public.sync_usage from anon, authenticated;

-- Check a vault token and return the stored hash for it.
create or replace function public.sync_vault(p_vault text)
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_vault is null or p_vault !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid sync space' using errcode = '22023';
  end if;
  return extensions.digest(p_vault, 'sha256');
end;
$$;

create or replace function public.sync_push(p_vault text, p_items jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault bytea := public.sync_vault(p_vault);
  v_bytes bigint;
  v_today_in bigint;
  v_live int;
  v_size bigint;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'send at most 200 items at a time' using errcode = '22023';
  end if;

  v_bytes := octet_length(p_items::text);
  insert into public.sync_usage as u (day, bytes_in) values (current_date, v_bytes)
    on conflict (day) do update set bytes_in = u.bytes_in + excluded.bytes_in
    returning u.bytes_in into v_today_in;
  if v_today_in > 50 * 1024 * 1024 then
    raise exception 'sync has reached its daily limit; your patches are safe on this device and will sync tomorrow' using errcode = '53400';
  end if;
  if pg_catalog.pg_total_relation_size('public.sync_vault_items') > 300 * 1024 * 1024 then
    raise exception 'sync storage is full; your patches are safe on this device' using errcode = '53100';
  end if;

  insert into public.sync_vault_items as s (vault, item, blob, deleted, client_updated_at, server_updated_at)
  select v_vault,
         i ->> 'item',
         case when coalesce((i ->> 'deleted')::boolean, false) then null else i ->> 'blob' end,
         coalesce((i ->> 'deleted')::boolean, false),
         least((i ->> 'updatedAt')::timestamptz, now() + interval '1 day'),
         clock_timestamp()
  from jsonb_array_elements(p_items) as i
  on conflict (vault, item) do update
    set blob = excluded.blob,
        deleted = excluded.deleted,
        client_updated_at = excluded.client_updated_at,
        server_updated_at = clock_timestamp()
    where excluded.client_updated_at >= s.client_updated_at;

  select count(*) filter (where not deleted), coalesce(sum(octet_length(blob)), 0)
    into v_live, v_size
    from public.sync_vault_items where vault = v_vault;
  if v_live > 1000 then
    raise exception 'this sync space is full (1,000 items)' using errcode = '54000';
  end if;
  if v_size > 2 * 1024 * 1024 then
    raise exception 'this sync space is full (2 MB)' using errcode = '54000';
  end if;

  return clock_timestamp();
end;
$$;

create or replace function public.sync_pull(p_vault text, p_since timestamptz default null)
returns table (item text, blob text, deleted boolean, client_updated_at timestamptz, server_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault bytea := public.sync_vault(p_vault);
  v_out bigint := 0;
  v_today_out bigint;
  r record;
begin
  select u.bytes_out into v_today_out from public.sync_usage u where u.day = current_date;
  if coalesce(v_today_out, 0) > 120 * 1024 * 1024 then
    raise exception 'sync has reached its daily limit; your patches are safe on this device and will sync tomorrow' using errcode = '53400';
  end if;

  for r in
    select s.item, s.blob, s.deleted, s.client_updated_at, s.server_updated_at
    from public.sync_vault_items s
    where s.vault = v_vault and (p_since is null or s.server_updated_at >= p_since)
    order by s.server_updated_at
    limit 500
  loop
    item := r.item; blob := r.blob; deleted := r.deleted;
    client_updated_at := r.client_updated_at; server_updated_at := r.server_updated_at;
    v_out := v_out + coalesce(octet_length(r.blob), 0) + 160;
    return next;
  end loop;

  insert into public.sync_usage as u (day, bytes_out) values (current_date, v_out)
    on conflict (day) do update set bytes_out = u.bytes_out + excluded.bytes_out;
end;
$$;

-- "Delete my synced data": removes everything stored for a sync space.
create or replace function public.sync_delete(p_vault text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault bytea := public.sync_vault(p_vault);
  v_n integer;
begin
  delete from public.sync_vault_items where vault = v_vault;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.sync_housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.sync_vault_items s
   where s.vault in (select vault from public.sync_vault_items group by vault
                      having max(server_updated_at) < now() - interval '12 months');
  delete from public.sync_vault_items where deleted and server_updated_at < now() - interval '90 days';
  delete from public.sync_usage where day < current_date - 90;
end;
$$;

revoke all on function public.sync_vault(text) from public, anon, authenticated;
revoke all on function public.sync_push(text, jsonb) from public;
revoke all on function public.sync_pull(text, timestamptz) from public;
revoke all on function public.sync_delete(text) from public;
revoke all on function public.sync_housekeeping() from public, anon, authenticated;
grant execute on function public.sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_pull(text, timestamptz) to anon, authenticated;
grant execute on function public.sync_delete(text) to anon, authenticated;

-- Daily housekeeping at 03:17 UTC.
create extension if not exists pg_cron;
select cron.schedule('patchbook-sync-housekeeping', '17 3 * * *', 'select public.sync_housekeeping()');
