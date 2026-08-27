begin;

-- Private billing tables intentionally expose no rows to APK roles. Explicit
-- deny policies document that decision and keep security audits unambiguous.
create policy billing_products_deny_client
on billing_private.billing_products
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create policy subscriptions_deny_client
on billing_private.subscriptions
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create policy billing_events_deny_client
on billing_private.billing_events
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

-- Supabase provisioned this helper outside the Alô Etiqueta schemas. It does
-- not need to be callable through a client role.
revoke execute on function public.rls_auto_enable()
from public, anon, authenticated;

commit;
