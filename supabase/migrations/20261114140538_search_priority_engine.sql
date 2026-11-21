create or replace function public.get_answer_link_search_priorities(p_include_books_with_links boolean default false)
returns table(book_id uuid, priority_score integer, priority_reasons jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $body$
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and not (select public.has_admin_permission('search.run')) then
    raise exception 'Search execution permission is required.' using errcode = '42501';
  end if;

  return query
  with link_stats as (
    select l.book_id,
      count(*)::integer as link_count,
      count(*) filter (where l.health_status in ('broken','redirected','invalid_pdf'))::integer as unhealthy_count
    from public.answer_links l
    group by l.book_id
  ),
  run_stats as (
    select b.id as book_id,
      max(r.started_at) as last_search_at,
      count(*) filter (where b.id = any(coalesce(r.failed_book_ids, '{}')))::integer as failed_runs
    from public.books b
    left join public.answer_link_search_runs r on b.id = any(r.book_ids)
    group by b.id
  ),
  queue_stats as (
    select q.book_id, max(q.priority)::integer as queued_priority,
      max(q.requested_count)::integer as request_count
    from public.answer_link_search_queue q
    where q.status in ('queued','running')
    group by q.book_id
  )
  select b.id,
    greatest(0, least(1000,
      (case when coalesce(ls.link_count,0) = 0 then 100 else 0 end)
      + coalesce(qs.queued_priority,0)
      + least(coalesce(rs.failed_runs,0) * 20, 100)
      + least(coalesce(qs.request_count,0) * 2, 200)
      + least(coalesce(extract(day from (now() - rs.last_search_at))::integer, 60), 60)
      + least(coalesce(ls.unhealthy_count,0) * 200, 400)
    ))::integer,
    jsonb_build_object(
      'no_answer_links', coalesce(ls.link_count,0) = 0,
      'queued_priority', coalesce(qs.queued_priority,0),
      'user_request_count', coalesce(qs.request_count,0),
      'failed_search_runs', coalesce(rs.failed_runs,0),
      'days_since_last_search', coalesce(extract(day from (now() - rs.last_search_at))::integer, 60),
      'unhealthy_link_count', coalesce(ls.unhealthy_count,0)
    )
  from public.books b
  left join link_stats ls on ls.book_id = b.id
  left join run_stats rs on rs.book_id = b.id
  left join queue_stats qs on qs.book_id = b.id
  where p_include_books_with_links
     or coalesce(ls.link_count,0) = 0
     or coalesce(ls.unhealthy_count,0) > 0
  order by 2 desc, b.created_at asc;
end;
$body$;

revoke all on function public.get_answer_link_search_priorities(boolean) from public, anon;
grant execute on function public.get_answer_link_search_priorities(boolean) to authenticated, service_role;
