/**
 * Pagos en línea con Culqi (tarjeta y Yape).
 *
 * Flujo seguro:
 *  1. createOrder (Cloud Function) recalcula precios y stock en el servidor
 *     y devuelve el monto: el navegador nunca decide cuánto se cobra.
 *  2. El checkout de Culqi tokeniza la tarjeta o Yape: los datos de pago
 *     van directo a Culqi y nunca pasan por la tienda.
 *  3. payOrder (Cloud Function) cobra con la llave secreta y descuenta el stock.
 */
import { CONFIG, ONLINE_PAYMENTS_READY } from '../config.js';
import { callFunction } from './firebase.js';

let scriptPromise = null;
let pending = null;

function loadCulqi() {
  if (window.Culqi) return Promise.resolve(window.Culqi);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CONFIG.CULQI.checkoutScript;
      script.async = true;
      script.onload = () => (window.Culqi ? resolve(window.Culqi) : reject(new Error('No se pudo iniciar el checkout de Culqi.')));
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('No se pudo cargar el checkout de Culqi. Revisa tu conexión.'));
      };
      document.head.append(script);
    });
  }
  return scriptPromise;
}

/** Abre el checkout de Culqi y resuelve con el token de pago. */
async function collectToken({ amountCents, description, email }) {
  const Culqi = await loadCulqi();
  return new Promise((resolve, reject) => {
    pending = { reject };
    Culqi.publicKey = CONFIG.CULQI.publicKey;
    Culqi.settings({ title: CONFIG.STORE_NAME, currency: 'PEN', amount: amountCents, description });
    Culqi.options({
      lang: 'auto',
      installments: false,
      paymentMethods: { ...CONFIG.CULQI.paymentMethods },
      style: {
        bannerColor: '#2B2024',
        buttonBackground: '#2B2024',
        menuColor: '#2B2024',
        linksColor: '#7A5C00',
        buttonText: 'Pagar',
        priceColor: '#7A5C00'
      }
    });
    if (email) Culqi.email = email;
    // Culqi llama a esta función global cuando hay token o error.
    window.culqi = () => {
      if (Culqi.token) {
        const tokenId = Culqi.token.id;
        Culqi.close();
        pending = null;
        resolve(tokenId);
      } else if (Culqi.error) {
        pending = null;
        reject(new Error(Culqi.error.user_message || 'El pago no se pudo procesar.'));
      }
    };
    Culqi.open();
  });
}

export const Payments = {
  available: ONLINE_PAYMENTS_READY,

  /**
   * Ejecuta el pago completo.
   * @param {{items: Array<{productId:string, variantId:string|null, qty:number}>, customer: object, onStage?: Function}} input
   * @returns {Promise<{orderId: string, total: number, status: string}>}
   */
  async pay({ items, customer, onStage }) {
    if (!ONLINE_PAYMENTS_READY) throw new Error('El pago en línea aún no está activado en esta tienda.');
    onStage?.('creating');
    const order = await callFunction('createOrder', { items, customer });
    onStage?.('awaiting', order);
    const token = await collectToken({ amountCents: order.amountCents, description: order.description, email: customer.email });
    onStage?.('charging', order);
    return callFunction('payOrder', { orderId: order.orderId, token });
  },

  /** Cancela la espera si la clienta cierra el checkout de Culqi sin pagar. */
  cancel() {
    if (!pending) return;
    try { window.Culqi?.close(); } catch { /* sin acción */ }
    const { reject } = pending;
    pending = null;
    const error = new Error('Pago cancelado. No se realizó ningún cobro.');
    error.code = 'cancelled';
    reject(error);
  }
};
