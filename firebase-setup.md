# Configurar Firebase — sin CLI, todo desde la consola web

Esto es 100% gratis (plan "Spark") y **no pide tarjeta de crédito**.

## 1. Crear el proyecto

1. Andá a https://console.firebase.google.com
2. "Agregar proyecto" → ponele un nombre (ej. "yokai-tcg") → seguí los
   pasos (podés desactivar Google Analytics, no lo necesitás).

## 2. Registrar una app web

1. En la pantalla principal del proyecto, hacé clic en el ícono `</>`
   ("Web").
2. Ponele un apodo (ej. "pokedex-web") y **no** marques Firebase Hosting
   por ahora.
3. Te va a mostrar un bloque `firebaseConfig = { apiKey: ..., authDomain: ...}`.
   Copiá ese objeto completo.
4. Pegalo en `app.js`, reemplazando el objeto `firebaseConfig` de ejemplo
   (cerca de la línea 10).

## 3. Activar Firestore (la base de datos)

1. En el menú lateral: **Compilación → Firestore Database**.
2. "Crear base de datos".
3. Elegí modo **producción** (no "modo de prueba" — vamos a poner reglas
   propias en el paso 5).
4. Elegí la región más cercana (para Argentina, `southamerica-east1` — San
   Pablo — suele ser la más rápida).

## 4. Activar Authentication (para el login de admin)

1. En el menú lateral: **Compilación → Authentication**.
2. "Comenzar" → pestaña **Sign-in method** → habilitá **Correo
   electrónico/contraseña**.
3. Andá a la pestaña **Users** → "Agregar usuario".
4. Como email poné el mismo valor que tenga `ADMIN_EMAIL` en `app.js`
   (por defecto `admin@yokai-tcg.local` — no hace falta que sea un email
   real, Firebase lo trata solo como un identificador de cuenta).
5. Como contraseña, elegí una fuerte — **esta es la contraseña real que
   vas a usar para entrar en modo admin** en la app.

## 5. Configurar las reglas de seguridad de Firestore

1. Volvé a **Firestore Database → Reglas** (pestaña arriba).
2. Reemplazá todo el contenido por el archivo `firestore.rules` de este
   proyecto (o copiá y pegá su contenido directamente).
3. "Publicar".

Esto asegura que cualquiera pueda *ver* el stock (para que los clientes
naveguen el catálogo), pero solo alguien logueado con tu cuenta admin
pueda *modificarlo*.

## 6. Probar

1. Asegurate de haber completado también `WORKER_URL` en `app.js` (ver
   `worker/README.md`) y el `firebaseConfig` del paso 2.
2. Abrí `pokedex.html` con un servidor local:
   ```bash
   python -m http.server 8000
   ```
   y entrá a `http://localhost:8000/pokedex.html`.
3. Buscá un Pokémon, entrá como admin con la contraseña del paso 4, sumá
   stock.
4. Abrí la misma URL en **otra pestaña o en tu celular** — el stock
   debería aparecer sincronizado, y si sumás/restás en un lado, el otro
   se actualiza solo en segundos (tiempo real, sin recargar).

## Notas

- El `apiKey` que copiaste en `firebaseConfig` **no es secreto** — Firebase
  está diseñado así a propósito; la seguridad real la dan las reglas de
  Firestore (paso 5) y Authentication, no ese valor. Es normal y seguro
  que esté visible en el JS del cliente.
- La API key de **Pokémon TCG** (la otra, distinta) sigue oculta en el
  Worker de Cloudflare — no toques eso.
- Si en algún momento querés agregar más de un admin, repetís el paso 4.4
  con otro email/contraseña.
