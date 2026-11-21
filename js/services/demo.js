/**
 * Modo demostración: catálogo y cuentas en localStorage.
 * La autenticación es una SIMULACIÓN local: no verifica identidad ni da seguridad.
 */
import { CONFIG } from '../config.js';
import { LocalStore } from '../core/storage.js';
import { normalizeText, randomId } from '../core/utils.js';
import { sanitizeProduct, seedProducts } from '../data/product.js';
import { services } from '../state.js';

const clone = (list) => list.map((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v })) }));

export const DemoBackend = {
  products: [],
  listener: null,

  async init(onProducts, onError) {
    this.listener = onProducts;
    const saved = LocalStore.read(CONFIG.STORAGE.products);
    if (!saved.ok || (saved.value !== null && !Array.isArray(saved.value))) {
      // Datos dañados: se respaldan y se vuelve a crear el catálogo inicial.
      LocalStore.writeRaw(`${CONFIG.STORAGE.products}.respaldo-danado`, LocalStore.readRaw(CONFIG.STORAGE.products) || '');
      onError(new Error('Los datos guardados del catálogo estaban dañados. Se restauró el catálogo inicial.'), true);
      this.products = seedProducts();
      this.persist();
    } else if (saved.value === null) {
      // Primera visita: el catálogo del PDF se siembra una sola vez.
      this.products = seedProducts();
      this.persist();
    } else {
      this.products = saved.value.map(sanitizeProduct).filter(Boolean);
      this.restoreCatalogImages();
    }

    // Sincroniza cambios hechos en otra pestaña del mismo navegador.
    window.addEventListener('storage', (event) => {
      if (event.key !== CONFIG.STORAGE.products || event.newValue === null) return;
      try {
        const list = JSON.parse(event.newValue);
        if (Array.isArray(list)) {
          this.products = list.map(sanitizeProduct).filter(Boolean);
          this.emit();
        }
      } catch {
        /* se ignoran cambios ilegibles */
      }
    });
    this.emit();
  },

  emit() {
    this.listener?.(clone(this.products));
  },

  persist() {
    LocalStore.write(CONFIG.STORAGE.products, this.products);
  },

  /**
   * Reparación única: los inventarios guardados con la primera versión de la tienda
   * pudieron perder la foto al migrar. Se devuelve la foto del catálogo del PDF
   * solo a los productos de ese catálogo que quedaron sin imagen.
   */
  restoreCatalogImages() {
    const flag = `${CONFIG.STORAGE.products}.fotos-restauradas`;
    if (LocalStore.readRaw(flag)) return;
    const seedImages = new Map(seedProducts().map((p) => [p.id, p.image]));
    let restored = 0;
    for (const product of this.products) {
      const image = seedImages.get(product.id);
      if (!product.image && image) {
        product.image = image;
        restored += 1;
      }
    }
    if (restored) {
      try {
        this.persist();
      } catch {
        return; // sin espacio: se reintentará en la próxima visita
      }
    }
    LocalStore.writeRaw(flag, '1');
  },

  requireAdmin() {
    if (!services.auth?.current?.isAdmin) throw new Error('No autorizado: solo la administradora puede modificar productos.');
  },

  /** Aplica un cambio y lo revierte si no se puede guardar. */
  commit(next) {
    const before = this.products;
    this.products = next;
    try {
      this.persist();
    } catch (error) {
      this.products = before;
      throw error;
    }
    this.emit();
  },

  async saveProduct(product) {
    this.requireAdmin();
    const clean = sanitizeProduct(product);
    const index = this.products.findIndex((p) => p.id === clean.id);
    const next = this.products.slice();
    if (index === -1) next.push(clean);
    else next[index] = clean;
    this.commit(next);
  },

  async deleteProduct(id) {
    this.requireAdmin();
    this.commit(this.products.filter((p) => p.id !== id));
  },

  async importMissing() {
    this.requireAdmin();
    const ids = new Set(this.products.map((p) => p.id));
    const missing = seedProducts().filter((p) => !ids.has(p.id));
    if (missing.length) this.commit(this.products.concat(missing));
    return missing.length;
  },

  async applyStock(patches) {
    this.requireAdmin();
    this.commit(this.products.map((p) => {
      const patch = patches.find((x) => x.id === p.id);
      return patch && !p.variants.length ? { ...p, stock: patch.stock } : p;
    }));
  },

  /** En modo demo no hay pagos en línea, así que no existen pedidos pagados. */
  watchOrders(onOrders) {
    onOrders([]);
    return () => {};
  }
};

async function hashPassword(password, salt) {
  const input = `${salt}:${password}`;
  if (window.crypto?.subtle && window.isSecureContext) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return `sha256:${Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  // Respaldo no criptográfico (solo para la simulación local).
  let hash = 0x811c9dc5;
  for (let r = 0; r < 1000; r += 1) {
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `fnv:${hash.toString(16)}`;
}

export const DemoAuth = {
  current: null,
  supportsReset: false,
  onChange: null,

  users() {
    const r = LocalStore.read(CONFIG.STORAGE.users);
    return r.ok && Array.isArray(r.value) ? r.value : [];
  },

  saveUsers(list) {
    LocalStore.write(CONFIG.STORAGE.users, list);
  },

  async init(onChange) {
    this.onChange = onChange;
    let users = this.users();
    const ownerEmail = normalizeText(CONFIG.OWNER_EMAIL);
    if (!users.some((u) => u.role === 'owner' && normalizeText(u.email) === ownerEmail)) {
      // Crea (o reemplaza) la cuenta de prueba de la dueña con el correo configurado.
      const salt = randomId('s');
      users = users.filter((u) => u.role !== 'owner' && normalizeText(u.email) !== ownerEmail);
      users.push({
        id: 'owner-demo', name: 'Ariana (demo)', email: CONFIG.OWNER_EMAIL, role: 'owner',
        salt, hash: await hashPassword(CONFIG.DEMO_OWNER_PASSWORD, salt), createdAt: Date.now()
      });
      this.saveUsers(users);
    }
    const session = LocalStore.read(CONFIG.STORAGE.session);
    const user = session.ok && session.value ? users.find((u) => u.id === session.value.userId) : null;
    this.setCurrent(user || null);
  },

  setCurrent(user) {
    this.current = user
      ? { uid: user.id, name: user.name, email: user.email, isAdmin: user.role === 'owner', emailVerified: true, roleLabel: user.role === 'owner' ? 'Administradora (simulada)' : 'Cliente' }
      : null;
    if (user) LocalStore.write(CONFIG.STORAGE.session, { userId: user.id });
    else LocalStore.remove(CONFIG.STORAGE.session);
    this.onChange?.(this.current);
  },

  async register(name, email, password) {
    const users = this.users();
    const normalized = email.trim().toLowerCase();
    if (normalized === CONFIG.OWNER_EMAIL.toLowerCase()) throw new Error('Este correo corresponde a la cuenta de prueba de la dueña: usa «Ingresar».');
    if (users.some((u) => u.email.toLowerCase() === normalized)) throw new Error('Ya existe una cuenta con ese correo en este navegador.');
    const salt = randomId('s');
    const user = { id: randomId('u'), name: name.trim(), email: normalized, role: 'customer', salt, hash: await hashPassword(password, salt), createdAt: Date.now() };
    users.push(user);
    this.saveUsers(users);
    this.setCurrent(user);
    return { needsVerification: false };
  },

  async login(email, password) {
    const normalized = email.trim().toLowerCase();
    const user = this.users().find((u) => u.email.toLowerCase() === normalized);
    if (!user || (await hashPassword(password, user.salt)) !== user.hash) throw new Error('Correo o contraseña incorrectos.');
    this.setCurrent(user);
  },

  async logout() {
    this.setCurrent(null);
  },

  async resetPassword() {
    throw new Error('La recuperación de contraseña solo está disponible con Firebase.');
  },

  async resendVerification() {
    throw new Error('La verificación de correo solo existe con Firebase.');
  }
};
