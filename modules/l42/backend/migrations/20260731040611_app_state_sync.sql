begin;

create table api.app_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  device_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint app_states_payload_object_check check (
    jsonb_typeof(payload) = 'object'
  ),
  constraint app_states_payload_size_check check (
    pg_column_size(payload) <= 8388608
  ),
  constraint app_states_revision_positive_check check (revision > 0)
);

comment on table api.app_states is
  'Encrypted-transport, per-account application snapshot used by the offline-first Android app.';
comment on column api.app_states.payload is
  'Application snapshot. Operator PINs and device-only settings must be redacted by the client.';
comment on column api.app_states.revision is
  'Server-controlled optimistic concurrency token.';

alter table api.app_states enable row level security;
alter table api.app_states force row level security;

create policy app_states_select_own
on api.app_states
for select
to authenticated, app_rpc_executor
using (
  (select private.request_user_id()) is not null
  and owner_id = (select private.request_user_id())
);

create policy app_states_insert_rpc
on api.app_states
for insert
to app_rpc_executor
with check (
  (select private.request_user_id()) is not null
  and owner_id = (select private.request_user_id())
);

create policy app_states_update_rpc
on api.app_states
for update
to app_rpc_executor
using (owner_id = (select private.request_user_id()))
with check (owner_id = (select private.request_user_id()));

grant select on api.app_states to authenticated, app_rpc_executor;
grant insert, update on api.app_states to app_rpc_executor;
grant all privileges on api.app_states to service_role;

grant create on schema api to app_rpc_executor;
set local role app_rpc_executor;

create function api.get_app_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.request_user_id();
  v_state api.app_states;
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select *
  into v_state
  from api.app_states
  where owner_id = v_owner;

  if not found then
    return jsonb_build_object('exists', false);
  end if;

  return jsonb_build_object(
    'exists', true,
    'payload', v_state.payload,
    'revision', v_state.revision,
    'updated_at', v_state.updated_at,
    'device_id', v_state.device_id
  );
end
$$;

create function api.sync_app_state(
  p_base_revision bigint,
  p_payload jsonb,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.request_user_id();
  v_state api.app_states;
  v_now timestamptz := statement_timestamp();
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(p_payload) > 8388608 then
    raise exception 'payload exceeds 8 MiB' using errcode = '22023';
  end if;

  perform private.ensure_account(v_owner, null);

  select *
  into v_state
  from api.app_states
  where owner_id = v_owner
  for update;

  if not found then
    insert into api.app_states (
      owner_id,
      payload,
      revision,
      device_id,
      created_at,
      updated_at
    )
    values (
      v_owner,
      p_payload,
      1,
      p_device_id,
      v_now,
      v_now
    )
    returning * into v_state;

    insert into audit_private.audit_logs (
      owner_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      request_id,
      details
    )
    values (
      v_owner,
      v_owner,
      'app_state.created',
      'app_state',
      v_owner,
      p_device_id,
      jsonb_build_object('revision', v_state.revision)
    );

    return jsonb_build_object(
      'status', 'saved',
      'payload', v_state.payload,
      'revision', v_state.revision,
      'updated_at', v_state.updated_at
    );
  end if;

  if p_base_revision is null or p_base_revision <> v_state.revision then
    return jsonb_build_object(
      'status', 'conflict',
      'payload', v_state.payload,
      'revision', v_state.revision,
      'updated_at', v_state.updated_at,
      'device_id', v_state.device_id
    );
  end if;

  if v_state.payload = p_payload then
    return jsonb_build_object(
      'status', 'unchanged',
      'payload', v_state.payload,
      'revision', v_state.revision,
      'updated_at', v_state.updated_at
    );
  end if;

  update api.app_states
  set payload = p_payload,
      revision = revision + 1,
      device_id = p_device_id,
      updated_at = v_now
  where owner_id = v_owner
  returning * into v_state;

  insert into audit_private.audit_logs (
    owner_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    request_id,
    details
  )
  values (
    v_owner,
    v_owner,
    'app_state.updated',
    'app_state',
    v_owner,
    p_device_id,
    jsonb_build_object('revision', v_state.revision)
  );

  return jsonb_build_object(
    'status', 'saved',
    'payload', v_state.payload,
    'revision', v_state.revision,
    'updated_at', v_state.updated_at
  );
end
$$;

reset role;
revoke create on schema api from app_rpc_executor;

revoke all on function api.get_app_state()
from public, anon, authenticated;
revoke all on function api.sync_app_state(bigint, jsonb, uuid)
from public, anon, authenticated;

grant execute on function api.get_app_state()
to authenticated;
grant execute on function api.sync_app_state(bigint, jsonb, uuid)
to authenticated;

grant execute on function api.get_app_state(),
  api.sync_app_state(bigint, jsonb, uuid)
to service_role;

revoke all on api.app_states from public, anon;

notify pgrst, 'reload schema';

commit;
