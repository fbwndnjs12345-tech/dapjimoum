-- Fine-grained administrator roles. Existing administrators are promoted to super_admin
-- so the migration does not remove any current access.
create table if not exists public.admin_roles (
  role_key text primary key,
  label text not null,
  description text not null default '',
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_role_permissions (
  role_key text not null references public.admin_roles(role_key) on delete cascade,
  permission_key text not null,
  primary key (role_key, permission_key)
);

create table if not exists public.admin_user_roles (
  user_id uuid primary key references public.admin_users(user_id) on delete cascade,
  role_key text not null references public.admin_roles(role_key),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now()
);

insert into public.admin_roles(role_key,label,description) values
('super_admin','최고 관리자','모든 관리자 기능 및 권한 관리'),
('search_operator','검색 운영자','검색 실행·중단·복구와 진단 확인'),
('reviewer','후보 검수자','검색 후보 검토 및 답지 링크 승인·거절'),
('content_manager','콘텐츠 관리자','교재·답지 링크·사이트 콘텐츠 관리'),
('support','접수 담당자','사용자 요청 및 오류 신고 처리')
on conflict (role_key) do nothing;

insert into public.admin_role_permissions(role_key,permission_key)
select 'super_admin', permission_key
from unnest(array[
  'dashboard.read','books.read','books.create','books.update','books.delete',
  'links.read','links.create','links.update','links.delete',
  'search.read','search.run','search.control','search.diagnostics','search.queue','search.settings',
  'candidates.read','candidates.review','inbox.read','inbox.update','content.update',
  'audit.read','admin.roles.manage'
]) as permission_key
on conflict do nothing;

insert into public.admin_role_permissions(role_key,permission_key) values
('search_operator','dashboard.read'),('search_operator','books.read'),('search_operator','links.read'),
('search_operator','search.read'),('search_operator','search.run'),('search_operator','search.control'),
('search_operator','search.diagnostics'),('search_operator','search.queue'),('search_operator','search.settings'),
('search_operator','candidates.read'),
('reviewer','dashboard.read'),('reviewer','search.read'),('reviewer','candidates.read'),
('reviewer','candidates.review'),('reviewer','links.read'),
('content_manager','dashboard.read'),('content_manager','books.read'),('content_manager','books.create'),
('content_manager','books.update'),('content_manager','links.read'),('content_manager','links.create'),
('content_manager','links.update'),('content_manager','links.delete'),('content_manager','content.update'),
('support','dashboard.read'),('support','books.read'),('support','links.read'),
('support','inbox.read'),('support','inbox.update')
on conflict do nothing;

insert into public.admin_user_roles(user_id,role_key)
select user_id, 'super_admin' from public.admin_users
on conflict (user_id) do nothing;

alter table public.admin_roles enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_user_roles enable row level security;
grant select, insert, update, delete on public.admin_roles, public.admin_role_permissions, public.admin_user_roles to authenticated;

create or replace function public.has_admin_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users a
    join public.admin_user_roles ur on ur.user_id = a.user_id
    join public.admin_role_permissions rp on rp.role_key = ur.role_key
    where a.user_id = (select auth.uid())
      and rp.permission_key = p_permission
  );
$$;
revoke all on function public.has_admin_permission(text) from public, anon;
grant execute on function public.has_admin_permission(text) to authenticated;

drop policy if exists "Admins can read admin roles" on public.admin_roles;
create policy "Admins can read admin roles" on public.admin_roles for select to authenticated
using ((select public.has_admin_permission('admin.roles.manage')));
drop policy if exists "Super admins can manage admin roles" on public.admin_roles;
create policy "Super admins can manage admin roles" on public.admin_roles for all to authenticated
using ((select public.has_admin_permission('admin.roles.manage')))
with check ((select public.has_admin_permission('admin.roles.manage')));

drop policy if exists "Admins can read role permissions" on public.admin_role_permissions;
create policy "Admins can read role permissions" on public.admin_role_permissions for select to authenticated
using ((select public.has_admin_permission('admin.roles.manage')));
drop policy if exists "Super admins can manage role permissions" on public.admin_role_permissions;
create policy "Super admins can manage role permissions" on public.admin_role_permissions for all to authenticated
using ((select public.has_admin_permission('admin.roles.manage')))
with check ((select public.has_admin_permission('admin.roles.manage')));

drop policy if exists "Admins can read admin role assignments" on public.admin_user_roles;
create policy "Admins can read admin role assignments" on public.admin_user_roles for select to authenticated
using ((select public.has_admin_permission('admin.roles.manage')));
drop policy if exists "Super admins can manage admin role assignments" on public.admin_user_roles;
create policy "Super admins can manage admin role assignments" on public.admin_user_roles for all to authenticated
using ((select public.has_admin_permission('admin.roles.manage')))
with check ((select public.has_admin_permission('admin.roles.manage')));

create or replace function public.assign_default_admin_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_user_roles(user_id, role_key)
  values (new.user_id, 'support')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.assign_default_admin_role() from public, anon, authenticated;
drop trigger if exists assign_default_admin_role_on_admin_insert on public.admin_users;
create trigger assign_default_admin_role_on_admin_insert after insert on public.admin_users
for each row execute function public.assign_default_admin_role();

-- Replace broad administrator checks with explicit permission checks.
drop policy if exists "Admins can insert books" on public.books;
create policy "Admins can insert books" on public.books for insert to authenticated
with check ((select public.has_admin_permission('books.create')));
drop policy if exists "Admins can update books" on public.books;
create policy "Admins can update books" on public.books for update to authenticated
using ((select public.has_admin_permission('books.update')))
with check ((select public.has_admin_permission('books.update')));
drop policy if exists "Admins can delete books" on public.books;
create policy "Admins can delete books" on public.books for delete to authenticated
using ((select public.has_admin_permission('books.delete')));

drop policy if exists "Admins can insert answer links" on public.answer_links;
create policy "Admins can insert answer links" on public.answer_links for insert to authenticated
with check ((select public.has_admin_permission('links.create')));
drop policy if exists "Admins can update answer links" on public.answer_links;
create policy "Admins can update answer links" on public.answer_links for update to authenticated
using ((select public.has_admin_permission('links.update')))
with check ((select public.has_admin_permission('links.update')));
drop policy if exists "Admins can delete answer links" on public.answer_links;
create policy "Admins can delete answer links" on public.answer_links for delete to authenticated
using ((select public.has_admin_permission('links.delete')));

drop policy if exists "Admins can read answer link search runs" on public.answer_link_search_runs;
create policy "Admins can read answer link search runs" on public.answer_link_search_runs for select to authenticated
using ((select public.has_admin_permission('search.read')));

drop policy if exists "Admins can read answer link candidates" on public.answer_link_candidates;
create policy "Admins can read answer link candidates" on public.answer_link_candidates for select to authenticated
using ((select public.has_admin_permission('candidates.read')));

drop policy if exists "Admins can read user submissions" on public.user_submissions;
create policy "Admins can read user submissions" on public.user_submissions for select to authenticated
using ((select public.has_admin_permission('inbox.read')));
drop policy if exists "Admins can update user submissions" on public.user_submissions;
create policy "Admins can update user submissions" on public.user_submissions for update to authenticated
using ((select public.has_admin_permission('inbox.update')))
with check ((select public.has_admin_permission('inbox.update')));

drop policy if exists "Admins can insert site pages" on public.site_pages;
create policy "Admins can insert site pages" on public.site_pages for insert to authenticated
with check ((select public.has_admin_permission('content.update')) and updated_by = (select auth.uid()));
drop policy if exists "Admins can update site pages" on public.site_pages;
create policy "Admins can update site pages" on public.site_pages for update to authenticated
using ((select public.has_admin_permission('content.update')))
with check ((select public.has_admin_permission('content.update')) and updated_by = (select auth.uid()));

-- A newly added administrator receives the limited support role unless a super admin assigns another role.
-- Existing administrator accounts were seeded as super_admin above.
