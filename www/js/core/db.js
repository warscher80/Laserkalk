/**
 * db.js — Persistenz-Adapter.
 *
 * Die App spricht NIE direkt mit IndexedDB, sondern nur mit dem Adapter-Interface:
 *     get(store,id) put(store,obj) del(store,id) all(store) bulkPut(store,arr) clear(store)
 *
 * Dadurch ist die Speicherschicht austauschbar (§43):
 *   - IdbAdapter    : IndexedDB, der Produktivfall (Browser, PWA, Capacitor-WebView)
 *   - MemoryAdapter : reiner RAM, für Tests und als Notfall-Fallback
 *   - (später)      : SqliteAdapter über @capacitor-community/sqlite — ohne Änderung
 *                     an Repos, Kalkulationslogik oder Oberfläche.
 */

export const DB_NAME = 'laserkalk';
export const DB_VERSION = 1;

/** Alle Objektspeicher der Anwendung. Schlüssel ist immer das Feld `id`. */
export const STORES = [
  'settings',
  'materialGroups',
  'materials',
  'cutParams',
  'processes',
  'gases',
  'machines',
  'calculations',
  'remnants',
  'meta',
];

/* ------------------------------------------------------------------ */
/* Memory-Adapter                                                      */
/* ------------------------------------------------------------------ */

export class MemoryAdapter {
  constructor() {
    this.data = new Map();
    for (const s of STORES) this.data.set(s, new Map());
    this.kind = 'memory';
  }
  _s(store) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store);
  }
  async open() { return this; }
  async get(store, id) { const v = this._s(store).get(id); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  async put(store, obj) { this._s(store).set(obj.id, JSON.parse(JSON.stringify(obj))); return obj; }
  async del(store, id) { this._s(store).delete(id); }
  async all(store) { return [...this._s(store).values()].map(v => JSON.parse(JSON.stringify(v))); }
  async bulkPut(store, arr) { for (const o of arr) await this.put(store, o); return arr; }
  async clear(store) { this._s(store).clear(); }
  /** Wie IdbAdapter.replaceAll – im Speicher ohnehin unteilbar. */
  async replaceAll(daten, leeren = true) {
    let anzahl = 0;
    for (const [name, arr] of Object.entries(daten)) {
      if (!STORES.includes(name)) continue;
      if (leeren) this._s(name).clear();
      for (const o of arr) { await this.put(name, o); anzahl++; }
    }
    return anzahl;
  }
  async close() {}
}

/* ------------------------------------------------------------------ */
/* IndexedDB-Adapter                                                   */
/* ------------------------------------------------------------------ */

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB-Fehler'));
  });
}

export class IdbAdapter {
  constructor(name = DB_NAME, version = DB_VERSION) {
    this.name = name;
    this.version = version;
    this.db = null;
    this.kind = 'indexeddb';
  }

  open() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(this.name, this.version);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        }
      };
      open.onsuccess = () => {
        this.db = open.result;
        this.db.onversionchange = () => { try { this.db.close(); } catch {} };
        resolve(this);
      };
      open.onerror = () => reject(open.error || new Error('IndexedDB konnte nicht geöffnet werden'));
      open.onblocked = () => reject(new Error('Datenbank durch ein anderes Fenster blockiert'));
    });
  }

  _tx(store, mode) {
    if (!this.db) throw new Error('Datenbank nicht geöffnet');
    return this.db.transaction(store, mode).objectStore(store);
  }

  async get(store, id) { return req(this._tx(store, 'readonly').get(id)); }
  async put(store, obj) { await req(this._tx(store, 'readwrite').put(obj)); return obj; }
  async del(store, id) { await req(this._tx(store, 'readwrite').delete(id)); }
  async all(store) { return (await req(this._tx(store, 'readonly').getAll())) || []; }

  async bulkPut(store, arr) {
    if (!arr.length) return arr;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const o of arr) os.put(o);
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Transaktion abgebrochen'));
    });
    return arr;
  }

  async clear(store) { await req(this._tx(store, 'readwrite').clear()); }

  /**
   * Ersetzt mehrere Bereiche in EINER Transaktion.
   *
   * Das ist der Kern eines sicheren Restore: Leeren und Neuschreiben passieren
   * gemeinsam. Bricht irgendetwas ab, macht IndexedDB die gesamte Transaktion
   * rückgängig — es kann kein Zustand entstehen, in dem die alten Daten weg und
   * die neuen unvollständig sind.
   *
   * @param {Object} daten  { storeName: [...Einträge] }
   * @param {boolean} leeren  true = betroffene Bereiche vorher leeren (Ersetzen),
   *                          false = nur überschreiben/ergänzen (Hinzufügen)
   */
  async replaceAll(daten, leeren = true) {
    const namen = Object.keys(daten).filter(n => STORES.includes(n));
    if (!namen.length) return 0;
    const tx = this.db.transaction(namen, 'readwrite');
    let anzahl = 0;
    for (const name of namen) {
      const os = tx.objectStore(name);
      if (leeren) os.clear();
      for (const o of daten[name]) { os.put(o); anzahl++; }
    }
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error || new Error('Schreibfehler'));
      tx.onabort = () => rej(tx.error || new Error('Transaktion abgebrochen'));
    });
    return anzahl;
  }

  async close() { if (this.db) { this.db.close(); this.db = null; } }
}

/* ------------------------------------------------------------------ */
/* Auswahl + Sicherungsnetz                                            */
/* ------------------------------------------------------------------ */

/**
 * Öffnet die beste verfügbare Datenbank.
 * Fällt IndexedDB aus (Privatmodus, alter WebView, gesperrter Speicher), läuft die App
 * im Memory-Adapter weiter — mit deutlich sichtbarer Warnung in der Oberfläche.
 */
export async function openDatabase() {
  if (typeof indexedDB !== 'undefined') {
    try {
      return await new IdbAdapter().open();
    } catch (e) {
      console.warn('IndexedDB nicht verfügbar, Rückfall auf Arbeitsspeicher:', e);
    }
  }
  return new MemoryAdapter().open();
}

/**
 * Bittet den Browser, den Speicher dauerhaft zu behalten.
 *
 * Ohne diese Zusage darf der Browser die Datenbank bei Platzmangel oder nach
 * längerer Nichtbenutzung löschen — bei Kalkulationsdaten eines Betriebs ist
 * das keine theoretische Gefahr. Chrome gewährt es meist stillschweigend,
 * Safari knüpft es an die Installation als Home-Bildschirm-App.
 *
 * @returns {Promise<{unterstuetzt:boolean, dauerhaft:boolean, belegtBytes:number|null, kontingentBytes:number|null}>}
 */
export async function speicherStatus(anfordern = true) {
  const aus = { unterstuetzt: false, dauerhaft: false, belegtBytes: null, kontingentBytes: null };
  if (typeof navigator === 'undefined' || !navigator.storage) return aus;
  aus.unterstuetzt = typeof navigator.storage.persisted === 'function';
  try {
    if (aus.unterstuetzt) {
      aus.dauerhaft = await navigator.storage.persisted();
      if (!aus.dauerhaft && anfordern && typeof navigator.storage.persist === 'function') {
        aus.dauerhaft = await navigator.storage.persist();
      }
    }
    if (typeof navigator.storage.estimate === 'function') {
      const e = await navigator.storage.estimate();
      aus.belegtBytes = Number.isFinite(e.usage) ? e.usage : null;
      aus.kontingentBytes = Number.isFinite(e.quota) ? e.quota : null;
    }
  } catch (e) {
    console.warn('Speicherstatus nicht ermittelbar:', e);
  }
  return aus;
}

const MIRROR_KEY = 'laserkalk_mirror_v1';

/**
 * Spiegelt den gesamten Datenbestand nach localStorage.
 * Reines Sicherungsnetz: Wird IndexedDB je vom System geleert, kann der Benutzer
 * beim nächsten Start wiederherstellen, statt alles neu zu erfassen.
 */
export async function mirrorToLocalStorage(adapter) {
  if (typeof localStorage === 'undefined') return false;
  try {
    const dump = {};
    for (const s of STORES) dump[s] = await adapter.all(s);
    localStorage.setItem(MIRROR_KEY, JSON.stringify({ v: DB_VERSION, ts: Date.now(), data: dump }));
    return true;
  } catch (e) {
    // Quota überschritten o. ä. — kein Grund, die App zu stoppen.
    console.warn('Spiegel-Backup fehlgeschlagen:', e);
    return false;
  }
}

export function readLocalMirror() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && obj.data ? obj : null;
  } catch { return null; }
}
