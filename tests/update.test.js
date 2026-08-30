import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruefeUpdate, pruefeManifest, faellig, STATUS } from '../www/js/core/update.js';
import { APP_VERSION, versionText } from '../www/js/core/version.js';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Versionen dürfen nicht auseinanderlaufen                            */
/* ------------------------------------------------------------------ */

test('version.js, build.gradle und sw.js nennen dieselbe Version', () => {
  const gradle = readFileSync(join(WURZEL, 'android/app/build.gradle'), 'utf8');
  const code = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
  const name = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];

  assert.equal(code, APP_VERSION.code,
    'versionCode in android/app/build.gradle weicht von core/version.js ab');
  assert.equal(name, APP_VERSION.name,
    'versionName in android/app/build.gradle weicht von core/version.js ab');

  const sw = readFileSync(join(WURZEL, 'www/sw.js'), 'utf8');
  const cache = /const CACHE = '([^']+)'/.exec(sw)?.[1];
  assert.equal(cache, `laserkalk-${APP_VERSION.name}-${APP_VERSION.code}`,
    'Die Cache-Kennung in www/sw.js muss zur Version passen, sonst liefert der Service Worker alte Dateien aus');
});

test('sw.js listet jede ausgelieferte JS-Datei im Cache', async () => {
  const { globSync } = await import('node:fs');
  const sw = readFileSync(join(WURZEL, 'www/sw.js'), 'utf8');
  const dateien = globSync('www/js/**/*.js', { cwd: WURZEL });
  const fehlen = dateien
    .map(f => './' + f.replace(/^www\//, '').replace(/\\/g, '/'))
    .filter(p => !sw.includes(`'${p}'`));
  assert.deepEqual(fehlen, [],
    'Diese Dateien fehlen in der Cache-Liste von www/sw.js und wären offline nicht verfügbar');
});

test('versionText ist lesbar', () => {
  assert.equal(versionText(), `${APP_VERSION.name} (${APP_VERSION.code})`);
});

/* ------------------------------------------------------------------ */
/* Manifest-Prüfung                                                    */
/* ------------------------------------------------------------------ */

const gutesManifest = {
  versionCode: 5,
  versionName: '1.2.0',
  apkUrl: 'https://example.org/LaserKalk-1.2.0.apk',
  hinweise: 'Nesting verbessert',
};

test('Gültiges Manifest wird angenommen', () => {
  const r = pruefeManifest(gutesManifest, 1);
  assert.equal(r.ok, true);
  assert.equal(r.info.versionCode, 5);
  assert.equal(r.info.versionName, '1.2.0');
  assert.equal(r.info.neuer, true);
  assert.equal(r.info.pflicht, false);
});

test('Gleiche oder ältere Version gilt nicht als neuer', () => {
  assert.equal(pruefeManifest({ ...gutesManifest, versionCode: 1 }, 1).info.neuer, false);
  assert.equal(pruefeManifest({ ...gutesManifest, versionCode: 1 }, 5).info.neuer, false);
});

test('Unbrauchbare Manifeste werden abgelehnt statt geraten', () => {
  for (const schlecht of [null, undefined, 'text', [], 42, {}, { versionCode: 'zwei' }, { versionCode: 0 }, { versionCode: -3 }, { versionCode: 1.5 }]) {
    assert.equal(pruefeManifest(schlecht, 1).ok, false, `angenommen wurde: ${JSON.stringify(schlecht)}`);
  }
});

test('Downloadadresse muss https sein', () => {
  const r = pruefeManifest({ ...gutesManifest, apkUrl: 'http://example.org/app.apk' }, 1);
  assert.equal(r.ok, false);
  assert.match(r.fehler, /https/);

  // Ohne Adresse ist das Manifest gültig, es wird dann nur gemeldet
  const ohne = pruefeManifest({ versionCode: 5, versionName: '1.2.0' }, 1);
  assert.equal(ohne.ok, true);
  assert.equal(ohne.info.apkUrl, '');
});

test('Fehlender versionName fällt auf den Code zurück, Hinweise werden begrenzt', () => {
  const r = pruefeManifest({ versionCode: 7, hinweise: 'x'.repeat(5000) }, 1);
  assert.equal(r.info.versionName, '7');
  assert.equal(r.info.hinweise.length, 2000);
});

/* ------------------------------------------------------------------ */
/* Prüfabstand                                                         */
/* ------------------------------------------------------------------ */

test('faellig respektiert den Prüfabstand', () => {
  const jetzt = 1_000_000_000_000;
  assert.equal(faellig(0, 24, jetzt), true, 'noch nie geprüft');
  assert.equal(faellig(jetzt - 1000, 24, jetzt), false, 'gerade eben geprüft');
  assert.equal(faellig(jetzt - 25 * 3600_000, 24, jetzt), true, 'länger als der Abstand her');
  assert.equal(faellig(jetzt + 5_000_000, 24, jetzt), true, 'Uhr wurde zurückgestellt');
  assert.equal(faellig(jetzt - 1000, 0, jetzt), true, 'Abstand 0 = immer prüfen');
});

/* ------------------------------------------------------------------ */
/* Ablauf                                                              */
/* ------------------------------------------------------------------ */

function antwort(daten, ok = true, status = 200) {
  return { ok, status, json: async () => daten };
}

test('Neue Version wird gemeldet', async () => {
  const r = await pruefeUpdate({
    url: 'https://example.org/update.json', aktiv: true, letztePruefung: 0,
    aktuellerCode: 1, jetzt: 123, fetchFn: async () => antwort(gutesManifest),
  });
  assert.equal(r.status, STATUS.NEU);
  assert.equal(r.info.versionName, '1.2.0');
  assert.equal(r.gepruektAm, 123);
});

test('Aktuelle Version meldet keinen Bedarf', async () => {
  const r = await pruefeUpdate({
    url: 'https://example.org/update.json', letztePruefung: 0,
    aktuellerCode: 5, fetchFn: async () => antwort(gutesManifest),
  });
  assert.equal(r.status, STATUS.AKTUELL);
});

test('Ohne Adresse oder abgeschaltet wird gar nicht erst geladen', async () => {
  let gerufen = 0;
  const zaehl = async () => { gerufen++; return antwort(gutesManifest); };
  assert.equal((await pruefeUpdate({ url: '', fetchFn: zaehl })).status, STATUS.AUS);
  assert.equal((await pruefeUpdate({ url: 'https://x/u.json', aktiv: false, fetchFn: zaehl })).status, STATUS.AUS);
  assert.equal((await pruefeUpdate({ url: 'ftp://x/u.json', fetchFn: zaehl })).status, STATUS.AUS);
  assert.equal(gerufen, 0, 'es darf kein Netzaufruf stattfinden');
});

test('Innerhalb des Prüfabstands wird nicht erneut geladen', async () => {
  let gerufen = 0;
  const jetzt = 1_000_000_000_000;
  const r = await pruefeUpdate({
    url: 'https://example.org/update.json', letztePruefung: jetzt - 1000,
    intervallStunden: 24, jetzt, fetchFn: async () => { gerufen++; return antwort(gutesManifest); },
  });
  assert.equal(r.status, STATUS.ZU_FRUEH);
  assert.equal(gerufen, 0);
});

test('erzwingen übergeht Prüfabstand und Abschaltung', async () => {
  let gerufen = 0;
  const jetzt = 1_000_000_000_000;
  const r = await pruefeUpdate({
    url: 'https://example.org/update.json', aktiv: false, letztePruefung: jetzt - 1000,
    intervallStunden: 24, jetzt, erzwingen: true, aktuellerCode: 1,
    fetchFn: async () => { gerufen++; return antwort(gutesManifest); },
  });
  assert.equal(gerufen, 1);
  assert.equal(r.status, STATUS.NEU);
});

test('Netzfehler, Serverfehler und Schrottdaten enden sauber im Fehlerzustand', async () => {
  const netz = await pruefeUpdate({
    url: 'https://example.org/update.json', letztePruefung: 0,
    fetchFn: async () => { throw new Error('offline'); },
  });
  assert.equal(netz.status, STATUS.FEHLER);
  assert.match(netz.fehler, /nicht erreichbar/);

  const server = await pruefeUpdate({
    url: 'https://example.org/update.json', letztePruefung: 0,
    fetchFn: async () => antwort(null, false, 404),
  });
  assert.equal(server.status, STATUS.FEHLER);
  assert.match(server.fehler, /404/);

  const schrott = await pruefeUpdate({
    url: 'https://example.org/update.json', letztePruefung: 0,
    fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new Error('kein json'); } }),
  });
  assert.equal(schrott.status, STATUS.FEHLER);
  assert.match(schrott.fehler, /JSON/);

  const fremd = await pruefeUpdate({
    url: 'https://example.org/update.json', letztePruefung: 0,
    fetchFn: async () => antwort({ irgendwas: true }),
  });
  assert.equal(fremd.status, STATUS.FEHLER);
});

test('Die mitgelieferte update.json ist gültig', () => {
  const vorlage = JSON.parse(readFileSync(join(WURZEL, 'update.json'), 'utf8'));
  const r = pruefeManifest(vorlage, 0);
  assert.equal(r.ok, true, r.fehler);
  assert.equal(r.info.versionCode, APP_VERSION.code,
    'Die Vorlage update.json muss die aktuelle Version nennen');
  assert.equal(r.info.versionName, APP_VERSION.name);
});
