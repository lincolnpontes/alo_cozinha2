begin;

-- Alô Etiqueta commercial foundation.
-- Only the api schema is exposed to the APK. Billing and audit data remain
-- server-side. All quotas use database time and are enforced transactionally.

create schema if not exists api;
create schema if not exists private;
create schema if not exists billing_private;
create schema if not exists audit_private;

revoke all on schema api, private, billing_private, audit_private
from public, anon, authenticated;

grant usage on schema api to authenticated, service_role;
grant usage on schema api, private, audit_private to service_role;
grant usage on schema billing_private to service_role;

do $$
begin
  create role app_rpc_executor nologin nosuperuser nocreatedb
    nocreaterole noinherit noreplication nobypassrls;
exception
  when duplicate_object then null;
end
$$;

-- PostgreSQL requires the migration owner to be a member of the destination
-- role before transferring ownership of the protected RPC functions.
grant app_rpc_executor to postgres;

grant usage on schema api, private, audit_private to app_rpc_executor;
grant create on schema api to app_rpc_executor;

alter default privileges for role postgres in schema api
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema api
  revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema api
  revoke all on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema private
  revoke all on functions from public, anon, authenticated;

alter default privileges for role postgres in schema billing_private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema billing_private
  revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema billing_private
  revoke all on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema audit_private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema audit_private
  revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema audit_private
  revoke all on sequences from public, anon, authenticated;

create table api.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Fortaleza',
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint profiles_display_name_check check (
    display_name is null
    or char_length(btrim(display_name)) between 1 and 120
  ),
  constraint profiles_timezone_check check (
    char_length(timezone) between 1 and 80
  ),
  constraint profiles_preferences_check check (
    jsonb_typeof(preferences) = 'object'
  )
);

create table api.plans (
  code text primary key,
  name text not null,
  max_active_products integer,
  max_daily_labels integer,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint plans_code_check check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint plans_product_limit_check check (
    max_active_products is null or max_active_products >= 0
  ),
  constraint plans_label_limit_check check (
    max_daily_labels is null or max_daily_labels >= 0
  ),
  constraint plans_features_check check (
    jsonb_typeof(features) = 'object'
  )
);

insert into api.plans (
  code,
  name,
  max_active_products,
  max_daily_labels,
  features
)
values
  (
    'free',
    'Gratuito',
    10,
    3,
    '{"basic":true,"offline_preview":true}'::jsonb
  ),
  (
    'premium',
    'Premium',
    null,
    null,
    '{"all_features":true}'::jsonb
  )
on conflict (code) do update
set
  name = excluded.name,
  max_active_products = excluded.max_active_products,
  max_daily_labels = excluded.max_daily_labels,
  features = excluded.features,
  is_active = true,
  updated_at = statement_timestamp();

create table billing_private.billing_products (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'google_play',
  package_name text not null,
  product_id text not null,
  base_plan_id text not null,
  billing_period text not null,
  plan_code text not null references api.plans(code) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint billing_products_identity_key unique (
    provider,
    package_name,
    product_id,
    base_plan_id
  ),
  constraint billing_products_provider_check check (
    provider = 'google_play'
  ),
  constraint billing_products_period_check check (
    billing_period in ('monthly', 'annual')
  ),
  constraint billing_products_package_check check (
    char_length(btrim(package_name)) between 3 and 255
  ),
  constraint billing_products_product_check check (
    char_length(btrim(product_id)) between 1 and 255
  ),
  constraint billing_products_base_plan_check check (
    char_length(btrim(base_plan_id)) between 1 and 255
  )
);

create table billing_private.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  billing_product_id uuid not null
    references billing_private.billing_products(id) on delete restrict,
  provider text not null default 'google_play',
  purchase_token_hash text not null,
  purchase_token_ciphertext bytea not null,
  linked_purchase_token_hash text,
  original_order_id text,
  status text not null,
  started_at timestamptz,
  expires_at timestamptz,
  auto_renewing boolean,
  cancel_reason text,
  last_verified_at timestamptz,
  provider_version text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint subscriptions_purchase_token_key unique (
    provider,
    purchase_token_hash
  ),
  constraint subscriptions_provider_check check (
    provider = 'google_play'
  ),
  constraint subscriptions_status_check check (
    status in (
      'pending',
      'active',
      'grace',
      'on_hold',
      'paused',
      'canceled',
      'expired',
      'revoked'
    )
  ),
  constraint subscriptions_dates_check check (
    expires_at is null
    or started_at is null
    or expires_at >= started_at
  ),
  constraint subscriptions_token_hash_check check (
    char_length(purchase_token_hash) between 32 and 128
  )
);

create table api.entitlements (
  owner_id uuid primary key references api.profiles(id) on delete cascade,
  plan_code text not null references api.plans(code) on delete restrict,
  source text not null default 'free',
  subscription_id uuid
    references billing_private.subscriptions(id) on delete set null,
  status text not null default 'active',
  valid_from timestamptz not null default statement_timestamp(),
  valid_until timestamptz,
  revoked_at timestamptz,
  version bigint not null default 1,
  updated_at timestamptz not null default statement_timestamp(),
  constraint entitlements_source_check check (
    source in ('free', 'google_play', 'manual')
  ),
  constraint entitlements_status_check check (
    status in ('active', 'grace', 'expired', 'revoked')
  ),
  constraint entitlements_dates_check check (
    valid_until is null or valid_until >= valid_from
  ),
  constraint entitlements_version_check check (version > 0),
  constraint entitlements_subscription_source_check check (
    (source = 'google_play' and subscription_id is not null)
    or (source <> 'google_play')
  )
);

create table api.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references api.profiles(id) on delete cascade,
  external_id uuid not null,
  idempotency_key uuid not null,
  product_number bigint,
  name text not null,
  sku text,
  category text,
  brands text[] not null default '{}',
  validity_days integer,
  price numeric(12,2),
  qr_stock_control boolean not null default false,
  attributes jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint products_external_id_key unique (owner_id, external_id),
  constraint products_idempotency_key unique (owner_id, idempotency_key),
  constraint products_number_key unique (owner_id, product_number),
  constraint products_name_check check (
    char_length(btrim(name)) between 1 and 160
  ),
  constraint products_sku_check check (
    sku is null or char_length(btrim(sku)) between 1 and 80
  ),
  constraint products_category_check check (
    category is null or char_length(btrim(category)) between 1 and 120
  ),
  constraint products_validity_check check (
    validity_days is null or validity_days between 0 and 36500
  ),
  constraint products_price_check check (price is null or price >= 0),
  constraint products_brands_check check (cardinality(brands) <= 50),
  constraint products_attributes_check check (
    jsonb_typeof(attributes) = 'object'
  )
);

create table api.label_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references api.profiles(id) on delete cascade,
  external_id uuid not null,
  name text not null,
  size_code text not null,
  layout jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint label_templates_external_id_key unique (owner_id, external_id),
  constraint label_templates_name_check check (
    char_length(btrim(name)) between 1 and 120
  ),
  constraint label_templates_size_check check (
    size_code in ('40x40', '60x40', '80x50')
  ),
  constraint label_templates_layout_check check (
    jsonb_typeof(layout) = 'object'
  )
);

create table api.label_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references api.profiles(id) on delete cascade,
  idempotency_key uuid not null,
  product_id uuid references api.products(id) on delete set null,
  template_id uuid references api.label_templates(id) on delete set null,
  quantity integer not null,
  usage_date date not null,
  status text not null default 'generated',
  payload_snapshot jsonb not null,
  generated_at timestamptz not null default statement_timestamp(),
  printed_at timestamptz,
  constraint label_jobs_idempotency_key unique (
    owner_id,
    idempotency_key
  ),
  constraint label_jobs_quantity_check check (
    quantity between 1 and 1000
  ),
  constraint label_jobs_status_check check (
    status in ('generated', 'printed', 'voided')
  ),
  constraint label_jobs_payload_check check (
    jsonb_typeof(payload_snapshot) = 'object'
  )
);

create table api.daily_usage (
  owner_id uuid not null references api.profiles(id) on delete cascade,
  usage_date date not null,
  labels_generated integer not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (owner_id, usage_date),
  constraint daily_usage_count_check check (labels_generated >= 0)
);

create table billing_private.billing_events (
  id bigint generated always as identity primary key,
  provider text not null default 'google_play',
  event_id text not null,
  event_type text not null,
  subscription_id uuid
    references billing_private.subscriptions(id) on delete set null,
  payload_redacted jsonb not null default '{}'::jsonb,
  payload_hash text,
  status text not null default 'received',
  attempts integer not null default 0,
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  last_error text,
  constraint billing_events_identity_key unique (provider, event_id),
  constraint billing_events_provider_check check (
    provider = 'google_play'
  ),
  constraint billing_events_status_check check (
    status in ('received', 'processing', 'processed', 'failed', 'ignored')
  ),
  constraint billing_events_attempts_check check (attempts >= 0),
  constraint billing_events_payload_check check (
    jsonb_typeof(payload_redacted) = 'object'
  )
);

create table audit_private.audit_logs (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id uuid,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default statement_timestamp(),
  constraint audit_logs_details_check check (
    jsonb_typeof(details) = 'object'
  )
);

create index billing_products_plan_idx
  on billing_private.billing_products (plan_code);

create index subscriptions_owner_status_idx
  on billing_private.subscriptions (owner_id, status, expires_at desc);

create index subscriptions_billing_product_idx
  on billing_private.subscriptions (billing_product_id);

create index subscriptions_linked_token_idx
  on billing_private.subscriptions (linked_purchase_token_hash)
  where linked_purchase_token_hash is not null;

create index entitlements_plan_idx
  on api.entitlements (plan_code);

create index entitlements_subscription_idx
  on api.entitlements (subscription_id)
  where subscription_id is not null;

create index products_owner_active_idx
  on api.products (owner_id, created_at desc)
  where archived_at is null;

create index products_owner_active_name_idx
  on api.products (owner_id, lower(name), id)
  where archived_at is null;

create index products_owner_category_idx
  on api.products (owner_id, category)
  where archived_at is null and category is not null;

create unique index products_owner_active_sku_uidx
  on api.products (owner_id, lower(sku))
  where archived_at is null and sku is not null;

create index label_templates_owner_active_idx
  on api.label_templates (owner_id, size_code, name)
  where archived_at is null;

create unique index label_templates_one_default_uidx
  on api.label_templates (owner_id, size_code)
  where is_default and archived_at is null;

create index label_jobs_owner_generated_idx
  on api.label_jobs (owner_id, generated_at desc, id);

create index label_jobs_product_idx on api.label_jobs (product_id);
create index label_jobs_template_idx on api.label_jobs (template_id);

create index billing_events_pending_idx
  on billing_private.billing_events (received_at, id)
  where status in ('received', 'failed');

create index billing_events_subscription_idx
  on billing_private.billing_events (subscription_id)
  where subscription_id is not null;

create index audit_logs_owner_created_idx
  on audit_private.audit_logs (owner_id, created_at desc, id);

create index audit_logs_actor_created_idx
  on audit_private.audit_logs (actor_id, created_at desc, id);

create index audit_logs_entity_idx
  on audit_private.audit_logs (
    entity_type,
    entity_id,
    created_at desc
  );

create index audit_logs_created_brin
  on audit_private.audit_logs using brin (created_at);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end
$$;

create trigger profiles_set_updated_at
before update on api.profiles
for each row execute function private.set_updated_at();

create trigger plans_set_updated_at
before update on api.plans
for each row execute function private.set_updated_at();

create trigger billing_products_set_updated_at
before update on billing_private.billing_products
for each row execute function private.set_updated_at();

create trigger subscriptions_set_updated_at
before update on billing_private.subscriptions
for each row execute function private.set_updated_at();

create trigger entitlements_set_updated_at
before update on api.entitlements
for each row execute function private.set_updated_at();

create trigger products_set_updated_at
before update on api.products
for each row execute function private.set_updated_at();

create trigger label_templates_set_updated_at
before update on api.label_templates
for each row execute function private.set_updated_at();

alter table api.profiles enable row level security;
alter table api.plans enable row level security;
alter table api.entitlements enable row level security;
alter table api.products enable row level security;
alter table api.label_templates enable row level security;
alter table api.label_jobs enable row level security;
alter table api.daily_usage enable row level security;
alter table billing_private.billing_products enable row level security;
alter table billing_private.subscriptions enable row level security;
alter table billing_private.billing_events enable row level security;
alter table audit_private.audit_logs enable row level security;

alter table api.profiles force row level security;
alter table api.plans force row level security;
alter table api.entitlements force row level security;
alter table api.products force row level security;
alter table api.label_templates force row level security;
alter table api.label_jobs force row level security;
alter table api.daily_usage force row level security;
alter table billing_private.billing_products force row level security;
alter table billing_private.subscriptions force row level security;
alter table billing_private.billing_events force row level security;
alter table audit_private.audit_logs force row level security;

create policy profiles_select_own
on api.profiles
for select
to authenticated, app_rpc_executor
using (
  (select auth.uid()) is not null
  and id = (select auth.uid())
);

create policy profiles_insert_rpc
on api.profiles
for insert
to app_rpc_executor
with check (
  (select auth.uid()) is not null
  and id = (select auth.uid())
);

create policy profiles_update_own
on api.profiles
for update
to authenticated, app_rpc_executor
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy plans_read_active
on api.plans
for select
to authenticated, app_rpc_executor
using (is_active);

create policy entitlements_select_own
on api.entitlements
for select
to authenticated, app_rpc_executor
using (owner_id = (select auth.uid()));

create policy entitlements_insert_free_rpc
on api.entitlements
for insert
to app_rpc_executor
with check (
  owner_id = (select auth.uid())
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
using (owner_id = (select auth.uid()));

create policy products_insert_rpc
on api.products
for insert
to app_rpc_executor
with check (owner_id = (select auth.uid()));

create policy products_update_own
on api.products
for update
to authenticated, app_rpc_executor
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy templates_select_own
on api.label_templates
for select
to authenticated, app_rpc_executor
using (owner_id = (select auth.uid()));

create policy templates_insert_own
on api.label_templates
for insert
to authenticated, app_rpc_executor
with check (owner_id = (select auth.uid()));

create policy templates_update_own
on api.label_templates
for update
to authenticated, app_rpc_executor
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy jobs_select_own
on api.label_jobs
for select
to authenticated, app_rpc_executor
using (owner_id = (select auth.uid()));

create policy jobs_insert_rpc
on api.label_jobs
for insert
to app_rpc_executor
with check (owner_id = (select auth.uid()));

create policy usage_select_own
on api.daily_usage
for select
to authenticated, app_rpc_executor
using (owner_id = (select auth.uid()));

create policy usage_insert_rpc
on api.daily_usage
for insert
to app_rpc_executor
with check (owner_id = (select auth.uid()));

create policy usage_update_rpc
on api.daily_usage
for update
to app_rpc_executor
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy audit_insert_rpc
on audit_private.audit_logs
for insert
to app_rpc_executor
with check (
  owner_id = (select auth.uid())
  and actor_id = (select auth.uid())
);

grant select on api.profiles, api.plans, api.entitlements, api.products,
  api.label_templates, api.label_jobs, api.daily_usage
to authenticated;

grant update (display_name, timezone, preferences)
on api.profiles to authenticated;

grant update (
  name,
  sku,
  category,
  brands,
  validity_days,
  price,
  qr_stock_control,
  attributes
)
on api.products to authenticated;

grant insert (
  id,
  owner_id,
  external_id,
  name,
  size_code,
  layout,
  is_default
),
update (
  name,
  size_code,
  layout,
  is_default
)
on api.label_templates to authenticated;

grant select, insert on api.profiles, api.entitlements, api.products,
  api.label_jobs, api.daily_usage
to app_rpc_executor;

grant select on api.plans, api.label_templates to app_rpc_executor;

grant update on api.products, api.daily_usage to app_rpc_executor;

grant insert on audit_private.audit_logs to app_rpc_executor;
grant usage, select on sequence audit_private.audit_logs_id_seq
to app_rpc_executor;

grant all privileges on all tables in schema api, billing_private,
  audit_private to service_role;
grant all privileges on all sequences in schema api, billing_private,
  audit_private to service_role;

create function private.ensure_account(
  p_owner_id uuid,
  p_display_name text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_owner_id is null or p_owner_id is distinct from auth.uid() then
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

create function private.effective_plan_code(
  p_owner_id uuid,
  p_now timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select e.plan_code
      from api.entitlements e
      join api.plans p on p.code = e.plan_code
      where e.owner_id = p_owner_id
        and e.status in ('active', 'grace')
        and e.revoked_at is null
        and e.valid_from <= p_now
        and (e.valid_until is null or e.valid_until > p_now)
        and p.is_active
      order by e.version desc
      limit 1
    ),
    'free'
  )
$$;

create function api.bootstrap_account(
  p_display_name text default null
)
returns api.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_result api.profiles;
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform private.ensure_account(v_owner, p_display_name);

  select *
  into strict v_result
  from api.profiles
  where id = v_owner;

  return v_result;
end
$$;

create function api.create_product(
  p_idempotency_key uuid,
  p_external_id uuid,
  p_name text,
  p_product_number bigint default null,
  p_sku text default null,
  p_category text default null,
  p_brands text[] default '{}',
  p_validity_days integer default null,
  p_price numeric default null,
  p_qr_stock_control boolean default false,
  p_attributes jsonb default '{}'::jsonb
)
returns api.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_existing api.products;
  v_result api.products;
  v_limit integer;
  v_active integer;
  v_name text := btrim(p_name);
  v_sku text := nullif(btrim(p_sku), '');
  v_category text := nullif(btrim(p_category), '');
  v_brands text[] := coalesce(p_brands, '{}');
  v_attributes jsonb := coalesce(p_attributes, '{}'::jsonb);
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_idempotency_key is null or p_external_id is null then
    raise exception 'idempotency_key and external_id are required'
      using errcode = '22023';
  end if;

  if p_name is null or char_length(v_name) = 0 then
    raise exception 'product name is required' using errcode = '22023';
  end if;

  if jsonb_typeof(v_attributes) <> 'object' then
    raise exception 'attributes must be an object' using errcode = '22023';
  end if;

  perform private.ensure_account(v_owner, null);

  perform pg_advisory_xact_lock(
    hashtextextended('alo:create-product:' || v_owner::text, 0)
  );

  select *
  into v_existing
  from api.products
  where owner_id = v_owner
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.external_id is distinct from p_external_id
      or v_existing.product_number is distinct from p_product_number
      or v_existing.name is distinct from v_name
      or v_existing.sku is distinct from v_sku
      or v_existing.category is distinct from v_category
      or v_existing.brands is distinct from v_brands
      or v_existing.validity_days is distinct from p_validity_days
      or v_existing.price is distinct from p_price
      or v_existing.qr_stock_control is distinct from p_qr_stock_control
      or v_existing.attributes is distinct from v_attributes
    then
      raise exception 'idempotency key reused with different payload'
        using
          errcode = '22023',
          detail = '{"code":"IDEMPOTENCY_CONFLICT"}';
    end if;

    return v_existing;
  end if;

  select p.max_active_products
  into strict v_limit
  from api.plans p
  where p.code = private.effective_plan_code(v_owner, v_now)
    and p.is_active;

  if v_limit is not null then
    select count(*)
    into v_active
    from api.products
    where owner_id = v_owner
      and archived_at is null;

    if v_active >= v_limit then
      raise exception 'active product limit reached'
        using
          errcode = 'P0001',
          detail = jsonb_build_object(
            'code', 'PRODUCT_LIMIT_REACHED',
            'limit', v_limit,
            'active', v_active
          )::text;
    end if;
  end if;

  insert into api.products (
    owner_id,
    external_id,
    idempotency_key,
    product_number,
    name,
    sku,
    category,
    brands,
    validity_days,
    price,
    qr_stock_control,
    attributes,
    created_at,
    updated_at
  )
  values (
    v_owner,
    p_external_id,
    p_idempotency_key,
    p_product_number,
    v_name,
    v_sku,
    v_category,
    v_brands,
    p_validity_days,
    p_price,
    p_qr_stock_control,
    v_attributes,
    v_now,
    v_now
  )
  returning * into v_result;

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
    'product.created',
    'product',
    v_result.id,
    p_idempotency_key,
    jsonb_build_object('external_id', p_external_id)
  );

  return v_result;
end
$$;

create function api.set_product_archived(
  p_product_id uuid,
  p_archived boolean,
  p_request_id uuid default gen_random_uuid()
)
returns api.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_current api.products;
  v_result api.products;
  v_limit integer;
  v_active integer;
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_product_id is null or p_archived is null or p_request_id is null then
    raise exception 'invalid archive request' using errcode = '22023';
  end if;

  perform private.ensure_account(v_owner, null);

  perform pg_advisory_xact_lock(
    hashtextextended('alo:create-product:' || v_owner::text, 0)
  );

  select *
  into v_current
  from api.products
  where id = p_product_id
    and owner_id = v_owner
  for update;

  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if p_archived = (v_current.archived_at is not null) then
    return v_current;
  end if;

  if not p_archived then
    select p.max_active_products
    into strict v_limit
    from api.plans p
    where p.code = private.effective_plan_code(v_owner, v_now)
      and p.is_active;

    if v_limit is not null then
      select count(*)
      into v_active
      from api.products
      where owner_id = v_owner
        and archived_at is null;

      if v_active >= v_limit then
        raise exception 'active product limit reached'
          using
            errcode = 'P0001',
            detail = jsonb_build_object(
              'code', 'PRODUCT_LIMIT_REACHED',
              'limit', v_limit,
              'active', v_active
            )::text;
      end if;
    end if;
  end if;

  update api.products
  set
    archived_at = case when p_archived then v_now else null end,
    updated_at = v_now
  where id = p_product_id
    and owner_id = v_owner
  returning * into v_result;

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
    case when p_archived then 'product.archived'
      else 'product.unarchived' end,
    'product',
    v_result.id,
    p_request_id,
    '{}'::jsonb
  );

  return v_result;
end
$$;

create function api.generate_labels(
  p_idempotency_key uuid,
  p_quantity integer,
  p_payload_snapshot jsonb,
  p_product_id uuid default null,
  p_template_id uuid default null
)
returns api.label_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'America/Fortaleza')::date;
  v_limit integer;
  v_used integer := 0;
  v_existing api.label_jobs;
  v_result api.label_jobs;
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_idempotency_key is null
    or p_quantity is null
    or p_quantity not between 1 and 1000
    or p_payload_snapshot is null
    or jsonb_typeof(p_payload_snapshot) <> 'object'
  then
    raise exception 'invalid label request' using errcode = '22023';
  end if;

  perform private.ensure_account(v_owner, null);

  perform pg_advisory_xact_lock(
    hashtextextended(
      'alo:labels:' || v_owner::text || ':' || v_day::text,
      0
    )
  );

  select *
  into v_existing
  from api.label_jobs
  where owner_id = v_owner
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.product_id is distinct from p_product_id
      or v_existing.template_id is distinct from p_template_id
      or v_existing.quantity is distinct from p_quantity
      or v_existing.payload_snapshot is distinct from p_payload_snapshot
    then
      raise exception 'idempotency key reused with different payload'
        using
          errcode = '22023',
          detail = '{"code":"IDEMPOTENCY_CONFLICT"}';
    end if;

    return v_existing;
  end if;

  if p_product_id is not null and not exists (
    select 1
    from api.products
    where id = p_product_id
      and owner_id = v_owner
      and archived_at is null
  ) then
    raise exception 'active product not found' using errcode = 'P0002';
  end if;

  if p_template_id is not null and not exists (
    select 1
    from api.label_templates
    where id = p_template_id
      and owner_id = v_owner
      and archived_at is null
  ) then
    raise exception 'active template not found' using errcode = 'P0002';
  end if;

  select p.max_daily_labels
  into strict v_limit
  from api.plans p
  where p.code = private.effective_plan_code(v_owner, v_now)
    and p.is_active;

  select labels_generated
  into v_used
  from api.daily_usage
  where owner_id = v_owner
    and usage_date = v_day;

  v_used := coalesce(v_used, 0);

  if v_limit is not null and v_used + p_quantity > v_limit then
    raise exception 'daily label limit reached'
      using
        errcode = 'P0001',
        detail = jsonb_build_object(
          'code', 'DAILY_LABEL_LIMIT_REACHED',
          'limit', v_limit,
          'used', v_used,
          'requested', p_quantity,
          'day', v_day
        )::text;
  end if;

  insert into api.daily_usage (
    owner_id,
    usage_date,
    labels_generated,
    updated_at
  )
  values (
    v_owner,
    v_day,
    p_quantity,
    v_now
  )
  on conflict (owner_id, usage_date)
  do update
  set
    labels_generated =
      api.daily_usage.labels_generated + excluded.labels_generated,
    updated_at = excluded.updated_at;

  insert into api.label_jobs (
    owner_id,
    idempotency_key,
    product_id,
    template_id,
    quantity,
    usage_date,
    status,
    payload_snapshot,
    generated_at
  )
  values (
    v_owner,
    p_idempotency_key,
    p_product_id,
    p_template_id,
    p_quantity,
    v_day,
    'generated',
    p_payload_snapshot,
    v_now
  )
  returning * into v_result;

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
    'labels.generated',
    'label_job',
    v_result.id,
    p_idempotency_key,
    jsonb_build_object(
      'quantity', p_quantity,
      'usage_date', v_day
    )
  );

  return v_result;
end
$$;

alter function api.bootstrap_account(text) owner to app_rpc_executor;
alter function api.create_product(
  uuid,
  uuid,
  text,
  bigint,
  text,
  text,
  text[],
  integer,
  numeric,
  boolean,
  jsonb
) owner to app_rpc_executor;
alter function api.set_product_archived(uuid, boolean, uuid)
  owner to app_rpc_executor;
alter function api.generate_labels(uuid, integer, jsonb, uuid, uuid)
  owner to app_rpc_executor;

revoke create on schema api from app_rpc_executor;

revoke all on all functions in schema api, private
from public, anon, authenticated;

grant execute on function private.ensure_account(uuid, text)
to app_rpc_executor;
grant execute on function private.effective_plan_code(uuid, timestamptz)
to app_rpc_executor;

grant execute on function api.bootstrap_account(text)
to authenticated;
grant execute on function api.create_product(
  uuid,
  uuid,
  text,
  bigint,
  text,
  text,
  text[],
  integer,
  numeric,
  boolean,
  jsonb
) to authenticated;
grant execute on function api.set_product_archived(uuid, boolean, uuid)
to authenticated;
grant execute on function api.generate_labels(
  uuid,
  integer,
  jsonb,
  uuid,
  uuid
) to authenticated;

grant execute on all functions in schema api, private
to service_role;

revoke all on all tables in schema api
from public, anon;
revoke all on all tables in schema billing_private, audit_private
from public, anon, authenticated;
revoke all on all sequences in schema api, billing_private, audit_private
from public, anon, authenticated;

-- Make the isolated API surface effective immediately. The Supabase dashboard
-- will no longer manage this list until the override is reset.
alter role authenticator set pgrst.db_schemas = 'api';
notify pgrst, 'reload config';

commit;
