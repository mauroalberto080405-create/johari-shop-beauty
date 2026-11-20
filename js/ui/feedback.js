/**
 * Retroalimentación de la interfaz: notificaciones (toasts),
 * diálogos modales accesibles y confirmaciones.
 */
import { $, $$, h, icon, setKids } from '../core/utils.js';

/* ---------------------------------------------------------------------------
   Notificaciones
   --------------------------------------------------------------------------- */
export const Toast = {
  show(message, type = 'info', ms = 4500) {
    const el = h('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' },
      h('p', null, message),
      h('button', { type: 'button', class: 'toast__close', 'aria-label': 'Cerrar notificación', onclick: () => el.remove() }, icon('close', 'icon icon--sm')));
    $('#toasts').append(el);
    setTimeout(() => el.remove(), ms);
  }
};

/* ---------------------------------------------------------------------------
   Diálogos modales: pila, foco atrapado, Escape y devolución del foco
   --------------------------------------------------------------------------- */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const BACKGROUND = ['#page', '#fabWhatsapp', '#fabAdmin'];

export const Modal = {
  stack: [],

  open(id, opener) {
    const overlay = document.getElementById(id);
    if (!overlay || !overlay.hidden) return;
    const previous = this.top();
    if (previous) previous.overlay.inert = true;
    this.stack.push({ overlay, opener: opener || document.activeElement });
    overlay.hidden = false;
    BACKGROUND.forEach((sel) => { $(sel).inert = true; });
    document.body.classList.add('modal-open');
    const panel = overlay.firstElementChild;
    const target = panel.querySelector('[autofocus]') || panel.querySelector(FOCUSABLE) || panel;
    if (target === panel) panel.setAttribute('tabindex', '-1');
    setTimeout(() => target.focus(), 0);
  },

  close(id) {
    const index = this.stack.findIndex((m) => m.overlay.id === id);
    if (index === -1) return;
    const [entry] = this.stack.splice(index, 1);
    entry.overlay.hidden = true;
    const top = this.top();
    if (top) {
      top.overlay.inert = false;
    } else {
      BACKGROUND.forEach((sel) => { $(sel).inert = false; });
      document.body.classList.remove('modal-open');
    }
    let opener = entry.opener;
    // Si el elemento que abrió el diálogo se volvió a renderizar, se busca su reemplazo.
    if (opener && !document.contains(opener) && opener.dataset?.focusKey) {
      opener = document.querySelector(`[data-focus-key="${CSS.escape(opener.dataset.focusKey)}"]`);
    }
    if (opener && document.contains(opener) && !opener.closest('[hidden]') && typeof opener.focus === 'function') {
      opener.focus();
    } else if (top) {
      top.overlay.querySelector(FOCUSABLE)?.focus();
    }
  },

  closeAll() {
    while (this.stack.length) this.close(this.top().overlay.id);
  },

  isOpen(id) {
    return this.stack.some((m) => m.overlay.id === id);
  },

  top() {
    return this.stack[this.stack.length - 1];
  },

  init() {
    document.addEventListener('keydown', (event) => {
      const top = this.top();
      if (!top) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (top.overlay.id === 'confirmDialog') Confirm.resolve(false);
        else this.close(top.overlay.id);
        return;
      }
      if (event.key === 'Tab') {
        const items = $$(FOCUSABLE, top.overlay).filter((el) => el.offsetParent !== null);
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const outside = !top.overlay.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    $$('.overlay').forEach((overlay) => {
      overlay.addEventListener('mousedown', (event) => {
        if (event.target !== overlay) return;
        if (overlay.id === 'confirmDialog') Confirm.resolve(false);
        else if (overlay.dataset.locked !== 'true') this.close(overlay.id);
      });
      $$('[data-close]', overlay).forEach((btn) => btn.addEventListener('click', () => this.close(overlay.id)));
    });
  }
};

/* ---------------------------------------------------------------------------
   Confirmación (devuelve una promesa con true/false)
   --------------------------------------------------------------------------- */
export const Confirm = {
  pending: null,

  ask({ title, body, okText = 'Confirmar', danger = false }) {
    $('#confirmTitle').textContent = title;
    const parts = (Array.isArray(body) ? body : [body]).map((item) => (item instanceof Node ? item : h('p', null, item)));
    setKids($('#confirmBody'), parts);
    const ok = $('#confirmOk');
    ok.textContent = okText;
    ok.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
    return new Promise((resolve) => {
      this.pending = resolve;
      Modal.open('confirmDialog');
      setTimeout(() => $('#confirmCancel').focus(), 0);
    });
  },

  resolve(value) {
    const done = this.pending;
    this.pending = null;
    Modal.close('confirmDialog');
    if (done) done(value);
  },

  init() {
    $('#confirmOk').addEventListener('click', () => this.resolve(true));
    $('#confirmCancel').addEventListener('click', () => this.resolve(false));
  }
};

/** Muestra un aviso dentro de un contenedor (por ejemplo, el checkout). */
export function notice(container, { title, items = [], type = 'warn', focus = false }) {
  const box = h('div', { class: `notice ${type === 'warn' ? '' : `notice--${type}`}`.trim(), role: 'alert', tabindex: '-1' },
    h('p', { class: 'notice__title' }, title),
    items.length ? h('ul', null, items.map((item) => h('li', null, item))) : null);
  setKids(container, box);
  if (focus) box.focus();
  return box;
}
