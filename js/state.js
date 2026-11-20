/**
 * Estado compartido de la aplicación y un bus de eventos mínimo.
 * Los módulos de interfaz escuchan eventos ('products', 'cart', 'user')
 * en lugar de llamarse entre sí, para mantenerlos desacoplados.
 */
export const state = {
  products: [],
  loaded: false,
  error: null,
  category: 'Todos',
  query: '',
  selectedVariant: new Map(),
  variantErrors: new Set(),
  user: null
};

/** Servicios activos según el modo (demo o Firebase). Se asignan en main.js. */
export const services = {
  backend: null,
  auth: null
};

const bus = new EventTarget();

export function emit(name, detail) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, handler) {
  bus.addEventListener(name, (event) => handler(event.detail));
}
