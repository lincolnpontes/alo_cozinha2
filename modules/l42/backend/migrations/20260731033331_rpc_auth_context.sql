begin;

-- The constrained RPC owner may read the authenticated user's JWT subject via
-- auth.uid(), but receives no access to Auth tables.
grant usage on schema auth to app_rpc_executor;
grant execute on function auth.uid() to app_rpc_executor;

commit;
