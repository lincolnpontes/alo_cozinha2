-- Alô Cozinha unified cloud foundation.
-- Keeps the legacy L42 tables intact until migration is verified.

create table if not exists api.module_states (
  owner_id uuid not null references auth.users(id) on delete cascade,
  module text not null check (module in (
    'catalog', 'kds', 'checklist', 'technical_sheets', 'documents',
    'compras', 'etiquetas', 'migrations'
  )),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, module)
);

create index if not exists module_states_updated_at_idx
  on api.module_states (updated_at desc);

create table if not exists api.sync_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  module text not null,
  operation_id text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, module, operation_id)
);

create index if not exists sync_operations_created_at_idx
  on api.sync_operations (created_at);

alter table api.module_states enable row level security;
alter table api.module_states force row level security;
alter table api.sync_operations enable row level security;
alter table api.sync_operations force row level security;

drop policy if exists module_states_select_own on api.module_states;
create policy module_states_select_own
  on api.module_states for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists sync_operations_select_own on api.sync_operations;
create policy sync_operations_select_own
  on api.sync_operations for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on api.module_states from public, anon;
revoke all on api.sync_operations from public, anon;
grant select on api.module_states to authenticated;
grant select on api.sync_operations to authenticated;

create or replace function api.get_module_state(p_module text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.request_user_id();
  v_state api.module_states;
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_module is null or p_module not in (
    'catalog', 'kds', 'checklist', 'technical_sheets', 'documents',
    'compras', 'etiquetas', 'migrations'
  ) then
    raise exception 'invalid module' using errcode = '22023';
  end if;

  select * into v_state
  from api.module_states
  where owner_id = v_owner and module = p_module;

  if not found then
    return jsonb_build_object(
      'exists', false,
      'module', p_module,
      'payload', '{}'::jsonb,
      'revision', 0
    );
  end if;

  return jsonb_build_object(
    'exists', true,
    'module', v_state.module,
    'payload', v_state.payload,
    'revision', v_state.revision,
    'updated_at', v_state.updated_at,
    'device_id', v_state.device_id
  );
end
$$;

create or replace function api.sync_module_state(
  p_module text,
  p_base_revision bigint,
  p_payload jsonb,
  p_device_id text default null,
  p_operation_id text default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.request_user_id();
  v_state api.module_states;
  v_response jsonb;
  v_now timestamptz := statement_timestamp();
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_module is null or p_module not in (
    'catalog', 'kds', 'checklist', 'technical_sheets', 'documents',
    'compras', 'etiquetas', 'migrations'
  ) then
    raise exception 'invalid module' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(p_payload) > 8388608 then
    raise exception 'payload exceeds 8 MiB' using errcode = '22023';
  end if;

  perform private.ensure_account(v_owner, null);

  if nullif(p_operation_id, '') is not null then
    select response into v_response
    from api.sync_operations
    where owner_id = v_owner
      and module = p_module
      and operation_id = p_operation_id;
    if found then return v_response; end if;
  end if;

  select * into v_state
  from api.module_states
  where owner_id = v_owner and module = p_module
  for update;

  if not found then
    if not p_force and coalesce(p_base_revision, 0) <> 0 then
      return jsonb_build_object(
        'status', 'conflict', 'module', p_module,
        'payload', '{}'::jsonb, 'revision', 0
      );
    end if;
    insert into api.module_states (
      owner_id, module, payload, revision, device_id, created_at, updated_at
    ) values (
      v_owner, p_module, p_payload, 1, nullif(p_device_id, ''), v_now, v_now
    ) returning * into v_state;
    v_response := jsonb_build_object(
      'status', 'saved', 'module', p_module,
      'payload', v_state.payload, 'revision', v_state.revision,
      'updated_at', v_state.updated_at
    );
  elsif not p_force and coalesce(p_base_revision, -1) <> v_state.revision then
    return jsonb_build_object(
      'status', 'conflict', 'module', p_module,
      'payload', v_state.payload, 'revision', v_state.revision,
      'updated_at', v_state.updated_at, 'device_id', v_state.device_id
    );
  elsif v_state.payload = p_payload then
    v_response := jsonb_build_object(
      'status', 'unchanged', 'module', p_module,
      'payload', v_state.payload, 'revision', v_state.revision,
      'updated_at', v_state.updated_at
    );
  else
    update api.module_states
    set payload = p_payload,
        revision = revision + 1,
        device_id = nullif(p_device_id, ''),
        updated_at = v_now
    where owner_id = v_owner and module = p_module
    returning * into v_state;
    v_response := jsonb_build_object(
      'status', 'saved', 'module', p_module,
      'payload', v_state.payload, 'revision', v_state.revision,
      'updated_at', v_state.updated_at
    );
  end if;

  if nullif(p_operation_id, '') is not null then
    insert into api.sync_operations (owner_id, module, operation_id, response)
    values (v_owner, p_module, p_operation_id, v_response)
    on conflict (owner_id, module, operation_id) do nothing;
  end if;

  insert into audit_private.audit_logs (
    owner_id, actor_id, action, entity_type, entity_id, request_id, details
  ) values (
    v_owner, v_owner, 'module_state.synced', 'module_state', v_owner,
    case when nullif(p_operation_id, '') ~* '^[0-9a-f-]{36}$'
      then p_operation_id::uuid else null end,
    jsonb_build_object('module', p_module, 'revision', v_state.revision)
  );

  return v_response;
end
$$;

revoke all on function api.get_module_state(text) from public, anon;
revoke all on function api.sync_module_state(text, bigint, jsonb, text, text, boolean) from public, anon;
grant execute on function api.get_module_state(text) to authenticated;
grant execute on function api.sync_module_state(text, bigint, jsonb, text, text, boolean) to authenticated;

-- Preserve every existing L42 cloud snapshot while moving it into the unified namespace.
insert into api.module_states (owner_id, module, payload, revision, device_id, created_at, updated_at)
select owner_id, 'etiquetas', payload, revision, device_id::text, created_at, updated_at
from api.app_states
on conflict (owner_id, module) do nothing;

do $$
begin
  alter publication supabase_realtime add table api.module_states;
exception
  when duplicate_object then null;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'alo-cozinha-private',
  'alo-cozinha-private',
  false,
  6291456,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists alo_cozinha_storage_select_own on storage.objects;
create policy alo_cozinha_storage_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'alo-cozinha-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists alo_cozinha_storage_insert_own on storage.objects;
create policy alo_cozinha_storage_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'alo-cozinha-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists alo_cozinha_storage_update_own on storage.objects;
create policy alo_cozinha_storage_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'alo-cozinha-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'alo-cozinha-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists alo_cozinha_storage_delete_own on storage.objects;
create policy alo_cozinha_storage_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'alo-cozinha-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
