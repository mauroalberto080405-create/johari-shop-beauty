/**
 * Johari Shop Beauty · punto de entrada.
 * Elige los servicios según el modo (demo o Firebase), conecta los módulos
 * de interfaz y reacciona a los cambios del catálogo.
 */
import { ACTIVE_MODE, CONFIG, ONLINE_PAYMENTS_READY } from './config.js';
import { $ } from './core/utils.js';
import { LocalStore } from './core/storage.js';
import { state, services, emit, on } from './state.js';
import { Confirm, Modal, Toast } from './ui/feedback.js';
import { Product } from './data/product.js';
import { Cart } from './store/cart.js';
import { DemoAuth, DemoBackend } from './services/demo.js';
import { FirebaseAuth, FirestoreBackend } from './services/firebase.js';
import { friendlyError } from './services/errors.js';
import { initCatalog, renderCatalog } from './features/catalog.js';
import { initCartView, renderCart } from './features/cart-view.js';
import { initCheckout, renderSummary, showCheckoutChanges } from './features/checkout.js';
import { initAccount, onUserChange } from './features/account.js';
import { initAdmin } from './features/admin.js';

services.backend = ACTIVE_MODE === 'firebase' ? FirestoreBackend : DemoBackend;
services.auth = ACTIVE_MODE === 'firebase' ? FirebaseAuth : DemoAuth;

function modeMessage() {
  if (ACTIVE_MODE === 'firebase') {
    return ONLINE_PAYMENTS_READY
      ? 'Tienda en línea: catálogo compartido y pagos seguros con Culqi.'
      : 'Tienda conectada a Firebase. El pago en línea se activará al configurar Culqi.';
  }
  return CONFIG.MODE === 'firebase'
    ? 'Firebase no está configurado (faltan credenciales en js/config.js). Se usa el modo demostración: datos solo en este navegador.'
    : 'Modo demostración: catálogo, cuentas y carrito se guardan solo en este navegador. El acceso de la dueña es simulado.';
}

/** Llega una versión nueva del catálogo (inicio, cambio del panel u otro dispositivo). */
function onProducts(list) {
  state.products = list;
  state.loaded = true;
  state.error = null;
  for (const [productId, variantId] of state.selectedVariant) {
    const product = list.find((p) => p.id === productId);
    if (!product || !Product.variant(product, variantId)) state.selectedVariant.delete(productId);
  }

  const changes = Cart.reconcile(list);
  if (Modal.isOpen('checkoutDialog')) {
    if (Cart.notices.length) showCheckoutChanges();
    else renderSummary();
  } else if (changes.length) {
    Toast.show('Algunos productos de tu carrito cambiaron. Ábrelo para revisar los detalles.', 'warn', 7000);
  }
  emit('products', list);
  if (Modal.isOpen('cartDrawer')) renderCart();
}

function onDataError(error, recovered) {
  state.error = error.message;
  state.loaded = true;
  Toast.show(error.message, recovered ? 'warn' : 'error', 8000);
  renderCatalog();
}

/**
 * Evita que insignias flotantes del hosting (p. ej. «Powered by Netlify»)
 * tapen el botón de WhatsApp: si se superponen, el botón sube.
 */
function guardHostBadge() {
  const adjust = () => {
    const fab = $('#fabWhatsapp');
    const badge = document.querySelector('#nl-badge-frame');
    if (!badge) {
      fab.style.bottom = '';
      return;
    }
    const r = badge.getBoundingClientRect();
    const overlaps = r.width > 0 && r.height > 0 && r.left < window.innerWidth - 16 && r.right > window.innerWidth - 90;
    fab.style.bottom = overlaps ? `${Math.round(window.innerHeight - r.top + 12)}px` : '';
  };
  new MutationObserver(adjust).observe(document.body, { childList: true });
  window.addEventListener('resize', adjust);
  let runs = 0;
  const timer = setInterval(() => {
    adjust();
    runs += 1;
    if (runs >= 20) clearInterval(timer);
  }, 500);
}

async function start() {
  $('#year').textContent = String(new Date().getFullYear());
  $('#modeBannerText').textContent = modeMessage();
  if (!ONLINE_PAYMENTS_READY) $('#perkPayment').textContent = 'Pedidos seguros por WhatsApp';
  Modal.init();
  Confirm.init();
  on('toast', ({ message, type }) => Toast.show(message, type));

  if (!LocalStore.available) Toast.show('Tu navegador no permite guardar datos: el carrito se perderá al recargar.', 'warn', 8000);
  if (!Cart.load()) Toast.show('No se pudo leer el carrito guardado; se inició uno nuevo.', 'warn');

  initCatalog();
  initCartView();
  initCheckout();
  initAccount();
  initAdmin();
  guardHostBadge();

  // El carrito se comparte entre pestañas del mismo navegador.
  window.addEventListener('storage', (event) => {
    if (event.key !== CONFIG.STORAGE.cart) return;
    Cart.load();
    Cart.reconcile();
    emit('cart:external');
    renderCart();
  });

  try {
    await services.auth.init(onUserChange);
  } catch (error) {
    Toast.show(`No se pudo iniciar la autenticación: ${friendlyError(error)}`, 'error', 8000);
  }

  try {
    await services.backend.init(onProducts, onDataError);
  } catch (error) {
    onDataError(new Error(ACTIVE_MODE === 'firebase'
      ? `No se pudo conectar con Firebase. Revisa tu conexión y la configuración. Detalle: ${friendlyError(error)}`
      : friendlyError(error)));
  }
}

start();
