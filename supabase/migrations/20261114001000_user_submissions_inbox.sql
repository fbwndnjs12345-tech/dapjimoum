create table if not exists public.user_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null check (submission_type in ('book_request', 'link_report')),
  book_title text not null check (char_length(btrim(book_title)) between 1 and 200),
  publisher text check (publisher is null or char_length(publisher) <= 120),
  answer_link_id uuid references public.answer_links(id) on delete set null,
  answer_link_title text check (answer_link_title is null or char_length(answer_link_title) <= 300),
  reason text check (reason is null or char_length(reason) <= 120),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'resolved', 'rejected')),
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_submissions_kind_fields_check check (
    (submission_type = 'book_request' and answer_link_id is null)
    or (submission_type = 'link_report' and answer_link_id is not null)
  )
);
create index if not exists user_submissions_status_created_idx on public.user_submissions(status, created_at desc);
create index if not exists user_submissions_created_idx on public.user_submissions(created_at desc);
alter table public.user_submissions enable row level security;
revoke all on table public.user_submissions from public, anon, authenticated;
grant insert on table public.user_submissions to anon, authenticated;
grant select, update on table public.user_submissions to authenticated;
drop policy if exists "Anyone can submit book requests and link reports" on public.user_submissions;
create policy "Anyone can submit book requests and link reports" on public.user_submissions for insert to anon, authenticated
with check (
  char_length(btrim(book_title)) between 1 and 200
  and char_length(coalesce(publisher, '')) <= 120
  and char_length(coalesce(answer_link_title, '')) <= 300
  and char_length(coalesce(reason, '')) <= 120
  and char_length(coalesce(details, '')) <= 1000
  and ((submission_type = 'book_request' and answer_link_id is null) or (submission_type = 'link_report' and answer_link_id is not null))
);
drop policy if exists "Admins can read user submissions" on public.user_submissions;
create policy "Admins can read user submissions" on public.user_submissions for select to authenticated using ((select public.is_admin_user()));
drop policy if exists "Admins can update user submissions" on public.user_submissions;
create policy "Admins can update user submissions" on public.user_submissions for update to authenticated
using ((select public.is_admin_user())) with check ((select public.is_admin_user()));
