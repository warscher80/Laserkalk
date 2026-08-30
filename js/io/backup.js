/**
 * backup.js — Sicherung, Wiederherstellung, Export/Import (§39).
 *
 * Der Kern ist reine Textverarbeitung (String rein, String raus) und damit
 * testbar. Das Speichern der Datei übernimmt files.js.
 *
 * Formate:
 *   - Vollbackup / Teilexport: JSON mit Kopf (Version, Datum, Prüfsumme)
 *   - Materialien: CSV (Semikolon, deutsches Zahlenformat, Excel-tauglich)
 *   - Kalkulationen: CSV (Übersicht) – für Auswertungen in Excel
 */

import { STORES, DB_VERSION } from '../core/db.js';
import { materialAbleiten } from '../core/material.js';
import { berechne } from '../calc/engine.js';
import { centStr, toCent, parseNum } from '../core/money.js';
import { dateDe, isoDate, stampDe } from '../core/util.js';

export const BACKUP_FORMAT = 'laserkalk-backup';
/** Format der Backup-Hülle (Kopf, Prüfsumme). */
export const BACKUP_VERSION = 1;

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

/** Einfache, stabile Prüfsumme über den Nutzdatenteil. */
export function pruefsumme(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
  }
  return ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0');
}

/**
 * Baut ein Backup-Dokument.
 * @param {object} daten  { storeName: [...] }
 * @param {string[]} [stores]  Auswahl; Standard: alle
 */
export function baueBackup(daten, stores = STORES) {
  const nutz = {};
  for (const s of stores) nutz[s] = daten[s] || [];
  const body = JSON.stringify(nutz);
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: DB_VERSION,          // Aufbau der Datenbank, für Migrationen
    erstellt: new Date().toISOString(),
    stores,
    pruefsumme: pruefsumme(body),
    anzahl: Object.fromEntries(stores.map(s => [s, nutz[s].length])),
    daten: nutz,
  }, null, 1);
}

/**
 * Liest ein Backup und prüft es, BEVOR etwas eingespielt wird.
 * @returns {{ok:boolean, fehler?:string, warnungen:string[], daten?:object, kopf?:object}}
 */
export function leseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch { return { ok: false, fehler: 'Die Datei ist keine gültige JSON-Datei.', warnungen: [] }; }

  if (!obj || typeof obj !== 'object') return { ok: false, fehler: 'Die Datei hat keinen erkennbaren Inhalt.', warnungen: [] };
  if (obj.format !== BACKUP_FORMAT) {
    return { ok: false, fehler: 'Das ist kein LaserKalk-Backup. Bitte eine mit dieser App erzeugte Datei wählen.', warnungen: [] };
  }
  const warnungen = [];
  if (Number(obj.version) > BACKUP_VERSION) {
    return { ok: false, fehler: `Das Backup stammt aus einer neueren App-Version (Format ${obj.version}). Bitte zuerst die App aktualisieren.`, warnungen };
  }
  if (!obj.daten || typeof obj.daten !== 'object') return { ok: false, fehler: 'Im Backup fehlen die Daten.', warnungen };

  const body = JSON.stringify(obj.daten);
  if (obj.pruefsumme && pruefsumme(body) !== obj.pruefsumme) {
    warnungen.push('Die Prüfsumme stimmt nicht. Die Datei wurde nach dem Export verändert oder ist beschädigt.');
  }
  const unbekannt = Object.keys(obj.daten).filter(k => !STORES.includes(k));
  if (unbekannt.length) warnungen.push(`Unbekannte Bereiche im Backup werden übersprungen: ${unbekannt.join(', ')}.`);

  const schema = Number(obj.schemaVersion);
  if (Number.isFinite(schema) && schema > DB_VERSION) {
    return {
      ok: false,
      fehler: `Das Backup stammt aus einem neueren Datenbankstand (${schema} statt ${DB_VERSION}). Bitte zuerst die App aktualisieren.`,
      warnungen,
    };
  }
  if (Number.isFinite(schema) && schema < DB_VERSION) {
    warnungen.push(`Das Backup stammt aus Datenbankstand ${schema}; es wird auf Stand ${DB_VERSION} übernommen.`);
  }

  const daten = {};
  for (const s of STORES) {
    const arr = obj.daten[s];
    if (!Array.isArray(arr)) continue;
    const gueltig = arr.filter(o => o && typeof o === 'object' && typeof o.id === 'string');
    if (gueltig.length !== arr.length) warnungen.push(`${arr.length - gueltig.length} fehlerhafte Einträge in „${s}" übersprungen.`);
    daten[s] = gueltig;
  }
  return { ok: true, warnungen, daten, kopf: { erstellt: obj.erstellt, version: obj.version, anzahl: obj.anzahl } };
}

/* ------------------------------------------------------------------ */
/* Inhaltliche Prüfung vor dem Einspielen                              */
/* ------------------------------------------------------------------ */

const ZAHL = (v) => Number.isFinite(Number(v));
const GANZ_NICHT_NEGATIV = (v) => Number.isInteger(Number(v)) && Number(v) >= 0;

/**
 * Regeln je Bereich. Rückgabe: Fehlertext oder null.
 * Bewusst streng bei allem, was in eine Rechnung eingeht — ein Backup mit
 * NaN im Preisfeld würde sonst still falsche Angebote erzeugen.
 */
const REGELN = {
  settings: (o) => {
    for (const f of ['laserSatzCent', 'cadSatzCent', 'bedienerSatzCent', 'entgratSatzCent', 'mindestwertCent']) {
      if (o[f] !== undefined && !GANZ_NICHT_NEGATIV(o[f])) return `Einstellung "${f}" ist kein gültiger Cent-Betrag`;
    }
    for (const f of ['materialAufschlagBp', 'verschnittBp', 'gewinnBp', 'mwstBp']) {
      if (o[f] !== undefined && !GANZ_NICHT_NEGATIV(o[f])) return `Einstellung "${f}" ist kein gültiger Prozentwert`;
    }
    return null;
  },
  materialGroups: (o) => (!o.name ? 'Materialgruppe ohne Namen'
    : !(Number(o.dichteStd) > 0) ? `Materialgruppe "${o.name}" hat keine gültige Dichte` : null),
  materials: (o) => {
    if (!o.werkstoff) return 'Blech ohne Werkstoff';
    if (!(Number(o.dickeMm) > 0)) return `Blech "${o.werkstoff}" hat keine gültige Blechstärke`;
    if (!(Number(o.dichte) > 0)) return `Blech "${o.werkstoff}" hat keine gültige Dichte`;
    for (const f of ['ekTafelCent', 'ekProKgCent', 'preisProM2Cent']) {
      if (o[f] !== undefined && !GANZ_NICHT_NEGATIV(o[f])) return `Blech "${o.werkstoff}": "${f}" ist kein gültiger Cent-Betrag`;
    }
    for (const f of ['tafelLaengeMm', 'tafelBreiteMm']) {
      if (o[f] !== undefined && (!ZAHL(o[f]) || Number(o[f]) < 0)) return `Blech "${o.werkstoff}": "${f}" ist ungültig`;
    }
    return null;
  },
  cutParams: (o) => (!(Number(o.dickeMm) > 0) ? 'Schnittparameter ohne gültige Blechstärke'
    : !(Number(o.vSchnittMmMin) > 0) ? `Schnittparameter "${o.werkstoff || '?'}" ohne gültige Schnittgeschwindigkeit`
    : !ZAHL(o.piercingSek) || Number(o.piercingSek) < 0 ? `Schnittparameter "${o.werkstoff || '?'}" mit ungültiger Einstichzeit` : null),
  processes: (o) => (!o.name ? 'Bearbeitungsart ohne Namen'
    : !GANZ_NICHT_NEGATIV(o.satzCent) ? `Bearbeitungsart "${o.name}" hat keinen gültigen Stundensatz` : null),
  gases: (o) => (!o.name ? 'Gas ohne Namen'
    : !['inklusive', 'proStunde', 'proMinute', 'pauschal'].includes(o.modus) ? `Gas "${o.name}" hat eine unbekannte Abrechnungsart`
    : !GANZ_NICHT_NEGATIV(o.preisCent) ? `Gas "${o.name}" hat keinen gültigen Preis` : null),
  machines: (o) => (!o.name ? 'Maschine ohne Namen' : null),
  calculations: (o) => {
    const n = Number(o.stueckzahl);
    if (!Number.isFinite(n) || n < 1) return `Kalkulation "${o.nummer || o.id}" hat keine gültige Stückzahl`;
    for (const f of ['verschnittBp', 'materialAufschlagBp', 'gewinnBp', 'mwstBp']) {
      if (o[f] !== undefined && !GANZ_NICHT_NEGATIV(o[f])) return `Kalkulation "${o.nummer || o.id}": "${f}" ist ungültig`;
    }
    return null;
  },
};

/**
 * Prüft den Inhalt eines gelesenen Backups VOLLSTÄNDIG, bevor irgendetwas
 * geschrieben wird. Erst wenn hier nichts blockiert, darf eingespielt werden.
 *
 * @returns {{ok:boolean, fehler:string[], warnungen:string[], daten:Object, anzahl:Object}}
 */
export function validiereDaten(daten) {
  const fehler = [];
  const warnungen = [];
  const sauber = {};
  const anzahl = {};

  for (const bereich of STORES) {
    const arr = daten[bereich];
    if (!Array.isArray(arr)) continue;
    const regel = REGELN[bereich];
    const gesehen = new Set();
    const behalten = [];

    for (const o of arr) {
      if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id) {
        warnungen.push(`${bereich}: ein Eintrag ohne gültige Kennung wurde übersprungen.`);
        continue;
      }
      if (gesehen.has(o.id)) {
        // Doppelte Kennung im Backup: der spätere Eintrag gewinnt, wie beim Schreiben.
        warnungen.push(`${bereich}: Kennung "${o.id}" kommt mehrfach vor – der letzte Eintrag wird verwendet.`);
        const i = behalten.findIndex(x => x.id === o.id);
        if (i >= 0) behalten.splice(i, 1);
      }
      gesehen.add(o.id);
      const problem = regel ? regel(o) : null;
      if (problem) { fehler.push(`${bereich}: ${problem}.`); continue; }
      behalten.push(o);
    }
    sauber[bereich] = behalten;
    anzahl[bereich] = behalten.length;
  }

  if (!Object.values(anzahl).some(n => n > 0) && !fehler.length) {
    fehler.push('Das Backup enthält keine übernehmbaren Daten.');
  }
  return { ok: fehler.length === 0, fehler, warnungen, daten: sauber, anzahl };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

const SEP = ';';

function csvFeld(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvZeile(felder) { return felder.map(csvFeld).join(SEP); }

/** Deutsches Zahlformat für Excel (Komma als Dezimaltrenner, keine Tausenderpunkte). */
function zahl(v, dez = 2) {
  if (!Number.isFinite(v)) return '';
  return v.toFixed(dez).replace('.', ',');
}

export const MATERIAL_CSV_SPALTEN = [
  'Materialgruppe', 'Werkstoff', 'Bezeichnung', 'Blechstärke mm',
  'Tafellänge mm', 'Tafelbreite mm', 'Dichte kg/m3',
  'EK Tafel EUR', 'EK pro kg EUR', 'Preis pro m2 EUR', 'Preisquelle',
  'Gewicht pro Tafel kg', 'Lieferant', 'Artikelnummer', 'Preisdatum', 'Notizen', 'Aktiv',
];

/** §39: Materialdatenbank als CSV. */
export function materialienCsv(materialien, gruppen) {
  const gname = new Map((gruppen || []).map(g => [g.id, g.name]));
  const zeilen = [csvZeile(MATERIAL_CSV_SPALTEN)];
  for (const raw of materialien) {
    const m = materialAbleiten(raw);
    zeilen.push(csvZeile([
      gname.get(m.groupId) || m.groupId || '',
      m.werkstoff || '', m.bezeichnung || '',
      zahl(Number(m.dickeMm) || 0, 2),
      zahl(Number(m.tafelLaengeMm) || 0, 0), zahl(Number(m.tafelBreiteMm) || 0, 0),
      zahl(Number(m.dichte) || 0, 0),
      centStr(m.ekTafelCent || 0), centStr(m.ekProKgCent || 0), centStr(m.preisProM2Cent || 0),
      m.preisQuelle || 'tafel',
      zahl(m.gewichtProTafelKg || 0, 3),
      m.lieferant || '', m.artikelnummer || '',
      m.preisDatum ? dateDe(m.preisDatum) : '',
      m.notizen || '',
      m.aktiv === false ? 'nein' : 'ja',
    ]));
  }
  return '﻿' + zeilen.join('\r\n') + '\r\n';   // BOM, damit Excel UTF-8 erkennt
}

/** Zerlegt eine CSV-Zeile mit Semikolon und Anführungszeichen. */
export function csvSplit(zeile) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (inQ) {
      if (c === '"') { if (zeile[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === SEP) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Liest eine Material-CSV. Legt fehlende Materialgruppen NICHT still an, sondern
 * meldet sie — der Benutzer entscheidet.
 * @returns {{materialien:Array, fehler:string[], warnungen:string[], neueGruppen:string[]}}
 */
export function leseMaterialCsv(text, gruppen) {
  const fehler = [], warnungen = [];
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return { materialien: [], fehler: ['Die Datei ist leer.'], warnungen, neueGruppen: [] };

  const zeilen = clean.split('\n');
  const kopf = csvSplit(zeilen[0]).map(s => s.trim().toLowerCase());
  const idx = name => kopf.findIndex(h => h === name.toLowerCase());
  const spalte = { };
  for (const s of MATERIAL_CSV_SPALTEN) spalte[s] = idx(s);
  if (spalte['Werkstoff'] < 0 || spalte['Blechstärke mm'] < 0) {
    return { materialien: [], fehler: ['Der CSV-Kopf passt nicht. Erwartet werden mindestens die Spalten „Werkstoff" und „Blechstärke mm". Am besten zuerst einen Export erzeugen und diese Datei als Vorlage verwenden.'], warnungen, neueGruppen: [] };
  }

  const gByName = new Map((gruppen || []).map(g => [String(g.name).toLowerCase(), g]));
  const neueGruppen = new Set();
  const materialien = [];

  for (let i = 1; i < zeilen.length; i++) {
    if (!zeilen[i].trim()) continue;
    const f = csvSplit(zeilen[i]);
    const hole = name => (spalte[name] >= 0 ? (f[spalte[name]] ?? '').trim() : '');

    const werkstoff = hole('Werkstoff');
    const dicke = parseNum(hole('Blechstärke mm'), NaN);
    if (!werkstoff) { warnungen.push(`Zeile ${i + 1}: kein Werkstoff – übersprungen.`); continue; }
    if (!Number.isFinite(dicke) || dicke <= 0) { warnungen.push(`Zeile ${i + 1}: ungültige Blechstärke „${hole('Blechstärke mm')}" – übersprungen.`); continue; }

    const gName = hole('Materialgruppe');
    const gr = gByName.get(gName.toLowerCase());
    if (!gr && gName) neueGruppen.add(gName);

    materialien.push({
      _gruppeName: gName,
      groupId: gr ? gr.id : '',
      werkstoff,
      bezeichnung: hole('Bezeichnung') || `${werkstoff} ${String(dicke).replace('.', ',')} mm`,
      dickeMm: dicke,
      tafelLaengeMm: parseNum(hole('Tafellänge mm'), 0),
      tafelBreiteMm: parseNum(hole('Tafelbreite mm'), 0),
      dichte: parseNum(hole('Dichte kg/m3'), 0),
      ekTafelCent: toCent(hole('EK Tafel EUR'), 0),
      ekProKgCent: toCent(hole('EK pro kg EUR'), 0),
      preisProM2Cent: toCent(hole('Preis pro m2 EUR'), 0),
      preisQuelle: ['tafel', 'kg', 'm2'].includes(hole('Preisquelle')) ? hole('Preisquelle') : 'tafel',
      lieferant: hole('Lieferant'),
      artikelnummer: hole('Artikelnummer'),
      preisDatum: normDatum(hole('Preisdatum')),
      notizen: hole('Notizen'),
      aktiv: !/^(nein|no|0|false)$/i.test(hole('Aktiv')),
    });
  }
  if (!materialien.length && !fehler.length) fehler.push('Es konnte keine gültige Materialzeile gelesen werden.');
  return { materialien, fehler, warnungen, neueGruppen: [...neueGruppen] };
}

function normDatum(s) {
  if (!s) return '';
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim());
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  return iso ? s.trim() : '';
}

/** §39: Kalkulationen als CSV-Übersicht (für Excel-Auswertungen). */
export function kalkulationenCsv(kalkulationen) {
  const kopf = [
    'Nummer', 'Datum', 'Kunde', 'Projekt', 'Bauteil', 'Angebotsnummer',
    'Material', 'Stärke mm', 'Stückzahl',
    'Material EK EUR', 'Material VK EUR', 'Zeitkosten EUR', 'Gas EUR', 'Zusatzkosten EUR',
    'Kalkulationspreis netto EUR', 'Gewinn EUR', 'VK netto EUR', 'VK pro Stück EUR',
    'MwSt EUR', 'VK brutto EUR', 'Deckungsbeitrag EUR', 'Zuletzt geändert',
  ];
  const zeilen = [csvZeile(kopf)];
  for (const k of kalkulationen) {
    let r;
    try { r = berechne(k); } catch { continue; }
    zeilen.push(csvZeile([
      k.nummer || '', dateDe(k.datum) || '', k.kunde || '', k.projekt || '', k.bauteil || '', k.angebotsnummer || '',
      r.material.name || '', zahl(Number(k.material?.dickeMm) || 0, 2), r.stueckzahl,
      centStr(r.material.ekCent), centStr(r.material.vkCent), centStr(r.zeitenSummeCent),
      centStr(r.gas.kostenCent), centStr(r.zusatzSummeCent),
      centStr(r.kalkulationCent), centStr(r.gewinnCent), centStr(r.vkNettoCent), centStr(r.vkProStueckCent),
      centStr(r.mwstCent), centStr(r.vkBruttoCent), centStr(r.deckungsbeitragCent),
      k.updatedAt ? stampDe(k.updatedAt) : '',
    ]));
  }
  return '﻿' + zeilen.join('\r\n') + '\r\n';
}

/** Dateiname mit Datum, z. B. laserkalk-backup-2026-08-30.json */
export function dateiname(basis, endung) {
  return `${basis}-${isoDate()}.${endung}`;
}
