create table if not exists public.answer_link_search_rate_limits (
  bucket_start timestamptz primary key,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.reserve_answer_search_request(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_count integer;
  bucket timestamptz := date_trunc('minute', clock_timestamp());
begin
  insert into public.answer_link_search_rate_limits(bucket_start, request_count, updated_at)
  values (bucket, 1, now())
  on conflict (bucket_start) do update
    set request_count = public.answer_link_search_rate_limits.request_count + 1,
        updated_at = now()
    where public.answer_link_search_rate_limits.request_count < greatest(1, least(coalesce(p_limit, 30), 300))
  returning request_count into reserved_count;
  return reserved_count is not null;
end;
$$;

revoke all on function public.reserve_answer_search_request(integer) from public, anon, authenticated;
grant execute on function public.reserve_answer_search_request(integer) to service_role;

alter table public.answer_link_search_rate_limits enable row level security;
revoke all on public.answer_link_search_rate_limits from anon, authenticated;
