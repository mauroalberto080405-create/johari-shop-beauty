/**
 * Mensajes de WhatsApp. Todo el texto se codifica con encodeURIComponent.
 * Abrir WhatsApp no envía el mensaje: la clienta debe presionar «Enviar».
 */
import { CONFIG } from '../config.js';
import { money } from '../core/utils.js';
import { Product } from '../data/product.js';

export const WhatsApp = {
  url(text) {
    return `https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  },

  productQuery(product, variantId) {
    const variant = Product.variant(product, variantId);
    const lines = [
      `Hola, ${CONFIG.STORE_NAME}. Quisiera consultar por este producto:`,
      `${product.name}${product.brand ? ` – ${product.brand}` : ''}`
    ];
    if (variant) lines.push(`Opción: ${variant.name}`);
    else if (product.presentation) lines.push(`Presentación: ${product.presentation}`);
    lines.push(Product.price(product, variantId) === null ? '¿Me indican el precio y la disponibilidad?' : '¿Me confirman disponibilidad?');
    return this.url(lines.join('\n'));
  },

  itemLines(items) {
    return items.flatMap((it) => [
      `• ${it.qty} × ${it.name}${it.brand ? ` ${it.brand}` : ''}`,
      ...(it.variantName ? [`  Variante / presentación: ${it.variantName}`] : []),
      `  Precio unitario: ${money(it.unitPrice)}`,
      `  Subtotal: ${money(it.unitPrice * it.qty)}`,
      ''
    ]);
  },

  deliveryLines(data) {
    return [
      `Cliente: ${data.fullName}`,
      `Teléfono: ${data.phone}`,
      `Distrito / Provincia: ${data.district} / ${data.province}`,
      `Dirección: ${data.address}`,
      ...(data.reference ? [`Referencia: ${data.reference}`] : []),
      ...(data.notes ? [`Observaciones: ${data.notes}`] : [])
    ];
  },

  /** Pedido para coordinar el pago por WhatsApp. */
  order(items, data) {
    const unitsCount = items.reduce((sum, i) => sum + i.qty, 0);
    const total = Math.round(items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0) * 100) / 100;
    return [
      `Hola, ${CONFIG.STORE_NAME}. Quisiera solicitar este pedido:`,
      '',
      ...this.itemLines(items),
      `Cantidad de productos: ${unitsCount}`,
      `Total de productos: ${money(total)}`,
      'Envío: por coordinar, no incluido.',
      '',
      ...this.deliveryLines(data),
      `Pago preferido: ${data.preferred}`,
      '',
      '¿Me confirman disponibilidad, costo de envío y datos de pago?'
    ].join('\n');
  },

  /** Mensaje para coordinar el envío de un pedido ya pagado en línea. */
  paidOrder(order, data) {
    return [
      `Hola, ${CONFIG.STORE_NAME}. Acabo de pagar en línea el pedido N.° ${order.orderId} por ${money(order.total)}.`,
      'Quisiera coordinar el costo y la fecha de envío.',
      '',
      ...this.deliveryLines(data)
    ].join('\n');
  }
};
