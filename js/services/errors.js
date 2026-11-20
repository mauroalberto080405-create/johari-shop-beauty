/** Traduce errores de Firebase, Culqi y la aplicación a mensajes claros en español. */
const MESSAGES = {
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/weak-password': 'La contraseña es muy débil: usa al menos 8 caracteres.',
  'auth/missing-password': 'Ingresa tu contraseña.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'No hay conexión. Revisa tu internet e inténtalo otra vez.',
  'auth/operation-not-allowed': 'El acceso con correo y contraseña no está habilitado en Firebase.',
  'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase Authentication.',
  'permission-denied': 'No tienes permiso para realizar esta acción.',
  unavailable: 'El servicio no está disponible. Revisa tu conexión.',
  'failed-precondition': 'La base de datos no está lista. Revisa la configuración de Firestore.',
  'not-found': 'El elemento ya no existe.',
  'resource-exhausted': 'Se superó un límite del servicio. Inténtalo más tarde.',
  'invalid-argument': 'Algún dato no es válido.',
  'functions/internal': 'Ocurrió un error en el servidor. Inténtalo de nuevo.',
  'functions/unavailable': 'El servicio de pagos no está disponible. Inténtalo más tarde.',
  'functions/deadline-exceeded': 'El servidor tardó demasiado en responder. Revisa si el pago se registró antes de reintentar.'
};

/** Errores de Cloud Functions que ya traen un mensaje pensado para la clienta. */
const PASS_THROUGH = ['functions/failed-precondition', 'functions/invalid-argument', 'functions/aborted', 'functions/not-found', 'functions/permission-denied'];

export function friendlyError(error) {
  const code = error?.code || '';
  if (PASS_THROUGH.includes(code) && error.message) return error.message;
  if (MESSAGES[code]) return MESSAGES[code];
  if (error?.message && !code) return error.message;
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}
