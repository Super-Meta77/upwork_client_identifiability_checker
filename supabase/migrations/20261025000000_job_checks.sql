-- D-32, D-33: the check history of the Upwork Client Identifiability Checker.
-- Run once in the Supabase SQL editor (or with `supabase db push`). See README, "Results database".

-- One row per checked job and user. Failed checks are not stored.
create table public.job_checks (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  job_id     text        not null check (job_id ~ '^~[a-z0-9]{8,}$'),
  checked_at timestamptz not null default now(),
  job_title  text        not null,
  verdict    text        not null check (verdict in ('has_potential', 'no_potential')),
  evidence   jsonb       not null default '[]',
  primary key (user_id, job_id)
);

comment on table public.job_checks is 'Upwork Client Identifiability Checker: one row per checked job. Holds personal data (client names, review snippets).';
comment on column public.job_checks.evidence is 'Findings, best first: {source, kind, value, confidence, raised_from?, location, snippet?, mentions?}.';

-- History list, newest first.
create index job_checks_recent on public.job_checks (user_id, checked_at desc);

-- Each signed-in user reads and writes only their own rows; the public anon key alone sees nothing.
alter table public.job_checks enable row level security;

create policy "Each user reads and writes only their own checks"
  on public.job_checks for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
