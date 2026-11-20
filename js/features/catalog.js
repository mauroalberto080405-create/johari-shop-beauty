/**
 * Catálogo: filtros por categoría, búsqueda y tarjetas de producto.
 */
import { CONFIG } from '../config.js';
import { $, h, icon, money, plural, searchText, setKids } from '../core/utils.js';
import { Product } from '../data/product.js';
import { Cart } from '../store/cart.js';
import { state, on, emit } from '../state.js';
import { Toast } from '../ui/feedback.js';
import { WhatsApp } from './whatsapp.js';
import { productImage } from './media.js';

/* ---------- Búsqueda y filtros ---------- */
function filtered() {
  const terms = searchText(state.query).split(' ').filter(Boolean);
  return Product.sort(state.products).filter((p) => {
    if (state.category !== 'Todos' && p.category !== state.category) return false;
    if (!terms.length) return true;
    const haystack = searchText(`${p.name} ${p.brand}`);
    return terms.every((t) => haystack.includes(t));
  });
}

function renderFilters() {
  const categories = ['Todos', ...CONFIG.CATEGORIES];
  setKids($('#categoryFilters'), categories.map((cat) => {
    const count = cat === 'Todos' ? state.products.length : state.products.filter((p) => p.category === cat).length;
    return h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(state.category === cat),
      onclick: () => {
        state.category = cat;
        renderFilters();
        renderCatalog();
      }
    }, cat, h('span', { class: 'chip__count' }, `(${count})`));
  }));
}

/* ---------- Estados del catálogo ---------- */
function skeleton() {
  return Array.from({ length: 8 }, () => h('li', { class: 'product-card', 'aria-hidden': 'true' },
    h('div', { class: 'product-card__inner' },
      h('div', { class: 'skeleton skeleton--media' }),
      h('div', { class: 'product-card__body' },
        h('div', { class: 'skeleton skeleton--line' }),
        h('div', { class: 'skeleton skeleton--line skeleton--line-short' }),
        h('div', { class: 'skeleton skeleton--btn' })))));
}

function clearFilters() {
  state.query = '';
  state.category = 'Todos';
  $('#searchInput').value = '';
  renderFilters();
  renderCatalog();
  $('#searchInput').focus();
}

export function renderCatalog() {
  const grid = $('#productGrid');
  const status = $('#catalogStatus');
  const count = $('#resultCount');

  if (!state.loaded) {
    setKids(status, h('p', { class: 'sr-only', role: 'status' }, 'Cargando catálogo…'));
    grid.setAttribute('aria-busy', 'true');
    setKids(grid, skeleton());
    count.textContent = '';
    return;
  }
  grid.removeAttribute('aria-busy');

  if (state.error && !state.products.length) {
    setKids(status, h('div', { class: 'notice notice--error', role: 'alert' },
      h('p', { class: 'notice__title' }, 'No se pudo cargar el catálogo.'),
      h('p', null, state.error),
      h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: () => location.reload() }, 'Reintentar')));
    setKids(grid);
    count.textContent = '';
    return;
  }

  const list = filtered();
  count.textContent = `${list.length} ${plural(list.length, 'producto', 'productos')}`;
  if (!list.length) {
    const hasProducts = state.products.length > 0;
    setKids(status, h('div', { class: 'empty-state' },
      h('p', { class: 'empty-state__title' }, hasProducts ? 'No encontramos productos que coincidan con tu búsqueda.' : 'Aún no hay productos en el catálogo.'),
      hasProducts ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: clearFilters }, 'Limpiar búsqueda y filtros') : null));
    setKids(grid);
    return;
  }
  setKids(status);
  setKids(grid, list.map(card));
}

/* ---------- Tarjeta de producto ---------- */
function stockBadge(status, qty) {
  if (status === 'out') return h('span', { class: 'badge badge--out' }, 'AGOTADO');
  if (status === 'unknown') return h('span', { class: 'badge badge--unknown' }, 'Stock por confirmar');
  return h('span', { class: 'badge badge--in' }, qty === undefined ? 'Disponible' : `Stock: ${qty} ${plural(qty, 'disponible', 'disponibles')}`);
}

function priceBlock(p, selectedId) {
  const hasVariants = p.variants.length > 0;
  let current;
  if (hasVariants && !selectedId) {
    const range = Product.priceRange(p);
    current = range
      ? h('span', { class: 'price__current' }, range.min === range.max ? money(range.min) : `Desde ${money(range.min)}`)
      : h('span', { class: 'price__current price__current--ask' }, 'Consultar precio');
  } else {
    const price = Product.price(p, selectedId);
    current = price === null
      ? h('span', { class: 'price__current price__current--ask' }, 'Consultar precio')
      : h('span', { class: 'price__current' }, money(price));
  }
  const variantHasOwnPrice = selectedId && Product.variant(p, selectedId)?.price !== null;
  const old = p.previousPrice && !variantHasOwnPrice
    ? h('span', { class: 'price__old' }, h('span', { class: 'sr-only' }, 'Precio anterior: '), h('s', null, money(p.previousPrice)))
    : null;
  return h('div', { class: 'price' }, current, old);
}

function variantPicker(p, selectedId) {
  const selectId = `var-${p.id}`;
  const errorId = `${selectId}-err`;
  const invalid = state.variantErrors.has(p.id);
  const select = h('select', { id: selectId, class: 'input input--sm', 'aria-describedby': errorId, 'aria-invalid': invalid ? 'true' : null },
    h('option', { value: '' }, 'Selecciona una opción'),
    p.variants.map((v) => {
      const stockText = v.stock === null ? 'stock por confirmar' : v.stock === 0 ? 'agotado' : `${v.stock} disp.`;
      const price = v.price !== null ? v.price : p.price;
      return h('option', { value: v.id, selected: v.id === selectedId, disabled: v.stock === 0 }, `${v.name}${price !== null ? ` — ${money(price)}` : ''} (${stockText})`);
    }));
  select.addEventListener('change', () => {
    if (select.value) state.selectedVariant.set(p.id, select.value);
    else state.selectedVariant.delete(p.id);
    state.variantErrors.delete(p.id);
    replaceCard(p.id, 'select');
  });
  return h('div', { class: 'field product-card__variant' },
    h('label', { for: selectId, class: 'field__label' }, 'Tono / presentación'),
    select,
    h('p', { id: errorId, class: 'field__error', hidden: !invalid }, 'Selecciona una opción para continuar.'));
}

function card(p) {
  const selectedId = state.selectedVariant.get(p.id) || null;
  const hasVariants = p.variants.length > 0;
  const status = Product.status(p, selectedId);
  const stock = Product.stock(p, selectedId);
  const price = hasVariants && !selectedId ? null : Product.price(p, selectedId);
  const inCart = Cart.qtyOf(p.id, selectedId);
  const headingId = `prod-${p.id}`;
  const hintId = `hint-${p.id}`;

  let disabled = false;
  let label = 'Agregar al carrito';
  let hint = null;
  if (status === 'out') { disabled = true; label = 'Agotado'; }
  else if (hasVariants && !selectedId) { /* se pide elegir opción al hacer clic */ }
  else if (price === null) { disabled = true; hint = 'Sin precio publicado: consulta por WhatsApp.'; }
  else if (status === 'unknown') { disabled = true; hint = 'Stock por confirmar: consulta disponibilidad por WhatsApp.'; }
  else if (stock !== null && inCart >= stock) { disabled = true; label = 'Máximo en el carrito'; hint = `Ya tienes las ${stock} unidades disponibles.`; }

  return h('li', { class: 'product-card', 'data-product-id': p.id },
    h('article', { class: 'product-card__inner', 'aria-labelledby': headingId },
      h('div', { class: 'product-card__media' },
        productImage(p),
        stockBadge(status, status === 'in' && (!hasVariants || selectedId) ? stock : undefined)),
      h('div', { class: 'product-card__body' },
        h('p', { class: 'product-card__category' }, p.category),
        h('h3', { id: headingId, class: 'product-card__name' }, p.name),
        p.brand ? h('p', { class: 'product-card__brand' }, p.brand) : null,
        p.presentation ? h('p', { class: 'product-card__presentation' }, p.presentation) : null,
        p.description ? h('details', { class: 'product-card__details' }, h('summary', null, 'Detalles'), h('p', null, p.description)) : null,
        hasVariants ? variantPicker(p, selectedId) : null,
        priceBlock(p, selectedId),
        h('div', { class: 'product-card__actions' },
          h('button', {
            type: 'button',
            class: 'btn btn--primary btn--block',
            disabled,
            'aria-describedby': hint ? hintId : null,
            'data-add': p.id,
            onclick: () => addToCart(p.id)
          }, label),
          hint ? h('p', { id: hintId, class: 'product-card__hint' }, hint) : null,
          inCart && !disabled ? h('p', { class: 'product-card__incart' }, `${inCart} en tu carrito`) : null,
          h('a', {
            href: WhatsApp.productQuery(p, selectedId),
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'btn btn--whatsapp-outline btn--block',
            'aria-label': `Consultar por WhatsApp: ${p.name}`
          }, icon('whatsapp', 'icon icon--sm'), 'Consultar por WhatsApp')))));
}

function replaceCard(productId, focus) {
  const product = state.products.find((p) => p.id === productId);
  const current = document.querySelector(`li[data-product-id="${CSS.escape(productId)}"]`);
  if (!product || !current) return;
  current.replaceWith(card(product));
  if (focus === 'select') document.getElementById(`var-${productId}`)?.focus();
  if (focus === 'add') {
    const btn = document.querySelector(`[data-add="${CSS.escape(productId)}"]`);
    if (btn && !btn.disabled) btn.focus();
  }
}

function addToCart(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) {
    Toast.show('Este producto ya no está disponible.', 'error');
    return;
  }
  const selectedId = state.selectedVariant.get(productId) || null;
  if (product.variants.length && !selectedId) {
    state.variantErrors.add(productId);
    replaceCard(productId, 'select');
    Toast.show('Selecciona un tono o presentación antes de agregar.', 'warn');
    return;
  }
  const error = Cart.add(product, selectedId);
  if (error) {
    Toast.show(error, 'warn');
    replaceCard(productId);
    return;
  }
  Toast.show(`Agregado: ${Product.label(product, selectedId)}`, 'success', 2600);
  emit('cart:bump');
  replaceCard(productId, 'add');
}

export function initCatalog() {
  let timer = null;
  $('#searchInput').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = event.target.value;
      renderCatalog();
    }, 120);
  });
  $('#exploreBtn').addEventListener('click', (event) => {
    event.preventDefault();
    $('#catalogo').scrollIntoView();
    $('#searchInput').focus({ preventScroll: true });
  });

  on('products', () => {
    renderFilters();
    renderCatalog();
  });
  // Los cambios del carrito hechos desde el panel lateral actualizan las tarjetas.
  on('cart:external', renderCatalog);

  renderFilters();
  renderCatalog();
}
