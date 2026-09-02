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
    case when nullif(p_operation_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then p_operation_id::uuid else null end,
    jsonb_build_object('module', p_module, 'revision', v_state.revision)
  );

  return v_response;
end
$$;

revoke all on function api.sync_module_state(text, bigint, jsonb, text, text, boolean) from public, anon;
grant execute on function api.sync_module_state(text, bigint, jsonb, text, text, boolean) to authenticated;
