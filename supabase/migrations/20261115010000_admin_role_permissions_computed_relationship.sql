-- Provide a PostgREST computed relationship for legacy clients that embed
-- admin_role_permissions directly from admin_user_roles. The canonical schema
-- still relates both tables through admin_roles.role_key.
create or replace function public.admin_role_permissions(source public.admin_user_roles)
returns setof public.admin_role_permissions
rows 20
language sql
stable
security invoker
set search_path = ''
as $$
  select rp.*
  from public.admin_role_permissions as rp
  where rp.role_key = source.role_key;
$$;

revoke all on function public.admin_role_permissions(public.admin_user_roles) from public, anon;
grant execute on function public.admin_role_permissions(public.admin_user_roles) to authenticated;

notify pgrst, 'reload schema';
