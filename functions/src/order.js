/**
 * Lógica de pedidos sin dependencias de Firebase (se prueba con node:test).
 * El servidor es la única fuente de verdad del monto: los precios y el stock
 * se leen de Firestore, nunca del navegador.
 */

export const MAX_LINES = 50;
export const MAX_QTY = 99;

export class OrderError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'OrderError';
    this.details = details;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const text = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** Valida y agrupa los ítems enviados por el navegador: [{productId, variantId, qty}]. */
export function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new OrderError('El carrito está vacío.');
  if (items.length > MAX_LINES) throw new OrderError(`El pedido supera el máximo de ${MAX_LINES} productos distintos.`);
  const merged = new Map();
  for (const item of items) {
    const productId = typeof item?.productId === 'string' ? item.productId.slice(0, 120) : '';
    const variantId = typeof item?.variantId === 'string' && item.variantId ? item.variantId.slice(0, 60) : null;
    const qty = item?.qty;
    if (!productId || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new OrderError('El carrito contiene datos no válidos. Actualiza la página e inténtalo de nuevo.');
    const key = `${productId}::${variantId || ''}`;
    const previous = merged.get(key);
    merged.set(key, { productId, variantId, qty: (previous?.qty || 0) + qty });
  }
  return [...merged.values()];
}

/** Valida los datos de entrega y contacto. */
export function validateCustomer(customer) {
  const c = {
    fullName: text(customer?.fullName, 80),
    phone: text(customer?.phone, 20),
    email: text(customer?.email, 120).toLowerCase(),
    district: text(customer?.district, 60),
    province: text(customer?.province, 60),
    address: text(customer?.address, 160),
    reference: text(customer?.reference, 160),
    notes: text(customer?.notes, 500)
  };
  const problems = [];
  if (c.fullName.length < 3) problems.push('nombre completo');
  if (!/^(\+?51)?9\d{8}$/.test(c.phone.replace(/[\s\-().]/g, ''))) problems.push('celular');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) problems.push('correo');
  if (c.district.length < 2) problems.push('distrito');
  if (c.province.length < 2) problems.push('provincia');
  if (c.address.length < 5) problems.push('dirección');
  if (problems.length) throw new OrderError(`Revisa estos datos: ${problems.join(', ')}.`, problems);
  return c;
}

function variantOf(product, variantId) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return variantId ? variants.find((v) => v.id === variantId) || null : null;
}

const validStock = (s) => Number.isInteger(s) && s >= 0;

/**
 * Construye las líneas del pedido con precios y stock del servidor.
 * @param {Map<string, object>} productsById productos leídos de Firestore
 * @param {Array} items ítems ya normalizados
 * @returns {{lines: Array, total: number, amountCents: number}}
 */
export function buildOrder(productsById, items) {
  const problems = [];
  const lines = [];
  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) {
      problems.push('Un producto de tu carrito ya no está disponible.');
      continue;
    }
    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    const variant = variantOf(product, item.variantId);
    if (hasVariants && !variant) {
      problems.push(`La opción elegida de «${product.name}» ya no existe.`);
      continue;
    }
    if (!hasVariants && item.variantId) {
      problems.push(`«${product.name}» cambió de presentación.`);
      continue;
    }
    const price = variant && typeof variant.price === 'number' && variant.price > 0 ? variant.price : product.price;
    const stock = hasVariants ? variant.stock : product.stock;
    const label = `«${product.name}${variant ? ` (${variant.name})` : ''}»`;
    if (typeof price !== 'number' || !(price > 0)) {
      problems.push(`${label} no tiene precio publicado.`);
      continue;
    }
    if (!validStock(stock)) {
      problems.push(`${label} tiene stock por confirmar.`);
      continue;
    }
    if (stock < item.qty) {
      problems.push(stock === 0 ? `${label} se agotó.` : `De ${label} solo quedan ${stock}.`);
      continue;
    }
    lines.push({
      productId: item.productId,
      variantId: variant ? variant.id : null,
      name: product.name,
      brand: product.brand || '',
      variantName: variant ? variant.name : (product.presentation || ''),
      qty: item.qty,
      unitPrice: round2(price)
    });
  }
  if (problems.length) throw new OrderError('Tu carrito cambió. Actualiza la página y revisa tu pedido.', problems);
  const total = round2(lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0));
  return { lines, total, amountCents: Math.round(total * 100) };
}

/**
 * Calcula el stock resultante tras vender una línea.
 * @returns {object} campos a actualizar en el producto ({stock} o {variants})
 */
export function stockAfterSale(product, line) {
  if (line.variantId) {
    const variants = (product.variants || []).map((v) => ({ ...v }));
    const variant = variants.find((v) => v.id === line.variantId);
    if (!variant || !validStock(variant.stock) || variant.stock < line.qty) {
      throw new OrderError(`Stock insuficiente de «${line.name} (${line.variantName})».`);
    }
    variant.stock -= line.qty;
    return { variants };
  }
  if (!validStock(product.stock) || product.stock < line.qty) {
    throw new OrderError(`Stock insuficiente de «${line.name}».`);
  }
  return { stock: product.stock - line.qty };
}

/** Resumen corto para el comprobante de Culqi (máx. 80 caracteres). */
export function describeOrder(lines) {
  const units = lines.reduce((sum, l) => sum + l.qty, 0);
  return `Johari Shop Beauty · ${units} ${units === 1 ? 'producto' : 'productos'}`.slice(0, 80);
}
