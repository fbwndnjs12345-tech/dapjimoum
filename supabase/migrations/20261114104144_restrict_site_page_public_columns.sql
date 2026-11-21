revoke select on public.site_pages from anon, authenticated;
grant select (slug, title, body, updated_at) on public.site_pages to anon, authenticated;