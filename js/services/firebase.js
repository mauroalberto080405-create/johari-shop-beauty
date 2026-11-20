/**
 * Modo producción: Firebase Authentication, Cloud Firestore y Cloud Functions.
 * El SDK modular se carga desde gstatic solo cuando este modo está activo.
 *
 * Seguridad: los permisos reales los imponen las reglas de Firestore
 * (firestore.rules) y las Cloud Functions. Lo que hace este archivo solo
 * decide qué interfaz mostrar.
 */
import { CONFIG } from '../config.js';
import { sanitizeProduct, seedProducts } from '../data/product.js';
import { friendlyError } from './errors.js';

const sdk = { loaded: null, app: null, auth: null, db: null, functions: null };

async function loadSdk() {
  if (sdk.loaded) return sdk.loaded;
  const base = `https://www.gstatic.com/firebasejs/${CONFIG.FIREBASE_SDK_VERSION}/`;
  const [appMod, authMod, storeMod, fnMod] = await Promise.all([
    import(`${base}firebase-app.js`),
    import(`${base}firebase-auth.js`),
    import(`${base}firebase-firestore.js`),
    import(`${base}firebase-functions.js`)
  ]);
  sdk.app = appMod.initializeApp({ ...CONFIG.FIREBASE });
  sdk.auth = authMod.getAuth(sdk.app);
  sdk.auth.languageCode = 'es';
  sdk.db = storeMod.getFirestore(sdk.app);
  sdk.functions = fnMod.getFunctions(sdk.app, CONFIG.FUNCTIONS_REGION);
  sdk.loaded = { ...authMod, ...storeMod, ...fnMod };
  return sdk.loaded;
}

/** Llama a una Cloud Function «callable» y devuelve su resultado. */
export async function callFunction(name, data) {
  const f = await loadSdk();
  const result = await f.httpsCallable(sdk.functions, name, { timeout: 70000 })(data);
  return result.data;
}

function toDocument(product) {
  const { id, ...data } = sanitizeProduct(product);
  return { id, data };
}

export const FirestoreBackend = {
  async init(onProducts, onError) {
    const f = await loadSdk();
    f.onSnapshot(
      f.collection(sdk.db, 'products'),
      (snap) => onProducts(snap.docs.map((d) => sanitizeProduct({ ...d.data(), id: d.id })).filter(Boolean)),
      (error) => onError(new Error(friendlyError(error)))
    );
  },

  async saveProduct(product) {
    const f = await loadSdk();
    const { id, data } = toDocument(product);
    await f.setDoc(f.doc(sdk.db, 'products', id), { ...data, updatedAt: f.serverTimestamp() });
  },

  async deleteProduct(id) {
    const f = await loadSdk();
    await f.deleteDoc(f.doc(sdk.db, 'products', id));
  },

  /** Agrega los productos del catálogo inicial que no existan (no sobrescribe cambios). */
  async importMissing() {
    const f = await loadSdk();
    const snap = await f.getDocs(f.collection(sdk.db, 'products'));
    const existing = new Set(snap.docs.map((d) => d.id));
    const missing = seedProducts().filter((p) => !existing.has(p.id));
    for (let i = 0; i < missing.length; i += 400) {
      const batch = f.writeBatch(sdk.db);
      missing.slice(i, i + 400).forEach((p) => {
        const { id, data } = toDocument(p);
        batch.set(f.doc(sdk.db, 'products', id), { ...data, updatedAt: f.serverTimestamp() });
      });
      await batch.commit();
    }
    return missing.length;
  },

  async applyStock(patches) {
    const f = await loadSdk();
    const batch = f.writeBatch(sdk.db);
    patches.forEach((patch) => batch.update(f.doc(sdk.db, 'products', patch.id), { stock: patch.stock, updatedAt: f.serverTimestamp() }));
    await batch.commit();
  },

  /** Pedidos pagados (solo la administradora puede leerlos según las reglas). */
  watchOrders(onOrders, onError) {
    let unsubscribe = () => {};
    loadSdk().then((f) => {
      const q = f.query(f.collection(sdk.db, 'orders'), f.orderBy('createdAt', 'desc'), f.limit(50));
      unsubscribe = f.onSnapshot(q, (snap) => {
        onOrders(snap.docs.map((d) => {
          const o = d.data();
          return {
            id: d.id,
            status: o.status,
            total: o.total,
            lines: Array.isArray(o.lines) ? o.lines : [],
            customer: o.customer || {},
            paidAt: o.paidAt?.toDate?.() || null,
            createdAt: o.createdAt?.toDate?.() || null
          };
        }).filter((o) => String(o.status).startsWith('paid')));
      }, (error) => onError?.(new Error(friendlyError(error))));
    }).catch((error) => onError?.(error));
    return () => unsubscribe();
  }
};

export const FirebaseAuth = {
  current: null,
  supportsReset: true,
  onChange: null,

  async init(onChange) {
    this.onChange = onChange;
    const f = await loadSdk();
    f.onAuthStateChanged(sdk.auth, async (user) => {
      if (!user) {
        this.current = null;
        onChange(null);
        return;
      }
      let isAdmin = false;
      try {
        // admins/{uid} solo se crea desde la consola de Firebase (entorno confiable).
        const snap = await f.getDoc(f.doc(sdk.db, 'admins', user.uid));
        isAdmin = snap.exists() && user.emailVerified;
      } catch {
        isAdmin = false;
      }
      this.current = {
        uid: user.uid,
        name: user.displayName || user.email,
        email: user.email,
        isAdmin,
        emailVerified: user.emailVerified,
        roleLabel: isAdmin ? 'Administradora' : 'Cliente'
      };
      onChange(this.current);
    });
  },

  async register(name, email, password) {
    const f = await loadSdk();
    const cred = await f.createUserWithEmailAndPassword(sdk.auth, email.trim(), password);
    await f.updateProfile(cred.user, { displayName: name.trim() });
    await f.setDoc(f.doc(sdk.db, 'users', cred.user.uid), {
      name: name.trim(), email: cred.user.email, role: 'customer', createdAt: f.serverTimestamp()
    });
    await f.sendEmailVerification(cred.user);
    this.current = { uid: cred.user.uid, name: name.trim(), email: cred.user.email, isAdmin: false, emailVerified: false, roleLabel: 'Cliente' };
    this.onChange?.(this.current);
    return { needsVerification: true };
  },

  async login(email, password) {
    const f = await loadSdk();
    await f.signInWithEmailAndPassword(sdk.auth, email.trim(), password);
  },

  async logout() {
    const f = await loadSdk();
    await f.signOut(sdk.auth);
  },

  async resetPassword(email) {
    const f = await loadSdk();
    await f.sendPasswordResetEmail(sdk.auth, email.trim());
  },

  async resendVerification() {
    const f = await loadSdk();
    if (!sdk.auth.currentUser) throw new Error('Inicia sesión primero.');
    await f.sendEmailVerification(sdk.auth.currentUser);
  }
};
