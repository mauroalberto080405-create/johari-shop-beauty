/**
 * Modelo de producto: limpieza de datos no confiables y reglas de precio/stock.
 */
import { CONFIG } from '../config.js';
import { Validate } from '../core/utils.js';
import { SEED_PRODUCTS } from './seed.js';

const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const positiveMoney = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null);

/**
 * La primera versión de la tienda (un solo HTML) guardaba las fotos como «pdf:p4».
 * Se traducen a la ruta actual para que los inventarios guardados conserven su imagen.
 */
function migrateImage(src) {
  const legacy = typeof src === 'string' ? /^pdf:(p\d+)$/.exec(src) : null;
  return legacy ? `assets/img/products/${legacy[1]}.jpg` : src;
}

/** Normaliza un producto proveniente de almacenamiento o red. Devuelve null si no es válido. */
export function sanitizeProduct(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const image = migrateImage(raw.image);
  const price = positiveMoney(raw.price);
  const previous = positiveMoney(raw.previousPrice);
  const variants = Array.isArray(raw.variants)
    ? raw.variants.slice(0, 40).map((v, i) => {
      if (!v || typeof v !== 'object') return null;
      const name = str(v.name, 80).trim();
      if (!name) return null;
      return {
        id: str(v.id, 60) || `v${i}`,
        name,
        price: positiveMoney(v.price),
        stock: Validate.isNonNegInt(v.stock) ? v.stock : null
      };
    }).filter(Boolean)
    : [];

  return {
    id: raw.id.slice(0, 120),
    name: str(raw.name, 120).trim() || 'Producto sin nombre',
    brand: str(raw.brand, 80).trim(),
    category: CONFIG.CATEGORIES.includes(raw.category) ? raw.category : CONFIG.CATEGORIES[0],
    presentation: str(raw.presentation, 120).trim(),
    description: str(raw.description, 1000).trim(),
    price,
    previousPrice: previous !== null && price !== null && previous > price ? previous : null,
    stock: variants.length ? null : (Validate.isNonNegInt(raw.stock) ? raw.stock : null),
    variants,
    image: Validate.imageSrc(image) ? image : '',
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 0,
    source: str(raw.source, 80)
  };
}

/** Copia limpia del catálogo inicial (PDF). */
export function seedProducts() {
  return SEED_PRODUCTS.map((p) => sanitizeProduct(structuredClone(p))).filter(Boolean);
}

/** Reglas de negocio sobre un producto y sus variantes. */
export const Product = {
  variant(p, variantId) {
    return variantId ? p.variants.find((v) => v.id === variantId) || null : null;
  },

  price(p, variantId) {
    const v = this.variant(p, variantId);
    return v && v.price !== null ? v.price : p.price;
  },

  stock(p, variantId) {
    if (p.variants.length) {
      const v = this.variant(p, variantId);
      return v ? v.stock : null;
    }
    return p.stock;
  },

  /** 'in' (hay stock), 'unknown' (por confirmar) u 'out' (agotado). */
  status(p, variantId) {
    if (p.variants.length && !variantId) {
      if (p.variants.every((v) => v.stock === 0)) return 'out';
      if (p.variants.some((v) => v.stock > 0)) return 'in';
      return 'unknown';
    }
    const s = this.stock(p, variantId);
    if (s === null) return 'unknown';
    return s > 0 ? 'in' : 'out';
  },

  priceRange(p) {
    const prices = p.variants.length
      ? p.variants.map((v) => (v.price !== null ? v.price : p.price)).filter((x) => x !== null)
      : (p.price !== null ? [p.price] : []);
    return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
  },

  knownUnits(p) {
    if (p.variants.length) return p.variants.reduce((sum, v) => sum + (v.stock > 0 ? v.stock : 0), 0);
    return p.stock > 0 ? p.stock : 0;
  },

  label(p, variantId) {
    const v = this.variant(p, variantId);
    const extra = v ? v.name : p.presentation;
    return `${p.name}${p.brand ? ` – ${p.brand}` : ''}${extra ? ` (${extra})` : ''}`;
  },

  /** Orden del catálogo: con stock, por confirmar y al final agotados. */
  sort(list) {
    const rank = (p) => ({ in: 0, unknown: 1, out: 2 })[this.status(p)];
    return list.slice().sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.name.localeCompare(b.name, 'es'));
  }
};
