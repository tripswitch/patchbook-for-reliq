-- Patchbook for Reliq: per-visitor daily limits. Run after 0002_sync_v3.sql.
--
-- The global daily budget protects the database, but one person could still use it up for
-- everyone. These limits cap what each visitor (each network address) can use per day:
--   * 5,000 requests (a device polls about once a minute while it's open)
--   * 5 MB uploaded
--   * 15 MB downloaded
-- Past a limit, that visitor's sync pauses until the next day (UTC); patches keep working on
-- each device, and everyone else is unaffected.
--
-- Privacy
--   The visitor's IP address is never stored. Each visitor is counted under a one-way code:
--   SHA-256 of a random salt that changes every day, followed by the address (IPv6 addresses
--   are cut to their /64 network, which is what one connection usually gets). The day's salt
--   and counters are deleted by the daily housekeeping, so codes can't be linked across days
--   or turned back into addresses.
--
-- Which address
--   Cloudflare's CF-Connecting-IP when present (Cloudflare sets it; clients can't), otherwise
--   the first X-Forwarded-For entry. Requests with no address header at all (for example a
--   self-hosted project with no proxy in front) aren't limited per visitor. A header that
--   isn't a valid address counts under one shared "unknown" visitor.

create table if not exists public.sync_visitor_salt (
  day  date  primary key,
  salt bytea not null
);
create table if not exists public.sync_visitor_usage (
  day       date    not null,
  visitor   bytea   not null,
  requests  integer not null default 0,
  bytes_in  bigint  not null default 0,
  bytes_out bigint  not null default 0,
  primary key (day, visitor)
);
alter table public.sync_visitor_salt enable row level security;
alter table public.sync_visitor_usage enable row level security;
revoke all on public.sync_visitor_salt from anon, authenticated;
revoke all on public.sync_visitor_usage from anon, authenticated;

-- The one-way code for whoever made this request, or null if there's no address to go on.
create or replace function public.sync_visitor()
returns bytea
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_headers json;
  v_raw text;
  v_ip inet;
  v_key text;
  v_salt bytea;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  if v_headers is null then
    return null;
  end if;
  v_raw := coalesce(nullif(trim(v_headers ->> 'cf-connecting-ip'), ''),
                    nullif(trim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''));
  if v_raw is null then
    return null;
  end if;
  begin
    v_ip := v_raw::inet;
    v_key := case when family(v_ip) = 6 then host(network(set_masklen(v_ip, 64))) || '/64' else host(v_ip) end;
  exception when others then
    v_key := 'unknown';
  end;
  insert into public.sync_visitor_salt (day, salt) values (current_date, extensions.gen_random_bytes(32))
    on conflict (day) do nothing;
  select salt into v_salt from public.sync_visitor_salt where day = current_date;
  return extensions.digest(v_salt || convert_to(v_key, 'UTF8'), 'sha256');
end;
$$;

-- Refuse the request if this visitor is over a daily limit (counting p_in bytes about to be uploaded).
create or replace function public.sync_visitor_check(p_visitor bytea, p_in bigint)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  u record;
begin
  if p_visitor is null then
    return;
  end if;
  select requests, bytes_in, bytes_out into u from public.sync_visitor_usage where day = current_date and visitor = p_visitor;
  if found and (u.requests >= 5000 or u.bytes_in + p_in > 5 * 1024 * 1024 or u.bytes_out > 15 * 1024 * 1024) then
    raise exception 'sync has reached its daily limit for your network; your patches are safe on this device and will sync tomorrow' using errcode = '53400';
  end if;
  if not found and p_in > 5 * 1024 * 1024 then
    raise exception 'sync has reached its daily limit for your network; your patches are safe on this device and will sync tomorrow' using errcode = '53400';
  end if;
end;
$$;

create or replace function public.sync_visitor_charge(p_visitor bytea, p_in bigint, p_out bigint)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.sync_visitor_usage as u (day, visitor, requests, bytes_in, bytes_out)
  select current_date, p_visitor, 1, p_in, p_out where p_visitor is not null
  on conflict (day, visitor) do update
    set requests = u.requests + 1, bytes_in = u.bytes_in + excluded.bytes_in, bytes_out = u.bytes_out + excluded.bytes_out
$$;

create or replace function public.sync_push(p_vault text, p_items jsonb)
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
  v_visitor bytea := public.sync_visitor();
begin
  perform public.sync_visitor_check(v_visitor, 0);
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

  perform public.sync_visitor_check(v_visitor, v_in);

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

  perform public.sync_visitor_charge(v_visitor, v_in, 0);

  return jsonb_build_object('refused', v_refused);
end;
$$;


create or replace function public.sync_pull(p_vault text, p_after bigint default 0, p_items text[] default null)
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
  v_visitor bytea := public.sync_visitor();
begin
  perform public.sync_visitor_check(v_visitor, 0);
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

  perform public.sync_visitor_charge(v_visitor, 0, v_out);

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
  v_visitor bytea := public.sync_visitor();
begin
  perform public.sync_visitor_check(v_visitor, 0);
  perform pg_advisory_xact_lock(public.sync_lock_key(v_vault));
  delete from public.sync_vault_items where vault = v_vault;
  get diagnostics v_n = row_count;
  delete from public.sync_vaults where vault = v_vault;
  perform public.sync_visitor_charge(v_visitor, 0, 0);
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
  -- Per-visitor counters and the day's salt don't outlive the day.
  delete from public.sync_visitor_usage where day < current_date;
  delete from public.sync_visitor_salt where day < current_date;
end;
$$;


revoke all on function public.sync_visitor() from public, anon, authenticated;
revoke all on function public.sync_visitor_check(bytea, bigint) from public, anon, authenticated;
revoke all on function public.sync_visitor_charge(bytea, bigint, bigint) from public, anon, authenticated;
revoke all on function public.sync_housekeeping() from public, anon, authenticated;
