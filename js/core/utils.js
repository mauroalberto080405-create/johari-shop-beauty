/**
 * Utilidades generales: DOM seguro, formato de moneda, texto y validaciones.
 * Todo el texto dinámico se inserta como nodos de texto (nunca con innerHTML).
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Crea un elemento con atributos, eventos e hijos. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  appendKids(el, children);
  return el;
}

function appendKids(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Reemplaza los hijos de un nodo; acepta listas y omite valores vacíos. */
export function setKids(el, ...children) {
  el.replaceChildren();
  appendKids(el, children);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ícono del sprite SVG definido en index.html (<symbol id="i-…">). */
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Formato de moneda peruana: S/ 1,234.50 */
export function money(value) {
  const [int, dec] = Number(value).toFixed(2).split('.');
  return `S/ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

export function normalizeText(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Texto para búsqueda: sin tildes, mayúsculas ni signos («Victoria's» → «victorias», «e.l.f.» → «elf»). */
export function searchText(text) {
  return normalizeText(text).replace(/[^a-z0-9ñ\s]/g, '').replace(/\s+/g, ' ');
}

export function slugify(text) {
  return normalizeText(text).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export function randomId(prefix) {
  const random = window.crypto?.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function hashCode(text) {
  let x = 0;
  for (let i = 0; i < text.length; i += 1) x = (Math.imul(31, x) + text.charCodeAt(i)) | 0;
  return x;
}

export const plural = (n, one, many) => (n === 1 ? one : many);

export const Validate = {
  isNonNegInt: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,

  parseStock(text) {
    const t = String(text).trim();
    return /^\d{1,6}$/.test(t) ? parseInt(t, 10) : null;
  },

  parsePrice(text) {
    const t = String(text).trim().replace(',', '.');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
    const n = Number(t);
    return n > 0 ? Math.round(n * 100) / 100 : null;
  },

  phone(text) {
    return /^(\+?51)?9\d{8}$/.test(String(text).replace(/[\s\-().]/g, ''));
  },

  email(text) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(text).trim());
  },

  /** Imágenes permitidas: archivos del proyecto, data URI de imagen o URL http(s). */
  imageSrc(src) {
    if (typeof src !== 'string' || src === '') return false;
    if (/^assets\/img\/products\/[a-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(src)) return true;
    if (/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return src.length < 900000;
    try {
      const url = new URL(src);
      return (url.protocol === 'https:' || url.protocol === 'http:') && src.length <= 2000;
    } catch {
      return false;
    }
  }
};
