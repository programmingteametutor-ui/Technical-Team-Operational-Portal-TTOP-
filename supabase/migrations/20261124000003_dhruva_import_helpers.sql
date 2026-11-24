-- Helpers used by tools/SupabaseExport.gs (one-time copy from Google Sheets)

create table if not exists public.gs_export_log (
  project        text primary key,      -- portal | pune-call-tracker | ...
  script_id      text,
  spreadsheet_id text,
  web_app_url    text,                  -- used to route portal -> project bridge calls in-process
  property_count int,
  trigger_count  int,
  exported_at    timestamptz not null default now()
);
alter table public.gs_export_log enable row level security;
revoke all on public.gs_export_log from anon, authenticated;

create or replace function public.gs_export_workbook(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update gs_workbooks
     set title = coalesce(p ->> 'title', title),
         time_zone = coalesce(p ->> 'time_zone', time_zone),
         imported_at = now()
   where spreadsheet_id = p ->> 'spreadsheet_id';
  if not found then
    insert into gs_workbooks (spreadsheet_id, key, title, time_zone, imported_at)
    values (p ->> 'spreadsheet_id', p ->> 'spreadsheet_id', coalesce(p ->> 'title', 'Untitled'), coalesce(p ->> 'time_zone', 'Asia/Kolkata'), now());
  end if;
end $$;

-- Create (or reset) a tab before its rows are exported. Returns the sheet id.
create or replace function public.gs_export_sheet_begin(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_pk bigint;
begin
  select id into v_pk from gs_sheets
   where spreadsheet_id = p ->> 'spreadsheet_id' and name = p ->> 'name'
   order by id limit 1;
  if v_pk is null then
    insert into gs_sheets (spreadsheet_id, sheet_id, name, position, max_rows, max_cols, frozen_rows, frozen_cols, hidden)
    values (p ->> 'spreadsheet_id', (p ->> 'sheet_id')::bigint, p ->> 'name', (p ->> 'position')::int,
            (p ->> 'max_rows')::int, (p ->> 'max_cols')::int, (p ->> 'frozen_rows')::int, (p ->> 'frozen_cols')::int,
            (p ->> 'hidden')::boolean)
    returning id into v_pk;
  else
    update gs_sheets set sheet_id = (p ->> 'sheet_id')::bigint, position = (p ->> 'position')::int,
           max_rows = (p ->> 'max_rows')::int, max_cols = (p ->> 'max_cols')::int,
           frozen_rows = (p ->> 'frozen_rows')::int, frozen_cols = (p ->> 'frozen_cols')::int,
           hidden = (p ->> 'hidden')::boolean, updated_at = now()
     where id = v_pk;
    delete from gs_rows where sheet_pk = v_pk;
  end if;
  return v_pk;
end $$;

revoke execute on function public.gs_export_workbook(jsonb), public.gs_export_sheet_begin(jsonb) from public, anon, authenticated;
grant  execute on function public.gs_export_workbook(jsonb), public.gs_export_sheet_begin(jsonb) to service_role;
