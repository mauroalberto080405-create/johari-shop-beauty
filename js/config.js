/**
 * Configuración central de la tienda.
 * Para pasar a producción: completa FIREBASE, cambia MODE a 'firebase'
 * y coloca la llave PÚBLICA de Culqi (pk_...). La llave secreta (sk_...)
 * NUNCA va aquí: se guarda como secreto de Cloud Functions.
 */
export const CONFIG = Object.freeze({
  // 'demo'     → funciona sin servidor; datos solo en este navegador (localStorage).
  // 'firebase' → Firebase Authentication + Cloud Firestore + Cloud Functions.
  MODE: 'demo',
  FIREBASE: Object.freeze({
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  }),
  FIREBASE_SDK_VERSION: '10.12.2',
  FUNCTIONS_REGION: 'us-central1',

  CULQI: Object.freeze({
    publicKey: '', // pk_test_... o pk_live_...
    checkoutScript: 'https://checkout.culqi.com/js/v4',
    paymentMethods: Object.freeze({ tarjeta: true, yape: true, bancaMovil: false, agente: false, billetera: false, cuotealo: false })
  }),

  STORE_NAME: 'Johari Shop Beauty',
  WHATSAPP_NUMBER: '51994426141',
  // Cuenta de prueba SOLO para la simulación local (modo demo). No es real ni da seguridad.
  // En Firebase la administradora se define con admins/{UID} (ver docs/CONFIGURACION.md).
  OWNER_EMAIL: 'duena@johari.demo',
  DEMO_OWNER_PASSWORD: 'JohariDemo2026',

  PREFERRED_METHODS: Object.freeze(['Yape', 'Transferencia BCP', 'Transferencia Interbank']),
  CATEGORIES: Object.freeze(['Maquillaje', 'Skincare', 'Perfumes/Mists', 'Bolsos y Accesorios']),
  SHIPPING_NOTE: 'Costo de envío por coordinar por WhatsApp. No incluido en el total de productos.',

  STORAGE: Object.freeze({
    products: 'johari.products.v1',
    cart: 'johari.cart.v1',
    users: 'johari.demo.users.v1',
    session: 'johari.demo.session.v1'
  }),

  // Cantidades de prueba (no provienen del PDF). Solo se aplican a pedido de la administradora.
  EXAMPLE_STOCK: Object.freeze([
    { id: 'pdf-tinta-labial-hidratante-poutsicle-fenty-beauty', stock: 5 },
    { id: 'pdf-paleta-de-sombras-bratz-x-beauty-creations', stock: 4 },
    { id: 'pdf-set-de-12-body-mist-edicion-navidena-2024-victoria-s-secret', stock: 0 },
    { id: 'pdf-crossbody-monogram-michael-kors', stock: 2 },
    { id: 'pdf-parches-para-granitos-starface', stock: 8 },
    { id: 'pdf-lip-glow-oil-full-size-dior', stock: 3 }
  ])
});

export const FIREBASE_READY = CONFIG.MODE === 'firebase' &&
  ['apiKey', 'authDomain', 'projectId', 'appId'].every((k) => typeof CONFIG.FIREBASE[k] === 'string' && CONFIG.FIREBASE[k].trim() !== '');

export const ACTIVE_MODE = FIREBASE_READY ? 'firebase' : 'demo';

/** El cobro en línea necesita backend (Cloud Functions) y la llave pública de Culqi. */
export const ONLINE_PAYMENTS_READY = ACTIVE_MODE === 'firebase' && /^pk_(test|live)_/.test(CONFIG.CULQI.publicKey);
