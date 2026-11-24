-- =====================================================================
-- Dhruva Team Portal – Supabase storage
--
-- The portal's Apps Script logic addresses data by spreadsheet, tab, row
-- and column (e.g. "Source Row 13469", "Team Data Row 1642", date blocks in
-- Raw Data / Team Data / InterviewBot). To keep that logic unchanged, every
-- Google Sheet tab is stored row-by-row here, exactly as it was in Sheets.
--
-- Readable, column-named views for every header-based tab are created in
-- the next migration (…_views.sql) for reporting and direct SQL access.
--
-- All tables have RLS enabled with NO policies: only the server (service
-- role key) can read or write. Browsers never talk to Supabase directly;
-- they go through the portal server, which enforces the portal's own
-- OTP login and role checks exactly as before.
-- =====================================================================

create table if not exists public.gs_workbooks (
  spreadsheet_id text primary key,                -- original Google spreadsheet id (the code still uses these ids)
  key            text not null unique,            -- short name, e.g. pune_private_backend
  title          text not null,
  time_zone      text not null default 'Asia/Kolkata',
  imported_at    timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.gs_sheets (
  id             bigserial primary key,
  spreadsheet_id text not null references public.gs_workbooks(spreadsheet_id) on delete cascade,
  sheet_id       bigint not null,                 -- Google "gid"
  name           text not null,
  position       int  not null default 0,
  max_rows       int  not null default 1000,
  max_cols       int  not null default 26,
  frozen_rows    int  not null default 0,
  frozen_cols    int  not null default 0,
  hidden         boolean not null default false,
  meta           jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);
create index if not exists gs_sheets_wb_name on public.gs_sheets (spreadsheet_id, name);

-- One row per non-empty spreadsheet row.
--   v: cell values   (dates as {"$d": "<ISO timestamp>"})
--   f: number formats per cell ("@", "dd-MMM-yyyy", "₹#,##0", …) or null
--   d: display text captured at import (null once the row is edited)
--   x: formulas captured at import, informational only
create table if not exists public.gs_rows (
  sheet_pk   bigint not null references public.gs_sheets(id) on delete cascade,
  row_num    int    not null check (row_num >= 1),
  v          jsonb  not null default '[]'::jsonb,
  f          jsonb,
  d          jsonb,
  x          jsonb,
  updated_at timestamptz not null default now(),
  primary key (sheet_pk, row_num)
);

-- Apps Script "Script Properties" per project (bridge secrets, sessions,
-- team routing, roster caches, leave flags, …)
create table if not exists public.gs_script_properties (
  project    text not null,
  key        text not null,
  value      text not null,
  updated_at timestamptz not null default now(),
  primary key (project, key)
);

-- Installable triggers (edit triggers on Team Data, time-based triggers)
create table if not exists public.gs_triggers (
  id         text primary key,
  project    text not null,
  handler    text not null,
  event_type text not null,            -- ON_EDIT | CLOCK | ON_CHANGE | ON_OPEN
  source_id  text,                     -- spreadsheet id for spreadsheet triggers
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- Text of a stored cell: display text if captured, else the value
-- (dates rendered as Asia/Kolkata timestamps).
create or replace function public.gs_cell(v jsonb, d jsonb, i int)
returns text language sql immutable as $$
  select coalesce(
    nullif(d ->> i, ''),
    case
      when jsonb_typeof(v -> i) = 'object' and (v -> i) ? '$d'
        then to_char(((v -> i ->> '$d')::timestamptz at time zone 'Asia/Kolkata'), 'YYYY-MM-DD HH24:MI:SS')
      else v ->> i
    end,
    ''
  )
$$;

-- Raw typed value of a stored cell as jsonb (dates -> timestamptz text)
create or replace function public.gs_value(v jsonb, i int)
returns jsonb language sql immutable as $$
  select case
    when jsonb_typeof(v -> i) = 'object' and (v -> i) ? '$d' then to_jsonb((v -> i ->> '$d')::timestamptz)
    else v -> i
  end
$$;

-- Save one sheet's changes atomically (used by the portal server).
-- p = { spreadsheet_id, sheet_pk|null, sheet_id, name, position, max_rows, max_cols,
--       frozen_rows, frozen_cols, hidden, replace:boolean,
--       rows:[{row_num, v, f, d, x}], delete_rows:[int] }
-- returns the sheet's id.
create or replace function public.gs_save_sheet(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_pk bigint := nullif(p ->> 'sheet_pk', '')::bigint;
begin
  if v_pk is null then
    insert into gs_sheets (spreadsheet_id, sheet_id, name, position, max_rows, max_cols, frozen_rows, frozen_cols, hidden)
    values (p ->> 'spreadsheet_id', (p ->> 'sheet_id')::bigint, p ->> 'name', coalesce((p ->> 'position')::int, 0),
            coalesce((p ->> 'max_rows')::int, 1000), coalesce((p ->> 'max_cols')::int, 26),
            coalesce((p ->> 'frozen_rows')::int, 0), coalesce((p ->> 'frozen_cols')::int, 0),
            coalesce((p ->> 'hidden')::boolean, false))
    returning id into v_pk;
  else
    update gs_sheets set
      name = p ->> 'name',
      position = coalesce((p ->> 'position')::int, position),
      max_rows = coalesce((p ->> 'max_rows')::int, max_rows),
      max_cols = coalesce((p ->> 'max_cols')::int, max_cols),
      frozen_rows = coalesce((p ->> 'frozen_rows')::int, frozen_rows),
      frozen_cols = coalesce((p ->> 'frozen_cols')::int, frozen_cols),
      hidden = coalesce((p ->> 'hidden')::boolean, hidden),
      updated_at = now()
    where id = v_pk;
    if not found then
      raise exception 'gs_save_sheet: sheet % not found', v_pk;
    end if;
  end if;

  if coalesce((p ->> 'replace')::boolean, false) then
    delete from gs_rows where sheet_pk = v_pk;
  end if;

  if jsonb_array_length(coalesce(p -> 'delete_rows', '[]'::jsonb)) > 0 then
    delete from gs_rows
    where sheet_pk = v_pk
      and row_num in (select (jsonb_array_elements_text(p -> 'delete_rows'))::int);
  end if;

  insert into gs_rows (sheet_pk, row_num, v, f, d, x, updated_at)
  select v_pk, (r ->> 'row_num')::int,
         coalesce(r -> 'v', '[]'::jsonb),
         nullif(r -> 'f', 'null'::jsonb),
         nullif(r -> 'd', 'null'::jsonb),
         nullif(r -> 'x', 'null'::jsonb),
         now()
  from jsonb_array_elements(coalesce(p -> 'rows', '[]'::jsonb)) r
  on conflict (sheet_pk, row_num) do update
    set v = excluded.v, f = excluded.f, d = excluded.d, x = excluded.x, updated_at = now();

  return v_pk;
end $$;

create or replace function public.gs_delete_sheet(p_sheet_pk bigint)
returns void language sql security definer set search_path = public as $$
  delete from gs_sheets where id = p_sheet_pk;
$$;

create or replace function public.gs_replace_triggers(p_triggers jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from gs_triggers where true;
  insert into gs_triggers (id, project, handler, event_type, source_id, meta)
  select t ->> 'id', t ->> 'project', t ->> 'handler', t ->> 'event_type', t ->> 'source_id', coalesce(t -> 'meta', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_triggers, '[]'::jsonb)) t;
end $$;

-- ---------------------------------------------------------------------
-- Security: server-only access
-- ---------------------------------------------------------------------
alter table public.gs_workbooks         enable row level security;
alter table public.gs_sheets            enable row level security;
alter table public.gs_rows              enable row level security;
alter table public.gs_script_properties enable row level security;
alter table public.gs_triggers          enable row level security;

revoke all on public.gs_workbooks, public.gs_sheets, public.gs_rows, public.gs_script_properties, public.gs_triggers from anon, authenticated;
revoke execute on function public.gs_save_sheet(jsonb), public.gs_delete_sheet(bigint), public.gs_replace_triggers(jsonb) from public, anon, authenticated;
grant  execute on function public.gs_save_sheet(jsonb), public.gs_delete_sheet(bigint), public.gs_replace_triggers(jsonb) to service_role;

-- The six workbooks the portal uses (ids are the original Google ids the code references)
insert into public.gs_workbooks (spreadsheet_id, key, title) values
  ('1FD5pShmQaqszrcqi1UHXGlsJQBuKPnxJXKFvj7iwjus', 'portal_control',         'Interview Portal Control'),
  ('1BD_XIhQW6d4w4dnrcM17wYgv6hZqdx7mTsAIYgUOC7M', 'pune_call_tracker',      'Call Tracker'),
  ('1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4', 'pune_incentive_tracker', 'Incentive tracker'),
  ('1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk', 'pune_private_backend',   'Incentive Backend - Private'),
  ('1pDKLkZc4mCU7pcTWG-aYgovj7DJjF7C77292JyQ3zwU', 'hyd_incentive_tracker',  'HYD Incentive Tracker'),
  ('1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w', 'hyd_private_backend',    'HYD Incentive Backend - Private')
on conflict (spreadsheet_id) do nothing;
