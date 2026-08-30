/**
 * update.js — Update-Prüfung.
 *
 * Die App fragt in einem einstellbaren Abstand eine kleine JSON-Datei ab und
 * meldet, wenn dort eine neuere Version steht. Sie installiert NICHTS von
 * selbst: sie zeigt nur einen Hinweis mit Link. Das Installieren macht der
 * Benutzer über den normalen Android-Weg — deshalb braucht die App auch keine
 * Berechtigung zum Installieren von Paketen.
 *
 * Datenschutz: Der Aufruf ist ein einfaches GET ohne Kennung, ohne Zählpixel
 * und ohne Cookies. Es wird nichts über das Gerät oder den Betrieb übertragen.
 * Die Prüfung ist in den Einstellungen abschaltbar.
 *
 * Erwartetes Format der Datei (Beispiel siehe update.json im Projekt):
 * {
 *   "versionCode": 2,
 *   "versionName": "1.0.1",
 *   "apkUrl": "https://…/LaserKalk-1.0.1.apk",
 *   "hinweise": "Was neu ist",
 *   "pflicht": false
 * }
 *
 * DOM-frei und in Node testbar: fetch und Uhrzeit werden hereingereicht.
 */

import { APP_VERSION } from './version.js';

export const STATUS = {
  AUS: 'aus',                 // Prüfung abgeschaltet oder keine Adresse hinterlegt
  ZU_FRUEH: 'zuFrueh',        // Innerhalb des Prüfabstands, nichts zu tun
  AKTUELL: 'aktuell',         // Es läuft bereits die neueste Version
  NEU: 'neu',                 // Es gibt eine neuere Version
  FEHLER: 'fehler',           // Datei nicht erreichbar oder unbrauchbar
};

/**
 * Prüft eine geladene Update-Datei auf Plausibilität.
 * Gibt { ok:true, info } oder { ok:false, fehler } zurück.
 *
 * Bewusst streng: Eine kaputte oder fremde Datei darf nicht dazu führen, dass
 * dem Benutzer ein beliebiger Download angeboten wird.
 */
export function pruefeManifest(daten, aktuellerCode = APP_VERSION.code) {
  if (!daten || typeof daten !== 'object' || Array.isArray(daten)) {
    return { ok: false, fehler: 'Die Update-Datei hat kein gültiges Format.' };
  }
  const code = Number(daten.versionCode);
  if (!Number.isInteger(code) || code < 1 || code > 1_000_000) {
    return { ok: false, fehler: 'In der Update-Datei fehlt eine gültige versionCode-Angabe.' };
  }
  const name = typeof daten.versionName === 'string' && daten.versionName.trim()
    ? daten.versionName.trim() : String(code);

  let apkUrl = typeof daten.apkUrl === 'string' ? daten.apkUrl.trim() : '';
  if (apkUrl) {
    // Nur https zulassen – ein per http geladenes Installationspaket wäre
    // unterwegs manipulierbar.
    if (!/^https:\/\//i.test(apkUrl)) {
      return { ok: false, fehler: 'Die Adresse des Installationspakets muss mit https:// beginnen.' };
    }
    if (apkUrl.length > 2000) return { ok: false, fehler: 'Die Adresse des Installationspakets ist unbrauchbar lang.' };
  }

  const hinweise = typeof daten.hinweise === 'string' ? daten.hinweise.slice(0, 2000) : '';

  return {
    ok: true,
    info: {
      versionCode: code,
      versionName: name,
      apkUrl,
      hinweise,
      pflicht: daten.pflicht === true,
      neuer: code > Number(aktuellerCode),
    },
  };
}

/** Ist der Prüfabstand seit der letzten Prüfung verstrichen? */
export function faellig(letztePruefung, intervallStunden, jetzt = Date.now()) {
  const stunden = Number(intervallStunden);
  if (!Number.isFinite(stunden) || stunden <= 0) return true;
  const letzte = Number(letztePruefung) || 0;
  if (!letzte) return true;
  if (letzte > jetzt) return true;          // Uhr wurde zurückgestellt
  return jetzt - letzte >= stunden * 3600_000;
}

/**
 * Führt die Prüfung durch.
 *
 * @param {object} o
 *   o.url             Adresse der Update-Datei
 *   o.aktiv           Prüfung eingeschaltet?
 *   o.letztePruefung  Zeitstempel der letzten Prüfung
 *   o.intervallStunden
 *   o.erzwingen       true = Prüfabstand ignorieren (Knopf „Jetzt prüfen")
 *   o.aktuellerCode   versionCode der laufenden App
 *   o.fetchFn         fetch-Ersatz (für Tests)
 *   o.jetzt           Zeitstempel (für Tests)
 *   o.zeitlimitMs     Abbruch nach dieser Zeit (Standard 8 s)
 * @returns {Promise<{status:string, info?:object, fehler?:string, gepruektAm?:number}>}
 */
export async function pruefeUpdate(o = {}) {
  const {
    url, aktiv = true, letztePruefung = 0, intervallStunden = 24, erzwingen = false,
    aktuellerCode = APP_VERSION.code,
    fetchFn = (typeof fetch === 'function' ? fetch : null),
    jetzt = Date.now(),
    zeitlimitMs = 8000,
  } = o;

  if (!aktiv && !erzwingen) return { status: STATUS.AUS };
  if (!url || !/^https?:\/\//i.test(String(url))) return { status: STATUS.AUS };
  if (!erzwingen && !faellig(letztePruefung, intervallStunden, jetzt)) return { status: STATUS.ZU_FRUEH };
  if (!fetchFn) return { status: STATUS.FEHLER, fehler: 'Auf diesem Gerät ist kein Netzzugriff möglich.' };

  let antwort;
  try {
    // Zeitlimit, damit ein hängender Server die App nicht blockiert.
    const abbruch = typeof AbortController === 'function' ? new AbortController() : null;
    const uhr = abbruch ? setTimeout(() => abbruch.abort(), zeitlimitMs) : null;
    try {
      antwort = await fetchFn(url, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        signal: abbruch ? abbruch.signal : undefined,
      });
    } finally {
      if (uhr) clearTimeout(uhr);
    }
  } catch (e) {
    return { status: STATUS.FEHLER, fehler: 'Die Update-Datei ist nicht erreichbar.', gepruektAm: jetzt };
  }

  if (!antwort || !antwort.ok) {
    return {
      status: STATUS.FEHLER,
      fehler: `Die Update-Datei konnte nicht geladen werden (${antwort ? antwort.status : '?'}).`,
      gepruektAm: jetzt,
    };
  }

  let daten;
  try { daten = await antwort.json(); }
  catch { return { status: STATUS.FEHLER, fehler: 'Die Update-Datei ist keine gültige JSON-Datei.', gepruektAm: jetzt }; }

  const geprueft = pruefeManifest(daten, aktuellerCode);
  if (!geprueft.ok) return { status: STATUS.FEHLER, fehler: geprueft.fehler, gepruektAm: jetzt };

  return {
    status: geprueft.info.neuer ? STATUS.NEU : STATUS.AKTUELL,
    info: geprueft.info,
    gepruektAm: jetzt,
  };
}
