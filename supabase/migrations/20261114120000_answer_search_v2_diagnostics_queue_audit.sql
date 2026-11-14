-- Non-destructive V2 search diagnostics, scheduling configuration, queue and audit foundation.
-- Existing books, links, runs, candidates, submissions and admin identities are not rewritten.

alter table public.answer_link_search_runs
  add column if not exists terminal_reason text,
  add column if not exists trigger_source text not null default 'manual',
  add column if not exists priority integer not null default 50,
  add column if not exists scheduled_for timestamptz,
  add column if not exists completed_with_warnings boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'answer_link_search_runs_terminal_reason_check') then
    alter table public.answer_link_search_runs
      add constraint answer_link_search_runs_terminal_reason_check
      check (terminal_reason is null or terminal_reason in (
        'found_candidates', 'no_search_results', 'all_filtered', 'provider_failures',
        'partial_provider_failure', 'book_failures', 'cancelled', 'unknown_legacy'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'answer_link_search_runs_trigger_source_check') then
    alter table public.answer_link_search_runs
      add constraint answer_link_search_runs_trigger_source_check
      check (trigger_source in ('manual', 'daily_schedule', 'new_book', 'user_request', 'link_health', 'retry'));
  end if;
end $$;

-- Preserve candidate review rows when 30-day run history is pruned.
alter table public.answer_link_candidates drop constraint if exists answer_link_candidates_run_id_fkey;
alter table public.answer_link_candidates add constraint answer_link_candidates_run_id_fkey foreign key (run_id) references public.answer_link_search_runs(id) on delete set null;

create table if not exists public.answer_link_search_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.answer_link_search_runs(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  provider_mode text not null check (provider_mode in ('naver', 'kakao', 'web', 'combined')),
  query text not null,
  status text not null check (status in ('succeeded', 'partial', 'no_results', 'failed', 'filtered_all')),
  providers_attempted text[] not null default '{}',
  providers_with_results text[] not null default '{}',
  result_count integer not null default 0 check (result_count >= 0),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  filtered_count integer not null default 0 check (filtered_count >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  warnings jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

create index if not exists answer_link_search_attempts_run_idx
  on public.answer_link_search_attempts(run_id, started_at desc);
create index if not exists answer_link_search_attempts_book_idx
  on public.answer_link_search_attempts(book_id, started_at desc);
create index if not exists answer_link_search_attempts_status_idx
  on public.answer_link_search_attempts(status, started_at desc);

create table if not exists public.answer_link_search_queue (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  reason text not null check (reason in ('new_book', 'user_request', 'link_health', 'manual')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  priority integer not null default 50 check (priority between 0 and 1000),
  requested_count integer not null default 0 check (requested_count >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  run_id uuid references public.answer_link_search_runs(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error text
);

create unique index if not exists answer_link_search_queue_one_active_book
  on public.answer_link_search_queue(book_id)
  where status in ('queued', 'running');
create index if not exists answer_link_search_queue_priority_idx
  on public.answer_link_search_queue(status, priority desc, available_at asc);

create table if not exists public.admin_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_events_created_at_idx
  on public.admin_audit_events(created_at desc);
create index if not exists admin_audit_events_actor_idx
  on public.admin_audit_events(actor_user_id, created_at desc);
create index if not exists admin_audit_events_entity_idx
  on public.admin_audit_events(entity_type, entity_id, created_at desc);

create table if not exists public.answer_link_search_settings (
  singleton boolean primary key default true check (singleton),
  daily_enabled boolean not null default true,
  daily_time time not null default time '06:00',
  timezone text not null default 'Asia/Seoul',
  provider_mode text not null default 'combined' check (provider_mode in ('naver', 'kakao', 'web', 'combined')),
  max_concurrency integer not null default 1 check (max_concurrency between 1 and 5),
  requests_per_minute integer not null default 30 check (requests_per_minute between 1 and 300),
  retry_limit integer not null default 2 check (retry_limit between 0 and 5),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.answer_link_search_settings(singleton) values (true)
on conflict (singleton) do nothing;

alter table public.answer_link_search_attempts enable row level security;
alter table public.answer_link_search_queue enable row level security;
alter table public.admin_audit_events enable row level security;
alter table public.answer_link_search_settings enable row level security;

grant select on public.answer_link_search_attempts to authenticated;
grant select, update on public.answer_link_search_queue to authenticated;
grant select on public.admin_audit_events to authenticated;
grant select, update on public.answer_link_search_settings to authenticated;

drop policy if exists "Admins can read search attempts" on public.answer_link_search_attempts;
create policy "Admins can read search attempts"
  on public.answer_link_search_attempts for select to authenticated
  using ((select public.is_admin_user()));

drop policy if exists "Admins can read search queue" on public.answer_link_search_queue;
create policy "Admins can read search queue"
  on public.answer_link_search_queue for select to authenticated
  using ((select public.is_admin_user()));
drop policy if exists "Admins can update search queue" on public.answer_link_search_queue;
create policy "Admins can update search queue"
  on public.answer_link_search_queue for update to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

drop policy if exists "Admins can read audit events" on public.admin_audit_events;
create policy "Admins can read audit events"
  on public.admin_audit_events for select to authenticated
  using ((select public.is_admin_user()));

drop policy if exists "Admins can read search settings" on public.answer_link_search_settings;
create policy "Admins can read search settings"
  on public.answer_link_search_settings for select to authenticated
  using ((select public.is_admin_user()));
drop policy if exists "Admins can update search settings" on public.answer_link_search_settings;
create policy "Admins can update search settings"
  on public.answer_link_search_settings for update to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

create or replace function public.capture_admin_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  before_json jsonb;
  after_json jsonb;
  entity_key text;
  event_action text;
begin
  if tg_op = 'INSERT' then
    before_json := null;
    after_json := to_jsonb(new);
    event_action := 'insert';
  elsif tg_op = 'UPDATE' then
    before_json := to_jsonb(old);
    after_json := to_jsonb(new);
    event_action := 'update';
  else
    before_json := to_jsonb(old);
    after_json := null;
    event_action := 'delete';
  end if;

  if actor is null and tg_table_name not in ('answer_link_candidates', 'answer_links') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if actor is not null and not (select public.is_admin_user()) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  entity_key := coalesce(
    after_json ->> 'id', before_json ->> 'id',
    after_json ->> 'slug', before_json ->> 'slug',
    after_json ->> 'user_id', before_json ->> 'user_id',
    'unknown'
  );

  -- Keep the audit payload deliberately small; never copy user-submitted details or secrets.
  if tg_table_name = 'answer_link_candidates' then
    before_json := case when before_json is null then null else jsonb_build_object('status', before_json -> 'status', 'book_id', before_json -> 'book_id', 'url_identity', before_json -> 'url_identity') end;
    after_json := case when after_json is null then null else jsonb_build_object('status', after_json -> 'status', 'book_id', after_json -> 'book_id', 'url_identity', after_json -> 'url_identity') end;
  elsif tg_table_name = 'answer_links' then
    before_json := case when before_json is null then null else jsonb_build_object('book_id', before_json -> 'book_id', 'url', before_json -> 'url', 'verified', before_json -> 'verified') end;
    after_json := case when after_json is null then null else jsonb_build_object('book_id', after_json -> 'book_id', 'url', after_json -> 'url', 'verified', after_json -> 'verified') end;
  elsif tg_table_name = 'user_submissions' then
    before_json := case when before_json is null then null else jsonb_build_object('status', before_json -> 'status', 'submission_type', before_json -> 'submission_type') end;
    after_json := case when after_json is null then null else jsonb_build_object('status', after_json -> 'status', 'submission_type', after_json -> 'submission_type') end;
  elsif tg_table_name = 'books' then
    before_json := case when before_json is null then null else jsonb_build_object('title', before_json -> 'title', 'publisher', before_json -> 'publisher') end;
    after_json := case when after_json is null then null else jsonb_build_object('title', after_json -> 'title', 'publisher', after_json -> 'publisher') end;
  else
    before_json := case when before_json is null then null else jsonb_build_object('slug', before_json -> 'slug') end;
    after_json := case when after_json is null then null else jsonb_build_object('slug', after_json -> 'slug') end;
  end if;

  insert into public.admin_audit_events(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (actor, event_action, tg_table_name, entity_key, before_json, after_json);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists audit_answer_link_candidates on public.answer_link_candidates;
create trigger audit_answer_link_candidates after insert or update or delete on public.answer_link_candidates
for each row execute function public.capture_admin_audit_event();
drop trigger if exists audit_answer_links on public.answer_links;
create trigger audit_answer_links after insert or update or delete on public.answer_links
for each row execute function public.capture_admin_audit_event();
drop trigger if exists audit_books on public.books;
create trigger audit_books after insert or update or delete on public.books
for each row execute function public.capture_admin_audit_event();
drop trigger if exists audit_user_submissions on public.user_submissions;
create trigger audit_user_submissions after update or delete on public.user_submissions
for each row execute function public.capture_admin_audit_event();
drop trigger if exists audit_site_pages on public.site_pages;
create trigger audit_site_pages after insert or update or delete on public.site_pages
for each row execute function public.capture_admin_audit_event();
drop trigger if exists audit_admin_users on public.admin_users;
create trigger audit_admin_users after insert or update or delete on public.admin_users
for each row execute function public.capture_admin_audit_event();

create or replace function public.enqueue_answer_search_for_book()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.answer_link_search_queue as queue(book_id, reason, priority)
  values (new.id, 'new_book', 100)
  on conflict (book_id) where status in ('queued', 'running')
  do update set priority = greatest(queue.priority, excluded.priority),
                updated_at = now();
  return new;
end;
$$;
drop trigger if exists enqueue_new_book_for_answer_search on public.books;
create trigger enqueue_new_book_for_answer_search after insert on public.books
for each row execute function public.enqueue_answer_search_for_book();

create or replace function public.enqueue_answer_search_for_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_book_id uuid;
begin
  if new.submission_type = 'book_request' then
    select id into target_book_id from public.books
    where lower(btrim(title)) = lower(btrim(new.book_title))
    order by created_at desc limit 1;
  elsif new.submission_type = 'link_report' and new.answer_link_id is not null then
    select book_id into target_book_id from public.answer_links where id = new.answer_link_id;
  end if;

  if target_book_id is not null then
    insert into public.answer_link_search_queue as queue(book_id, reason, priority, requested_count, requested_by)
    values (target_book_id, 'user_request', 150, 1, new.submitted_by)
    on conflict (book_id) where status in ('queued', 'running')
    do update set requested_count = queue.requested_count + 1,
                  priority = greatest(queue.priority, 150),
                  updated_at = now();
  end if;
  return new;
end;
$$;
drop trigger if exists enqueue_answer_search_for_user_submission on public.user_submissions;
create trigger enqueue_answer_search_for_user_submission after insert on public.user_submissions
for each row execute function public.enqueue_answer_search_for_submission();

create or replace function public.set_answer_search_run_terminal_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_results bigint;
  total_filtered bigint;
  failed_attempts bigint;
begin
  if new.status = 'completed' and old.status is distinct from new.status and new.terminal_reason is null then
    select coalesce(sum(result_count), 0), coalesce(sum(filtered_count), 0),
           count(*) filter (where status = 'failed')
      into total_results, total_filtered, failed_attempts
    from public.answer_link_search_attempts where run_id = new.id;

    update public.answer_link_search_runs
    set terminal_reason = case
      when new.candidate_count > 0 and (new.error_count > 0 or failed_attempts > 0) then 'partial_provider_failure'
      when new.candidate_count > 0 then 'found_candidates'
      when failed_attempts > 0 and total_results = 0 then 'provider_failures'
      when total_results > 0 and total_filtered > 0 then 'all_filtered'
      when total_results = 0 then 'no_search_results'
      else 'unknown_legacy'
    end,
    completed_with_warnings = (new.error_count > 0 or failed_attempts > 0)
    where id = new.id and terminal_reason is null;
  end if;
  return new;
end;
$$;
drop trigger if exists answer_search_run_terminal_reason on public.answer_link_search_runs;
create trigger answer_search_run_terminal_reason after update of status on public.answer_link_search_runs
for each row execute function public.set_answer_search_run_terminal_reason();

create index if not exists site_pages_updated_by_idx on public.site_pages(updated_by);


create or replace function public.finish_answer_search_queue_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'failed') and old.status is distinct from new.status then
    update public.answer_link_search_queue q
    set status = case
          when not (q.book_id = any(coalesce(new.failed_book_ids, '{}'))) then 'completed'
          when q.retry_count < coalesce((select retry_limit from public.answer_link_search_settings where singleton = true), 2) then 'queued'
          else 'failed'
        end,
        available_at = case
          when q.book_id = any(coalesce(new.failed_book_ids, '{}')))
            and q.retry_count < coalesce((select retry_limit from public.answer_link_search_settings where singleton = true), 2)
          then now() + make_interval(mins => (5 * power(2, q.retry_count))::integer)
          else q.available_at
        end,
        retry_count = case
          when q.book_id = any(coalesce(new.failed_book_ids, '{}')))
            and q.retry_count < coalesce((select retry_limit from public.answer_link_search_settings where singleton = true), 2)
          then q.retry_count + 1 else q.retry_count
        end,
        run_id = case when q.book_id = any(coalesce(new.failed_book_ids, '{}')) then null else q.run_id end,
        last_error = case when q.book_id = any(coalesce(new.failed_book_ids, '{}')) then left(coalesce(new.last_error, '교재별 검색 실패'), 1000) else null end,
        updated_at = now()
    where q.run_id = new.id and q.status = 'running';
  end if;
  return new;
end;
$$;
drop trigger if exists finish_answer_search_queue_items on public.answer_link_search_runs;
create trigger finish_answer_search_queue_items after update of status on public.answer_link_search_runs
for each row execute function public.finish_answer_search_queue_items();

alter table public.answer_link_search_settings
  add column if not exists scheduler_last_tick_at timestamptz,
  add column if not exists scheduler_last_error text,
  add column if not exists scheduler_configured boolean not null default false;
