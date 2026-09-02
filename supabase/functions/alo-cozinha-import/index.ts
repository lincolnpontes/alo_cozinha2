import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({ status: "closed", message: "A importação inicial já foi concluída." }),
  { status: 410, headers: { "Content-Type": "application/json" } },
));
