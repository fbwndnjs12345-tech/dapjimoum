CREATE OR REPLACE FUNCTION public.get_public_answer_link_summary()
RETURNS TABLE(book_id uuid, link_count bigint, click_count bigint, verified_count bigint)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT
    links.book_id,
    count(*)::bigint AS link_count,
    coalesce(sum(links.click_count), 0)::bigint AS click_count,
    count(*) FILTER (WHERE links.verified IS TRUE)::bigint AS verified_count
  FROM public.answer_links AS links
  GROUP BY links.book_id;
$function$;

REVOKE ALL ON FUNCTION public.get_public_answer_link_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_answer_link_summary() TO anon, authenticated;
