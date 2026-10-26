-- D-32: the check history of the Upwork Client Identifiability Checker.
-- Run once in the Supabase SQL editor (or with `supabase db push`). See README, "Results database".

-- One row per checked job and user. Failed checks are not stored.
create table public.job_checks (
  user_id           uuid        not null default auth.uid() references auth.users on delete cascade,
  job_id            text        not null check (job_id ~ '^~[a-z0-9]{8,}$'),
  checked_at        timestamptz not null default now(),
  job_title         text        not null,
  verdict           text        not null check (verdict in ('identified', 'partial', 'narrowable', 'not_identifiable')),
  best_value        text,
  s3_score          smallint    not null check (s3_score between 0 and 100),
  s3_details        jsonb       not null default '[]',
  client_company_id text,
  client_country    text,
  client_city       text,
  client_industry   text,
  client_size       text,
  client_since      smallint,
  evidence          jsonb       not null default '[]',
  known_person      text,
  known_company     text,
  known_website     text,
  primary key (user_id, job_id)
);

comment on table public.job_checks is 'Upwork Client Identifiability Checker: one row per checked job. Holds personal data (client names, review snippets).';
comment on column public.job_checks.evidence is 'Findings, best first: {source, kind, value, confidence, raised_from?, location, snippet?, mentions?}.';
comment on column public.job_checks.s3_details is 'S3 trust details: {attribute, value, points}.';

-- History list, newest first.
create index job_checks_recent on public.job_checks (user_id, checked_at desc);

-- Each signed-in user reads and writes only their own rows; the public anon key alone sees nothing.
alter table public.job_checks enable row level security;

create policy "Each user reads and writes only their own checks"
  on public.job_checks for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- FR-22: for one checked job, how many other clients in the user's history share its country, city,
-- industry, size and member-since year. A client is counted once (by company ID, else by job).
-- A count is null when the job has no value for that detail.
create function public.peer_counts(p_job_id text)
returns table (country bigint, city bigint, industry bigint, size bigint, member_since bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select coalesce(client_company_id, 'job:' || job_id) as client_key,
           lower(client_country) as country, lower(client_city) as city, lower(client_industry) as industry,
           lower(client_size) as size, client_since
    from public.job_checks
    where user_id = (select auth.uid()) and job_id = p_job_id
  ),
  others as (
    select coalesce(c.client_company_id, 'job:' || c.job_id) as client_key,
           lower(c.client_country) as country, lower(c.client_city) as city, lower(c.client_industry) as industry,
           lower(c.client_size) as size, c.client_since
    from public.job_checks c
    where c.user_id = (select auth.uid())
  )
  select
    case when me.country is null then null else count(distinct o.client_key) filter (where o.country = me.country) end,
    case when me.city is null then null else count(distinct o.client_key) filter (where o.city = me.city) end,
    case when me.industry is null then null else count(distinct o.client_key) filter (where o.industry = me.industry) end,
    case when me.size is null then null else count(distinct o.client_key) filter (where o.size = me.size) end,
    case when me.client_since is null then null else count(distinct o.client_key) filter (where o.client_since = me.client_since) end
  from me
  left join others o on o.client_key <> me.client_key
  group by me.client_key, me.country, me.city, me.industry, me.size, me.client_since;
$$;

revoke execute on function public.peer_counts(text) from public, anon;
grant execute on function public.peer_counts(text) to authenticated;
