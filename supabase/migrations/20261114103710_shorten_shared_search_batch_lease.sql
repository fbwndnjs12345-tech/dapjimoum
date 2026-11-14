create or replace function public.claim_answer_link_search_batch(
  p_run_id uuid,
  p_lock_token uuid,
  p_batch_size integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  current_run public.answer_link_search_runs%rowtype;
  batch_ids uuid[];
begin
  select * into current_run
  from public.answer_link_search_runs
  where id = p_run_id
  for update skip locked;

  if not found or current_run.status <> 'running' then
    return null;
  end if;
  if current_run.locked_until is not null and current_run.locked_until > now() then
    return null;
  end if;

  batch_ids := current_run.book_ids[
    current_run.next_index + 1:
    least(current_run.next_index + greatest(1, least(p_batch_size, 10)), cardinality(current_run.book_ids))
  ];
  update public.answer_link_search_runs
  set lock_token = p_lock_token, locked_until = now() + interval '2 minutes'
  where id = p_run_id;

  return jsonb_build_object('start_index', current_run.next_index, 'book_ids', coalesce(to_jsonb(batch_ids), '[]'::jsonb));
end;
$function$;