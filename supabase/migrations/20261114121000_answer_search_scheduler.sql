-- Server-side answer search schedule.
-- The cron jobs remain harmless no-ops until both Vault secrets are configured:
-- dapjimoum_project_url and dapjimoum_service_role_key.

create schema if not exists net;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema net;

create schema if not exists private;
alter table public.answer_link_search_settings add column if not exists last_daily_run_on date;

create or replace function private.invoke_answer_search_edge(p_action text, p_run_id uuid default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  service_role_key text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets where name = 'dapjimoum_project_url' limit 1;
  select decrypted_secret into service_role_key
  from vault.decrypted_secrets where name = 'dapjimoum_service_role_key' limit 1;

  if coalesce(project_url, '') = '' or coalesce(service_role_key, '') = '' then
    update public.answer_link_search_settings
    set scheduler_configured = false,
        scheduler_last_error = 'Supabase Vault secrets are missing: dapjimoum_project_url / dapjimoum_service_role_key',
        scheduler_last_tick_at = now()
    where singleton = true;
    return null;
  end if;

  update public.answer_link_search_settings
  set scheduler_configured = true, scheduler_last_error = null, scheduler_last_tick_at = now()
  where singleton = true;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/answer-link-search',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', service_role_key,
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := case when p_run_id is null
      then jsonb_build_object('action', p_action)
      else jsonb_build_object('action', p_action, 'runId', p_run_id)
    end,
    timeout_milliseconds := 10000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_answer_search_edge(text, uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dapjimoum-answer-search-daily-kst') then
    perform cron.unschedule('dapjimoum-answer-search-daily-kst');
  end if;
  if exists (select 1 from cron.job where jobname = 'dapjimoum-answer-search-batch-worker') then
    perform cron.unschedule('dapjimoum-answer-search-batch-worker');
  end if;
  if exists (select 1 from cron.job where jobname = 'dapjimoum-answer-search-queue-worker') then
    perform cron.unschedule('dapjimoum-answer-search-queue-worker');
  end if;
end $$;

create or replace function private.maybe_start_daily_answer_search()
returns void
language plpgsql
security definer
set search_path = ''
as $
declare
  config public.answer_link_search_settings%rowtype;
  local_now timestamp;
  request_id bigint;
begin
  select * into config from public.answer_link_search_settings where singleton = true;
  if not found or not config.daily_enabled then return; end if;
  local_now := now() at time zone config.timezone;
  if local_now::date = config.last_daily_run_on then return; end if;
  if to_char(local_now::time, 'HH24:MI') <> to_char(config.daily_time, 'HH24:MI') then return; end if;
  request_id := private.invoke_answer_search_edge('scheduled_start', null);
  if request_id is not null then
    update public.answer_link_search_settings set last_daily_run_on = local_now::date where singleton = true;
  end if;
end;
$;
revoke all on function private.maybe_start_daily_answer_search() from public, anon, authenticated;

-- Check every minute; daily_time is interpreted in Asia/Seoul by default.
select cron.schedule(
  'dapjimoum-answer-search-daily-kst',
  '* * * * *',
  $ select private.maybe_start_daily_answer_search(); $
);

-- Each tick processes one server-side batch (3 books). No browser tab must remain open.
select cron.schedule(
  'dapjimoum-answer-search-batch-worker',
  '* * * * *',
  $$ select private.invoke_answer_search_edge(
       'batch',
       (select id from public.answer_link_search_runs where status = 'running' order by started_at asc limit 1)
     )
     where exists (select 1 from public.answer_link_search_runs where status = 'running'); $$
);

-- Newly created books and mapped user requests are queued and started when no run is active.
select cron.schedule(
  'dapjimoum-answer-search-queue-worker',
  '*/5 * * * *',
  $$ select private.invoke_answer_search_edge('scheduled_queue_start', null); $$
);


-- Keep run history for 30 days. Candidate review records survive with run_id = NULL,
-- and the separate audit table is intentionally not pruned by this job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'dapjimoum-answer-search-history-retention') then
    perform cron.unschedule('dapjimoum-answer-search-history-retention');
  end if;
end $$;

select cron.schedule(
  'dapjimoum-answer-search-history-retention',
  '0 19 * * *',
  $$ delete from public.answer_link_search_runs
     where started_at < now() - interval '30 days'
       and status in ('completed', 'failed', 'paused'); $$
);


create or replace function private.invoke_answer_health_edge()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  service_role_key text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets where name = 'dapjimoum_project_url' limit 1;
  select decrypted_secret into service_role_key
  from vault.decrypted_secrets where name = 'dapjimoum_service_role_key' limit 1;
  if coalesce(project_url, '') = '' or coalesce(service_role_key, '') = '' then
    update public.answer_link_search_settings
    set scheduler_configured = false,
        scheduler_last_error = 'Supabase Vault secrets are missing: dapjimoum_project_url / dapjimoum_service_role_key',
        scheduler_last_tick_at = now()
    where singleton = true;
    return null;
  end if;
  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/answer-link-health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', service_role_key,
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('limit', 50),
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function private.invoke_answer_health_edge() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dapjimoum-answer-link-health-check') then
    perform cron.unschedule('dapjimoum-answer-link-health-check');
  end if;
end $$;

-- Daily at 04:30 Korea time. Link failures are enqueued for replacement search.
select cron.schedule(
  'dapjimoum-answer-link-health-check',
  '30 19 * * *',
  $$ select private.invoke_answer_health_edge(); $$
);
