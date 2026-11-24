-- Readable views over the stored tabs (one per header-based Google Sheet tab).
-- Columns are text, taken from the tab's header row (row 1); row_num is the
-- original sheet row number. Generated from the live sheets on 2026-11-24.
-- Block-layout tabs (Raw Data, InterviewBot, …) are queried with
-- public.gs_rows_view (below) because they have no header row.

create or replace view public.gs_rows_view with (security_invoker = true) as
select w.key as workbook, s.name as tab, r.row_num,
       (select array_agg(public.gs_cell(r.v, r.d, i) order by i) from generate_series(0, greatest(jsonb_array_length(r.v), coalesce(jsonb_array_length(r.d),0)) - 1) i) as cells,
       r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk join public.gs_workbooks w on w.spreadsheet_id = s.spreadsheet_id;

create or replace view public."pune_call_tracker__nov25" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "s_no",
  public.gs_cell(r.v, r.d, 1) as "date",
  public.gs_cell(r.v, r.d, 2) as "name",
  public.gs_cell(r.v, r.d, 3) as "client_name",
  public.gs_cell(r.v, r.d, 4) as "call_feedback",
  public.gs_cell(r.v, r.d, 5) as "tool_drive",
  public.gs_cell(r.v, r.d, 6) as "supporter_in_call",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1BD_XIhQW6d4w4dnrcM17wYgv6hZqdx7mTsAIYgUOC7M' and s.name = 'Nov25' and r.row_num > 1;

create or replace view public."pune_call_tracker__portal_call_status" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "call_id",
  public.gs_cell(r.v, r.d, 1) as "working_date",
  public.gs_cell(r.v, r.d, 2) as "date_key",
  public.gs_cell(r.v, r.d, 3) as "source_row",
  public.gs_cell(r.v, r.d, 4) as "interview_text",
  public.gs_cell(r.v, r.d, 5) as "assigned_handler",
  public.gs_cell(r.v, r.d, 6) as "call_status",
  public.gs_cell(r.v, r.d, 7) as "updated_at_col",
  public.gs_cell(r.v, r.d, 8) as "updated_by",
  public.gs_cell(r.v, r.d, 9) as "actor_role",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1BD_XIhQW6d4w4dnrcM17wYgv6hZqdx7mTsAIYgUOC7M' and s.name = 'Portal Call Status' and r.row_num > 1;

create or replace view public."pune_call_tracker__dec25" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "s_no",
  public.gs_cell(r.v, r.d, 1) as "date",
  public.gs_cell(r.v, r.d, 2) as "name",
  public.gs_cell(r.v, r.d, 3) as "client_name",
  public.gs_cell(r.v, r.d, 4) as "call_feedback",
  public.gs_cell(r.v, r.d, 5) as "tool_drive",
  public.gs_cell(r.v, r.d, 6) as "supporter_in_call",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1BD_XIhQW6d4w4dnrcM17wYgv6hZqdx7mTsAIYgUOC7M' and s.name = 'Dec25' and r.row_num > 1;

create or replace view public."portal_control__candidate_master" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "candidate_id",
  public.gs_cell(r.v, r.d, 1) as "canonical_name",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1FD5pShmQaqszrcqi1UHXGlsJQBuKPnxJXKFvj7iwjus' and s.name = 'Candidate Master' and r.row_num > 1;

create or replace view public."portal_control__candidate_name_map" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "alias",
  public.gs_cell(r.v, r.d, 1) as "candidate_id",
  public.gs_cell(r.v, r.d, 2) as "canonical_name",
  public.gs_cell(r.v, r.d, 3) as "active",
  public.gs_cell(r.v, r.d, 4) as "added_by",
  public.gs_cell(r.v, r.d, 5) as "added_at",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1FD5pShmQaqszrcqi1UHXGlsJQBuKPnxJXKFvj7iwjus' and s.name = 'Candidate Name Map' and r.row_num > 1;

create or replace view public."portal_control__client_name_map" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "alias",
  public.gs_cell(r.v, r.d, 1) as "client_id",
  public.gs_cell(r.v, r.d, 2) as "canonical_client_name",
  public.gs_cell(r.v, r.d, 3) as "active",
  public.gs_cell(r.v, r.d, 4) as "added_by",
  public.gs_cell(r.v, r.d, 5) as "added_at",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1FD5pShmQaqszrcqi1UHXGlsJQBuKPnxJXKFvj7iwjus' and s.name = 'Client Name Map' and r.row_num > 1;

create or replace view public."portal_control__identity_mapping_audit" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "timestamp",
  public.gs_cell(r.v, r.d, 1) as "team",
  public.gs_cell(r.v, r.d, 2) as "call_id",
  public.gs_cell(r.v, r.d, 3) as "source_row",
  public.gs_cell(r.v, r.d, 4) as "entity_type",
  public.gs_cell(r.v, r.d, 5) as "original_value",
  public.gs_cell(r.v, r.d, 6) as "canonical_id",
  public.gs_cell(r.v, r.d, 7) as "canonical_value",
  public.gs_cell(r.v, r.d, 8) as "action",
  public.gs_cell(r.v, r.d, 9) as "actor_email",
  public.gs_cell(r.v, r.d, 10) as "notes",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1FD5pShmQaqszrcqi1UHXGlsJQBuKPnxJXKFvj7iwjus' and s.name = 'Identity Mapping Audit' and r.row_num > 1;

create or replace view public."portal_control__client_master" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "client_id",
  public.gs_cell(r.v, r.d, 1) as "canonical_client_name",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1FD5pShmQaqszrcqi1UHXGlsJQBuKPnxJXKFvj7iwjus' and s.name = 'Client Master' and r.row_num > 1;

create or replace view public."pune_private_backend__incentive_tracker" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "incentive_type",
  public.gs_cell(r.v, r.d, 1) as "candidate",
  public.gs_cell(r.v, r.d, 2) as "client",
  public.gs_cell(r.v, r.d, 3) as "from",
  public.gs_cell(r.v, r.d, 4) as "to",
  public.gs_cell(r.v, r.d, 5) as "previous_date",
  public.gs_cell(r.v, r.d, 6) as "promotion_date",
  public.gs_cell(r.v, r.d, 7) as "handler",
  public.gs_cell(r.v, r.d, 8) as "amount",
  public.gs_cell(r.v, r.d, 9) as "status",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Incentive Tracker' and r.row_num > 1;

create or replace view public."pune_private_backend__call_outcome_correction_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "call_id",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "date_key",
  public.gs_cell(r.v, r.d, 4) as "source_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "original_handler",
  public.gs_cell(r.v, r.d, 9) as "old_outcome",
  public.gs_cell(r.v, r.d, 10) as "requested_outcome",
  public.gs_cell(r.v, r.d, 11) as "request_status",
  public.gs_cell(r.v, r.d, 12) as "requested_at",
  public.gs_cell(r.v, r.d, 13) as "requested_by_email",
  public.gs_cell(r.v, r.d, 14) as "requested_by_handler",
  public.gs_cell(r.v, r.d, 15) as "reviewed_at",
  public.gs_cell(r.v, r.d, 16) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 17) as "review_note",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Call Outcome Correction Requests' and r.row_num > 1;

create or replace view public."pune_private_backend__portal_access_audit_log" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "timestamp",
  public.gs_cell(r.v, r.d, 1) as "actor_email",
  public.gs_cell(r.v, r.d, 2) as "role",
  public.gs_cell(r.v, r.d, 3) as "action",
  public.gs_cell(r.v, r.d, 4) as "target_type",
  public.gs_cell(r.v, r.d, 5) as "target_id",
  public.gs_cell(r.v, r.d, 6) as "old_value",
  public.gs_cell(r.v, r.d, 7) as "new_value",
  public.gs_cell(r.v, r.d, 8) as "handler",
  public.gs_cell(r.v, r.d, 9) as "details",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Portal Access Audit Log' and r.row_num > 1;

create or replace view public."pune_private_backend__hyd_call_sync_map" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "call_id",
  public.gs_cell(r.v, r.d, 1) as "date_key",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "call_tracker_row",
  public.gs_cell(r.v, r.d, 4) as "team_data_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "original_handler",
  public.gs_cell(r.v, r.d, 7) as "final_team_value",
  public.gs_cell(r.v, r.d, 8) as "outcome",
  public.gs_cell(r.v, r.d, 9) as "synced_at",
  public.gs_cell(r.v, r.d, 10) as "approved_by",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'HYD Call Sync Map' and r.row_num > 1;

create or replace view public."pune_private_backend__hyd_selection_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "requested_at",
  public.gs_cell(r.v, r.d, 2) as "requested_by_email",
  public.gs_cell(r.v, r.d, 3) as "handler",
  public.gs_cell(r.v, r.d, 4) as "team_row",
  public.gs_cell(r.v, r.d, 5) as "interview_date",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "round",
  public.gs_cell(r.v, r.d, 9) as "current_status",
  public.gs_cell(r.v, r.d, 10) as "requested_status",
  public.gs_cell(r.v, r.d, 11) as "request_status",
  public.gs_cell(r.v, r.d, 12) as "reviewed_at",
  public.gs_cell(r.v, r.d, 13) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 14) as "review_note",
  public.gs_cell(r.v, r.d, 15) as "original_interview_text",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'HYD Selection Requests' and r.row_num > 1;

create or replace view public."pune_private_backend__hyd_portal_action_log" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "timestamp",
  public.gs_cell(r.v, r.d, 1) as "actor_email",
  public.gs_cell(r.v, r.d, 2) as "role",
  public.gs_cell(r.v, r.d, 3) as "action",
  public.gs_cell(r.v, r.d, 4) as "target_type",
  public.gs_cell(r.v, r.d, 5) as "target_id",
  public.gs_cell(r.v, r.d, 6) as "old_value",
  public.gs_cell(r.v, r.d, 7) as "new_value",
  public.gs_cell(r.v, r.d, 8) as "handler",
  public.gs_cell(r.v, r.d, 9) as "details",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'HYD Portal Action Log' and r.row_num > 1;

create or replace view public."pune_private_backend__hyd_call_reassignment_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "call_id",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "date_key",
  public.gs_cell(r.v, r.d, 4) as "source_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "from_handler",
  public.gs_cell(r.v, r.d, 9) as "to_handler",
  public.gs_cell(r.v, r.d, 10) as "request_status",
  public.gs_cell(r.v, r.d, 11) as "requested_at",
  public.gs_cell(r.v, r.d, 12) as "requested_by_email",
  public.gs_cell(r.v, r.d, 13) as "reviewed_at",
  public.gs_cell(r.v, r.d, 14) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 15) as "review_note",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'HYD Call Reassignment Requests' and r.row_num > 1;

create or replace view public."pune_private_backend__hyd_call_outcome_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "call_id",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "date_key",
  public.gs_cell(r.v, r.d, 4) as "source_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "duration",
  public.gs_cell(r.v, r.d, 9) as "original_handler",
  public.gs_cell(r.v, r.d, 10) as "requested_outcome",
  public.gs_cell(r.v, r.d, 11) as "request_status",
  public.gs_cell(r.v, r.d, 12) as "submitted_at",
  public.gs_cell(r.v, r.d, 13) as "submitted_by_email",
  public.gs_cell(r.v, r.d, 14) as "submitted_by_handler",
  public.gs_cell(r.v, r.d, 15) as "reviewed_at",
  public.gs_cell(r.v, r.d, 16) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 17) as "review_note",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'HYD Call Outcome Requests' and r.row_num > 1;

create or replace view public."pune_private_backend__v2_technical_support_master" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "technical_support_id",
  public.gs_cell(r.v, r.d, 1) as "technical_support_name",
  public.gs_cell(r.v, r.d, 2) as "home_team_id",
  public.gs_cell(r.v, r.d, 3) as "developer_capability",
  public.gs_cell(r.v, r.d, 4) as "screen_operator_capability",
  public.gs_cell(r.v, r.d, 5) as "active",
  public.gs_cell(r.v, r.d, 6) as "notes",
  public.gs_cell(r.v, r.d, 7) as "email",
  public.gs_cell(r.v, r.d, 8) as "legacy_developer_id",
  public.gs_cell(r.v, r.d, 9) as "legacy_operator_id",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'V2 Technical Support Master' and r.row_num > 1;

create or replace view public."pune_private_backend__v2_user_roles" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "user_role_id",
  public.gs_cell(r.v, r.d, 1) as "user_id",
  public.gs_cell(r.v, r.d, 2) as "email",
  public.gs_cell(r.v, r.d, 3) as "role",
  public.gs_cell(r.v, r.d, 4) as "team_id",
  public.gs_cell(r.v, r.d, 5) as "resource_id",
  public.gs_cell(r.v, r.d, 6) as "active",
  public.gs_cell(r.v, r.d, 7) as "notes",
  public.gs_cell(r.v, r.d, 8) as "created_at",
  public.gs_cell(r.v, r.d, 9) as "updated_at_col",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'V2 User Roles' and r.row_num > 1;

create or replace view public."pune_private_backend__v2_team_master" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "team_id",
  public.gs_cell(r.v, r.d, 1) as "team_name",
  public.gs_cell(r.v, r.d, 2) as "support_mode",
  public.gs_cell(r.v, r.d, 3) as "active",
  public.gs_cell(r.v, r.d, 4) as "notes",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'V2 Team Master' and r.row_num > 1;

create or replace view public."pune_private_backend__v2_user_access" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "user_id",
  public.gs_cell(r.v, r.d, 1) as "email",
  public.gs_cell(r.v, r.d, 2) as "official_name",
  public.gs_cell(r.v, r.d, 3) as "role",
  public.gs_cell(r.v, r.d, 4) as "primary_team_id",
  public.gs_cell(r.v, r.d, 5) as "handler_id",
  public.gs_cell(r.v, r.d, 6) as "support_id",
  public.gs_cell(r.v, r.d, 7) as "active",
  public.gs_cell(r.v, r.d, 8) as "notes",
  public.gs_cell(r.v, r.d, 9) as "developer_id",
  public.gs_cell(r.v, r.d, 10) as "operator_id",
  public.gs_cell(r.v, r.d, 11) as "technical_support_id",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'V2 User Access' and r.row_num > 1;

create or replace view public."pune_private_backend__v2_handler_master" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "handler_id",
  public.gs_cell(r.v, r.d, 1) as "handler_name",
  public.gs_cell(r.v, r.d, 2) as "team_id",
  public.gs_cell(r.v, r.d, 3) as "active",
  public.gs_cell(r.v, r.d, 4) as "night_eligible",
  public.gs_cell(r.v, r.d, 5) as "shift_start",
  public.gs_cell(r.v, r.d, 6) as "shift_end",
  public.gs_cell(r.v, r.d, 7) as "notes",
  public.gs_cell(r.v, r.d, 8) as "email",
  public.gs_cell(r.v, r.d, 9) as "aliases",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'V2 Handler Master' and r.row_num > 1;

create or replace view public."pune_private_backend__v2_setup_support_master" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "support_id",
  public.gs_cell(r.v, r.d, 1) as "support_name",
  public.gs_cell(r.v, r.d, 2) as "team_scope",
  public.gs_cell(r.v, r.d, 3) as "active",
  public.gs_cell(r.v, r.d, 4) as "night_eligible",
  public.gs_cell(r.v, r.d, 5) as "notes",
  public.gs_cell(r.v, r.d, 6) as "email",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'V2 Setup Support Master' and r.row_num > 1;

create or replace view public."pune_private_backend__v2_developer_master" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "developer_id",
  public.gs_cell(r.v, r.d, 1) as "developer_name",
  public.gs_cell(r.v, r.d, 2) as "active",
  public.gs_cell(r.v, r.d, 3) as "notes",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'V2 Developer Master' and r.row_num > 1;

create or replace view public."pune_private_backend__v2_screen_operator_master" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "operator_id",
  public.gs_cell(r.v, r.d, 1) as "operator_name",
  public.gs_cell(r.v, r.d, 2) as "active",
  public.gs_cell(r.v, r.d, 3) as "notes",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'V2 Screen Operator Master' and r.row_num > 1;

create or replace view public."pune_private_backend__call_sync_map" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "call_id",
  public.gs_cell(r.v, r.d, 1) as "date_key",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "call_tracker_row",
  public.gs_cell(r.v, r.d, 4) as "team_data_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "original_handler",
  public.gs_cell(r.v, r.d, 7) as "final_team_value",
  public.gs_cell(r.v, r.d, 8) as "outcome",
  public.gs_cell(r.v, r.d, 9) as "synced_at",
  public.gs_cell(r.v, r.d, 10) as "approved_by",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Call Sync Map' and r.row_num > 1;

create or replace view public."pune_private_backend__call_outcome_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "call_id",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "date_key",
  public.gs_cell(r.v, r.d, 4) as "source_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "duration",
  public.gs_cell(r.v, r.d, 9) as "original_handler",
  public.gs_cell(r.v, r.d, 10) as "requested_outcome",
  public.gs_cell(r.v, r.d, 11) as "request_status",
  public.gs_cell(r.v, r.d, 12) as "submitted_at",
  public.gs_cell(r.v, r.d, 13) as "submitted_by_email",
  public.gs_cell(r.v, r.d, 14) as "submitted_by_handler",
  public.gs_cell(r.v, r.d, 15) as "reviewed_at",
  public.gs_cell(r.v, r.d, 16) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 17) as "review_note",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Call Outcome Requests' and r.row_num > 1;

create or replace view public."pune_private_backend__call_reassignment_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "call_id",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "date_key",
  public.gs_cell(r.v, r.d, 4) as "source_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "from_handler",
  public.gs_cell(r.v, r.d, 9) as "to_handler",
  public.gs_cell(r.v, r.d, 10) as "request_status",
  public.gs_cell(r.v, r.d, 11) as "requested_at",
  public.gs_cell(r.v, r.d, 12) as "requested_by_email",
  public.gs_cell(r.v, r.d, 13) as "reviewed_at",
  public.gs_cell(r.v, r.d, 14) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 15) as "review_note",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Call Reassignment Requests' and r.row_num > 1;

create or replace view public."pune_private_backend__portal_action_log" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "timestamp",
  public.gs_cell(r.v, r.d, 1) as "actor_email",
  public.gs_cell(r.v, r.d, 2) as "role",
  public.gs_cell(r.v, r.d, 3) as "action",
  public.gs_cell(r.v, r.d, 4) as "target_type",
  public.gs_cell(r.v, r.d, 5) as "target_id",
  public.gs_cell(r.v, r.d, 6) as "old_value",
  public.gs_cell(r.v, r.d, 7) as "new_value",
  public.gs_cell(r.v, r.d, 8) as "handler",
  public.gs_cell(r.v, r.d, 9) as "details",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Portal Action Log' and r.row_num > 1;

create or replace view public."pune_private_backend__selection_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "requested_at",
  public.gs_cell(r.v, r.d, 2) as "requested_by_email",
  public.gs_cell(r.v, r.d, 3) as "handler",
  public.gs_cell(r.v, r.d, 4) as "team_row",
  public.gs_cell(r.v, r.d, 5) as "interview_date",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "round",
  public.gs_cell(r.v, r.d, 9) as "current_status",
  public.gs_cell(r.v, r.d, 10) as "requested_status",
  public.gs_cell(r.v, r.d, 11) as "request_status",
  public.gs_cell(r.v, r.d, 12) as "reviewed_at",
  public.gs_cell(r.v, r.d, 13) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 14) as "review_note",
  public.gs_cell(r.v, r.d, 15) as "original_interview_text",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Selection Requests' and r.row_num > 1;

create or replace view public."pune_private_backend__portal_users" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "email",
  public.gs_cell(r.v, r.d, 1) as "handler",
  public.gs_cell(r.v, r.d, 2) as "role",
  public.gs_cell(r.v, r.d, 3) as "active",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Portal Users' and r.row_num > 1;

create or replace view public."pune_private_backend__monthly_incentive_summary" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "month",
  public.gs_cell(r.v, r.d, 1) as "handler",
  public.gs_cell(r.v, r.d, 2) as "promotion",
  public.gs_cell(r.v, r.d, 3) as "selection",
  public.gs_cell(r.v, r.d, 4) as "total",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Monthly Incentive Summary' and r.row_num > 1;

create or replace view public."pune_private_backend__settings" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "from_round",
  public.gs_cell(r.v, r.d, 1) as "to_round",
  public.gs_cell(r.v, r.d, 2) as "incentive",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Settings' and r.row_num > 1;

create or replace view public."pune_private_backend__portal_access" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "handler",
  public.gs_cell(r.v, r.d, 1) as "email",
  public.gs_cell(r.v, r.d, 2) as "role",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Portal Access' and r.row_num > 1;

create or replace view public."pune_private_backend__promotion_history" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "candidate",
  public.gs_cell(r.v, r.d, 1) as "client",
  public.gs_cell(r.v, r.d, 2) as "previous_round",
  public.gs_cell(r.v, r.d, 3) as "promotion_round",
  public.gs_cell(r.v, r.d, 4) as "previous_date",
  public.gs_cell(r.v, r.d, 5) as "promotion_date",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Promotion History' and r.row_num > 1;

create or replace view public."pune_private_backend__promotion_recovery" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "recovery_id",
  public.gs_cell(r.v, r.d, 1) as "candidate",
  public.gs_cell(r.v, r.d, 2) as "previous_round",
  public.gs_cell(r.v, r.d, 3) as "current_round",
  public.gs_cell(r.v, r.d, 4) as "team_client",
  public.gs_cell(r.v, r.d, 5) as "raw_client",
  public.gs_cell(r.v, r.d, 6) as "team_date",
  public.gs_cell(r.v, r.d, 7) as "promotion_date",
  public.gs_cell(r.v, r.d, 8) as "candidate_pct",
  public.gs_cell(r.v, r.d, 9) as "client_pct",
  public.gs_cell(r.v, r.d, 10) as "confidence",
  public.gs_cell(r.v, r.d, 11) as "suggested_handler",
  public.gs_cell(r.v, r.d, 12) as "amount",
  public.gs_cell(r.v, r.d, 13) as "status",
  public.gs_cell(r.v, r.d, 14) as "match_reason",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Promotion Recovery' and r.row_num > 1;

create or replace view public."pune_private_backend__recovery_evidence" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "evidence_id",
  public.gs_cell(r.v, r.d, 1) as "type",
  public.gs_cell(r.v, r.d, 2) as "team_candidate",
  public.gs_cell(r.v, r.d, 3) as "raw_candidate",
  public.gs_cell(r.v, r.d, 4) as "team_client",
  public.gs_cell(r.v, r.d, 5) as "raw_client",
  public.gs_cell(r.v, r.d, 6) as "previous_team_round",
  public.gs_cell(r.v, r.d, 7) as "current_raw_round",
  public.gs_cell(r.v, r.d, 8) as "team_date",
  public.gs_cell(r.v, r.d, 9) as "promotion_date",
  public.gs_cell(r.v, r.d, 10) as "previous_team_original_text",
  public.gs_cell(r.v, r.d, 11) as "previous_team_handler",
  public.gs_cell(r.v, r.d, 12) as "previous_team_status",
  public.gs_cell(r.v, r.d, 13) as "previous_team_source",
  public.gs_cell(r.v, r.d, 14) as "current_raw_original_text",
  public.gs_cell(r.v, r.d, 15) as "current_raw_source",
  public.gs_cell(r.v, r.d, 16) as "current_team_original_text",
  public.gs_cell(r.v, r.d, 17) as "current_team_handler",
  public.gs_cell(r.v, r.d, 18) as "current_team_status",
  public.gs_cell(r.v, r.d, 19) as "current_team_source",
  public.gs_cell(r.v, r.d, 20) as "candidate_pct",
  public.gs_cell(r.v, r.d, 21) as "client_pct",
  public.gs_cell(r.v, r.d, 22) as "confidence",
  public.gs_cell(r.v, r.d, 23) as "issue_match_reason",
  public.gs_cell(r.v, r.d, 24) as "review_status",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Recovery Evidence' and r.row_num > 1;

create or replace view public."pune_private_backend__possible_matches" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "type",
  public.gs_cell(r.v, r.d, 1) as "official",
  public.gs_cell(r.v, r.d, 2) as "alias",
  public.gs_cell(r.v, r.d, 3) as "candidate",
  public.gs_cell(r.v, r.d, 4) as "confidence",
  public.gs_cell(r.v, r.d, 5) as "action",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Possible Matches' and r.row_num > 1;

create or replace view public."pune_private_backend__incentive_summary" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "month",
  public.gs_cell(r.v, r.d, 1) as "handler",
  public.gs_cell(r.v, r.d, 2) as "promotion",
  public.gs_cell(r.v, r.d, 3) as "selection",
  public.gs_cell(r.v, r.d, 4) as "total",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Incentive Summary' and r.row_num > 1;

create or replace view public."pune_private_backend__recovery_applied_log" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "recovery_id",
  public.gs_cell(r.v, r.d, 1) as "applied_date",
  public.gs_cell(r.v, r.d, 2) as "result",
  public.gs_cell(r.v, r.d, 3) as "candidate",
  public.gs_cell(r.v, r.d, 4) as "client",
  public.gs_cell(r.v, r.d, 5) as "from",
  public.gs_cell(r.v, r.d, 6) as "to",
  public.gs_cell(r.v, r.d, 7) as "handler",
  public.gs_cell(r.v, r.d, 8) as "amount",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Recovery Applied Log' and r.row_num > 1;

create or replace view public."pune_private_backend__recovery_exceptions" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "exception_id",
  public.gs_cell(r.v, r.d, 1) as "candidate",
  public.gs_cell(r.v, r.d, 2) as "raw_client",
  public.gs_cell(r.v, r.d, 3) as "raw_round",
  public.gs_cell(r.v, r.d, 4) as "promotion_date",
  public.gs_cell(r.v, r.d, 5) as "possible_team_candidate",
  public.gs_cell(r.v, r.d, 6) as "team_client",
  public.gs_cell(r.v, r.d, 7) as "team_round",
  public.gs_cell(r.v, r.d, 8) as "team_date",
  public.gs_cell(r.v, r.d, 9) as "suggested_handler_s",
  public.gs_cell(r.v, r.d, 10) as "candidate_pct",
  public.gs_cell(r.v, r.d, 11) as "client_pct",
  public.gs_cell(r.v, r.d, 12) as "issue_type",
  public.gs_cell(r.v, r.d, 13) as "reason",
  public.gs_cell(r.v, r.d, 14) as "status",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk' and s.name = 'Recovery Exceptions' and r.row_num > 1;

create or replace view public."pune_incentive_tracker__team_data" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "date",
  public.gs_cell(r.v, r.d, 1) as "interview_details",
  public.gs_cell(r.v, r.d, 2) as "handler",
  public.gs_cell(r.v, r.d, 3) as "status",
  public.gs_cell(r.v, r.d, 4) as "confirm_date_of_selection",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4' and s.name = 'Team Data' and r.row_num > 1;

create or replace view public."hyd_private_backend__hyd_call_outcome_correction_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "call_id",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "date_key",
  public.gs_cell(r.v, r.d, 4) as "source_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "original_handler",
  public.gs_cell(r.v, r.d, 9) as "old_outcome",
  public.gs_cell(r.v, r.d, 10) as "requested_outcome",
  public.gs_cell(r.v, r.d, 11) as "request_status",
  public.gs_cell(r.v, r.d, 12) as "requested_at",
  public.gs_cell(r.v, r.d, 13) as "requested_by_email",
  public.gs_cell(r.v, r.d, 14) as "requested_by_handler",
  public.gs_cell(r.v, r.d, 15) as "reviewed_at",
  public.gs_cell(r.v, r.d, 16) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 17) as "review_note",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'HYD Call Outcome Correction Requests' and r.row_num > 1;

create or replace view public."hyd_private_backend__selection_reversal_log" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "reversed_at",
  public.gs_cell(r.v, r.d, 1) as "incentive_type",
  public.gs_cell(r.v, r.d, 2) as "candidate",
  public.gs_cell(r.v, r.d, 3) as "client",
  public.gs_cell(r.v, r.d, 4) as "from",
  public.gs_cell(r.v, r.d, 5) as "to",
  public.gs_cell(r.v, r.d, 6) as "previous_date",
  public.gs_cell(r.v, r.d, 7) as "promotion_date",
  public.gs_cell(r.v, r.d, 8) as "handler",
  public.gs_cell(r.v, r.d, 9) as "amount",
  public.gs_cell(r.v, r.d, 10) as "original_status",
  public.gs_cell(r.v, r.d, 11) as "team_row",
  public.gs_cell(r.v, r.d, 12) as "new_team_status",
  public.gs_cell(r.v, r.d, 13) as "reason",
  public.gs_cell(r.v, r.d, 14) as "source_interview",
  public.gs_cell(r.v, r.d, 15) as "mode",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Selection Reversal Log' and r.row_num > 1;

create or replace view public."hyd_private_backend__hyd_call_outcome_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "call_id",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "date_key",
  public.gs_cell(r.v, r.d, 4) as "source_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "duration",
  public.gs_cell(r.v, r.d, 9) as "original_handler",
  public.gs_cell(r.v, r.d, 10) as "requested_outcome",
  public.gs_cell(r.v, r.d, 11) as "request_status",
  public.gs_cell(r.v, r.d, 12) as "submitted_at",
  public.gs_cell(r.v, r.d, 13) as "submitted_by_email",
  public.gs_cell(r.v, r.d, 14) as "submitted_by_handler",
  public.gs_cell(r.v, r.d, 15) as "reviewed_at",
  public.gs_cell(r.v, r.d, 16) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 17) as "review_note",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'HYD Call Outcome Requests' and r.row_num > 1;

create or replace view public."hyd_private_backend__hyd_call_sync_map" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "call_id",
  public.gs_cell(r.v, r.d, 1) as "date_key",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "call_tracker_row",
  public.gs_cell(r.v, r.d, 4) as "team_data_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "original_handler",
  public.gs_cell(r.v, r.d, 7) as "final_team_value",
  public.gs_cell(r.v, r.d, 8) as "outcome",
  public.gs_cell(r.v, r.d, 9) as "synced_at",
  public.gs_cell(r.v, r.d, 10) as "approved_by",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'HYD Call Sync Map' and r.row_num > 1;

create or replace view public."hyd_private_backend__hyd_selection_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "requested_at",
  public.gs_cell(r.v, r.d, 2) as "requested_by_email",
  public.gs_cell(r.v, r.d, 3) as "handler",
  public.gs_cell(r.v, r.d, 4) as "team_row",
  public.gs_cell(r.v, r.d, 5) as "interview_date",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "round",
  public.gs_cell(r.v, r.d, 9) as "current_status",
  public.gs_cell(r.v, r.d, 10) as "requested_status",
  public.gs_cell(r.v, r.d, 11) as "request_status",
  public.gs_cell(r.v, r.d, 12) as "reviewed_at",
  public.gs_cell(r.v, r.d, 13) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 14) as "review_note",
  public.gs_cell(r.v, r.d, 15) as "original_interview_text",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'HYD Selection Requests' and r.row_num > 1;

create or replace view public."hyd_private_backend__hyd_portal_action_log" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "timestamp",
  public.gs_cell(r.v, r.d, 1) as "actor_email",
  public.gs_cell(r.v, r.d, 2) as "role",
  public.gs_cell(r.v, r.d, 3) as "action",
  public.gs_cell(r.v, r.d, 4) as "target_type",
  public.gs_cell(r.v, r.d, 5) as "target_id",
  public.gs_cell(r.v, r.d, 6) as "old_value",
  public.gs_cell(r.v, r.d, 7) as "new_value",
  public.gs_cell(r.v, r.d, 8) as "handler",
  public.gs_cell(r.v, r.d, 9) as "details",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'HYD Portal Action Log' and r.row_num > 1;

create or replace view public."hyd_private_backend__hyd_call_reassignment_requests" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "request_id",
  public.gs_cell(r.v, r.d, 1) as "call_id",
  public.gs_cell(r.v, r.d, 2) as "working_date",
  public.gs_cell(r.v, r.d, 3) as "date_key",
  public.gs_cell(r.v, r.d, 4) as "source_row",
  public.gs_cell(r.v, r.d, 5) as "interview_text",
  public.gs_cell(r.v, r.d, 6) as "candidate",
  public.gs_cell(r.v, r.d, 7) as "client",
  public.gs_cell(r.v, r.d, 8) as "from_handler",
  public.gs_cell(r.v, r.d, 9) as "to_handler",
  public.gs_cell(r.v, r.d, 10) as "request_status",
  public.gs_cell(r.v, r.d, 11) as "requested_at",
  public.gs_cell(r.v, r.d, 12) as "requested_by_email",
  public.gs_cell(r.v, r.d, 13) as "reviewed_at",
  public.gs_cell(r.v, r.d, 14) as "reviewed_by_email",
  public.gs_cell(r.v, r.d, 15) as "review_note",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'HYD Call Reassignment Requests' and r.row_num > 1;

create or replace view public."hyd_private_backend__incentive_tracker" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "incentive_type",
  public.gs_cell(r.v, r.d, 1) as "candidate",
  public.gs_cell(r.v, r.d, 2) as "client",
  public.gs_cell(r.v, r.d, 3) as "from",
  public.gs_cell(r.v, r.d, 4) as "to",
  public.gs_cell(r.v, r.d, 5) as "previous_date",
  public.gs_cell(r.v, r.d, 6) as "promotion_date",
  public.gs_cell(r.v, r.d, 7) as "handler",
  public.gs_cell(r.v, r.d, 8) as "amount",
  public.gs_cell(r.v, r.d, 9) as "status",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Incentive Tracker' and r.row_num > 1;

create or replace view public."hyd_private_backend__promotion_history" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "candidate",
  public.gs_cell(r.v, r.d, 1) as "client",
  public.gs_cell(r.v, r.d, 2) as "previous_round",
  public.gs_cell(r.v, r.d, 3) as "promotion_round",
  public.gs_cell(r.v, r.d, 4) as "previous_date",
  public.gs_cell(r.v, r.d, 5) as "promotion_date",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Promotion History' and r.row_num > 1;

create or replace view public."hyd_private_backend__incentive_summary" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "month",
  public.gs_cell(r.v, r.d, 1) as "handler",
  public.gs_cell(r.v, r.d, 2) as "promotion",
  public.gs_cell(r.v, r.d, 3) as "selection",
  public.gs_cell(r.v, r.d, 4) as "total",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Incentive Summary' and r.row_num > 1;

create or replace view public."hyd_private_backend__monthly_incentive_summary" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "month",
  public.gs_cell(r.v, r.d, 1) as "handler",
  public.gs_cell(r.v, r.d, 2) as "promotion",
  public.gs_cell(r.v, r.d, 3) as "selection",
  public.gs_cell(r.v, r.d, 4) as "total",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Monthly Incentive Summary' and r.row_num > 1;

create or replace view public."hyd_private_backend__client_alias" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "alias",
  public.gs_cell(r.v, r.d, 1) as "official",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Client Alias' and r.row_num > 1;

create or replace view public."hyd_private_backend__candidate_alias" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "alias",
  public.gs_cell(r.v, r.d, 1) as "official",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Candidate Alias' and r.row_num > 1;

create or replace view public."hyd_private_backend__promotion_recovery" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "recovery_id",
  public.gs_cell(r.v, r.d, 1) as "candidate",
  public.gs_cell(r.v, r.d, 2) as "previous_round",
  public.gs_cell(r.v, r.d, 3) as "current_round",
  public.gs_cell(r.v, r.d, 4) as "team_client",
  public.gs_cell(r.v, r.d, 5) as "raw_client",
  public.gs_cell(r.v, r.d, 6) as "team_date",
  public.gs_cell(r.v, r.d, 7) as "promotion_date",
  public.gs_cell(r.v, r.d, 8) as "candidate_pct",
  public.gs_cell(r.v, r.d, 9) as "client_pct",
  public.gs_cell(r.v, r.d, 10) as "confidence",
  public.gs_cell(r.v, r.d, 11) as "suggested_handler",
  public.gs_cell(r.v, r.d, 12) as "amount",
  public.gs_cell(r.v, r.d, 13) as "status",
  public.gs_cell(r.v, r.d, 14) as "match_reason",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Promotion Recovery' and r.row_num > 1;

create or replace view public."hyd_private_backend__recovery_exceptions" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "exception_id",
  public.gs_cell(r.v, r.d, 1) as "candidate",
  public.gs_cell(r.v, r.d, 2) as "raw_client",
  public.gs_cell(r.v, r.d, 3) as "raw_round",
  public.gs_cell(r.v, r.d, 4) as "promotion_date",
  public.gs_cell(r.v, r.d, 5) as "possible_team_candidate",
  public.gs_cell(r.v, r.d, 6) as "team_client",
  public.gs_cell(r.v, r.d, 7) as "team_round",
  public.gs_cell(r.v, r.d, 8) as "team_date",
  public.gs_cell(r.v, r.d, 9) as "suggested_handler_s",
  public.gs_cell(r.v, r.d, 10) as "candidate_pct",
  public.gs_cell(r.v, r.d, 11) as "client_pct",
  public.gs_cell(r.v, r.d, 12) as "issue_type",
  public.gs_cell(r.v, r.d, 13) as "reason",
  public.gs_cell(r.v, r.d, 14) as "status",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Recovery Exceptions' and r.row_num > 1;

create or replace view public."hyd_private_backend__recovery_evidence" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "evidence_id",
  public.gs_cell(r.v, r.d, 1) as "type",
  public.gs_cell(r.v, r.d, 2) as "team_candidate",
  public.gs_cell(r.v, r.d, 3) as "raw_candidate",
  public.gs_cell(r.v, r.d, 4) as "team_client",
  public.gs_cell(r.v, r.d, 5) as "raw_client",
  public.gs_cell(r.v, r.d, 6) as "previous_team_round",
  public.gs_cell(r.v, r.d, 7) as "current_raw_round",
  public.gs_cell(r.v, r.d, 8) as "team_date",
  public.gs_cell(r.v, r.d, 9) as "promotion_date",
  public.gs_cell(r.v, r.d, 10) as "previous_team_original_text",
  public.gs_cell(r.v, r.d, 11) as "previous_team_handler",
  public.gs_cell(r.v, r.d, 12) as "previous_team_status",
  public.gs_cell(r.v, r.d, 13) as "previous_team_source",
  public.gs_cell(r.v, r.d, 14) as "current_raw_original_text",
  public.gs_cell(r.v, r.d, 15) as "current_raw_source",
  public.gs_cell(r.v, r.d, 16) as "current_team_original_text",
  public.gs_cell(r.v, r.d, 17) as "current_team_handler",
  public.gs_cell(r.v, r.d, 18) as "current_team_status",
  public.gs_cell(r.v, r.d, 19) as "current_team_source",
  public.gs_cell(r.v, r.d, 20) as "candidate_pct",
  public.gs_cell(r.v, r.d, 21) as "client_pct",
  public.gs_cell(r.v, r.d, 22) as "confidence",
  public.gs_cell(r.v, r.d, 23) as "issue_match_reason",
  public.gs_cell(r.v, r.d, 24) as "review_status",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Recovery Evidence' and r.row_num > 1;

create or replace view public."hyd_private_backend__recovery_applied_log" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "recovery_id",
  public.gs_cell(r.v, r.d, 1) as "applied_date",
  public.gs_cell(r.v, r.d, 2) as "result",
  public.gs_cell(r.v, r.d, 3) as "candidate",
  public.gs_cell(r.v, r.d, 4) as "client",
  public.gs_cell(r.v, r.d, 5) as "from",
  public.gs_cell(r.v, r.d, 6) as "to",
  public.gs_cell(r.v, r.d, 7) as "handler",
  public.gs_cell(r.v, r.d, 8) as "amount",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w' and s.name = 'Recovery Applied Log' and r.row_num > 1;

create or replace view public."hyd_incentive_tracker__portal_call_status" with (security_invoker = true) as
select r.row_num,
  public.gs_cell(r.v, r.d, 0) as "call_id",
  public.gs_cell(r.v, r.d, 1) as "working_date",
  public.gs_cell(r.v, r.d, 2) as "date_key",
  public.gs_cell(r.v, r.d, 3) as "source_row",
  public.gs_cell(r.v, r.d, 4) as "interview_text",
  public.gs_cell(r.v, r.d, 5) as "assigned_handler",
  public.gs_cell(r.v, r.d, 6) as "call_status",
  public.gs_cell(r.v, r.d, 7) as "updated_at_col",
  public.gs_cell(r.v, r.d, 8) as "updated_by",
  public.gs_cell(r.v, r.d, 9) as "actor_role",
  r.updated_at
from public.gs_rows r join public.gs_sheets s on s.id = r.sheet_pk
where s.spreadsheet_id = '1pDKLkZc4mCU7pcTWG-aYgovj7DJjF7C77292JyQ3zwU' and s.name = 'Portal Call Status' and r.row_num > 1;

-- views are for the service role / SQL editor only
revoke all on public.gs_rows_view from anon, authenticated;
revoke all on public."pune_call_tracker__nov25" from anon, authenticated;
revoke all on public."pune_call_tracker__portal_call_status" from anon, authenticated;
revoke all on public."pune_call_tracker__dec25" from anon, authenticated;
revoke all on public."portal_control__candidate_master" from anon, authenticated;
revoke all on public."portal_control__candidate_name_map" from anon, authenticated;
revoke all on public."portal_control__client_name_map" from anon, authenticated;
revoke all on public."portal_control__identity_mapping_audit" from anon, authenticated;
revoke all on public."portal_control__client_master" from anon, authenticated;
revoke all on public."pune_private_backend__incentive_tracker" from anon, authenticated;
revoke all on public."pune_private_backend__call_outcome_correction_requests" from anon, authenticated;
revoke all on public."pune_private_backend__portal_access_audit_log" from anon, authenticated;
revoke all on public."pune_private_backend__hyd_call_sync_map" from anon, authenticated;
revoke all on public."pune_private_backend__hyd_selection_requests" from anon, authenticated;
revoke all on public."pune_private_backend__hyd_portal_action_log" from anon, authenticated;
revoke all on public."pune_private_backend__hyd_call_reassignment_requests" from anon, authenticated;
revoke all on public."pune_private_backend__hyd_call_outcome_requests" from anon, authenticated;
revoke all on public."pune_private_backend__v2_technical_support_master" from anon, authenticated;
revoke all on public."pune_private_backend__v2_user_roles" from anon, authenticated;
revoke all on public."pune_private_backend__v2_team_master" from anon, authenticated;
revoke all on public."pune_private_backend__v2_user_access" from anon, authenticated;
revoke all on public."pune_private_backend__v2_handler_master" from anon, authenticated;
revoke all on public."pune_private_backend__v2_setup_support_master" from anon, authenticated;
revoke all on public."pune_private_backend__v2_developer_master" from anon, authenticated;
revoke all on public."pune_private_backend__v2_screen_operator_master" from anon, authenticated;
revoke all on public."pune_private_backend__call_sync_map" from anon, authenticated;
revoke all on public."pune_private_backend__call_outcome_requests" from anon, authenticated;
revoke all on public."pune_private_backend__call_reassignment_requests" from anon, authenticated;
revoke all on public."pune_private_backend__portal_action_log" from anon, authenticated;
revoke all on public."pune_private_backend__selection_requests" from anon, authenticated;
revoke all on public."pune_private_backend__portal_users" from anon, authenticated;
revoke all on public."pune_private_backend__monthly_incentive_summary" from anon, authenticated;
revoke all on public."pune_private_backend__settings" from anon, authenticated;
revoke all on public."pune_private_backend__portal_access" from anon, authenticated;
revoke all on public."pune_private_backend__promotion_history" from anon, authenticated;
revoke all on public."pune_private_backend__promotion_recovery" from anon, authenticated;
revoke all on public."pune_private_backend__recovery_evidence" from anon, authenticated;
revoke all on public."pune_private_backend__possible_matches" from anon, authenticated;
revoke all on public."pune_private_backend__incentive_summary" from anon, authenticated;
revoke all on public."pune_private_backend__recovery_applied_log" from anon, authenticated;
revoke all on public."pune_private_backend__recovery_exceptions" from anon, authenticated;
revoke all on public."pune_incentive_tracker__team_data" from anon, authenticated;
revoke all on public."hyd_private_backend__hyd_call_outcome_correction_requests" from anon, authenticated;
revoke all on public."hyd_private_backend__selection_reversal_log" from anon, authenticated;
revoke all on public."hyd_private_backend__hyd_call_outcome_requests" from anon, authenticated;
revoke all on public."hyd_private_backend__hyd_call_sync_map" from anon, authenticated;
revoke all on public."hyd_private_backend__hyd_selection_requests" from anon, authenticated;
revoke all on public."hyd_private_backend__hyd_portal_action_log" from anon, authenticated;
revoke all on public."hyd_private_backend__hyd_call_reassignment_requests" from anon, authenticated;
revoke all on public."hyd_private_backend__incentive_tracker" from anon, authenticated;
revoke all on public."hyd_private_backend__promotion_history" from anon, authenticated;
revoke all on public."hyd_private_backend__incentive_summary" from anon, authenticated;
revoke all on public."hyd_private_backend__monthly_incentive_summary" from anon, authenticated;
revoke all on public."hyd_private_backend__client_alias" from anon, authenticated;
revoke all on public."hyd_private_backend__candidate_alias" from anon, authenticated;
revoke all on public."hyd_private_backend__promotion_recovery" from anon, authenticated;
revoke all on public."hyd_private_backend__recovery_exceptions" from anon, authenticated;
revoke all on public."hyd_private_backend__recovery_evidence" from anon, authenticated;
revoke all on public."hyd_private_backend__recovery_applied_log" from anon, authenticated;
revoke all on public."hyd_incentive_tracker__portal_call_status" from anon, authenticated;
