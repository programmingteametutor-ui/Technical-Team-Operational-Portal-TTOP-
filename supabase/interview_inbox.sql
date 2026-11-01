-- =====================================================================
-- TTOP Portal: Interview Inbox (interviews from recruiter emails)
-- Run once in Supabase > SQL Editor. Safe on the live database: it only ADDS columns, an index and 3 tables.
-- No data is changed or deleted. (The recruiter-email MySQL database is never written to.)
-- =====================================================================

-- 1. Where an interview came from (set only when it is added from the Interview Inbox)
alter table public.interviews
  add column if not exists source_account_id bigint,      -- recruiter DB accounts.id (the mailbox)
  add column if not exists source_thread_id  text,        -- Gmail thread id
  add column if not exists source_message_id bigint;      -- recruiter_messages.id used to fill the form

-- One interview per email thread. A rescheduled copy of it (rescheduled_from set) is allowed.
create unique index if not exists interviews_source_thread_uq
  on public.interviews (source_account_id, source_thread_id)
  where source_thread_id is not null and rescheduled_from is null;

-- 2. Threads someone dismissed (Undo removes the row)
create table if not exists public.interview_inbox_dismissed (
  thread_key    text primary key,                         -- "<account_id>.<gmail_thread_id>"
  account_id    bigint not null,
  thread_id     text not null,
  dismissed_by  text,
  dismissed_at  timestamptz not null default now()
);

-- 3. Extracted fields per thread (re-extracted only when a new email arrives in the thread)
create table if not exists public.interview_inbox_threads (
  thread_key      text primary key,
  account_id      bigint not null,
  thread_id       text not null,
  sig             text not null,                          -- extractor version : email count : newest id
  last_at         timestamptz not null,                   -- newest email in the thread
  last_message_id bigint not null,
  stage           text,                                   -- INTERVIEW / SCHEDULING (newest email)
  student_email   text,
  mailbox         text,
  n               int not null default 0,
  fields          jsonb not null default '{}'::jsonb,
  extracted_at    timestamptz not null default now()
);
create index if not exists interview_inbox_threads_student on public.interview_inbox_threads (student_email);

-- 4. Small key/value state (first message id on/after the start date, so MySQL reads stay fast)
create table if not exists public.interview_inbox_state (key text primary key, value text, updated_at timestamptz not null default now());

-- Only the server (service role) uses these tables: RLS on, no policies for browsers.
alter table public.interview_inbox_dismissed enable row level security;
alter table public.interview_inbox_threads   enable row level security;
alter table public.interview_inbox_state     enable row level security;
revoke all on public.interview_inbox_dismissed, public.interview_inbox_threads, public.interview_inbox_state from anon, authenticated;

-- Check: 3 new columns on interviews and 3 new tables
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'interviews' and column_name like 'source\_%' order by 1;
select table_name from information_schema.tables where table_schema = 'public' and table_name like 'interview_inbox%' order by 1;
