alter table public.admin_users
  add column if not exists email text;

update public.admin_users as admin
set email = lower(auth_user.email)
from auth.users as auth_user
where auth_user.id = admin.user_id
  and auth_user.email is not null
  and (admin.email is null or admin.email <> lower(auth_user.email));

create unique index if not exists admin_users_email_lower_unique
  on public.admin_users (lower(email))
  where email is not null;
