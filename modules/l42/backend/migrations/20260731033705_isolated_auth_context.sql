begin;

-- Hosted Supabase owns the auth schema and does not allow this migration role
-- to extend its ACL. This narrow helper reads only the JWT subject while
-- running as the constrained authenticated role; it never reads Auth tables.
grant usage, create on schema private to authenticated;

create function private.request_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid()
$$;

revoke all on function private.request_user_id()
from public, anon, authenticated;
grant execute on function private.request_user_id()
to app_rpc_executor, service_role;
alter function private.request_user_id() owner to authenticated;
revoke create on schema private from authenticated;

create or replace function private.ensure_account(
  p_owner_id uuid,
  p_display_name text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_owner_id is null
    or p_owner_id is distinct from private.request_user_id()
  then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into api.profiles (id, display_name)
  values (
    p_owner_id,
    case
      when p_display_name is null then null
      else nullif(btrim(p_display_name), '')
    end
  )
  on conflict (id) do nothing;

  insert into api.entitlements (
    owner_id,
    plan_code,
    source,
    status
  )
  values (
    p_owner_id,
    'free',
    'free',
    'active'
  )
  on conflict (owner_id) do nothing;
end
$$;

grant create on schema api to app_rpc_executor;
set local role app_rpc_executor;

do $$
declare
  v_definition text;
begin
  for v_definition in
    select pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname in (
        'bootstrap_account',
        'create_product',
        'set_product_archived',
        'generate_labels'
      )
  loop
    execute replace(
      v_definition,
      'auth.uid()',
      'private.request_user_id()'
    );
  end loop;
end
$$;

reset role;
revoke create on schema api from app_rpc_executor;

drop policy profiles_select_own on api.profiles;
drop policy profiles_insert_rpc on api.profiles;
drop policy profiles_update_own on api.profiles;
drop policy entitlements_select_own on api.entitlements;
drop policy entitlements_insert_free_rpc on api.entitlements;
drop policy products_select_own on api.products;
drop policy products_insert_rpc on api.products;
drop policy products_update_own on api.products;
drop policy templates_select_own on api.label_templates;
drop policy templates_insert_own on api.label_templates;
drop policy templates_update_own on api.label_templates;
drop policy jobs_select_own on api.label_jobs;
drop policy jobs_insert_rpc on api.label_jobs;
drop policy usage_select_own on api.daily_usage;
drop policy usage_insert_rpc on api.daily_usage;
drop policy usage_update_rpc on api.daily_usage;
drop policy audit_insert_rpc on audit_private.audit_logs;

create policy profiles_select_own
on api.profiles
for select
to authenticated, app_rpc_executor
using (
  (select private.request_user_id()) is not null
  and id = (select private.request_user_id())
);

create policy profiles_insert_rpc
on api.profiles
for insert
to app_rpc_executor
with check (
  (select private.request_user_id()) is not null
  and id = (select private.request_user_id())
);

create policy profiles_update_own
on api.profiles
for update
to authenticated, app_rpc_executor
using (id = (select private.request_user_id()))
with check (id = (select private.request_user_id()));

create policy entitlements_select_own
on api.entitlements
for select
to authenticated, app_rpc_executor
using (owner_id = (select private.request_user_id()));

create policy entitlements_insert_free_rpc
on api.entitlements
for insert
to app_rpc_executor
with check (
  owner_id = (select private.request_user_id())
  and plan_code = 'free'
  and source = 'free'
  and subscription_id is null
  and status = 'active'
  and revoked_at is null
);

create policy products_select_own
on api.products
for select
to authenticated, app_rpc_executor
using (owner_id = (select private.request_user_id()));

create policy products_insert_rpc
on api.products
for insert
to app_rpc_executor
with check (owner_id = (select private.request_user_id()));

create policy products_update_own
on api.products
for update
to authenticated, app_rpc_executor
using (owner_id = (select private.request_user_id()))
with check (owner_id = (select private.request_user_id()));

create policy templates_select_own
on api.label_templates
for select
to authenticated, app_rpc_executor
using (owner_id = (select private.request_user_id()));

create policy templates_insert_own
on api.label_templates
for insert
to authenticated, app_rpc_executor
with check (owner_id = (select private.request_user_id()));

create policy templates_update_own
on api.label_templates
for update
to authenticated, app_rpc_executor
using (owner_id = (select private.request_user_id()))
with check (owner_id = (select private.request_user_id()));

create policy jobs_select_own
on api.label_jobs
for select
to authenticated, app_rpc_executor
using (owner_id = (select private.request_user_id()));

create policy jobs_insert_rpc
on api.label_jobs
for insert
to app_rpc_executor
with check (owner_id = (select private.request_user_id()));

create policy usage_select_own
on api.daily_usage
for select
to authenticated, app_rpc_executor
using (owner_id = (select private.request_user_id()));

create policy usage_insert_rpc
on api.daily_usage
for insert
to app_rpc_executor
with check (owner_id = (select private.request_user_id()));

create policy usage_update_rpc
on api.daily_usage
for update
to app_rpc_executor
using (owner_id = (select private.request_user_id()))
with check (owner_id = (select private.request_user_id()));

create policy audit_insert_rpc
on audit_private.audit_logs
for insert
to app_rpc_executor
with check (
  owner_id = (select private.request_user_id())
  and actor_id = (select private.request_user_id())
);

commit;
