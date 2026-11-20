/**
 * Envoltorio de localStorage con manejo de errores.
 * Si el navegador bloquea el almacenamiento (modo privado, permisos),
 * los datos se mantienen en memoria mientras la página esté abierta.
 */
const memory = new Map();

const available = (() => {
  try {
    const key = '__johari_test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
})();

export const LocalStore = {
  available,

  /** Devuelve { ok, value } para distinguir «no existe» (value null) de «dañado» (ok false). */
  read(key) {
    try {
      const raw = available ? localStorage.getItem(key) : (memory.has(key) ? memory.get(key) : null);
      return { ok: true, value: raw === null ? null : JSON.parse(raw) };
    } catch (error) {
      return { ok: false, error };
    }
  },

  readRaw(key) {
    try {
      return available ? localStorage.getItem(key) : memory.get(key) ?? null;
    } catch {
      return null;
    }
  },

  write(key, value) {
    const raw = JSON.stringify(value);
    if (!available) {
      memory.set(key, raw);
      return;
    }
    try {
      localStorage.setItem(key, raw);
    } catch (error) {
      const quota = error && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014);
      throw new Error(quota
        ? 'No hay espacio suficiente en el almacenamiento del navegador. Usa una imagen más liviana o una URL de imagen.'
        : 'No se pudo guardar en el almacenamiento del navegador.');
    }
  },

  writeRaw(key, raw) {
    try {
      if (available) localStorage.setItem(key, raw);
      else memory.set(key, raw);
    } catch {
      /* sin acción: es un respaldo opcional */
    }
  },

  remove(key) {
    try {
      if (available) localStorage.removeItem(key);
      else memory.delete(key);
    } catch {
      /* sin acción */
    }
  }
};
