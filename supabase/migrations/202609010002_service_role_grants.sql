-- Edge Functions use the server-only service role. The key never ships to the app.
grant select, insert, update, delete on api.module_states to service_role;
grant select, insert, update, delete on api.sync_operations to service_role;
