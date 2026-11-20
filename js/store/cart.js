/**
 * Carrito persistente (localStorage). Valida precio y stock vigentes,
 * y se reconcilia cuando el catálogo cambia (precio, stock o eliminación).
 */
import { CONFIG } from '../config.js';
import { LocalStore } from '../core/storage.js';
import { money, plural } from '../core/utils.js';
import { Product } from '../data/product.js';
import { state, emit } from '../state.js';

const units = (n) => `${n} ${plural(n, 'unidad', 'unidades')}`;

export const Cart = {
  items: [],
  notices: [],

  load() {
    const saved = LocalStore.read(CONFIG.STORAGE.cart);
    const list = saved.ok && Array.isArray(saved.value) ? saved.value : [];
    this.items = list
      .filter((it) => it && typeof it.productId === 'string' && Number.isInteger(it.qty) && it.qty > 0 && typeof it.unitPrice === 'number')
      .map((it) => ({
        key: String(it.key),
        productId: it.productId,
        variantId: typeof it.variantId === 'string' ? it.variantId : null,
        qty: it.qty,
        unitPrice: it.unitPrice,
        name: String(it.name || ''),
        brand: String(it.brand || ''),
        variantName: String(it.variantName || '')
      }));
    return saved.ok;
  },

  save() {
    try {
      LocalStore.write(CONFIG.STORAGE.cart, this.items);
    } catch (error) {
      emit('toast', { message: `No se pudo guardar el carrito: ${error.message}`, type: 'error' });
    }
    emit('cart');
  },

  key: (productId, variantId) => `${productId}::${variantId || ''}`,

  qtyOf(productId, variantId) {
    return this.items.find((i) => i.key === this.key(productId, variantId))?.qty || 0;
  },

  count() {
    return this.items.reduce((sum, i) => sum + i.qty, 0);
  },

  total() {
    return Math.round(this.items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0) * 100) / 100;
  },

  /** Agrega una unidad. Devuelve un mensaje de error o null si se agregó. */
  add(product, variantId) {
    if (product.variants.length && !variantId) return 'Selecciona una opción antes de agregar.';
    const variant = Product.variant(product, variantId);
    if (product.variants.length && !variant) return 'La opción elegida ya no existe.';
    const price = Product.price(product, variantId);
    const stock = Product.stock(product, variantId);
    if (price === null) return 'Este producto no tiene precio publicado. Consúltalo por WhatsApp.';
    if (stock === null) return 'Stock por confirmar. Consulta disponibilidad por WhatsApp.';
    if (stock <= 0) return 'Producto agotado.';

    const key = this.key(product.id, variantId);
    const existing = this.items.find((i) => i.key === key);
    const nextQty = (existing ? existing.qty : 0) + 1;
    if (nextQty > stock) return `Solo hay ${units(stock)} ${plural(stock, 'disponible', 'disponibles')}.`;

    if (existing) {
      existing.qty = nextQty;
      existing.unitPrice = price;
    } else {
      this.items.push({
        key, productId: product.id, variantId: variantId || null, qty: 1, unitPrice: price,
        name: product.name, brand: product.brand, variantName: variant ? variant.name : (product.presentation || '')
      });
    }
    this.save();
    return null;
  },

  /** Cambia la cantidad (entero ≥ 1 y ≤ stock). Devuelve un aviso o null. */
  setQty(key, qty) {
    const item = this.items.find((i) => i.key === key);
    if (!item) return 'El producto ya no está en el carrito.';
    if (!Number.isInteger(qty) || qty < 1) return 'La cantidad debe ser un número entero mayor que cero.';
    const product = state.products.find((p) => p.id === item.productId);
    const stock = product ? Product.stock(product, item.variantId) : null;
    if (stock === null || stock <= 0) return 'Este producto ya no está disponible.';
    if (qty > stock) {
      item.qty = stock;
      this.save();
      return `Solo hay ${units(stock)} ${plural(stock, 'disponible', 'disponibles')}; se ajustó la cantidad.`;
    }
    item.qty = qty;
    this.save();
    return null;
  },

  remove(key) {
    this.items = this.items.filter((i) => i.key !== key);
    this.save();
  },

  clear() {
    this.items = [];
    this.notices = [];
    this.save();
  },

  /** Datos mínimos que se envían al servidor para crear un pedido. */
  toOrderItems() {
    return this.items.map(({ productId, variantId, qty }) => ({ productId, variantId, qty }));
  },

  /**
   * Compara el carrito con el catálogo vigente y lo corrige.
   * Los cambios quedan en `notices` para informar a la clienta antes de continuar.
   */
  reconcile(products = state.products) {
    const changes = [];
    const keep = [];
    for (const item of this.items) {
      const label = item.name + (item.variantName ? ` (${item.variantName})` : '');
      const product = products.find((p) => p.id === item.productId);
      if (!product) { changes.push(`«${label}» ya no está en el catálogo y se retiró del carrito.`); continue; }
      if (product.variants.length && !Product.variant(product, item.variantId)) { changes.push(`La opción de «${label}» ya no existe y se retiró del carrito.`); continue; }
      if (!product.variants.length && item.variantId) { changes.push(`«${label}» cambió de presentación y se retiró del carrito.`); continue; }

      const price = Product.price(product, item.variantId);
      const stock = Product.stock(product, item.variantId);
      if (price === null) { changes.push(`«${label}» ahora es «Consultar precio» y se retiró del carrito.`); continue; }
      if (stock === null) { changes.push(`El stock de «${label}» quedó por confirmar y se retiró del carrito.`); continue; }
      if (stock <= 0) { changes.push(`«${label}» se agotó y se retiró del carrito.`); continue; }
      if (item.qty > stock) {
        changes.push(`«${label}»: solo quedan ${units(stock)}; se ajustó la cantidad de ${item.qty} a ${stock}.`);
        item.qty = stock;
      }
      if (Math.abs(price - item.unitPrice) > 0.001) {
        changes.push(`El precio de «${label}» cambió de ${money(item.unitPrice)} a ${money(price)}.`);
        item.unitPrice = price;
      }
      const variant = Product.variant(product, item.variantId);
      item.name = product.name;
      item.brand = product.brand;
      item.variantName = variant ? variant.name : (product.presentation || '');
      keep.push(item);
    }
    this.items = keep;
    if (changes.length) {
      this.notices = this.notices.concat(changes);
      this.save();
    }
    return changes;
  }
};
