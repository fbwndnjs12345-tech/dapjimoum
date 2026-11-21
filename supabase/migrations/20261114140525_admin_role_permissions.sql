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
grant select, insert, update, delete on public.admin_roles, public.admin_role_permissions to authenticated;
grant select on public.admin_user_roles to authenticated;
revoke insert, update, delete on public.admin_user_roles from authenticated;

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


drop policy if exists "Admins can read search attempts" on public.answer_link_search_attempts;
create policy "Admins can read search attempts" on public.answer_link_search_attempts for select to authenticated
using ((select public.has_admin_permission('search.diagnostics')));
drop policy if exists "Admins can read search queue" on public.answer_link_search_queue;
create policy "Admins can read search queue" on public.answer_link_search_queue for select to authenticated
using ((select public.has_admin_permission('search.queue')));
drop policy if exists "Admins can update search queue" on public.answer_link_search_queue;
create policy "Admins can update search queue" on public.answer_link_search_queue for update to authenticated
using ((select public.has_admin_permission('search.queue')))
with check ((select public.has_admin_permission('search.queue')));
drop policy if exists "Admins can read audit events" on public.admin_audit_events;
create policy "Admins can read audit events" on public.admin_audit_events for select to authenticated
using ((select public.has_admin_permission('audit.read')));
drop policy if exists "Admins can read search settings" on public.answer_link_search_settings;
create policy "Admins can read search settings" on public.answer_link_search_settings for select to authenticated
using ((select public.has_admin_permission('search.settings')));
drop policy if exists "Admins can update search settings" on public.answer_link_search_settings;
create policy "Admins can update search settings" on public.answer_link_search_settings for update to authenticated
using ((select public.has_admin_permission('search.settings')))
with check ((select public.has_admin_permission('search.settings')));

create or replace function public.approve_answer_link_candidate(p_candidate_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.answer_link_candidates%rowtype;
begin
  if (select auth.uid()) is null or not (select public.has_admin_permission('candidates.review')) then
    raise exception 'Candidate review permission is required.' using errcode = '42501';
  end if;

  select * into candidate from public.answer_link_candidates where id = p_candidate_id for update;
  if not found then raise exception 'Candidate not found.' using errcode = 'P0002'; end if;
  if candidate.status = 'approved' then return 'approved'; end if;
  if candidate.status not in ('pending', 'unverified') then
    raise exception 'Only pending candidates can be approved.' using errcode = '22023';
  end if;
  if btrim(coalesce(candidate.url, '')) = '' or candidate.url !~* '^https?://' then
    raise exception 'Candidate URL must be a valid HTTP(S) URL.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(candidate.url_identity, 0));
  if exists (
    select 1 from public.answer_links links
    where public.answer_link_url_identity(links.url) = candidate.url_identity
  ) then
    update public.answer_link_candidates
    set status = 'duplicate', reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_candidate_id;
    return 'duplicate';
  end if;

  insert into public.answer_links (book_id, title, url, source_name, link_type, verified, click_count)
  values (candidate.book_id, candidate.title, btrim(candidate.url), candidate.source_name, candidate.link_type, false, 0);

  update public.answer_link_candidates
  set status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_candidate_id;
  return 'approved';
end;
$$;

create or replace function public.reject_answer_link_candidate(p_candidate_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.has_admin_permission('candidates.review')) then
    raise exception 'Candidate review permission is required.' using errcode = '42501';
  end if;
  update public.answer_link_candidates
  set status = 'rejected',
      review_note = nullif(left(btrim(coalesce(p_review_note, '')), 1000), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_candidate_id and status in ('pending', 'unverified');
  if not found then
    raise exception 'Candidate is missing or is no longer pending.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_list_role_assignments()
returns table(user_id uuid, email text, role_key text, role_label text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_admin_permission('admin.roles.manage')) then
    raise exception 'Administrator role management permission is required.' using errcode = '42501';
  end if;
  return query
    select a.user_id, u.email::text, ur.role_key, r.label
    from public.admin_users a
    join auth.users u on u.id = a.user_id
    left join public.admin_user_roles ur on ur.user_id = a.user_id
    left join public.admin_roles r on r.role_key = ur.role_key
    order by lower(coalesce(u.email, '')), a.created_at;
end;
$$;
revoke all on function public.admin_list_role_assignments() from public, anon;
grant execute on function public.admin_list_role_assignments() to authenticated;

create or replace function public.admin_assign_role(p_user_id uuid, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_role text;
begin
  if not (select public.has_admin_permission('admin.roles.manage')) then
    raise exception 'Administrator role management permission is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.admin_users where user_id = p_user_id) then
    raise exception 'Target user is not an administrator.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_roles where role_key = p_role_key) then
    raise exception 'Unknown administrator role.' using errcode = '22023';
  end if;
  select role_key into previous_role from public.admin_user_roles where user_id = p_user_id;
  insert into public.admin_user_roles(user_id, role_key, assigned_by, assigned_at)
  values (p_user_id, p_role_key, (select auth.uid()), now())
  on conflict (user_id) do update
    set role_key = excluded.role_key, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
  insert into public.admin_audit_events(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values ((select auth.uid()), 'role_change', 'admin_user_roles', p_user_id::text,
          jsonb_build_object('role_key', previous_role), jsonb_build_object('role_key', p_role_key));
end;
$$;
revoke all on function public.admin_assign_role(uuid, text) from public, anon;
grant execute on function public.admin_assign_role(uuid, text) to authenticated;


create table if not exists public.admin_access_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  route text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists admin_access_events_created_at_idx on public.admin_access_events(created_at desc);
create index if not exists admin_access_events_actor_idx on public.admin_access_events(actor_user_id, created_at desc);
alter table public.admin_access_events enable row level security;
grant select on public.admin_access_events to authenticated;
drop policy if exists "Admins can read admin access events" on public.admin_access_events;
create policy "Admins can read admin access events" on public.admin_access_events for select to authenticated
using ((select public.has_admin_permission('audit.read')));

create or replace function public.record_admin_access_event(p_event_type text, p_route text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_admin_user()) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  insert into public.admin_access_events(actor_user_id, event_type, route)
  values ((select auth.uid()), left(coalesce(p_event_type, 'page_view'), 60), left(coalesce(p_route, ''), 300));
end;
$$;
revoke all on function public.record_admin_access_event(text, text) from public, anon;
grant execute on function public.record_admin_access_event(text, text) to authenticated;

create or replace function public.admin_list_activity_events()
returns table(
  id text, event_kind text, action text, entity_type text, entity_id text,
  actor_user_id uuid, actor_email text, created_at timestamptz, details jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_admin_permission('audit.read')) then
    raise exception 'Audit read permission is required.' using errcode = '42501';
  end if;
  return query
    select 'audit:' || e.id::text, 'change'::text, e.action, e.entity_type, e.entity_id,
           e.actor_user_id, u.email::text, e.created_at,
           jsonb_build_object('before', e.before_data, 'after', e.after_data)
    from public.admin_audit_events e
    left join auth.users u on u.id = e.actor_user_id
    union all
    select 'access:' || a.id::text, 'access'::text, a.event_type, 'route'::text, a.route,
           a.actor_user_id, u.email::text, a.created_at, '{}'::jsonb
    from public.admin_access_events a
    left join auth.users u on u.id = a.actor_user_id
    order by created_at desc
    limit 500;
end;
$$;
revoke all on function public.admin_list_activity_events() from public, anon;
grant execute on function public.admin_list_activity_events() to authenticated;

create or replace function public.admin_assign_role(p_user_id uuid, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_role text;
  super_admin_count bigint;
begin
  if not (select public.has_admin_permission('admin.roles.manage')) then
    raise exception 'Administrator role management permission is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.admin_users where user_id = p_user_id) then
    raise exception 'Target user is not an administrator.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_roles where role_key = p_role_key) then
    raise exception 'Unknown administrator role.' using errcode = '22023';
  end if;
  select role_key into previous_role from public.admin_user_roles where user_id = p_user_id;
  if previous_role = 'super_admin' and p_role_key <> 'super_admin' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dapjimoum-super-admin-guard', 0));
    select count(*) into super_admin_count from public.admin_user_roles where role_key = 'super_admin';
    if super_admin_count <= 1 then
      raise exception 'At least one super administrator must remain.' using errcode = '22023';
    end if;
  end if;
  insert into public.admin_user_roles(user_id, role_key, assigned_by, assigned_at)
  values (p_user_id, p_role_key, (select auth.uid()), now())
  on conflict (user_id) do update
    set role_key = excluded.role_key, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
  insert into public.admin_audit_events(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values ((select auth.uid()), 'role_change', 'admin_user_roles', p_user_id::text,
          jsonb_build_object('role_key', previous_role), jsonb_build_object('role_key', p_role_key));
end;
$$;
