alter table public.user_submissions
  drop constraint if exists user_submissions_kind_fields_check;
alter table public.user_submissions
  add constraint user_submissions_kind_fields_check check (
    (submission_type = 'book_request' and answer_link_id is null)
    or (submission_type = 'link_report' and answer_link_title is not null)
  );
drop policy if exists "Anyone can submit book requests and link reports" on public.user_submissions;
create policy "Anyone can submit book requests and link reports"
  on public.user_submissions for insert to anon, authenticated
  with check (
    char_length(btrim(book_title)) between 1 and 200
    and char_length(coalesce(publisher, '')) <= 120
    and char_length(coalesce(answer_link_title, '')) <= 300
    and char_length(coalesce(reason, '')) <= 120
    and char_length(coalesce(details, '')) <= 1000
    and (
      (submission_type = 'book_request' and answer_link_id is null)
      or (submission_type = 'link_report' and answer_link_title is not null)
    )
  );
