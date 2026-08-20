// ============================================================================
// Worker de Yokai Inventory TCG
// Única responsabilidad: ocultar la API key de Pokémon TCG. La API key nunca
// se descarga al navegador; el Worker la inyecta server-side en cada pedido.
//
// El inventario y el login de admin ahora los maneja Firebase directamente
// desde el cliente (ver firebase-setup.md) — por eso este Worker ya no
// necesita KV, secrets de admin, ni lógica de sesión.
// ============================================================================

const POKEMON_API_BASE = "https://api.pokemontcg.io/v2";

// Dominio(s) desde donde se sirve pokedex.html. Reemplazá "*" por tu dominio
// real antes de ir a producción, ej: "https://tuusuario.github.io"
const ALLOWED_ORIGIN = "*";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN === "*" ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// Proxea /api/cards -> api.pokemontcg.io/v2/cards, inyectando la API key
// server-side. El cliente nunca ve la key.
async function handleCardsProxy(request, env, origin) {
  const url = new URL(request.url);
  const upstreamUrl = `${POKEMON_API_BASE}/cards${url.search}`;

  const response = await fetch(upstreamUrl, {
    headers: { "X-Api-Key": env.POKEMON_API_KEY },
  });

  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === "/api/cards" && request.method === "GET") {
      return handleCardsProxy(request, env, origin);
    }

    return jsonResponse({ error: "Not found" }, 404, origin);
  },
};
