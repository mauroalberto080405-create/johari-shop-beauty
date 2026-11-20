/**
 * Panel de administración: inventario (crear, editar, eliminar, stock, variantes,
 * imágenes) y pedidos pagados en línea.
 * Solo es visible para la administradora; en Firebase, las reglas de Firestore
 * impiden que otra cuenta escriba productos aunque llame a la API directamente.
 */
import { ACTIVE_MODE, CONFIG } from '../config.js';
import { $, $$, h, hashCode, money, plural, randomId, searchText, setKids, slugify, Validate } from '../core/utils.js';
import { Product } from '../data/product.js';
import { services, state, on } from '../state.js';
import { Confirm, Modal, Toast } from '../ui/feedback.js';
import { friendlyError } from '../services/errors.js';
import { productImage } from './media.js';

let editingId = null;
let pendingImage = '';
let stopOrders = null;

const isAdmin = () => Boolean(services.auth?.current?.isAdmin);

function guard() {
  if (isAdmin()) return true;
  Toast.show('Solo la administradora autenticada puede usar el panel.', 'error');
  return false;
}

/* ---------- Pestañas ---------- */
function selectTab(name) {
  const inventory = name === 'inventory';
  $('#tabInventory').setAttribute('aria-selected', String(inventory));
  $('#tabOrders').setAttribute('aria-selected', String(!inventory));
  $('#tabInventory').tabIndex = inventory ? 0 : -1;
  $('#tabOrders').tabIndex = inventory ? -1 : 0;
  $('#panelInventory').hidden = !inventory;
  $('#panelOrders').hidden = inventory;
  if (!inventory) watchOrders();
}

/* ---------- Inventario ---------- */
function renderStats() {
  const products = state.products;
  const stat = (label, value, variant) => h('div', { class: `stat ${variant}` },
    h('p', { class: 'stat__label' }, label),
    h('p', { class: 'stat__value' }, String(value)));
  setKids($('#adminStats'),
    stat('Productos', products.length, ''),
    stat('Unidades disponibles', products.reduce((sum, p) => sum + Product.knownUnits(p), 0), 'stat--green'),
    stat('Agotados', products.filter((p) => Product.status(p) === 'out').length, 'stat--red'),
    stat('Stock por confirmar', products.filter((p) => Product.status(p) === 'unknown').length, 'stat--gold'));
}

function renderList() {
  const query = searchText($('#adminSearch').value);
  const filter = $('#adminFilter').value;
  const list = Product.sort(state.products).filter((p) => (!query || searchText(`${p.name} ${p.brand}`).includes(query))
    && (filter === 'all' || Product.status(p) === filter));
  $('#adminListCount').textContent = `${list.length} ${plural(list.length, 'producto', 'productos')} en la lista`;
  if (!list.length) {
    setKids($('#adminList'), h('li', { class: 'admin-empty' }, 'No hay productos que coincidan.'));
    return;
  }
  setKids($('#adminList'), list.map((p) => {
    const status = Product.status(p);
    const stockText = p.variants.length
      ? p.variants.map((v) => `${v.name}: ${v.stock === null ? 'por confirmar' : v.stock}`).join(' · ')
      : (p.stock === null ? 'Stock por confirmar' : `Stock: ${p.stock}`);
    const range = Product.priceRange(p);
    return h('li', { class: 'admin-item' },
      h('div', { class: 'admin-item__thumb' }, productImage(p)),
      h('div', null,
        h('p', { class: 'admin-item__name' }, p.name),
        h('p', { class: 'admin-item__meta' }, [p.brand, p.category, p.presentation].filter(Boolean).join(' · ')),
        h('p', { class: 'small' }, range ? (range.min === range.max ? money(range.min) : `${money(range.min)} – ${money(range.max)}`) : 'Consultar precio'),
        h('p', { class: `admin-item__meta ${status === 'out' ? 'admin-item__stock--out' : ''}` }, `${status === 'out' ? 'AGOTADO · ' : ''}${stockText}`),
        p.source ? h('p', { class: 'admin-item__meta' }, `Origen: ${p.source}`) : null),
      h('div', { class: 'admin-item__actions' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `Editar ${p.name}`, 'data-focus-key': `edit:${p.id}`, onclick: (e) => openForm(p.id, e.currentTarget) }, 'Editar'),
        h('button', { type: 'button', class: 'btn btn--danger-outline btn--sm', 'aria-label': `Eliminar ${p.name}`, 'data-focus-key': `del:${p.id}`, onclick: () => removeProduct(p.id) }, 'Eliminar')));
  }));
}

function render() {
  renderStats();
  renderList();
}

async function removeProduct(id) {
  if (!guard()) return;
  const product = state.products.find((p) => p.id === id);
  if (!product) return;
  const ok = await Confirm.ask({
    title: 'Eliminar producto',
    body: [`¿Eliminar «${product.name}»${product.brand ? ` de ${product.brand}` : ''}?`, 'Esta acción no se puede deshacer. Si algún cliente lo tiene en su carrito, se le avisará y se retirará.'],
    okText: 'Eliminar',
    danger: true
  });
  if (!ok) return;
  try {
    await services.backend.deleteProduct(id);
    Toast.show('Producto eliminado.', 'success');
    $('#adminSearch').focus();
  } catch (error) {
    Toast.show(`No se pudo eliminar: ${friendlyError(error)}`, 'error');
  }
}

async function importMissing() {
  if (!guard()) return;
  const ok = await Confirm.ask({
    title: 'Importar productos del PDF',
    body: ['Se agregarán los productos del catálogo inicial que no existan en el inventario (por ejemplo, los que eliminaste).', 'Los productos existentes no se modifican.'],
    okText: 'Importar'
  });
  if (!ok) return;
  try {
    const count = await services.backend.importMissing();
    Toast.show(count ? `Se importaron ${count} productos.` : 'No faltaba ningún producto del catálogo inicial.', 'success');
  } catch (error) {
    Toast.show(`No se pudo importar: ${friendlyError(error)}`, 'error');
  }
}

async function applyExampleStock() {
  if (!guard()) return;
  const items = CONFIG.EXAMPLE_STOCK
    .map((x) => ({ ...x, product: state.products.find((p) => p.id === x.id) }))
    .filter((x) => x.product && !x.product.variants.length);
  if (!items.length) {
    Toast.show('Ninguno de los productos de ejemplo está en el inventario.', 'warn');
    return;
  }
  const ok = await Confirm.ask({
    title: 'Aplicar stock de ejemplo',
    body: [
      'Estas cantidades son de prueba (no vienen del PDF). Úsalas solo para probar la tienda:',
      h('ul', null, items.map((x) => h('li', null, `${x.product.name} (${x.product.brand}): ${x.stock}`)))
    ],
    okText: 'Aplicar'
  });
  if (!ok) return;
  try {
    await services.backend.applyStock(items.map(({ id, stock }) => ({ id, stock })));
    Toast.show('Stock de ejemplo aplicado.', 'success');
  } catch (error) {
    Toast.show(`No se pudo aplicar: ${friendlyError(error)}`, 'error');
  }
}

/* ---------- Pedidos pagados ---------- */
const STATUS_LABEL = {
  paid: 'Pagado',
  paid_stock_conflict: 'Pagado · revisar stock (se vendió a la vez en otro pedido)'
};

function watchOrders() {
  if (stopOrders) return;
  setKids($('#orderList'), h('li', { class: 'admin-empty' }, 'Cargando pedidos…'));
  stopOrders = services.backend.watchOrders((orders) => {
    if (!orders.length) {
      setKids($('#orderList'), h('li', { class: 'admin-empty' }, ACTIVE_MODE === 'demo'
        ? 'En modo demostración no hay pagos en línea. Los pedidos pagados aparecerán aquí cuando se active Firebase y Culqi.'
        : 'Aún no hay pedidos pagados.'));
      return;
    }
    setKids($('#orderList'), orders.map((o) => h('li', { class: 'order-item' },
      h('div', { class: 'order-item__head' }, h('span', null, `Pedido N.° ${o.id}`), h('span', null, money(o.total || 0))),
      h('p', null, `${STATUS_LABEL[o.status] || o.status}${o.paidAt ? ` · ${o.paidAt.toLocaleString('es-PE')}` : ''}`),
      h('p', null, `${o.customer.fullName || ''} · ${o.customer.phone || ''} · ${o.customer.email || ''}`),
      h('p', { class: 'muted' }, `${o.customer.address || ''}, ${o.customer.district || ''} / ${o.customer.province || ''}${o.customer.reference ? ` (Ref.: ${o.customer.reference})` : ''}`),
      h('ul', { class: 'muted' }, o.lines.map((l) => h('li', null, `${l.qty} × ${l.name}${l.variantName ? ` (${l.variantName})` : ''} — ${money(l.unitPrice * l.qty)}`))),
      o.customer.notes ? h('p', null, `Observaciones: ${o.customer.notes}`) : null)));
  }, (error) => setKids($('#orderList'), h('li', { class: 'admin-empty' }, `No se pudieron cargar los pedidos: ${error.message}`)));
}

/* ---------- Formulario de producto ---------- */
function addVariantRow(variant) {
  const index = $$('#pfVariants .variant-row').length;
  const uid = randomId('vr');
  const unknown = variant ? variant.stock === null : true;
  const row = h('div', { class: 'variant-row', 'data-variant-id': variant ? variant.id : '' },
    h('div', { class: 'field variant-row__name' },
      h('label', { for: `${uid}n`, class: 'field__label' }, `Variante ${index + 1}: nombre`),
      h('input', { id: `${uid}n`, class: 'input input--sm', 'data-k': 'name', maxlength: '80', value: variant ? variant.name : '' })),
    h('div', { class: 'field' },
      h('label', { for: `${uid}p`, class: 'field__label' }, 'Precio (opcional)'),
      h('input', { id: `${uid}p`, class: 'input input--sm', 'data-k': 'price', inputmode: 'decimal', value: variant && variant.price !== null ? variant.price.toFixed(2) : '' })),
    h('div', { class: 'field' },
      h('label', { for: `${uid}s`, class: 'field__label' }, 'Stock'),
      h('input', { id: `${uid}s`, class: 'input input--sm', 'data-k': 'stock', inputmode: 'numeric', value: variant && variant.stock !== null ? String(variant.stock) : '', disabled: unknown })),
    h('div', { class: 'variant-row__end' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-k': 'unknown', checked: unknown }), 'Por confirmar'),
      h('button', { type: 'button', class: 'link-btn', 'aria-label': `Quitar variante ${index + 1}` }, 'Quitar')));
  const check = row.querySelector('[data-k=unknown]');
  const stockInput = row.querySelector('[data-k=stock]');
  check.addEventListener('change', () => {
    stockInput.disabled = check.checked;
    if (check.checked) stockInput.value = '';
    else stockInput.focus();
  });
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    syncStockVisibility();
    $('#pfAddVariant').focus();
  });
  $('#pfVariants').append(row);
}

function syncStockVisibility() {
  $('#pfStockWrap').hidden = $$('#pfVariants .variant-row').length > 0;
}

function imageError(message) {
  const el = $('#pfImage-err');
  el.textContent = message || '';
  el.hidden = !message;
}

function renderImagePreview() {
  const preview = $('#pfImagePreview');
  setKids(preview, productImage({ name: $('#pfName').value || 'producto', brand: '', image: pendingImage }));
  preview.querySelector('img')?.addEventListener('error', () => imageError('No se pudo cargar la imagen de esa URL. Verifica el enlace.'), { once: true });
}

function setError(id, message) {
  const el = document.getElementById(id);
  const err = document.getElementById(`${id}-err`);
  err.textContent = message || '';
  err.hidden = !message;
  if (message) el.setAttribute('aria-invalid', 'true');
  else el.removeAttribute('aria-invalid');
}

function openForm(id, opener) {
  if (!guard()) return;
  const product = id ? state.products.find((p) => p.id === id) : null;
  if (id && !product) {
    Toast.show('El producto ya no existe.', 'error');
    return;
  }
  editingId = product ? product.id : null;
  const form = $('#productForm');
  form.reset();
  $$('#productForm [aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  $$('#productForm .field__error').forEach((el) => { el.hidden = true; el.textContent = ''; });
  setKids($('#pfAlert'));

  $('#pfTitle').textContent = product ? 'Editar producto' : 'Agregar producto';
  $('#pfName').value = product?.name || '';
  $('#pfBrand').value = product?.brand || '';
  $('#pfCategory').value = product ? product.category : (state.category !== 'Todos' ? state.category : '');
  $('#pfPresentation').value = product?.presentation || '';
  $('#pfDescription').value = product?.description || '';
  $('#pfPrice').value = product && product.price !== null ? product.price.toFixed(2) : '';
  $('#pfPriceAsk').checked = Boolean(product && product.price === null);
  $('#pfPrice').disabled = $('#pfPriceAsk').checked;
  $('#pfPrevPrice').value = product && product.previousPrice !== null ? product.previousPrice.toFixed(2) : '';
  $('#pfStock').value = product && product.stock !== null ? String(product.stock) : '';
  $('#pfStockUnknown').checked = Boolean(product && product.stock === null && !product.variants.length);
  $('#pfStock').disabled = $('#pfStockUnknown').checked;
  setKids($('#pfVariants'));
  (product?.variants || []).forEach(addVariantRow);
  syncStockVisibility();
  pendingImage = product?.image || '';
  $('#pfImageUrl').value = /^https?:/.test(pendingImage) ? pendingImage : '';
  imageError('');
  renderImagePreview();
  $('#pfSource').textContent = product?.source ? `Origen del dato: ${product.source}` : '';
  Modal.open('productFormDialog', opener);
}

function readVariants() {
  const rows = $$('#pfVariants .variant-row');
  const names = new Set();
  const variants = [];
  for (const [i, row] of rows.entries()) {
    const get = (key) => row.querySelector(`[data-k=${key}]`);
    const name = get('name').value.trim();
    if (!name) return { error: `La variante ${i + 1} necesita un nombre.`, focus: get('name') };
    if (names.has(searchText(name))) return { error: `La variante «${name}» está repetida.`, focus: get('name') };
    names.add(searchText(name));
    let price = null;
    if (get('price').value.trim()) {
      price = Validate.parsePrice(get('price').value);
      if (price === null) return { error: `Precio no válido en la variante «${name}».`, focus: get('price') };
    }
    let stock = null;
    if (!get('unknown').checked) {
      stock = Validate.parseStock(get('stock').value);
      if (stock === null) return { error: `El stock de «${name}» debe ser un entero igual o mayor que 0, o marca «Por confirmar».`, focus: get('stock') };
    }
    variants.push({ id: row.dataset.variantId || `${slugify(name) || 'v'}-${Math.abs(hashCode(name + i)).toString(36)}`, name, price, stock });
  }
  return { variants };
}

async function submitForm(event) {
  event.preventDefault();
  if (!guard()) return;
  const errors = {};
  const name = $('#pfName').value.trim().replace(/\s+/g, ' ');
  const category = $('#pfCategory').value;
  if (name.length < 2) errors.pfName = 'El nombre debe tener al menos 2 caracteres.';
  if (!CONFIG.CATEGORIES.includes(category)) errors.pfCategory = 'Elige una categoría.';

  let price = null;
  if (!$('#pfPriceAsk').checked) {
    price = Validate.parsePrice($('#pfPrice').value);
    if (price === null) errors.pfPrice = 'Ingresa un precio válido mayor que 0 (máximo 2 decimales) o marca «Consultar precio».';
  }
  let previousPrice = null;
  if ($('#pfPrevPrice').value.trim()) {
    previousPrice = Validate.parsePrice($('#pfPrevPrice').value);
    if (previousPrice === null) errors.pfPrevPrice = 'Precio anterior no válido.';
    else if (price === null || previousPrice <= price) errors.pfPrevPrice = 'El precio anterior debe ser mayor que el precio actual.';
  }

  const { variants = [], error: variantError, focus: variantFocus } = readVariants();
  let finalVariantError = variantError;
  if (!finalVariantError && variants.length && price === null && variants.some((v) => v.price === null) && !$('#pfPriceAsk').checked) {
    finalVariantError = 'Define el precio del producto o de cada variante.';
  }

  let stock = null;
  if (!variants.length && !$('#pfStockUnknown').checked) {
    stock = Validate.parseStock($('#pfStock').value);
    if (stock === null) errors.pfStock = 'El stock debe ser un número entero igual o mayor que 0, o marca «Stock pendiente de confirmar».';
  }

  const typedUrl = $('#pfImageUrl').value.trim();
  if (typedUrl && typedUrl !== pendingImage) {
    if (/^https?:\/\//i.test(typedUrl) && Validate.imageSrc(typedUrl)) pendingImage = typedUrl;
    else errors.pfImage = 'La URL debe empezar con https:// (o http://) y apuntar a una imagen.';
  }
  if (pendingImage && !Validate.imageSrc(pendingImage)) errors.pfImage = 'La imagen no es válida.';

  ['pfName', 'pfCategory', 'pfPrice', 'pfPrevPrice', 'pfStock'].forEach((id) => setError(id, errors[id]));
  imageError(errors.pfImage);
  $('#pfVariants-err').textContent = finalVariantError || '';
  $('#pfVariants-err').hidden = !finalVariantError;

  const first = ['pfName', 'pfCategory', 'pfPrice', 'pfPrevPrice', 'pfStock'].find((id) => errors[id]);
  if (first) return document.getElementById(first).focus();
  if (finalVariantError) return (variantFocus || $('#pfAddVariant')).focus();
  if (errors.pfImage) return $('#pfImageUrl').focus();

  const existing = editingId ? state.products.find((p) => p.id === editingId) : null;
  if (editingId && !existing) {
    Toast.show('Este producto fue eliminado mientras lo editabas.', 'error');
    Modal.close('productFormDialog');
    return undefined;
  }
  const minOrder = state.products.reduce((min, p) => Math.min(min, p.order), 0);
  const product = {
    id: existing ? existing.id : randomId('p'),
    name,
    brand: $('#pfBrand').value.trim(),
    category,
    presentation: $('#pfPresentation').value.trim(),
    description: $('#pfDescription').value.trim(),
    price,
    previousPrice,
    stock,
    variants,
    image: pendingImage,
    order: existing ? existing.order : minOrder - 10,
    source: existing ? existing.source : 'Agregado desde el panel'
  };

  const button = $('#pfSubmit');
  button.disabled = true;
  button.textContent = 'Guardando…';
  try {
    await services.backend.saveProduct(product);
    Toast.show(existing ? 'Cambios guardados.' : 'Producto agregado.', 'success');
    Modal.close('productFormDialog');
  } catch (error) {
    setKids($('#pfAlert'), h('p', { class: 'notice notice--error', role: 'alert' }, `No se pudo guardar: ${friendlyError(error)}`));
  } finally {
    button.disabled = false;
    button.textContent = 'Guardar producto';
  }
  return undefined;
}

/** Reduce una foto a JPEG (data URI) para guardarla junto al producto. */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Formato no permitido. Usa JPG, PNG o WebP.'));
    if (file.size > 8 * 1024 * 1024) return reject(new Error('La imagen supera 8 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let size = 800;
        let quality = 0.82;
        let out = '';
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          out = canvas.toDataURL('image/jpeg', quality);
          if (out.length < 450000) break;
          size = Math.round(size * 0.75);
          quality -= 0.08;
        }
        URL.revokeObjectURL(url);
        if (out.length >= 900000) reject(new Error('La imagen sigue siendo muy pesada. Prueba con otra foto.'));
        else resolve(out);
      } catch {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo procesar la imagen.'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('El archivo no es una imagen válida.'));
    };
    img.src = url;
    return undefined;
  });
}

export function openAdmin(opener) {
  if (!guard()) return;
  $('#adminModeNote').textContent = ACTIVE_MODE === 'firebase'
    ? 'Los cambios se guardan en Cloud Firestore y se ven en todos los dispositivos.'
    : 'Modo demostración: los cambios se guardan solo en este navegador.';
  selectTab('inventory');
  render();
  Modal.open('adminDialog', opener);
}

export function initAdmin() {
  setKids($('#pfCategory'), h('option', { value: '' }, 'Selecciona…'), CONFIG.CATEGORIES.map((c) => h('option', { value: c }, c)));

  $('#fabAdmin').addEventListener('click', (event) => openAdmin(event.currentTarget));
  $('#tabInventory').addEventListener('click', () => selectTab('inventory'));
  $('#tabOrders').addEventListener('click', () => selectTab('orders'));
  $('.tabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const next = $('#tabInventory').getAttribute('aria-selected') === 'true' ? 'orders' : 'inventory';
    selectTab(next);
    (next === 'orders' ? $('#tabOrders') : $('#tabInventory')).focus();
  });

  $('#adminSearch').addEventListener('input', renderList);
  $('#adminFilter').addEventListener('change', renderList);
  $('#adminAddBtn').addEventListener('click', (event) => openForm(null, event.currentTarget));
  $('#adminImportBtn').addEventListener('click', importMissing);
  $('#adminExampleStockBtn').addEventListener('click', applyExampleStock);

  $('#pfAddVariant').addEventListener('click', () => {
    addVariantRow();
    $$('#pfVariants .variant-row').at(-1).querySelector('input').focus();
    syncStockVisibility();
  });
  $('#pfPriceAsk').addEventListener('change', (event) => {
    $('#pfPrice').disabled = event.target.checked;
    if (event.target.checked) $('#pfPrice').value = '';
  });
  $('#pfStockUnknown').addEventListener('change', (event) => {
    $('#pfStock').disabled = event.target.checked;
    if (event.target.checked) $('#pfStock').value = '';
  });
  $('#pfImageUrl').addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value) || !Validate.imageSrc(value)) {
      imageError('La URL debe empezar con https:// (o http://) y apuntar a una imagen.');
      return;
    }
    imageError('');
    pendingImage = value;
    $('#pfImageFile').value = '';
    renderImagePreview();
  });
  $('#pfImageFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      imageError('');
      pendingImage = await compressImage(file);
      $('#pfImageUrl').value = '';
      renderImagePreview();
    } catch (error) {
      imageError(error.message);
      event.target.value = '';
    }
  });
  $('#pfImageRemove').addEventListener('click', () => {
    pendingImage = '';
    $('#pfImageUrl').value = '';
    $('#pfImageFile').value = '';
    imageError('');
    renderImagePreview();
  });
  $('#productForm').addEventListener('submit', submitForm);

  on('products', () => {
    if (Modal.isOpen('adminDialog')) render();
  });
  on('admin:open', (opener) => openAdmin(opener));
  on('user', (user) => {
    if (user?.isAdmin) return;
    ['productFormDialog', 'adminDialog'].forEach((id) => { if (Modal.isOpen(id)) Modal.close(id); });
    stopOrders?.();
    stopOrders = null;
  });
}
