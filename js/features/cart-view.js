/**
 * Carrito lateral (slide-over): cantidades, subtotales y avisos de cambios.
 */
import { CONFIG } from '../config.js';
import { $, h, hashCode, icon, money, plural, setKids, slugify } from '../core/utils.js';
import { Product } from '../data/product.js';
import { Cart } from '../store/cart.js';
import { state, on, emit } from '../state.js';
import { Modal, Toast } from '../ui/feedback.js';
import { productImage, placeholder } from './media.js';
import { openCheckout } from './checkout.js';

function renderCount() {
  const n = Cart.count();
  $('#cartCount').textContent = String(n);
  $('#cartBtn').setAttribute('aria-label', `Abrir carrito, ${n} ${plural(n, 'producto', 'productos')}`);
}

function renderNotices() {
  const box = $('#cartNotices');
  if (!Cart.notices.length) {
    setKids(box);
    return;
  }
  setKids(box, h('div', { id: 'cartNoticeBox', class: 'notice', role: 'alert', tabindex: '-1' },
    h('p', { class: 'notice__title' }, 'Tu carrito se actualizó'),
    h('ul', null, Cart.notices.map((n) => h('li', null, n))),
    h('button', {
      type: 'button',
      class: 'btn btn--primary btn--sm',
      onclick: () => {
        Cart.notices = [];
        renderCart();
        $('#checkoutBtn')?.focus();
      }
    }, 'Entendido')));
}

/** Tras un cambio hecho desde el panel, refresca catálogo y conserva el foco. */
function afterChange(focusSelector) {
  emit('cart:external');
  renderCart();
  const target = focusSelector && document.querySelector(focusSelector);
  if (target && !target.disabled) target.focus();
  else $('#cartDrawer [data-close]')?.focus();
}

function cartItem(item) {
  const product = state.products.find((p) => p.id === item.productId);
  const stock = product ? Product.stock(product, item.variantId) : null;
  const label = item.name + (item.variantName ? ` (${item.variantName})` : '');
  const uid = `${slugify(item.key)}-${Math.abs(hashCode(item.key))}`;
  const qtyId = `qty-${uid}`;

  const qtyInput = h('input', {
    id: qtyId, class: 'input qty__input', type: 'number', inputmode: 'numeric',
    min: '1', max: stock !== null ? String(stock) : null, step: '1', value: String(item.qty)
  });
  qtyInput.addEventListener('change', () => {
    const raw = qtyInput.value.trim();
    const error = Cart.setQty(item.key, /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN);
    if (error) Toast.show(error, 'warn');
    afterChange(`#${qtyId}`);
  });

  const step = (delta, kind) => () => {
    const error = Cart.setQty(item.key, item.qty + delta);
    if (error && delta > 0) Toast.show(error, 'warn');
    afterChange(`[data-${kind}="${CSS.escape(uid)}"]`);
  };

  return h('li', { class: 'cart-item' },
    h('div', { class: 'cart-item__thumb' }, product ? productImage(product) : placeholder(item.name)),
    h('div', null,
      h('p', { class: 'cart-item__name' }, item.name),
      item.brand ? h('p', { class: 'cart-item__meta' }, item.brand) : null,
      item.variantName ? h('p', { class: 'cart-item__meta' }, item.variantName) : null,
      h('p', { class: 'cart-item__meta' }, `Precio unitario: ${money(item.unitPrice)}${stock !== null ? ` · Stock: ${stock}` : ''}`),
      h('div', { class: 'cart-item__controls' },
        h('button', { type: 'button', class: 'qty__btn', disabled: item.qty <= 1, 'aria-label': `Quitar una unidad de ${label}`, dataset: { dec: uid }, onclick: step(-1, 'dec') }, '−'),
        h('label', { for: qtyId, class: 'sr-only' }, `Cantidad de ${label}`),
        qtyInput,
        h('button', { type: 'button', class: 'qty__btn', disabled: stock === null || item.qty >= stock, 'aria-label': `Agregar una unidad de ${label}`, dataset: { inc: uid }, onclick: step(1, 'inc') }, '+'),
        h('button', {
          type: 'button',
          class: 'cart-item__remove',
          'aria-label': `Eliminar ${label} del carrito`,
          onclick: () => {
            Cart.remove(item.key);
            afterChange(null);
          }
        }, icon('trash', 'icon icon--sm'), 'Eliminar')),
      h('p', { class: 'cart-item__subtotal' }, `Subtotal: ${money(item.unitPrice * item.qty)}`)));
}

export function renderCart() {
  renderCount();
  renderNotices();
  const body = $('#cartBody');
  const footer = $('#cartFooter');

  if (!Cart.items.length) {
    setKids(body, h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state__icon' }, icon('cart', 'icon icon--lg')),
      h('p', { class: 'empty-state__title' }, 'Tu carrito está vacío'),
      h('p', { class: 'muted small' }, 'Explora el catálogo y agrega tus favoritos.'),
      h('button', {
        type: 'button',
        class: 'btn btn--primary',
        onclick: () => {
          Modal.close('cartDrawer');
          $('#searchInput').focus();
        }
      }, 'Ver catálogo')));
    setKids(footer, h('p', { class: 'shipping-note' }, CONFIG.SHIPPING_NOTE));
    return;
  }

  setKids(body, h('ul', { class: 'cart-list', 'aria-label': 'Productos en el carrito' }, Cart.items.map(cartItem)));
  setKids(footer,
    h('div', { class: 'totals-row' }, h('span', null, 'Total de productos (unidades)'), h('strong', null, String(Cart.count()))),
    h('div', { class: 'totals-row totals-row--lg' }, h('span', null, 'Subtotal'), h('span', null, money(Cart.total()))),
    h('p', { class: 'shipping-note' }, CONFIG.SHIPPING_NOTE),
    h('button', { id: 'checkoutBtn', type: 'button', class: 'btn btn--primary btn--block', onclick: (e) => goToCheckout(e.currentTarget) }, 'Continuar al checkout'));
}

/** Antes de abrir el checkout se revalida el carrito; si cambió, se avisa primero. */
function goToCheckout(opener) {
  Cart.reconcile();
  emit('cart:external');
  renderCart();
  if (!Cart.items.length) {
    Toast.show('Tu carrito está vacío.', 'warn');
    return;
  }
  if (Cart.notices.length) {
    Toast.show('Revisa los cambios de tu carrito antes de continuar.', 'warn');
    $('#cartNoticeBox')?.focus();
    return;
  }
  openCheckout(opener);
}

export function initCartView() {
  $('#cartBtn').addEventListener('click', (event) => {
    renderCart();
    Modal.open('cartDrawer', event.currentTarget);
  });
  on('cart', () => {
    renderCount();
    if (Modal.isOpen('cartDrawer')) renderCart();
  });
  on('cart:bump', () => {
    const badge = $('#cartCount');
    badge.classList.remove('is-bumped');
    void badge.offsetWidth;
    badge.classList.add('is-bumped');
  });
  renderCount();
}
