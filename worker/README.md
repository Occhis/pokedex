# Yokai TCG Proxy — Despliegue

Este Worker de Cloudflare tiene una sola tarea: ocultar tu API key de
Pokémon TCG. Es gratis (100.000 requests/día en el plan free) y **no pide
tarjeta de crédito** para usarlo.

El inventario y el login de admin ahora los maneja Firebase directamente
(ver `firebase-setup.md` en la raíz del proyecto) — este Worker no sabe
nada de eso.

## 1. Instalar Wrangler (CLI de Cloudflare)

```bash
npm install -g wrangler
wrangler login
```

Se abre el navegador para loguearte con una cuenta de Cloudflare (gratis,
sin tarjeta).

## 2. Cargar la API key como secret

Desde la carpeta `worker/`:

```bash
cd worker
wrangler secret put POKEMON_API_KEY
# pegá tu API key real de pokemontcg.io cuando te la pida
```

## 3. Desplegar

```bash
wrangler deploy
```

Te va a dar una URL tipo:
`https://yokai-tcg-proxy.TU_SUBDOMINIO.workers.dev`

## 4. Conectar el frontend

Copiá esa URL y pegala en `app.js`, en la constante `WORKER_URL` (arriba
del todo).

## 5. (Recomendado) Restringir CORS a tu dominio

En `src/index.js`, cambiá:
```js
const ALLOWED_ORIGIN = "*";
```
por tu dominio real, por ejemplo:
```js
const ALLOWED_ORIGIN = "https://tuusuario.github.io";
```
y volvé a correr `wrangler deploy`.
