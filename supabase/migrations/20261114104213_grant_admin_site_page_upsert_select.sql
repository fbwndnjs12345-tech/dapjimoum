grant select on public.site_pages to authenticated;
revoke select on public.site_pages from anon;
grant select (slug, title, body, updated_at) on public.site_pages to anon;