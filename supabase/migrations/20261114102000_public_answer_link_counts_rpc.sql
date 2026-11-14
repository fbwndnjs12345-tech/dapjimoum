create or replace function public.get_public_answer_link_counts()
returns table(book_id uuid, link_count bigint, click_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select links.book_id, count(*)::bigint, coalesce(sum(links.click_count), 0)::bigint
  from public.answer_links as links
  group by links.book_id;
$$;
revoke all on function public.get_public_answer_link_counts() from public;
grant execute on function public.get_public_answer_link_counts() to anon, authenticated;
