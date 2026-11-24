-- =====================================================================
-- Dhruva on Vercel: safe with many server copies at once
--
-- Vercel runs several copies of the app. Each copy keeps a working copy of
-- Dhruva's data and must (1) see what other copies saved and (2) never
-- overwrite a change it has not seen. This adds:
--   gs_counter    one counter, taken by every saving transaction. Saves are
--                 numbered in commit order, so "everything after N" is exact.
--   seq columns   the save number that last touched each row / property /
--                 cache entry.
--   gs_cache      Dhruva's CacheService, shared by all copies.
--   gs_changes()  everything saved after a given number (one call per request).
--   gs_commit()   saves one action's changes atomically and refuses
--                 (GS_CONFLICT) if another copy changed the same rows first;
--                 the app then reloads and runs the action again.
-- Keeps all data. Safe to run again.
-- =====================================================================

create table if not exists public.gs_counter (id int primary key check (id = 1), v bigint not null);
insert into public.gs_counter values (1, 1) on conflict do nothing;

alter table public.gs_rows   add column if not exists seq bigint not null default 0;
alter table public.gs_sheets add column if not exists seq bigint not null default 0;
alter table public.gs_sheets add column if not exists sver bigint not null default 1;
alter table public.gs_script_properties add column if not exists seq bigint not null default 0;
alter table public.gs_script_properties alter column value drop not null;   -- null = deleted
create index if not exists gs_rows_seq on public.gs_rows (seq);
create index if not exists gs_props_seq on public.gs_script_properties (seq);

create table if not exists public.gs_cache (
  project    text not null,
  key        text not null,
  value      text,                      -- null = removed
  expires_at timestamptz not null,
  seq        bigint not null default 0,
  primary key (project, key)
);
create index if not exists gs_cache_seq on public.gs_cache (seq);
alter table public.gs_cache   enable row level security;
alter table public.gs_counter enable row level security;
revoke all on public.gs_cache, public.gs_counter from anon, authenticated;

-- The save number of the current transaction (taken once, held until commit)
create or replace function public.gs_tx_seq() returns bigint
language plpgsql set search_path = public as $$
declare c text := current_setting('gs.tx_seq', true); nv bigint;
begin
  if c is not null and c <> '' and current_setting('gs.tx_id', true) = txid_current()::text then return c::bigint; end if;
  update gs_counter g set v = g.v + 1 where g.id = 1 returning g.v into nv;
  perform set_config('gs.tx_seq', nv::text, true);
  perform set_config('gs.tx_id', txid_current()::text, true);
  return nv;
end $$;

create or replace function public.gs_stamp_seq() returns trigger
language plpgsql set search_path = public as $$
begin new.seq := public.gs_tx_seq(); return new; end $$;

drop trigger if exists t_gs_rows_seq on public.gs_rows;
create trigger t_gs_rows_seq before insert or update on public.gs_rows for each row execute function public.gs_stamp_seq();
drop trigger if exists t_gs_sheets_seq on public.gs_sheets;
create trigger t_gs_sheets_seq before insert or update on public.gs_sheets for each row execute function public.gs_stamp_seq();
drop trigger if exists t_gs_props_seq on public.gs_script_properties;
create trigger t_gs_props_seq before insert or update on public.gs_script_properties for each row execute function public.gs_stamp_seq();
drop trigger if exists t_gs_cache_seq on public.gs_cache;
create trigger t_gs_cache_seq before insert or update on public.gs_cache for each row execute function public.gs_stamp_seq();

-- A replaced tab gets a new structure version (other copies reload it whole)
create or replace function public.gs_sheet_replaced(p_pk bigint) returns void
language sql set search_path = public as $$ update gs_sheets set sver = sver + 1 where id = p_pk $$;

-- Existing save path (the exporter, older servers): a replace bumps sver too
create or replace function public.gs_save_sheet(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_pk bigint := nullif(p ->> 'sheet_pk', '')::bigint;
begin
  if v_pk is null then
    insert into gs_sheets (spreadsheet_id, sheet_id, name, position, max_rows, max_cols, frozen_rows, frozen_cols, hidden)
    values (p ->> 'spreadsheet_id', (p ->> 'sheet_id')::bigint, p ->> 'name', coalesce((p ->> 'position')::int, 0),
            coalesce((p ->> 'max_rows')::int, 1000), coalesce((p ->> 'max_cols')::int, 26),
            coalesce((p ->> 'frozen_rows')::int, 0), coalesce((p ->> 'frozen_cols')::int, 0), coalesce((p ->> 'hidden')::boolean, false))
    returning id into v_pk;
  else
    update gs_sheets set name = coalesce(p ->> 'name', name), position = coalesce((p ->> 'position')::int, position),
      max_rows = coalesce((p ->> 'max_rows')::int, max_rows), max_cols = coalesce((p ->> 'max_cols')::int, max_cols),
      frozen_rows = coalesce((p ->> 'frozen_rows')::int, frozen_rows), frozen_cols = coalesce((p ->> 'frozen_cols')::int, frozen_cols),
      hidden = coalesce((p ->> 'hidden')::boolean, hidden), updated_at = now()
    where id = v_pk;
    if not found then raise exception 'gs_save_sheet: sheet % not found', v_pk; end if;
  end if;
  if coalesce((p ->> 'replace')::boolean, false) then
    delete from gs_rows where sheet_pk = v_pk;
    perform gs_sheet_replaced(v_pk);
  end if;
  if jsonb_array_length(coalesce(p -> 'delete_rows', '[]'::jsonb)) > 0 then
    update gs_rows set v = '[]'::jsonb, f = null, d = null, x = null, updated_at = now()
     where sheet_pk = v_pk and row_num in (select (jsonb_array_elements_text(p -> 'delete_rows'))::int);
  end if;
  insert into gs_rows (sheet_pk, row_num, v, f, d, x, updated_at)
  select v_pk, (r ->> 'row_num')::int, coalesce(r -> 'v', '[]'::jsonb), nullif(r -> 'f', 'null'::jsonb),
         nullif(r -> 'd', 'null'::jsonb), nullif(r -> 'x', 'null'::jsonb), now()
  from jsonb_array_elements(coalesce(p -> 'rows', '[]'::jsonb)) r
  on conflict (sheet_pk, row_num) do update set v = excluded.v, f = excluded.f, d = excluded.d, x = excluded.x, updated_at = now();
  return v_pk;
end $$;

-- ---------------------------------------------------------------------
-- Everything saved after p_seq. Sheets: always the full list (it is small).
-- ---------------------------------------------------------------------
create or replace function public.gs_changes(p_seq bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (select v as max_seq from gs_counter where id = 1)
  select jsonb_build_object(
    'max_seq', (select max_seq from c),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('pk', s.id, 'spreadsheet_id', s.spreadsheet_id, 'sheet_id', s.sheet_id,
        'name', s.name, 'position', s.position, 'max_rows', s.max_rows, 'max_cols', s.max_cols, 'frozen_rows', s.frozen_rows,
        'frozen_cols', s.frozen_cols, 'hidden', s.hidden, 'sver', s.sver) order by s.spreadsheet_id, s.position) from gs_sheets s), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.sheet_pk, r.row_num, r.v, r.f, r.d, r.x, r.seq))
        from gs_rows r where r.seq > p_seq and r.seq <= (select max_seq from c)), '[]'::jsonb),
    'props', coalesce((select jsonb_agg(jsonb_build_array(p.project, p.key, p.value, p.seq))
        from gs_script_properties p where p.seq > p_seq and p.seq <= (select max_seq from c)), '[]'::jsonb),
    'cache', coalesce((select jsonb_agg(jsonb_build_array(k.project, k.key, k.value, extract(epoch from k.expires_at) * 1000, k.seq))
        from gs_cache k where k.seq > p_seq and k.seq <= (select max_seq from c) and k.expires_at > now()), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------
-- Save one action's changes atomically.
-- p = { force: bool,
--       sheets: [{ key, pk|null, spreadsheet_id, sheet_id, name, position, max_rows, max_cols, frozen_rows,
--                  frozen_cols, hidden, full: bool, expect_sver, rows: [{row_num, v, f, d, x, expect_seq|null}] }],
--       deleted: [pk], props: [{project, key, value|null, expect_seq|null}],
--       cache: [{project, key, value|null, expires_ms}] }
-- expect_seq null = "the row/property did not exist". Raises GS_CONFLICT when
-- another copy saved one of these rows/properties first (unless force).
-- ---------------------------------------------------------------------
create or replace function public.gs_commit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  force boolean := coalesce((p ->> 'force')::boolean, false);
  seq bigint := gs_tx_seq();            -- takes the counter: commits are numbered in order
  s jsonb; v_pk bigint; v_sver bigint; n int; want int;
  out_sheets jsonb := '[]'::jsonb;
begin
  for v_pk in select (jsonb_array_elements_text(coalesce(p -> 'deleted', '[]'::jsonb)))::bigint loop
    delete from gs_sheets where id = v_pk;
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p -> 'sheets', '[]'::jsonb)) loop
    v_pk := nullif(s ->> 'pk', '')::bigint;
    if v_pk is null then
      insert into gs_sheets (spreadsheet_id, sheet_id, name, position, max_rows, max_cols, frozen_rows, frozen_cols, hidden)
      values (s ->> 'spreadsheet_id', (s ->> 'sheet_id')::bigint, s ->> 'name', (s ->> 'position')::int, (s ->> 'max_rows')::int,
              (s ->> 'max_cols')::int, (s ->> 'frozen_rows')::int, (s ->> 'frozen_cols')::int, (s ->> 'hidden')::boolean)
      returning id into v_pk;
    else
      select sver into v_sver from gs_sheets where id = v_pk for update;
      if not found then
        if force then continue; end if;
        raise exception 'GS_CONFLICT: tab % was deleted', s ->> 'name';
      end if;
      if coalesce((s ->> 'full')::boolean, false) and not force and v_sver is distinct from (s ->> 'expect_sver')::bigint then
        raise exception 'GS_CONFLICT: tab % was changed', s ->> 'name';
      end if;
      update gs_sheets set name = s ->> 'name', position = (s ->> 'position')::int, max_rows = (s ->> 'max_rows')::int,
        max_cols = (s ->> 'max_cols')::int, frozen_rows = (s ->> 'frozen_rows')::int, frozen_cols = (s ->> 'frozen_cols')::int,
        hidden = (s ->> 'hidden')::boolean, updated_at = now()
      where id = v_pk;
    end if;

    if coalesce((s ->> 'full')::boolean, false) then
      delete from gs_rows where sheet_pk = v_pk;
      update gs_sheets set sver = sver + 1 where id = v_pk;
      insert into gs_rows (sheet_pk, row_num, v, f, d, x)
      select v_pk, (r ->> 'row_num')::int, coalesce(r -> 'v', '[]'::jsonb), nullif(r -> 'f', 'null'::jsonb), nullif(r -> 'd', 'null'::jsonb), nullif(r -> 'x', 'null'::jsonb)
      from jsonb_array_elements(coalesce(s -> 'rows', '[]'::jsonb)) r;
    elsif force then
      insert into gs_rows (sheet_pk, row_num, v, f, d, x, updated_at)
      select v_pk, (r ->> 'row_num')::int, coalesce(r -> 'v', '[]'::jsonb), nullif(r -> 'f', 'null'::jsonb), nullif(r -> 'd', 'null'::jsonb), nullif(r -> 'x', 'null'::jsonb), now()
      from jsonb_array_elements(coalesce(s -> 'rows', '[]'::jsonb)) r
      on conflict (sheet_pk, row_num) do update set v = excluded.v, f = excluded.f, d = excluded.d, x = excluded.x, updated_at = now();
    else
      -- rows that did not exist when the action read them
      select count(*) into want from jsonb_array_elements(coalesce(s -> 'rows', '[]'::jsonb)) r where r -> 'expect_seq' is null or r -> 'expect_seq' = 'null'::jsonb;
      insert into gs_rows (sheet_pk, row_num, v, f, d, x)
      select v_pk, (r ->> 'row_num')::int, coalesce(r -> 'v', '[]'::jsonb), nullif(r -> 'f', 'null'::jsonb), nullif(r -> 'd', 'null'::jsonb), nullif(r -> 'x', 'null'::jsonb)
      from jsonb_array_elements(coalesce(s -> 'rows', '[]'::jsonb)) r
      where r -> 'expect_seq' is null or r -> 'expect_seq' = 'null'::jsonb
      on conflict (sheet_pk, row_num) do nothing;
      get diagnostics n = row_count;
      if n <> want then raise exception 'GS_CONFLICT: rows were added to % by someone else', s ->> 'name'; end if;
      -- rows that existed: only if nobody saved them since
      select count(*) into want from jsonb_array_elements(coalesce(s -> 'rows', '[]'::jsonb)) r where jsonb_typeof(r -> 'expect_seq') = 'number';
      update gs_rows g set v = coalesce(r -> 'v', '[]'::jsonb), f = nullif(r -> 'f', 'null'::jsonb), d = nullif(r -> 'd', 'null'::jsonb),
             x = nullif(r -> 'x', 'null'::jsonb), updated_at = now()
        from jsonb_array_elements(coalesce(s -> 'rows', '[]'::jsonb)) r
       where jsonb_typeof(r -> 'expect_seq') = 'number' and g.sheet_pk = v_pk
         and g.row_num = (r ->> 'row_num')::int and g.seq = (r ->> 'expect_seq')::bigint;
      get diagnostics n = row_count;
      if n <> want then raise exception 'GS_CONFLICT: rows of % were changed by someone else', s ->> 'name'; end if;
    end if;
    select sver into v_sver from gs_sheets where id = v_pk;
    out_sheets := out_sheets || jsonb_build_array(jsonb_build_object('key', s ->> 'key', 'pk', v_pk, 'sver', v_sver));
  end loop;

  -- Script properties
  if force then
    insert into gs_script_properties (project, key, value, updated_at)
    select x ->> 'project', x ->> 'key', x ->> 'value', now() from jsonb_array_elements(coalesce(p -> 'props', '[]'::jsonb)) x
    on conflict (project, key) do update set value = excluded.value, updated_at = now();
  else
    select count(*) into want from jsonb_array_elements(coalesce(p -> 'props', '[]'::jsonb)) x where x -> 'expect_seq' is null or x -> 'expect_seq' = 'null'::jsonb;
    insert into gs_script_properties (project, key, value, updated_at)
    select x ->> 'project', x ->> 'key', x ->> 'value', now() from jsonb_array_elements(coalesce(p -> 'props', '[]'::jsonb)) x
     where x -> 'expect_seq' is null or x -> 'expect_seq' = 'null'::jsonb
    on conflict (project, key) do nothing;
    get diagnostics n = row_count;
    if n <> want then raise exception 'GS_CONFLICT: a setting was added by someone else'; end if;
    select count(*) into want from jsonb_array_elements(coalesce(p -> 'props', '[]'::jsonb)) x where jsonb_typeof(x -> 'expect_seq') = 'number';
    update gs_script_properties g set value = x ->> 'value', updated_at = now()
      from jsonb_array_elements(coalesce(p -> 'props', '[]'::jsonb)) x
     where jsonb_typeof(x -> 'expect_seq') = 'number' and g.project = x ->> 'project' and g.key = x ->> 'key' and g.seq = (x ->> 'expect_seq')::bigint;
    get diagnostics n = row_count;
    if n <> want then raise exception 'GS_CONFLICT: a setting was changed by someone else'; end if;
  end if;

  -- Cache (shared, last write wins)
  insert into gs_cache (project, key, value, expires_at)
  select x ->> 'project', x ->> 'key', x ->> 'value', to_timestamp((x ->> 'expires_ms')::double precision / 1000)
    from jsonb_array_elements(coalesce(p -> 'cache', '[]'::jsonb)) x
  on conflict (project, key) do update set value = excluded.value, expires_at = excluded.expires_at;
  if random() < 0.02 then delete from gs_cache where expires_at < now() - interval '1 day'; end if;

  return jsonb_build_object('seq', seq, 'sheets', out_sheets);
end $$;

revoke execute on function public.gs_commit(jsonb), public.gs_changes(bigint), public.gs_tx_seq(), public.gs_sheet_replaced(bigint) from public, anon, authenticated;
grant  execute on function public.gs_commit(jsonb), public.gs_changes(bigint) to service_role;

-- Number the existing data once (one save number for everything already there)
do $$
declare nv bigint;
begin
  if exists (select 1 from gs_rows where seq = 0) or exists (select 1 from gs_script_properties where seq = 0) then
    nv := gs_tx_seq();
    update gs_rows set seq = nv where seq = 0;
    update gs_sheets set seq = nv where seq = 0;
    update gs_script_properties set seq = nv where seq = 0;
  end if;
end $$;
