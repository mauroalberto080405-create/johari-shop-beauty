/**
 * Imagen de producto con marcador elegante si falta o no carga.
 */
import { Validate, h, icon } from '../core/utils.js';

export function placeholder(name) {
  return h('div', { class: 'placeholder', role: 'img', 'aria-label': `Imagen no disponible de ${name}` },
    icon('image', 'icon icon--xl'),
    h('span', null, 'Imagen no disponible'));
}

export function productImage(product) {
  if (!Validate.imageSrc(product.image)) return placeholder(product.name);
  const img = h('img', {
    src: product.image,
    alt: `${product.name}${product.brand ? ` de ${product.brand}` : ''}`,
    loading: 'lazy',
    decoding: 'async',
    width: '320',
    height: '320'
  });
  img.addEventListener('error', () => img.replaceWith(placeholder(product.name)), { once: true });
  return img;
}
