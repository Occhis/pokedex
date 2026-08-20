// ============================================================================
// CONFIGURACIÓN — completá esto después de desplegar
// ============================================================================

// URL de tu Worker de Cloudflare (ver worker/README.md). Solo se usa para
// buscar cartas en la API de Pokémon TCG sin exponer la key.
const WORKER_URL = "https://yokai-tcg-proxy.tomiocchiuto.workers.dev";

// Config de tu proyecto de Firebase (Configuración del proyecto > Tus apps >
// ícono web </> en la consola de Firebase). Ver firebase-setup.md.
const firebaseConfig = {
  apiKey: "AIzaSyDt3bP-bFGzcTOIDRP0DVAhxJCi34FykZ8",
  authDomain: "pokeinventory-2baf3.firebaseapp.com",
  projectId: "pokeinventory-2baf3",
  storageBucket: "pokeinventory-2baf3.firebasestorage.app",
  messagingSenderId: "845002464463",
  appId: "1:845002464463:web:df19e188968595ad822bba"
};

// Email fijo de la cuenta admin en Firebase Authentication. No es secreto
// (el secreto real es la contraseña) — es solo el identificador del usuario
// que vas a crear en la consola de Firebase. Ver firebase-setup.md.
const ADMIN_EMAIL = "poshito@tcg.com";

// ============================================================================

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let isAdmin = false;
let allCards = [];
let inventory = {}; // caché en memoria, sincronizada en tiempo real con Firestore
let prices = {}; // precios manuales por carta (colección "prices"), también en tiempo real

let debounceTimer = null;
let unsubscribeInventory = null;
let unsubscribePrices = null;

// ---------------------------------------------------------------------------
// Autenticación de admin (Firebase Auth maneja la sesión de forma segura;
// no hay nada casero para falsificar desde la consola del navegador)
// ---------------------------------------------------------------------------

async function toggleAdminMode() {
  if (!isAdmin) {
    const pass = prompt("Introduce la contraseña de Administrador:");
    if (pass === null) return; // cancelado

    try {
      await auth.signInWithEmailAndPassword(ADMIN_EMAIL, pass);
      // isAdmin se actualiza solo vía onAuthStateChanged
    } catch (err) {
      alert("Contraseña incorrecta.");
    }
  } else {
    await auth.signOut();
  }
}

auth.onAuthStateChanged(user => {
  isAdmin = !!user;
  updateAdminUI();
  applyFilters();
});

function updateAdminUI() {
  const dot = document.getElementById('adminStatusDot');
  const text = document.getElementById('adminBtnText');
  const btn = document.getElementById('adminToggleBtn');

  if (isAdmin) {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
    if (text) text.textContent = "Admin Activo 🔓";
    if (btn) btn.className = "px-3 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-950/40 text-emerald-300 text-xs font-semibold transition flex items-center gap-2";
  } else {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-slate-500";
    if (text) text.textContent = "Modo Cliente 🔒";
    if (btn) btn.className = "px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition flex items-center gap-2";
  }
}

// ---------------------------------------------------------------------------
// Inventario: sincronizado en tiempo real con Firestore (colección "inventory",
// un documento por cada combinación cardId_condicion)
// ---------------------------------------------------------------------------

function startInventorySync() {
  const syncDot = document.getElementById('syncStatusDot');

  unsubscribeInventory = db.collection('inventory').onSnapshot(
    snapshot => {
      const newInventory = {};
      snapshot.forEach(doc => {
        newInventory[doc.id] = doc.data();
      });
      inventory = newInventory;
      if (syncDot) syncDot.className = "w-2 h-2 rounded-full bg-emerald-400";
      updateStats();
      applyFilters();
    },
    err => {
      console.error("Error de sincronización con Firestore:", err);
      if (syncDot) syncDot.className = "w-2 h-2 rounded-full bg-red-500";
    }
  );
}

// Actualiza stock de forma atómica (transacción) para que dos dispositivos
// tocando el mismo botón casi a la vez no se pisen entre sí.
async function updateQty(cardId, condition, delta) {
  if (!isAdmin) return;

  const key = `${cardId}_${condition}`;
  const docRef = db.collection('inventory').doc(key);

  let cardData = allCards.find(c => c.id === cardId);
  if (!cardData && inventory[key]?.cardData) cardData = inventory[key].cardData;

  const qtyLabel = document.getElementById(`qty-${cardId}-${condition}`);
  const buttons = qtyLabel?.parentElement?.querySelectorAll('button');
  if (buttons) buttons.forEach(b => (b.disabled = true));

  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(docRef);
      const currentQty = doc.exists ? (doc.data().quantity || 0) : 0;
      const newQty = Math.max(0, currentQty + delta);

      if (newQty > 0) {
        const source = cardData || (doc.exists ? doc.data().cardData : null);
        if (!source) throw new Error("Faltan datos de la carta");

        tx.set(docRef, {
          quantity: newQty,
          cardData: {
            id: source.id,
            name: source.name,
            number: source.number,
            images: { small: source.images?.small || '' },
            set: { name: source.set?.name || '' },
            tcgplayer: source.tcgplayer || null,
          },
        });
      } else {
        tx.delete(docRef);
      }
    });
    // No hace falta tocar `inventory` a mano: el listener onSnapshot de
    // startInventorySync() lo actualiza solo, en todos los dispositivos.
  } catch (err) {
    alert(`No se pudo guardar el cambio de stock (${err.message}).`);
  } finally {
    if (buttons) buttons.forEach(b => (b.disabled = false));
  }
}

// ---------------------------------------------------------------------------
// Precios manuales: el TCGPlayer es solo referencia para el admin. Lo único
// que ve el cliente es este precio, que el vendedor carga a mano por carta
// (colección "prices", un documento por cardId — no por condición, ya que
// el precio de venta es el mismo sin importar NM/LP/MP).
// ---------------------------------------------------------------------------

function startPriceSync() {
  unsubscribePrices = db.collection('prices').onSnapshot(
    snapshot => {
      const newPrices = {};
      snapshot.forEach(doc => {
        newPrices[doc.id] = doc.data();
      });
      prices = newPrices;
      applyFilters();
    },
    err => {
      console.error("Error de sincronización de precios:", err);
    }
  );
}

async function savePrice(cardId) {
  if (!isAdmin) return;

  const input = document.getElementById(`price-input-${cardId}`);
  if (!input) return;

  const raw = input.value.trim();
  const value = raw === '' ? null : parseFloat(raw);

  if (raw !== '' && (isNaN(value) || value < 0)) {
    alert("Ingresá un precio válido (un número mayor o igual a 0).");
    return;
  }

  const docRef = db.collection('prices').doc(cardId);
  input.disabled = true;

  try {
    if (value === null) {
      await docRef.delete();
    } else {
      await docRef.set({
        manualPrice: value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    // No hace falta tocar `prices` a mano: el listener de startPriceSync()
    // lo actualiza solo, en todos los dispositivos.
  } catch (err) {
    alert(`No se pudo guardar el precio (${err.message}).`);
  } finally {
    input.disabled = false;
  }
}

// Busca el precio "market" de TCGPlayer entre TODAS las variantes que
// devuelva la carta (holofoil, normal, reverseHolofoil, 1stEditionHolofoil,
// unlimitedHolofoil, etc.) en vez de mirar solo dos fijas. Antes, cartas
// cuyo único precio venía bajo una variante distinta a "holofoil"/"normal"
// mostraban "N/D" aunque sí tuvieran precio — este es el fix de ese bug.
function getTcgPlayerMarketPrice(card) {
  const priceVariants = card.tcgplayer?.prices;
  if (!priceVariants) return null;

  for (const variant of Object.values(priceVariants)) {
    if (variant && typeof variant.market === 'number' && variant.market > 0) {
      return variant.market;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Búsqueda de cartas (vía Worker, que oculta la API key)
// ---------------------------------------------------------------------------

function onSearchInput() {
  const inputEl = document.getElementById('searchInput');
  if (!inputEl) return;
  const query = inputEl.value.trim();
  const spinner = document.getElementById('searchSpinner');
  clearTimeout(debounceTimer);

  if (!query) {
    loadCatalogStock();
    return;
  }

  if (spinner) spinner.classList.remove('hidden');
  debounceTimer = setTimeout(() => {
    executeSearch(query);
  }, 400);
}

// Carga directa del catálogo (cartas con stock > 0) desde el inventario ya
// sincronizado en memoria — no pega a ninguna API.
function loadCatalogStock() {
  const grid = document.getElementById('cardsGrid');
  const spinner = document.getElementById('searchSpinner');

  if (spinner) spinner.classList.add('hidden');

  const cardMap = {};

  Object.keys(inventory).forEach(key => {
    const entry = inventory[key];
    if (!entry) return;

    const qty = entry.quantity || 0;
    const cardData = entry.cardData;
    const cardId = key.split('_')[0];

    if (qty > 0 && cardData) {
      cardMap[cardId] = cardData;
    }
  });

  allCards = Object.values(cardMap);

  if (allCards.length === 0) {
    if (grid) {
      grid.innerHTML = `
        <div class="col-span-full text-center py-16 space-y-3">
          <p class="text-slate-400 text-base">El catálogo está vacío actualmente.</p>
          <p class="text-xs text-slate-500">Escribe el nombre de un Pokémon en el buscador superior para agregar cartas al stock.</p>
        </div>`;
    }
    return;
  }

  renderCards(allCards);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Trae una página puntual de la API (vía Worker), con reintentos ante fallos
// de red o 5xx (la API pública de Pokémon TCG suele ser inestable)
async function fetchPageWithRetry(url, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status >= 500 && attempt < maxRetries) {
          lastError = new Error(`Estado HTTP ${response.status}`);
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw new Error(`Estado HTTP ${response.status}`);
      }

      return await response.json();

    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError;
}

// Búsqueda en Pokémon TCG API (vía Worker): trae TODAS las páginas de
// resultados para el Pokémon buscado
async function executeSearch(query) {
  const grid = document.getElementById('cardsGrid');
  const spinner = document.getElementById('searchSpinner');

  try {
    const cleanQuery = query.replace(/[^a-zA-Z0-9\s]/g, "").trim();
    if (!cleanQuery) return;

    const pageSize = 250; // máximo permitido por la API
    let page = 1;
    let totalCount = Infinity;
    let collected = [];

    while (collected.length < totalCount) {
      if (spinner) spinner.textContent = `Cargando... (${collected.length}${totalCount !== Infinity ? '/' + totalCount : ''})`;

      const url = `${WORKER_URL}/api/cards?q=name:"${encodeURIComponent(cleanQuery)}"&pageSize=${pageSize}&page=${page}`;
      const result = await fetchPageWithRetry(url);

      if (!result.data || result.data.length === 0) break;

      collected = collected.concat(result.data);
      totalCount = typeof result.totalCount === 'number' ? result.totalCount : collected.length;
      page++;

      if (page > 20) break; // salvavidas anti-loop
    }

    if (spinner) {
      spinner.classList.add('hidden');
      spinner.textContent = 'Cargando...';
    }

    if (collected.length === 0) {
      if (grid) {
        grid.innerHTML = `<p class="col-span-full text-center text-slate-500 py-16">No se encontraron cartas con el nombre "${query}".</p>`;
      }
      allCards = [];
      return;
    }

    allCards = collected;
    renderCards(allCards);

  } catch (err) {
    if (spinner) {
      spinner.classList.add('hidden');
      spinner.textContent = 'Cargando...';
    }
    if (grid) {
      grid.innerHTML = `<p class="col-span-full text-center text-red-400 py-16">Error al consultar la API (${err.message}). Intenta buscar escribiendo el nombre exacto.</p>`;
    }
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderCards(cards) {
  const grid = document.getElementById('cardsGrid');
  const filterStockEl = document.getElementById('filterStock');
  const filterStock = filterStockEl ? filterStockEl.value : 'in_stock';

  if (!grid) return;
  grid.innerHTML = '';

  let displayedCount = 0;

  cards.forEach(card => {
    const tcgMarketPrice = getTcgPlayerMarketPrice(card);
    const manualPrice = typeof prices[card.id]?.manualPrice === 'number' ? prices[card.id].manualPrice : null;

    const getQty = (cond) => inventory[`${card.id}_${cond}`]?.quantity || 0;

    const qtyNM = getQty('NM');
    const qtyLP = getQty('LP');
    const qtyMP = getQty('MP');

    const totalCardStock = qtyNM + qtyLP + qtyMP;

    if (filterStock === 'in_stock' && totalCardStock <= 0) return;

    displayedCount++;

    const cardNode = document.createElement('div');
    cardNode.className = "bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col justify-between hover:border-pink-500/50 transition group shadow-lg";

    let stockControlHTML = '';

    if (isAdmin) {
      stockControlHTML = `
        <div class="pt-2 border-t border-slate-800 space-y-1.5 text-xs">
          <div class="flex items-center justify-between bg-slate-950/60 px-2 py-1 rounded border border-slate-800/80">
            <span class="text-pink-400 font-bold text-[10px]">NM</span>
            <div class="flex items-center gap-1.5">
              <button onclick="updateQty('${card.id}', 'NM', -1)" class="w-5 h-5 bg-slate-800 hover:bg-red-600 rounded text-xs font-bold flex items-center justify-center">-</button>
              <span id="qty-${card.id}-NM" class="font-bold w-4 text-center">${qtyNM}</span>
              <button onclick="updateQty('${card.id}', 'NM', 1)" class="w-5 h-5 bg-slate-800 hover:bg-emerald-600 rounded text-xs font-bold flex items-center justify-center">+</button>
            </div>
          </div>

          <div class="flex items-center justify-between bg-slate-950/60 px-2 py-1 rounded border border-slate-800/80">
            <span class="text-yellow-400 font-bold text-[10px]">LP</span>
            <div class="flex items-center gap-1.5">
              <button onclick="updateQty('${card.id}', 'LP', -1)" class="w-5 h-5 bg-slate-800 hover:bg-red-600 rounded text-xs font-bold flex items-center justify-center">-</button>
              <span id="qty-${card.id}-LP" class="font-bold w-4 text-center">${qtyLP}</span>
              <button onclick="updateQty('${card.id}', 'LP', 1)" class="w-5 h-5 bg-slate-800 hover:bg-emerald-600 rounded text-xs font-bold flex items-center justify-center">+</button>
            </div>
          </div>

          <div class="flex items-center justify-between bg-slate-950/60 px-2 py-1 rounded border border-slate-800/80">
            <span class="text-orange-400 font-bold text-[10px]">MP</span>
            <div class="flex items-center gap-1.5">
              <button onclick="updateQty('${card.id}', 'MP', -1)" class="w-5 h-5 bg-slate-800 hover:bg-red-600 rounded text-xs font-bold flex items-center justify-center">-</button>
              <span id="qty-${card.id}-MP" class="font-bold w-4 text-center">${qtyMP}</span>
              <button onclick="updateQty('${card.id}', 'MP', 1)" class="w-5 h-5 bg-slate-800 hover:bg-emerald-600 rounded text-xs font-bold flex items-center justify-center">+</button>
            </div>
          </div>
        </div>
      `;
    } else {
      stockControlHTML = `
        <div class="pt-2 border-t border-slate-800 flex flex-wrap gap-1.5 text-[11px]">
          ${qtyNM > 0 ? `<span class="bg-pink-950/60 text-pink-300 border border-pink-500/30 px-2 py-0.5 rounded-md font-semibold">${qtyNM}x NM</span>` : ''}
          ${qtyLP > 0 ? `<span class="bg-yellow-950/60 text-yellow-300 border border-yellow-500/30 px-2 py-0.5 rounded-md font-semibold">${qtyLP}x LP</span>` : ''}
          ${qtyMP > 0 ? `<span class="bg-orange-950/60 text-orange-300 border border-orange-500/30 px-2 py-0.5 rounded-md font-semibold">${qtyMP}x MP</span>` : ''}
          ${totalCardStock === 0 ? `<span class="text-slate-500 italic">Sin Stock</span>` : ''}
        </div>
      `;
    }

    let priceSectionHTML = '';

    if (isAdmin) {
      priceSectionHTML = `
        <p class="text-[10px] text-slate-500 mb-1">
          TCGPlayer (ref.): ${tcgMarketPrice != null ? '$' + tcgMarketPrice.toFixed(2) : 'N/D'}
        </p>
        <div class="flex items-center gap-1.5 mb-3">
          <span class="text-emerald-400 text-xs font-bold">$</span>
          <input
            type="number"
            id="price-input-${card.id}"
            value="${manualPrice != null ? manualPrice.toFixed(2) : ''}"
            placeholder="Precio a mostrar"
            step="0.01"
            min="0"
            class="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-pink-500"
          >
          <button
            onclick="savePrice('${card.id}')"
            class="px-2 py-1 bg-pink-600 hover:bg-pink-500 rounded text-[10px] font-bold whitespace-nowrap"
          >Guardar</button>
        </div>
      `;
    } else {
      priceSectionHTML = `
        <p class="text-xs font-semibold mb-3 ${manualPrice != null ? 'text-emerald-400' : 'text-slate-500 italic'}">
          ${manualPrice != null ? '$' + manualPrice.toFixed(2) + ' USD' : 'Precio a consultar'}
        </p>
      `;
    }

    cardNode.innerHTML = `
      <div>
        <div class="relative overflow-hidden rounded-lg mb-3 bg-slate-950 aspect-[2/3]">
          <img src="${card.images?.small || ''}" alt="${card.name}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
          ${totalCardStock > 0 ? `<span class="absolute top-2 right-2 bg-emerald-500/90 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded-full">${totalCardStock} Disponibles</span>` : ''}
        </div>
        <h3 class="font-bold text-sm text-slate-100 group-hover:text-pink-400 transition truncate">${card.name}</h3>
        <p class="text-xs text-slate-400 truncate mb-1">${card.set?.name || ''} • #${card.number}</p>
        ${priceSectionHTML}
      </div>

      ${stockControlHTML}
    `;

    grid.appendChild(cardNode);
  });

  if (displayedCount === 0) {
    grid.innerHTML = `<p class="col-span-full text-center text-slate-500 py-16">No hay cartas registradas en el catálogo actual.</p>`;
  }
}

function applyFilters() {
  const searchInput = document.getElementById('searchInput');
  const query = searchInput ? searchInput.value.trim() : '';
  if (!query) {
    loadCatalogStock();
  } else {
    renderCards(allCards);
  }
}

function updateStats() {
  let total = 0;
  let uniqueSet = new Set();

  Object.keys(inventory).forEach(key => {
    const entry = inventory[key];
    const qty = entry?.quantity || 0;

    if (qty > 0) {
      total += qty;
      uniqueSet.add(key.split('_')[0]);
    }
  });

  const uniqueEl = document.getElementById('statUnique');
  const totalEl = document.getElementById('statTotal');

  if (uniqueEl) uniqueEl.textContent = uniqueSet.size;
  if (totalEl) totalEl.textContent = total;
}

// ---------------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  startInventorySync();
  startPriceSync();
});
