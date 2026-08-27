const AUTH_PAGE = "https://lincolnpontes.github.io/alo-etiqueta-conta/";

Deno.serve((request: Request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Método não permitido", {
      status: 405,
      headers: { Allow: "GET, HEAD" }
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: AUTH_PAGE,
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer"
    }
  });
});
