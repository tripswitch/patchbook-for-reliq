-- Patchbook for Reliq: sync v3. Run after 0001_sync.sql.
--
-- What changes
--   * A change counter ("rev") replaces the time-based cursor. Each push takes a lock on its
--     sync space, so revisions within a space appear in the order they commit, and a device
--     can page through changes exactly: no overlap, no re-downloading, no missed rows.
--   * Pushes are validated in full before anything is written. Unknown fields are refused, and
--     only the bytes that are actually stored count toward the daily budget.
--   * Deletions are encrypted too (devices check their timestamps), and they count toward the
--     limits of their sync space.
--   * Storage is tracked logically per sync space (sync_vaults), so the storage ceiling goes
--     back down when data is deleted or expires.
--   * A push reports the items the server refused because it already had a newer copy, so the
--     device can fetch that copy.
--   * Sync spaces expire 12 months after any device last used them (pushing or pulling).
--
-- Limits
--   * 200 items per push, 48 KB per encrypted item
--   * per sync space: 1,500 records (including deletions from the last 90 days) and 3 MB,
--     counting 200 bytes of overhead per record
--   * all sync spaces together: 200 MB, counted the same way
--   * daily budget across everyone: 50 MB uploaded, 120 MB downloaded (UTC days)

-- Revision counter.
create sequence if not exists public.sync_rev as bigint;
alter table public.sync_vault_items add column if not exists rev bigint;
update public.sync_vault_items s
   set rev = o.n
  from (select vault, item, row_number() over (order by server_updated_at, item) as n
          from public.sync_vault_items) o
 where s.vault = o.vault and s.item = o.item and s.rev is null;
select setval('public.sync_rev', greatest(coalesce((select max(rev) from public.sync_vault_items), 0), 1));
alter table public.sync_vault_items alter column rev set default nextval('public.sync_rev');
alter table public.sync_vault_items alter column rev set not null;
create unique index if not exists sync_vault_items_vault_rev on public.sync_vault_items (vault, rev);
drop index if exists public.sync_vault_items_vault_time;

-- Deletions now carry an encrypted blob. Older unencrypted deletions (blob null) are ignored
-- by devices and expire with housekeeping.
alter table public.sync_vault_items drop constraint if exists sync_vault_items_blob_state;
alter table public.sync_vault_items add constraint sync_vault_items_blob_state check (deleted or blob is not null);

-- One row per sync space: logical size and when a device last used it.
create table if not exists public.sync_vaults (
  vault     bytea       primary key,
  records   integer     not null default 0,
  bytes     bigint      not null default 0,
  last_seen timestamptz not null default now()
);
alter table public.sync_vaults enable row level security;
revoke all on public.sync_vaults from anon, authenticated;
insert into public.sync_vaults (vault, records, bytes, last_seen)
select vault, count(*), sum(coalesce(octet_length(blob), 0) + 200), max(server_updated_at)
  from public.sync_vault_items group by vault
on conflict (vault) do nothing;

-- Daily usage, split into 16 shards by sync space, so unrelated sync spaces don't queue on one
-- counter row. Limits are checked against the sum of the day's shards.
alter table public.sync_usage add column if not exists shard smallint not null default 0;
alter table public.sync_usage drop constraint if exists sync_usage_pkey;
alter table public.sync_usage add primary key (day, shard);

-- A lock per sync space. Pushes take it exclusively, pulls shared.
create or replace function public.sync_lock_key(p_vault bytea)
returns bigint
language sql
immutable
set search_path = ''
as $$ select ('x' || encode(substring(p_vault from 1 for 8), 'hex'))::bit(64)::bigint $$;

drop function if exists public.sync_push(text, jsonb);
drop function if exists public.sync_pull(text, timestamptz);

create function public.sync_push(p_vault text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault bytea := public.sync_vault(p_vault);
  v_n int;
  v_in bigint;
  v_records int;
  v_bytes bigint;
  v_add_records int;
  v_add_bytes bigint;
  v_total bigint;
  v_refused jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 then
    return jsonb_build_object('refused', '[]'::jsonb);
  end if;
  if v_n > 200 then
    raise exception 'send at most 200 items at a time' using errcode = '22023';
  end if;

  -- Validate everything before writing anything.
  if exists (
    select 1 from jsonb_array_elements(p_items) i
     where jsonb_typeof(i) <> 'object'
        or (select count(*) from jsonb_object_keys(i)) <> 4
        or not (i ? 'item' and i ? 'blob' and i ? 'deleted' and i ? 'updatedAt')
        or jsonb_typeof(i -> 'item') <> 'string' or (i ->> 'item') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(i -> 'blob') <> 'string' or octet_length(i ->> 'blob') > 49152
        or (i ->> 'blob') !~ '^[A-Za-z0-9+/]{16,}={0,2}$'
        or jsonb_typeof(i -> 'deleted') <> 'boolean'
        or jsonb_typeof(i -> 'updatedAt') <> 'string'
        or (i ->> 'updatedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
  ) then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  if (select count(distinct i ->> 'item') from jsonb_array_elements(p_items) i) <> v_n then
    raise exception 'duplicate item' using errcode = '22023';
  end if;
  -- Dates that match the pattern but aren't real (month 13) fail here, before any write.
  begin
    perform max((i ->> 'updatedAt')::timestamptz) from jsonb_array_elements(p_items) i;
  exception when others then
    raise exception 'invalid item' using errcode = '22023';
  end;

  v_in := (select sum(64 + octet_length(i ->> 'blob')) from jsonb_array_elements(p_items) i);
  if coalesce((select sum(bytes_in) from public.sync_usage where day = current_date), 0) + v_in > 50 * 1024 * 1024 then
    raise exception 'sync has reached its daily limit; your patches are safe on this device and will sync tomorrow' using errcode = '53400';
  end if;

  perform pg_advisory_xact_lock(public.sync_lock_key(v_vault));

  -- Projected size of this sync space and of everything, counting each item as if written.
  select coalesce(records, 0), coalesce(bytes, 0) into v_records, v_bytes from public.sync_vaults where vault = v_vault;
  v_records := coalesce(v_records, 0);
  v_bytes := coalesce(v_bytes, 0);
  select count(*) filter (where s.item is null),
         coalesce(sum(octet_length(i ->> 'blob') + 200 - coalesce(octet_length(s.blob) + 200, 0)), 0)
    into v_add_records, v_add_bytes
    from jsonb_array_elements(p_items) i
    left join public.sync_vault_items s on s.vault = v_vault and s.item = i ->> 'item';
  if v_records + v_add_records > 1500 then
    raise exception 'this sync space is full (1,500 records)' using errcode = '54000';
  end if;
  if v_bytes + v_add_bytes > 3 * 1024 * 1024 then
    raise exception 'this sync space is full (3 MB)' using errcode = '54000';
  end if;
  select coalesce(sum(bytes), 0) into v_total from public.sync_vaults;
  if v_total + greatest(v_add_bytes, 0) > 200 * 1024 * 1024 then
    raise exception 'sync storage is full; your patches are safe on this device' using errcode = '53100';
  end if;

  -- Write. A copy older than the server's is refused and reported back.
  with incoming as (
    select i ->> 'item' as item,
           i ->> 'blob' as blob,
           (i ->> 'deleted')::boolean as deleted,
           least((i ->> 'updatedAt')::timestamptz, now() + interval '1 day') as updated_at
      from jsonb_array_elements(p_items) i
  ), written as (
    insert into public.sync_vault_items as s (vault, item, blob, deleted, client_updated_at, server_updated_at, rev)
    select v_vault, item, blob, deleted, updated_at, clock_timestamp(), nextval('public.sync_rev') from incoming
    on conflict (vault, item) do update
      set blob = excluded.blob,
          deleted = excluded.deleted,
          client_updated_at = excluded.client_updated_at,
          server_updated_at = excluded.server_updated_at,
          rev = excluded.rev
      where excluded.client_updated_at >= s.client_updated_at
    returning s.item
  )
  select coalesce(jsonb_agg(c.item), '[]'::jsonb) into v_refused
    from incoming c where c.item not in (select item from written);

  insert into public.sync_vaults as v (vault, records, bytes, last_seen)
  select v_vault, count(*), coalesce(sum(coalesce(octet_length(blob), 0) + 200), 0), now()
    from public.sync_vault_items where vault = v_vault
  on conflict (vault) do update set records = excluded.records, bytes = excluded.bytes, last_seen = excluded.last_seen;

  insert into public.sync_usage as u (day, shard, bytes_in) values (current_date, abs(public.sync_lock_key(v_vault) % 16), v_in)
    on conflict (day, shard) do update set bytes_in = u.bytes_in + excluded.bytes_in;

  return jsonb_build_object('refused', v_refused);
end;
$$;

-- Changes after revision p_after, oldest first, up to 500 at a time. With p_items, those items
-- instead (to fetch the server's copy of items a push was refused for). "head" is the newest
-- revision in the sync space, or null if it holds nothing.
create function public.sync_pull(p_vault text, p_after bigint default 0, p_items text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault bytea := public.sync_vault(p_vault);
  v_rows jsonb;
  v_out bigint;
  v_head bigint;
begin
  if p_items is not null and (cardinality(p_items) > 200 or exists (select 1 from unnest(p_items) x where x !~ '^[0-9a-f]{64}$')) then
    raise exception 'invalid items' using errcode = '22023';
  end if;
  if coalesce((select sum(bytes_out) from public.sync_usage where day = current_date), 0) > 120 * 1024 * 1024 then
    raise exception 'sync has reached its daily limit; your patches are safe on this device and will sync tomorrow' using errcode = '53400';
  end if;

  perform pg_advisory_xact_lock_shared(public.sync_lock_key(v_vault));

  select coalesce(jsonb_agg(jsonb_build_object('item', r.item, 'blob', r.blob, 'deleted', r.deleted, 'rev', r.rev) order by r.rev), '[]'::jsonb),
         coalesce(sum(coalesce(octet_length(r.blob), 0) + 100), 0)
    into v_rows, v_out
    from (select s.item, s.blob, s.deleted, s.rev
            from public.sync_vault_items s
           where s.vault = v_vault
             and (case when p_items is null then s.rev > coalesce(p_after, 0) else s.item = any (p_items) end)
           order by s.rev
           limit 500) r;
  select max(rev) into v_head from public.sync_vault_items where vault = v_vault;

  update public.sync_vaults set last_seen = now() where vault = v_vault and last_seen < now() - interval '1 day';
  insert into public.sync_usage as u (day, shard, bytes_out) values (current_date, abs(public.sync_lock_key(v_vault) % 16), v_out)
    on conflict (day, shard) do update set bytes_out = u.bytes_out + excluded.bytes_out;

  return jsonb_build_object('rows', v_rows, 'head', v_head);
end;
$$;

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
  perform pg_advisory_xact_lock(public.sync_lock_key(v_vault));
  delete from public.sync_vault_items where vault = v_vault;
  get diagnostics v_n = row_count;
  delete from public.sync_vaults where vault = v_vault;
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
  -- Sync spaces no device has used for 12 months.
  delete from public.sync_vault_items s
   using public.sync_vaults v
   where v.vault = s.vault and v.last_seen < now() - interval '12 months';
  delete from public.sync_vaults where last_seen < now() - interval '12 months';
  -- Deletion records older than 90 days.
  delete from public.sync_vault_items where deleted and server_updated_at < now() - interval '90 days';
  -- Recount every sync space.
  update public.sync_vaults v
     set records = c.records, bytes = c.bytes
    from (select vault, count(*) as records, sum(coalesce(octet_length(blob), 0) + 200) as bytes
            from public.sync_vault_items group by vault) c
   where c.vault = v.vault and (v.records <> c.records or v.bytes <> c.bytes);
  delete from public.sync_vaults v
   where not exists (select 1 from public.sync_vault_items s where s.vault = v.vault);
  delete from public.sync_usage where day < current_date - 90;
end;
$$;

revoke all on function public.sync_lock_key(bytea) from public, anon, authenticated;
revoke all on function public.sync_push(text, jsonb) from public;
revoke all on function public.sync_pull(text, bigint, text[]) from public;
revoke all on function public.sync_delete(text) from public;
revoke all on function public.sync_housekeeping() from public, anon, authenticated;
grant execute on function public.sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_pull(text, bigint, text[]) to anon, authenticated;
grant execute on function public.sync_delete(text) to anon, authenticated;
