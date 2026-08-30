/**
 * store.js — Datenzugriff der Anwendung.
 *
 * Kapselt den Persistenz-Adapter, hält einen Cache im Speicher (die Datenmengen
 * sind klein) und schreibt nach jeder Änderung ein Spiegel-Backup. Die
 * Oberfläche kennt nur dieses Modul, nie IndexedDB.
 */

import { openDatabase, mirrorToLocalStorage, readLocalMirror, STORES, MemoryAdapter } from './db.js';
import {
  defaultSettings, defaultMaterialGroups, defaultProcesses, defaultGases,
  defaultMachines, defaultCutParams, SETTINGS_ID,
} from './defaults.js';
import { materialAbleiten } from './material.js';
import { uid, natCmp, isoDate } from './util.js';

class Store {
  constructor() {
    this.adapter = null;
    this.cache = {};
    this.bereit = false;
    this.hinweise = [];
    this.listener = new Set();
  }

  /* ---------- Start ---------- */

  async init() {
    this.adapter = await openDatabase();
    if (this.adapter.kind === 'memory') {
      this.hinweise.push('Achtung: Der Gerätespeicher ist nicht verfügbar. Daten gehen beim Schließen der App verloren. Bitte den Privatmodus verlassen oder Speicherzugriff erlauben.');
    }
    for (const s of STORES) this.cache[s] = await this.adapter.all(s);

    const leer = STORES.every(s => this.cache[s].length === 0);
    if (leer) {
      const spiegel = readLocalMirror();
      if (spiegel && spiegel.data && STORES.some(s => (spiegel.data[s] || []).length)) {
        this.wiederherstellungVerfuegbar = spiegel;
      }
      await this.erstbefuellung();
    }
    if (!this.settings) await this.erstbefuellung(true);
    this.bereit = true;
    return this;
  }

  /** Legt die Startwerte an (§37) – nur beim allerersten Start. */
  async erstbefuellung(nurSettings = false) {
    if (!this.cache.settings.find(s => s.id === SETTINGS_ID)) {
      await this.put('settings', defaultSettings());
    }
    if (nurSettings) return;
    if (!this.cache.materialGroups.length) await this.bulkPut('materialGroups', defaultMaterialGroups());
    if (!this.cache.processes.length) await this.bulkPut('processes', defaultProcesses());
    if (!this.cache.gases.length) await this.bulkPut('gases', defaultGases());
    if (!this.cache.machines.length) await this.bulkPut('machines', defaultMachines());
    if (!this.cache.cutParams.length) await this.bulkPut('cutParams', defaultCutParams());
  }

  /* ---------- Basisoperationen ---------- */

  onChange(fn) { this.listener.add(fn); return () => this.listener.delete(fn); }
  _melde(store) { for (const fn of this.listener) { try { fn(store); } catch (e) { console.error(e); } } }

  all(store) { return this.cache[store] || []; }
  get(store, id) { return (this.cache[store] || []).find(o => o.id === id) || null; }

  async put(store, obj) {
    if (!obj.id) obj.id = uid(store.slice(0, 3));
    await this.adapter.put(store, obj);
    const arr = this.cache[store] || (this.cache[store] = []);
    const i = arr.findIndex(o => o.id === obj.id);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    this._spiegeln();
    this._melde(store);
    return obj;
  }

  async bulkPut(store, objs) {
    for (const o of objs) if (!o.id) o.id = uid(store.slice(0, 3));
    await this.adapter.bulkPut(store, objs);
    const arr = this.cache[store] || (this.cache[store] = []);
    for (const o of objs) {
      const i = arr.findIndex(x => x.id === o.id);
      if (i >= 0) arr[i] = o; else arr.push(o);
    }
    this._spiegeln();
    this._melde(store);
    return objs;
  }

  async del(store, id) {
    await this.adapter.del(store, id);
    this.cache[store] = (this.cache[store] || []).filter(o => o.id !== id);
    this._spiegeln();
    this._melde(store);
  }

  async clear(store) {
    await this.adapter.clear(store);
    this.cache[store] = [];
    this._spiegeln();
    this._melde(store);
  }

  _spiegeln() {
    clearTimeout(this._spiegelTimer);
    this._spiegelTimer = setTimeout(() => mirrorToLocalStorage(this.adapter), 400);
  }

  /* ---------- Einstellungen ---------- */

  get settings() { return this.get('settings', SETTINGS_ID); }

  async setSettings(patch) {
    const neu = { ...defaultSettings(), ...(this.settings || {}), ...patch, id: SETTINGS_ID };
    return this.put('settings', neu);
  }

  /** §-Verbesserung: fortlaufende Kalkulationsnummer K-JJJJ-#### */
  async naechsteNummer() {
    const s = this.settings;
    const jahr = new Date().getFullYear();
    const zaehler = (Number(s.nummernZaehler) || 1);
    await this.setSettings({ nummernZaehler: zaehler + 1 });
    return `${s.nummernPraefix || 'K'}-${jahr}-${String(zaehler).padStart(4, '0')}`;
  }

  /* ---------- Materialgruppen ---------- */

  gruppen(nurAktive = false) {
    return this.all('materialGroups')
      .filter(g => !nurAktive || g.aktiv !== false)
      .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || natCmp(a.name, b.name));
  }
  gruppe(id) { return this.get('materialGroups', id); }

  /* ---------- Materialien ---------- */

  materialien(nurAktive = false) {
    const gr = new Map(this.all('materialGroups').map(g => [g.id, g]));
    return this.all('materials')
      .filter(m => !nurAktive || m.aktiv !== false)
      .map(m => materialAbleiten(m))
      .sort((a, b) =>
        ((gr.get(a.groupId)?.sort ?? 999) - (gr.get(b.groupId)?.sort ?? 999)) ||
        natCmp(a.werkstoff, b.werkstoff) ||
        (Number(a.dickeMm) - Number(b.dickeMm)));
  }

  material(id) {
    const m = this.get('materials', id);
    return m ? materialAbleiten(m) : null;
  }

  /** Speichert ein Material; abgeleitete Werte werden vorher berechnet. */
  async saveMaterial(mat) {
    const rein = materialAbleiten(mat);
    delete rein.abgeleitet;
    delete rein.tafelFlaecheM2;
    delete rein.flaechengewichtKgProM2;
    return this.put('materials', rein);
  }

  /** Werkstoffliste einer Gruppe (für die Auswahl Gruppe → Werkstoff → Stärke, §3). */
  werkstoffe(groupId, nurAktive = true) {
    const set = new Set();
    for (const m of this.all('materials')) {
      if (m.groupId !== groupId) continue;
      if (nurAktive && m.aktiv === false) continue;
      if (m.werkstoff) set.add(m.werkstoff);
    }
    return [...set].sort(natCmp);
  }

  /** Blechstärken zu Gruppe + Werkstoff. */
  staerken(groupId, werkstoff, nurAktive = true) {
    return this.all('materials')
      .filter(m => m.groupId === groupId && m.werkstoff === werkstoff && (!nurAktive || m.aktiv !== false))
      .map(m => ({ id: m.id, dickeMm: Number(m.dickeMm) || 0 }))
      .sort((a, b) => a.dickeMm - b.dickeMm);
  }

  lieferanten() {
    return [...new Set(this.all('materials').map(m => m.lieferant).filter(Boolean))].sort(natCmp);
  }

  /* ---------- Bearbeitungsarten / Gase / Maschinen ---------- */

  prozesse(nurAktive = false) {
    return this.all('processes')
      .filter(p => !nurAktive || p.aktiv !== false)
      .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || natCmp(a.name, b.name));
  }
  gase() { return this.all('gases').sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999)); }
  gas(id) { return this.get('gases', id); }
  maschinen() { return this.all('machines'); }
  maschine(id) { return this.get('machines', id) || this.all('machines')[0] || null; }

  /* ---------- Schnittparameter ---------- */

  schnittparameter() {
    return this.all('cutParams').sort((a, b) =>
      natCmp(a.werkstoff, b.werkstoff) || (Number(a.dickeMm) - Number(b.dickeMm)) || natCmp(a.gas, b.gas));
  }

  /* ---------- Kalkulationen ---------- */

  kalkulationen() {
    return this.all('calculations').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  kalkulation(id) { return this.get('calculations', id); }

  async saveKalkulation(calc) {
    const jetzt = Date.now();
    const doc = { ...calc };
    if (!doc.id) {
      doc.id = uid('calc');
      doc.createdAt = jetzt;
      if (!doc.nummer) doc.nummer = await this.naechsteNummer();
      if (!doc.datum) doc.datum = isoDate();
    }
    doc.updatedAt = jetzt;
    await this.put('calculations', doc);
    return doc;
  }

  /** §35: Kalkulation duplizieren. */
  async dupliziereKalkulation(id) {
    const orig = this.kalkulation(id);
    if (!orig) return null;
    const kopie = JSON.parse(JSON.stringify(orig));
    kopie.id = null;
    kopie.nummer = '';
    kopie.createdAt = null;
    kopie.datum = isoDate();
    kopie.bauteil = orig.bauteil ? `${orig.bauteil} (Kopie)` : '';
    return this.saveKalkulation(kopie);
  }

  /* ---------- Restbleche (§33, vorbereitet) ---------- */

  restbleche() { return this.all('remnants'); }
}

export const store = new Store();
export { MemoryAdapter };
