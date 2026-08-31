/**
 * oberflaeche.browser.mjs — Prüfung des Verhaltens IM BROWSER.
 *
 * Die Datei läuft bewusst NICHT unter `npm test`: Sie braucht einen echten
 * Browser, und das Projekt bleibt sonst abhängigkeitsfrei. Aufruf:
 *
 *     npm run test:browser
 *
 * Ohne Playwright im System meldet sie das und endet ohne Fehler — die
 * Logikprüfung in tests/validierung.test.js läuft davon unabhängig.
 *
 * Geprüft wird genau das, was sich in Node nicht prüfen lässt: dass die
 * Meldung am Feld erscheint und wieder verschwindet, dass aria-invalid und
 * aria-describedby gesetzt sind, dass Speichern gesperrt ist und dass bei
 * sichtbarer Fehleingabe KEIN Preis mehr angezeigt wird.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW = fileURLToPath(new URL('../www/', import.meta.url));
const PORT = Number(process.env.PORT || 4655);
const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
  catch {
    console.log('Playwright ist nicht installiert – Browserprüfung übersprungen.');
    console.log('Die Logikprüfung läuft unabhängig davon: npm test');
    process.exit(0);
  }
}

/* --- Winziger Dateiserver, damit die ES-Module laden --- */
const server = createServer(async (req, res) => {
  try {
    const pfad = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const datei = join(WWW, pfad === '/' ? 'index.html' : pfad);
    const inhalt = await readFile(datei);
    res.writeHead(200, { 'Content-Type': TYPEN[extname(datei)] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.end(inhalt);
  } catch { res.writeHead(404).end('nicht gefunden'); }
});
await new Promise(r => server.listen(PORT, r));
const URL_ = `http://127.0.0.1:${PORT}/index.html`;

let bestanden = 0, durchgefallen = 0;
const pruefe = (bedingung, was) => {
  if (bedingung) { bestanden++; console.log(`  ok   ${was}`); }
  else { durchgefallen++; console.log(`  FEHL ${was}`); }
};

const browser = await chromium.launch();
const seite = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
const konsolenfehler = [];
seite.on('pageerror', e => konsolenfehler.push(e.message));
seite.on('console', m => { if (m.type() === 'error') konsolenfehler.push(m.text()); });

await seite.goto(URL_, { waitUntil: 'networkidle' });
await seite.waitForTimeout(800);
await seite.evaluate(async () => {
  const { store } = await import('./js/core/store.js');
  const { beispielMaterialien } = await import('./js/core/defaults.js');
  if (!store.all('materials').length) await store.bulkPut('materials', beispielMaterialien());
  for (const m of store.all('materials')) { if (!m.ekTafelCent) { m.ekTafelCent = 10000; await store.saveMaterial(m); } }
  try { sessionStorage.removeItem('laserkalk_quick'); } catch {}
});
await seite.goto(URL_ + '#/quick');
await seite.waitForTimeout(900);

const feld = (label) => seite.locator('.field')
  .filter({ has: seite.locator(`label:text-is("${label}")`) }).locator('input').first();

const zustand = () => seite.evaluate(() => {
  const inp = [...document.querySelectorAll('main input')];
  const rot = inp.filter(i => i.getAttribute('aria-invalid') === 'true');
  const sp = [...document.querySelectorAll('main button')]
    .find(b => /Als Kalkulation speichern/.test(b.textContent));
  const ersteMeldung = document.querySelector('.hint.feldfehler');
  const beschrieben = rot.every(i => (i.getAttribute('aria-describedby') || '')
    .split(/\s+/).some(id => document.getElementById(id)?.classList.contains('feldfehler')));
  return {
    anzahlRot: rot.length,
    meldung: ersteMeldung ? ersteMeldung.textContent : '',
    meldungIstVerbunden: rot.length ? beschrieben : true,
    meldungHatRolle: ersteMeldung ? ersteMeldung.getAttribute('role') === 'alert' : true,
    preisSichtbar: !!document.querySelector('.results'),
    pruefhinweis: !!document.querySelector('.pruefhinweis'),
    preisleiste: document.querySelector('#pricebar')?.textContent || '',
    speichernGesperrt: sp ? sp.disabled : null,
    gemerkteStueckzahl: (() => { try { return JSON.parse(sessionStorage.getItem('laserkalk_quick')).stueckzahl; } catch { return null; } })(),
    gemerkteLaserzeit: (() => { try { return JSON.parse(sessionStorage.getItem('laserkalk_quick')).zeiten.find(z => z.art === 'laser').minuten; } catch { return null; } })(),
  };
});

console.log('\nSchnellkalkulation – gültige Ausgangslage');
await feld('Länge').fill('1000');
await feld('Breite').fill('500');
await feld('Laser-Minuten').fill('2');
await feld('Stückzahl').fill('10');
await seite.waitForTimeout(500);
let z = await zustand();
pruefe(z.anzahlRot === 0, 'kein Feld ist rot');
pruefe(z.preisSichtbar, 'ein Preis wird angezeigt');
pruefe(z.speichernGesperrt === false, 'Speichern ist möglich');
const preisVorher = z.preisleiste;

console.log('\nStückzahl 0 – der gemeldete Fehler');
await feld('Stückzahl').fill('0');
await seite.waitForTimeout(500);
z = await zustand();
pruefe(z.anzahlRot === 1, 'genau ein Feld ist als fehlerhaft markiert');
pruefe(/ganze Zahl ab 1/.test(z.meldung), `Meldung nennt die Regel: „${z.meldung}"`);
pruefe(z.meldungIstVerbunden, 'Meldung ist über aria-describedby verbunden');
pruefe(z.meldungHatRolle, 'Meldung ist als role="alert" ausgezeichnet');
pruefe(!z.preisSichtbar, 'es wird KEIN Preis mehr angezeigt');
pruefe(z.pruefhinweis, 'der Ergebnisbereich zeigt „Eingaben prüfen"');
pruefe(/Eingaben prüfen/.test(z.preisleiste), 'die Preisleiste zeigt „Eingaben prüfen"');
pruefe(z.speichernGesperrt === true, 'Speichern ist gesperrt');
pruefe(z.gemerkteStueckzahl !== 0, 'die ungültige 0 wird nicht gespeichert');
pruefe(await feld('Stückzahl').inputValue() === '0', 'die Eingabe des Benutzers bleibt sichtbar');

console.log('\nStückzahl 1,5 – gebrochene Zahl');
await feld('Stückzahl').fill('1,5');
await seite.waitForTimeout(400);
z = await zustand();
pruefe(z.anzahlRot === 1 && /keine ganze Zahl/.test(z.meldung), 'gebrochene Stückzahl wird abgelehnt');
pruefe(!z.preisSichtbar, 'kein Preis bei gebrochener Stückzahl');

console.log('\nLaser-Minuten −1 – der zweite gemeldete Fehler');
await feld('Stückzahl').fill('10');
await seite.waitForTimeout(300);
await feld('Laser-Minuten').fill('-1');
await seite.waitForTimeout(500);
z = await zustand();
pruefe(z.anzahlRot === 1, 'die Laserzeit ist als fehlerhaft markiert');
pruefe(/nicht negativ/.test(z.meldung), `Meldung: „${z.meldung}"`);
pruefe(!z.preisSichtbar, 'kein Preis bei negativer Laserzeit');
pruefe(z.speichernGesperrt === true, 'Speichern ist gesperrt');
pruefe(z.gemerkteLaserzeit !== -1 && z.gemerkteLaserzeit >= 0, 'die −1 landet nicht im Modell');
pruefe(await feld('Laser-Minuten').inputValue() === '-1', 'die Eingabe bleibt sichtbar');

console.log('\nKorrektur – der Fehler muss sofort verschwinden');
await feld('Laser-Minuten').fill('2');
await seite.waitForTimeout(500);
z = await zustand();
pruefe(z.anzahlRot === 0, 'keine Fehlermarkierung mehr');
pruefe(z.meldung === '', 'keine Fehlermeldung mehr');
pruefe(z.preisSichtbar, 'der Preis wird wieder gerechnet');
pruefe(!z.pruefhinweis, '„Eingaben prüfen" ist verschwunden');
pruefe(z.speichernGesperrt === false, 'Speichern ist wieder möglich');
pruefe(z.preisleiste === preisVorher, 'derselbe Preis wie vor dem Fehler');

console.log('\nWeitere Zeitfelder');
for (const name of ['CAD-Minuten', 'Bediener-Minuten', 'Entgraten-Minuten']) {
  await feld(name).fill('-3');
  await seite.waitForTimeout(400);
  z = await zustand();
  pruefe(z.anzahlRot === 1 && !z.preisSichtbar && z.speichernGesperrt === true,
    `${name}: negativ wird abgelehnt, Preis und Speichern gesperrt`);
  await feld(name).fill('0');
  await seite.waitForTimeout(350);
}

console.log('\nEinheiten aus der Zwischenablage');
await feld('Länge').fill('850 mm');
await seite.waitForTimeout(400);
pruefe((await zustand()).anzahlRot === 0, 'passende Einheit „850 mm" wird angenommen');
await feld('Länge').fill('2,5 cm');
await seite.waitForTimeout(400);
z = await zustand();
pruefe(z.anzahlRot === 1 && /passt nicht/.test(z.meldung), 'fremde Einheit „2,5 cm" wird abgelehnt');
pruefe(!z.preisSichtbar, 'kein Preis bei fremder Einheit');
await feld('Länge').fill('1000');
await seite.waitForTimeout(400);

console.log('\nSpeichern bei Fehlern');
await feld('Stückzahl').fill('-4');
await seite.waitForTimeout(450);
const vorher = await seite.evaluate(async () => {
  const { store } = await import('./js/core/store.js');
  return store.all('calculations').length;
});
await seite.evaluate(() => {
  const b = [...document.querySelectorAll('main button')].find(x => /Als Kalkulation speichern/.test(x.textContent));
  b.disabled = false;           // Sperre absichtlich umgehen
  b.click();
});
await seite.waitForTimeout(900);
const nachher = await seite.evaluate(async () => {
  const { store } = await import('./js/core/store.js');
  return store.all('calculations').length;
});
pruefe(nachher === vorher, 'auch ein erzwungener Klick speichert nichts Ungültiges');

console.log('\nBeschriftungen');
const a11y = await seite.evaluate(() => {
  const f = [...document.querySelectorAll('main input, main select, main textarea')];
  return {
    gesamt: f.length,
    ohneId: f.filter(x => !x.id).length,
    ohneLabel: f.filter(x => !document.querySelector(`label[for="${CSS.escape(x.id || 'x')}"]`) && !x.getAttribute('aria-label')).length,
    ganzzahlTastatur: [...document.querySelectorAll('main input')]
      .filter(x => (document.querySelector(`label[for="${CSS.escape(x.id || 'x')}"]`) || {}).textContent === 'Stückzahl')
      .every(x => x.getAttribute('inputmode') === 'numeric'),
  };
});
pruefe(a11y.ohneId === 0, `alle ${a11y.gesamt} Felder haben eine ID`);
pruefe(a11y.ohneLabel === 0, 'alle Felder haben eine zugängliche Beschriftung');
pruefe(a11y.ganzzahlTastatur, 'die Stückzahl nutzt die Zifferntastatur');

pruefe(konsolenfehler.length === 0, `keine Konsolenfehler${konsolenfehler.length ? ': ' + konsolenfehler.join(' | ') : ''}`);

await browser.close();
server.close();
console.log(`\n${bestanden} bestanden, ${durchgefallen} durchgefallen`);
process.exit(durchgefallen ? 1 : 0);
