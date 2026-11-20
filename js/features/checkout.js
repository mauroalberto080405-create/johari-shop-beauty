/**
 * Checkout: datos de entrega y dos formas de completar el pedido:
 *  - Pago en línea con Culqi (tarjeta o Yape), procesado por Cloud Functions.
 *  - Coordinar el pago por WhatsApp.
 * No se muestran números de cuenta en la web: los datos sensibles no se publican.
 */
import { CONFIG } from '../config.js';
import { $, h, icon, money, plural, setKids, Validate } from '../core/utils.js';
import { Cart } from '../store/cart.js';
import { state, emit } from '../state.js';
import { Confirm, Modal, Toast, notice } from '../ui/feedback.js';
import { Payments } from '../services/payments.js';
import { friendlyError } from '../services/errors.js';
import { WhatsApp } from './whatsapp.js';

const FIELDS = [
  ['ckName', 'fullName'],
  ['ckPhone', 'phone'],
  ['ckEmail', 'email'],
  ['ckDistrict', 'district'],
  ['ckProvince', 'province'],
  ['ckAddress', 'address'],
  ['ckReference', 'reference'],
  ['ckNotes', 'notes']
];

let busy = false;

/** Texto del botón principal según la forma de completar el pedido. */
function syncSubmitLabel() {
  const form = $('#checkoutForm');
  $('#checkoutSubmit').textContent = form.method.value === 'online' ? 'Pagar con Culqi' : 'Enviar pedido a WhatsApp';
}

export function openCheckout(opener) {
  const form = $('#checkoutForm');
  if (state.user) {
    if (!form.fullName.value) form.fullName.value = state.user.name || '';
    if (!form.email.value) form.email.value = state.user.email || '';
  }
  setKids($('#checkoutAlert'));
  renderSummary();
  Modal.open('checkoutDialog', opener);
}

export function renderSummary() {
  setKids($('#checkoutSummary'),
    h('ul', { class: 'summary-list' }, Cart.items.map((it) => h('li', null,
      h('span', null, `${it.qty} × ${it.name}${it.variantName ? ` (${it.variantName})` : ''}`, h('small', null, `Precio unitario: ${money(it.unitPrice)}`)),
      h('strong', null, money(it.unitPrice * it.qty))))),
    h('div', { class: 'summary__total' },
      h('span', null, `Total de productos (${Cart.count()} ${plural(Cart.count(), 'unidad', 'unidades')})`),
      h('span', null, money(Cart.total()))));
}

/** Si el carrito cambió con el formulario abierto, se informa y se exige revisar antes de enviar. */
export function showCheckoutChanges() {
  const changes = Cart.notices.slice();
  Cart.notices = [];
  renderSummary();
  notice($('#checkoutAlert'), {
    title: 'Tu carrito cambió. Revisa el resumen actualizado y vuelve a confirmar.',
    items: changes,
    focus: true
  });
  if (!Cart.items.length) Toast.show('Tu carrito quedó vacío: no hay productos para enviar.', 'warn', 7000);
}

function setFieldError(id, message) {
  const error = document.getElementById(`${id}-err`);
  const input = document.getElementById(id);
  error.textContent = message || '';
  error.hidden = !message;
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function readForm() {
  const form = $('#checkoutForm');
  const data = Object.fromEntries(FIELDS.map(([, name]) => [name, form[name].value.trim().replace(/\s+/g, ' ')]));
  data.method = form.method.value;
  data.preferred = form.preferred.value;
  return data;
}

function validate(data) {
  const errors = {
    ckName: data.fullName.length >= 3 ? '' : 'Ingresa tu nombre completo.',
    ckPhone: Validate.phone(data.phone) ? '' : 'Ingresa un celular peruano válido de 9 dígitos que empiece con 9 (ej.: 987 654 321).',
    ckEmail: data.email && !Validate.email(data.email) ? 'Ingresa un correo válido.'
      : (data.method === 'online' && !data.email ? 'Para pagar en línea necesitamos tu correo (Culqi te envía el comprobante).' : ''),
    ckDistrict: data.district.length >= 2 ? '' : 'Ingresa tu distrito.',
    ckProvince: data.province.length >= 2 ? '' : 'Ingresa tu provincia.',
    ckAddress: data.address.length >= 5 ? '' : 'Ingresa la dirección de entrega.',
    ckMethod: ['online', 'whatsapp'].includes(data.method) ? '' : 'Elige cómo quieres completar tu pedido.'
  };
  Object.entries(errors).forEach(([id, message]) => setFieldError(id, message));
  const first = Object.keys(errors).find((id) => errors[id]);
  if (first) {
    const target = first === 'ckMethod' ? $('#checkoutForm input[name=method]:not(:disabled)') : document.getElementById(first);
    target?.focus();
    return false;
  }
  return true;
}

/* ---------- Diálogo de resultado ---------- */
function showResult({ title, body, actions }) {
  $('#resultTitle').textContent = title;
  setKids($('#resultBody'), body.map((text) => (text instanceof Node ? text : h('p', null, text))));
  setKids($('#resultActions'), actions);
  Modal.open('resultDialog', $('#cartBtn'));
}

function clearCartAction(label) {
  return h('button', {
    type: 'button',
    class: 'btn btn--ghost btn--block',
    onclick: async () => {
      const ok = await Confirm.ask({
        title: '¿Vaciar el carrito?',
        body: 'Hazlo solo si ya enviaste el mensaje en WhatsApp. El stock no cambia: la tienda lo actualiza al confirmar tu compra.',
        okText: 'Vaciar carrito'
      });
      if (!ok) return;
      Cart.clear();
      emit('cart:external');
      Modal.closeAll();
      Toast.show('Carrito vaciado.', 'info');
    }
  }, label);
}

function closeAction() {
  return h('button', { type: 'button', class: 'btn btn--ghost btn--block', onclick: () => Modal.closeAll() }, 'Cerrar');
}

/* ---------- Envío por WhatsApp ---------- */
function sendByWhatsApp(data) {
  const url = WhatsApp.url(WhatsApp.order(Cart.items, data));
  // Sin «noopener» en las opciones (con él window.open siempre devuelve null); se corta la referencia manualmente.
  const win = window.open(url, '_blank');
  if (win) {
    try { win.opener = null; } catch { /* sin acción */ }
  } else {
    Toast.show('Tu navegador bloqueó la ventana. Usa «Abrir WhatsApp de nuevo».', 'warn', 7000);
  }
  Modal.close('checkoutDialog');
  showResult({
    title: 'Tu pedido está listo en WhatsApp',
    body: [
      'Revisa el mensaje y presiona «Enviar» en WhatsApp. Hasta que lo envíes, la tienda no recibe tu pedido.',
      'La tienda te confirmará disponibilidad, costo de envío y datos de pago. Tu carrito se mantiene guardado por si necesitas reenviarlo.'
    ],
    actions: [
      h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn--whatsapp btn--block' }, icon('whatsapp', 'icon icon--sm'), 'Abrir WhatsApp de nuevo'),
      clearCartAction('Ya envié el pedido: vaciar carrito'),
      closeAction()
    ]
  });
}

/* ---------- Pago en línea con Culqi ---------- */
function setBusy(on, stageText) {
  busy = on;
  const submit = $('#checkoutSubmit');
  submit.disabled = on;
  if (on) submit.textContent = 'Procesando…';
  else syncSubmitLabel();
  $('#checkoutDialog').dataset.locked = on ? 'true' : 'false';
  if (on) {
    setKids($('#checkoutAlert'), h('div', { class: 'notice', role: 'status' },
      h('p', { class: 'notice__title' }, stageText),
      h('p', null, 'No cierres esta ventana. Si cierras el formulario de Culqi sin pagar, pulsa «Cancelar pago».'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => Payments.cancel() }, 'Cancelar pago')));
  }
}

const STAGES = {
  creating: 'Verificando precios y stock…',
  awaiting: 'Completa el pago en la ventana de Culqi.',
  charging: 'Confirmando tu pago…'
};

async function payOnline(data) {
  setBusy(true, STAGES.creating);
  try {
    const result = await Payments.pay({
      items: Cart.toOrderItems(),
      customer: {
        fullName: data.fullName, phone: data.phone, email: data.email, district: data.district,
        province: data.province, address: data.address, reference: data.reference, notes: data.notes
      },
      onStage: (stage) => setBusy(true, STAGES[stage])
    });
    setBusy(false);
    Cart.clear();
    emit('cart:external');
    Modal.close('checkoutDialog');
    const waUrl = WhatsApp.url(WhatsApp.paidOrder(result, data));
    showResult({
      title: '¡Pago aprobado!',
      body: [
        h('p', null, 'Pedido N.° ', h('strong', null, result.orderId), ` · Total pagado: ${money(result.total)}`),
        'Culqi te enviará el comprobante a tu correo. Escríbenos por WhatsApp para coordinar el costo y la fecha de envío.'
      ],
      actions: [
        h('a', { href: waUrl, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn--whatsapp btn--block' }, icon('whatsapp', 'icon icon--sm'), 'Coordinar envío por WhatsApp'),
        closeAction()
      ]
    });
  } catch (error) {
    setBusy(false);
    if (error.code === 'cancelled') {
      notice($('#checkoutAlert'), { title: error.message, focus: true });
      return;
    }
    notice($('#checkoutAlert'), {
      title: 'No se pudo completar el pago.',
      items: [friendlyError(error), 'Si se debitó algún monto, escríbenos por WhatsApp con tu número de pedido antes de reintentar.'],
      type: 'error',
      focus: true
    });
  }
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;
  const data = readForm();
  if (!validate(data)) return;

  // Revalidación final contra el catálogo vigente (incluye cambios recibidos con el formulario abierto).
  Cart.reconcile();
  emit('cart:external');
  if (Cart.notices.length) {
    showCheckoutChanges();
    return;
  }
  if (!Cart.items.length) {
    Toast.show('Tu carrito está vacío.', 'warn');
    return;
  }
  if (data.method === 'online') await payOnline(data);
  else sendByWhatsApp(data);
}

export function initCheckout() {
  const form = $('#checkoutForm');
  setKids($('#ckPreferred'), CONFIG.PREFERRED_METHODS.map((m) => h('option', { value: m }, m)));

  const onlineRadio = form.querySelector('input[name=method][value=online]');
  if (!Payments.available) {
    onlineRadio.disabled = true;
    $('#onlinePayDesc').textContent = 'Disponible cuando la tienda active Firebase y Culqi. Por ahora puedes coordinar tu pedido por WhatsApp.';
    form.querySelector('input[name=method][value=whatsapp]').checked = true;
  }

  const syncMethod = () => {
    syncSubmitLabel();
    setFieldError('ckMethod', '');
  };
  form.querySelectorAll('input[name=method]').forEach((radio) => radio.addEventListener('change', syncMethod));
  syncMethod();
  form.addEventListener('submit', onSubmit);
}
