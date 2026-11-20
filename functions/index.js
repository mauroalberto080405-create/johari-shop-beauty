/**
 * Cloud Functions de Johari Shop Beauty: pagos en línea con Culqi.
 *
 *  createOrder  → valida el carrito con precios y stock de Firestore y crea el pedido.
 *  payOrder     → cobra con la llave secreta de Culqi y descuenta el stock.
 *
 * La llave secreta se guarda en Secret Manager:
 *   firebase functions:secrets:set CULQI_SECRET_KEY
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { OrderError, buildOrder, describeOrder, normalizeItems, stockAfterSale, validateCustomer } from './src/order.js';

initializeApp();
const db = getFirestore();
const CULQI_SECRET_KEY = defineSecret('CULQI_SECRET_KEY');
const CULQI_CHARGES_URL = 'https://api.culqi.com/v2/charges';
const MIN_AMOUNT_CENTS = 300; // Monto mínimo aceptado por Culqi: S/ 3.00
const ORDER_TTL_MS = 30 * 60 * 1000;

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

function toHttpsError(error) {
  if (error instanceof HttpsError) return error;
  if (error instanceof OrderError) return new HttpsError('failed-precondition', [error.message, ...error.details].join(' '));
  logger.error('Error inesperado', error);
  return new HttpsError('internal', 'Ocurrió un error en el servidor.');
}

async function readProducts(ids, tx) {
  const refs = ids.map((id) => db.doc(`products/${id}`));
  const snaps = tx ? await Promise.all(refs.map((ref) => tx.get(ref))) : await db.getAll(...refs);
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
}

const itemsOf = (lines) => lines.map(({ productId, variantId, qty }) => ({ productId, variantId, qty }));
const uniqueIds = (lines) => [...new Set(lines.map((l) => l.productId))];

/** 1. Crea un pedido «pendiente de pago» con el monto calculado en el servidor. */
export const createOrder = onCall(async (request) => {
  try {
    const items = normalizeItems(request.data?.items);
    const customer = validateCustomer(request.data?.customer);
    const products = await readProducts(uniqueIds(items));
    const { lines, total, amountCents } = buildOrder(products, items);
    if (amountCents < MIN_AMOUNT_CENTS) throw new HttpsError('failed-precondition', 'El monto mínimo para pagar en línea es S/ 3.00.');

    const ref = db.collection('orders').doc();
    await ref.set({
      status: 'pending_payment',
      lines,
      total,
      amountCents,
      currency: 'PEN',
      customer,
      uid: request.auth?.uid || null,
      createdAt: FieldValue.serverTimestamp()
    });
    return { orderId: ref.id, total, amountCents, description: describeOrder(lines) };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 2. Cobra el pedido con el token de Culqi y descuenta el stock. */
export const payOrder = onCall({ secrets: [CULQI_SECRET_KEY] }, async (request) => {
  const orderId = typeof request.data?.orderId === 'string' ? request.data.orderId : '';
  const token = typeof request.data?.token === 'string' ? request.data.token : '';
  if (!/^[A-Za-z0-9]{10,40}$/.test(orderId) || !/^[a-z]{3}_(test|live)_[A-Za-z0-9]{8,}$/.test(token)) {
    throw new HttpsError('invalid-argument', 'Datos de pago no válidos.');
  }
  const orderRef = db.doc(`orders/${orderId}`);

  // a) Bloquea el pedido y vuelve a comprobar precios y stock antes de cobrar.
  let order;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new HttpsError('not-found', 'El pedido no existe.');
      order = snap.data();
      if (order.status !== 'pending_payment') {
        throw new HttpsError('failed-precondition', String(order.status).startsWith('paid') ? 'Este pedido ya fue pagado.' : 'Este pedido ya se está procesando.');
      }
      const createdAt = order.createdAt?.toMillis?.() || 0;
      if (Date.now() - createdAt > ORDER_TTL_MS) throw new HttpsError('failed-precondition', 'El pedido expiró. Vuelve a confirmarlo desde el carrito.');
      const products = await readProducts(uniqueIds(order.lines), tx);
      const fresh = buildOrder(products, itemsOf(order.lines));
      if (fresh.amountCents !== order.amountCents) throw new HttpsError('failed-precondition', 'Los precios cambiaron. Actualiza la página y revisa tu pedido.');
      tx.update(orderRef, { status: 'processing', processingAt: FieldValue.serverTimestamp() });
    });
  } catch (error) {
    throw toHttpsError(error);
  }

  // b) Cobro en Culqi (la llave secreta solo existe en el servidor).
  let charge;
  try {
    const response = await fetch(CULQI_CHARGES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CULQI_SECRET_KEY.value()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: order.amountCents,
        currency_code: 'PEN',
        email: order.customer.email,
        source_id: token,
        description: describeOrder(order.lines),
        metadata: { order_id: orderId }
      })
    });
    charge = await response.json();
    if (!response.ok || charge?.object === 'error') {
      await orderRef.update({ status: 'pending_payment', lastError: charge?.merchant_message || charge?.user_message || `HTTP ${response.status}`, updatedAt: FieldValue.serverTimestamp() });
      throw new HttpsError('aborted', charge?.user_message || 'El pago fue rechazado. Prueba con otro medio de pago.');
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    // No se sabe si Culqi llegó a cobrar: el pedido queda para revisión manual.
    logger.error('Fallo de comunicación con Culqi', { orderId, error: error.message });
    await orderRef.update({ status: 'needs_review', lastError: error.message, updatedAt: FieldValue.serverTimestamp() });
    throw new HttpsError('unavailable', 'No pudimos confirmar el pago con Culqi. Antes de reintentar, revisa si recibiste un comprobante o escríbenos por WhatsApp.');
  }

  // c) Pago aprobado: descuenta el stock y marca el pedido como pagado.
  try {
    await db.runTransaction(async (tx) => {
      const products = await readProducts(uniqueIds(order.lines), tx);
      const updates = new Map();
      for (const line of order.lines) {
        const current = { ...products.get(line.productId), ...updates.get(line.productId) };
        updates.set(line.productId, { ...updates.get(line.productId), ...stockAfterSale(current, line) });
      }
      for (const [id, patch] of updates) tx.update(db.doc(`products/${id}`), { ...patch, updatedAt: FieldValue.serverTimestamp() });
      tx.update(orderRef, { status: 'paid', chargeId: charge.id, paidAt: FieldValue.serverTimestamp() });
    });
    return { orderId, total: order.total, status: 'paid' };
  } catch (error) {
    // El cobro ya se hizo: se registra para que la administradora lo revise.
    logger.error('Pago cobrado con conflicto de stock', { orderId, error: error.message });
    await orderRef.update({ status: 'paid_stock_conflict', chargeId: charge.id, stockError: error.message, paidAt: FieldValue.serverTimestamp() });
    return { orderId, total: order.total, status: 'paid_stock_conflict' };
  }
});
