/**
 * release.mjs — eine neue Fassung von LaserKalk fertigmachen und hochladen.
 *
 * WARUM ES DAS GIBT
 *
 * Eine Veröffentlichung bestand bisher aus acht Handgriffen: Version an vier
 * Stellen anheben, Tests laufen lassen, Web-Dateien nach Capacitor kopieren,
 * APK bauen, Web-Dateien in den Zweig gh-pages schieben, APK hochladen,
 * update.json umstellen, alles gegenprüfen. Wird einer davon vergessen,
 * merkt es niemand sofort:
 *
 *   - vergessene CACHE-Kennung  → alte Dateien werden weiter ausgeliefert
 *   - vergessenes APK           → update.json zeigt auf eine 404-Adresse
 *   - vergessene update.json    → niemand erfährt von der neuen Fassung
 *
 * Deshalb macht das hier ein Befehl, in fester Reihenfolge, mit Prüfungen
 * dazwischen. Ohne zusätzliche Abhängigkeiten — nur Node, git und Gradle.
 *
 * AUFRUF
 *
 *   npm run release                 nächste Fehlerbehebungs-Nummer (1.0.5 → 1.0.6)
 *   npm run release -- --minor      nächste Funktionsnummer  (1.0.5 → 1.1.0)
 *   npm run release -- --version 2.0.0
 *   npm run release -- --hinweise "Was neu ist"
 *   npm run release -- --probe      alles rechnen und bauen, aber NICHTS hochladen
 *   npm run release -- --kein-commit  Versionsanhebung nicht in main committen
 *   npm run release -- --nur-web    ohne APK veröffentlichen (update.json bleibt)
 *   npm run release -- --zweig test-veroeffentlichung    in einen anderen Zweig
 *
 * SIGNATUR
 *
 * Liegt `android/keystore.properties`, entsteht ein signiertes Release-APK.
 * Sonst wird ein Debug-APK gebaut und ausdrücklich davor gewarnt: Der
 * Debug-Schlüssel entsteht je Rechner neu, ein solches Paket lässt sich
 * später nicht über eine bestehende Installation aktualisieren.
 */

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, copyFileSync, readdirSync, unlinkSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

/** Argumentwert schon vor den übrigen Helfern lesen (für Konstanten). */
function wertVorab(name, standard) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
}

const WURZEL = dirname(fileURLToPath(import.meta.url));
/** Zielzweig der Veröffentlichung. Mit --zweig umstellbar (z. B. zum Erproben). */
const SEITEN_ZWEIG = wertVorab('--zweig', 'gh-pages');
const BASIS_URL = 'https://warscher80.github.io/Laserkalk';
/** So viele APK-Fassungen bleiben im Zweig gh-pages liegen. */
const APKS_BEHALTEN = 2;

/* ------------------------------------------------------------------ */
/* Kleine Helfer                                                       */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const hatFlag = (n) => args.includes(n);
const wert = (n, standard = null) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : standard;
};

const PROBE = hatFlag('--probe');
const NUR_WEB = hatFlag('--nur-web');
const COMMITTEN = !hatFlag('--kein-commit');

let schritt = 0;
const sage = (t) => console.log(`\n[${++schritt}] ${t}`);
const ok = (t) => console.log(`    ✓ ${t}`);
const info = (t) => console.log(`    · ${t}`);
const warnung = (t) => console.log(`    ⚠ ${t}`);

function abbruch(grund, rat) {
  console.error(`\n✖ Abgebrochen: ${grund}`);
  if (rat) console.error(`  ${rat}`);
  process.exit(1);
}

/**
 * Führt ein Programm aus — auch aus der Windows-Eingabeaufforderung.
 *
 * Unter Windows sind `npm`, `npx` und `gradlew` KEINE Programme, sondern
 * Batch-Dateien. Node startet sie seit Version 20 aus Sicherheitsgründen nur
 * noch über die Kommandozeile; ein direkter Aufruf endet mit EINVAL. Deshalb
 * laufen genau diese über die Shell, alles andere direkt.
 */
function lauf(befehl, argumente, opts = {}) {
  const win = process.platform === 'win32';
  const brauchtShell = win && /^(npm|npx|gradlew)(\.(cmd|bat))?$/i.test(befehl.replace(/^\.[/\\]/, ''));
  const gemeinsam = {
    cwd: opts.cwd || WURZEL, encoding: 'utf8',
    stdio: opts.leise ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...(opts.env || {}) },
  };
  const e = brauchtShell
    ? spawnSync(`${zitiere(befehl)} ${argumente.map(zitiere).join(' ')}`, { ...gemeinsam, shell: true })
    : spawnSync(befehl, argumente, gemeinsam);

  if (e.error) throw e.error;
  if (e.status !== 0) {
    const fehler = new Error(`${befehl} endete mit Code ${e.status}`);
    fehler.stdout = e.stdout; fehler.stderr = e.stderr;
    throw fehler;
  }
  return e.stdout || '';
}
/** Setzt Anführungszeichen, wo ein Pfad Leerzeichen enthalten kann (C:\\Program Files\\…). */
function zitiere(t) { return /[\s&|<>^]/.test(t) ? `"${t}"` : t; }
const git = (...a) => execSync(`git ${a.join(' ')}`, { cwd: WURZEL, encoding: 'utf8' }).trim();

/** Ersetzt genau EIN Vorkommen – sonst Abbruch. Verhindert stille Halbersetzungen. */
function ersetze(datei, alt, neu) {
  const pfad = join(WURZEL, datei);
  const inhalt = readFileSync(pfad, 'utf8');
  const treffer = inhalt.split(alt).length - 1;
  if (treffer !== 1) {
    abbruch(`In ${datei} wurde „${alt}" ${treffer}× gefunden, erwartet war genau 1×.`,
      'Die Datei hat sich verändert – bitte die Stelle von Hand prüfen.');
  }
  writeFileSync(pfad, inhalt.replace(alt, neu));
}

/**
 * Liest Einträge aus einem APK (= ZIP), ohne externes `unzip`.
 *
 * Gebraucht wird das, um das FERTIGE Paket gegenzuprüfen statt der
 * Quelldateien. Unter Windows gibt es kein `unzip`, und eine zusätzliche
 * Abhängigkeit soll das Projekt nicht bekommen — deshalb hier direkt über
 * das Zentralverzeichnis des ZIP-Formats und node:zlib.
 *
 * @returns {Map<string, Buffer>} Pfad im Paket → Inhalt
 */
function apkEintraege(pfad, praefix = '') {
  const b = readFileSync(pfad);

  // Ende des Zentralverzeichnisses (EOCD) von hinten suchen.
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 22 - 65536; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Kein gültiges ZIP-Ende gefunden – ist das wirklich ein APK?');

  const anzahl = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const heraus = new Map();

  for (let i = 0; i < anzahl; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Zentralverzeichnis beschädigt.');
    const methode = b.readUInt16LE(p + 10);
    const groessePackt = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const kommentarLen = b.readUInt16LE(p + 32);
    const lokal = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + kommentarLen;

    if (praefix && !name.startsWith(praefix)) continue;
    if (name.endsWith('/')) continue;

    // Der lokale Kopf hat eigene Längenangaben – die des Zentralverzeichnisses
    // dürfen dafür nicht verwendet werden.
    const lNameLen = b.readUInt16LE(lokal + 26);
    const lExtraLen = b.readUInt16LE(lokal + 28);
    const start = lokal + 30 + lNameLen + lExtraLen;
    const roh = b.subarray(start, start + groessePackt);
    heraus.set(name, methode === 0 ? Buffer.from(roh) : inflateRawSync(roh));
  }
  return heraus;
}

/* ------------------------------------------------------------------ */
/* 1. Ausgangslage prüfen                                              */
/* ------------------------------------------------------------------ */

console.log('LaserKalk – Veröffentlichung\n' + '='.repeat(48));

sage('Ausgangslage prüfen');

const schmutzig = git('status', '--porcelain');
if (schmutzig && !PROBE) {
  abbruch('Es liegen ungespeicherte Änderungen vor:\n' + schmutzig,
    'Erst committen (oder mit --probe nur durchspielen).');
}
if (schmutzig) warnung('Ungespeicherte Änderungen – im Probelauf erlaubt.');

const zweig = git('rev-parse', '--abbrev-ref', 'HEAD');
if (zweig !== 'main' && !PROBE) {
  abbruch(`Aktueller Zweig ist „${zweig}", veröffentlicht wird nur aus „main".`);
}
ok(`Zweig ${zweig}`);

/* --- Version bestimmen --- */
const versionJs = readFileSync(join(WURZEL, 'www/js/core/version.js'), 'utf8');
const altCode = Number(/code:\s*(\d+)/.exec(versionJs)?.[1]);
const altName = /name:\s*'([^']+)'/.exec(versionJs)?.[1];
if (!Number.isInteger(altCode) || !altName) abbruch('version.js ist nicht lesbar.');

let neuName = wert('--version');
if (!neuName) {
  const [gr, mi, pa] = altName.split('.').map(Number);
  if ([gr, mi, pa].some(n => !Number.isInteger(n))) {
    abbruch(`Versionsnummer „${altName}" passt nicht zum Muster X.Y.Z – bitte --version angeben.`);
  }
  neuName = hatFlag('--minor') ? `${gr}.${mi + 1}.0`
    : hatFlag('--major') ? `${gr + 1}.0.0`
      : `${gr}.${mi}.${pa + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(neuName)) abbruch(`„${neuName}" ist keine gültige Versionsnummer (X.Y.Z).`);
const neuCode = altCode + 1;
ok(`${altName} (${altCode})  →  ${neuName} (${neuCode})`);

const hinweise = wert('--hinweise', `Verbesserungen und Fehlerbehebungen in Fassung ${neuName}.`);

/* --- Signaturlage --- */
const signiert = existsSync(join(WURZEL, 'android/keystore.properties'));
if (signiert) ok('keystore.properties gefunden – es wird ein signiertes Release-APK gebaut.');
else if (!NUR_WEB) {
  warnung('Kein keystore.properties: es entsteht ein DEBUG-signiertes APK.');
  warnung('Der Debug-Schlüssel entsteht je Rechner neu. Ein Paket von einem anderen');
  warnung('Rechner lässt sich NICHT über eine bestehende Installation aktualisieren –');
  warnung('der Benutzer müsste deinstallieren und verlöre dabei seine Daten.');
}

/* ------------------------------------------------------------------ */
/* 2. Version an allen vier Stellen anheben                            */
/* ------------------------------------------------------------------ */

sage('Version anheben (vier Stellen, die zusammenpassen müssen)');

ersetze('www/js/core/version.js', `code: ${altCode},`, `code: ${neuCode},`);
ersetze('www/js/core/version.js', `name: '${altName}',`, `name: '${neuName}',`);
ok('www/js/core/version.js');

ersetze('www/sw.js', `const CACHE = 'laserkalk-${altName}-${altCode}';`,
  `const CACHE = 'laserkalk-${neuName}-${neuCode}';`);
ok(`www/sw.js  (Cache laserkalk-${neuName}-${neuCode})`);

ersetze('android/app/build.gradle', `versionCode ${altCode}`, `versionCode ${neuCode}`);
ersetze('android/app/build.gradle', `versionName "${altName}"`, `versionName "${neuName}"`);
ok('android/app/build.gradle');

const APK_NAME = `LaserKalk-${neuName}.apk`;
const update = JSON.parse(readFileSync(join(WURZEL, 'update.json'), 'utf8'));
update.versionCode = neuCode;
update.versionName = neuName;
update.apkUrl = `${BASIS_URL}/${APK_NAME}`;
update.hinweise = hinweise;
update.pflicht = false;
writeFileSync(join(WURZEL, 'update.json'), JSON.stringify(update, null, 2) + '\n');
ok(`update.json  (${APK_NAME})`);

/* ------------------------------------------------------------------ */
/* 3. Tests                                                            */
/* ------------------------------------------------------------------ */

sage('Tests');
try {
  // Genau dieselbe Auswahl wie `npm test`: nur *.test.js. Ein pauschales
  // `--test tests/` zöge auch die Browserprüfung mit herein, die einen
  // laufenden Browser braucht.
  const dateien = readdirSync(join(WURZEL, 'tests'))
    .filter(f => f.endsWith('.test.js')).map(f => `tests/${f}`);
  const ausgabe = lauf(process.execPath, ['--test', ...dateien], { leise: true });
  const zahl = /# pass (\d+)/.exec(ausgabe)?.[1] || '?';
  const fehlgeschlagen = Number(/# fail (\d+)/.exec(ausgabe)?.[1] || 0);
  if (fehlgeschlagen) throw new Error(ausgabe);
  ok(`${zahl} Tests bestanden`);
} catch (e) {
  console.error(String(e.stdout || e.message).split('\n').filter(z => /^not ok|error:/.test(z)).slice(0, 12).join('\n'));
  abbruch('Tests fehlgeschlagen – es wird nichts veröffentlicht.',
    'Die Versionsnummern wurden bereits angehoben; mit `git checkout .` zurücknehmen.');
}

/* ------------------------------------------------------------------ */
/* 4. APK bauen                                                        */
/* ------------------------------------------------------------------ */

let apkPfad = null;
if (!NUR_WEB) {
  sage('Android-Paket bauen');

  if (!existsSync(join(WURZEL, 'node_modules/@capacitor/cli'))) {
    info('Capacitor fehlt – wird nachinstalliert …');
    lauf('npm', ['install', '--no-audit', '--no-fund'], { leise: true });
  }
  if (!existsSync(join(WURZEL, 'android/local.properties'))) {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk) abbruch('Android-SDK nicht gefunden.', 'ANDROID_HOME setzen oder android/local.properties anlegen.');
    writeFileSync(join(WURZEL, 'android/local.properties'), `sdk.dir=${sdk}\n`);
    info(`android/local.properties angelegt (${sdk})`);
  }

  lauf('npx', ['cap', 'sync', 'android'], { leise: true });
  ok('Web-Dateien ins Android-Projekt kopiert');

  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const ziel = signiert ? 'assembleRelease' : 'assembleDebug';
  info(`gradlew ${ziel} …`);
  lauf(gradlew, [ziel, '--no-daemon', '-q'], { cwd: join(WURZEL, 'android'), leise: true });

  apkPfad = join(WURZEL, 'android/app/build/outputs/apk',
    signiert ? 'release/app-release.apk' : 'debug/app-debug.apk');
  if (!existsSync(apkPfad)) abbruch(`Gradle meldete Erfolg, aber ${apkPfad} fehlt.`);
  const mb = (readFileSync(apkPfad).length / 1024 / 1024).toFixed(1);
  ok(`${ziel} fertig (${mb} MB)`);

  /* --- Gegenprüfung AM PAKET, nicht an den Quelldateien --- */
  const imPaket = apkEintraege(apkPfad, 'assets/public/');
  const holen = (p) => imPaket.get('assets/public/' + p);
  const alsText = (p) => { const b = holen(p); return b ? b.toString('utf8') : null; };

  const vJs = alsText('js/core/version.js');
  const cJs = alsText('sw.js');
  if (!vJs || !cJs) abbruch('Im APK fehlen version.js oder sw.js.', 'Wurde cap sync ausgeführt?');
  if (!vJs.includes(`code: ${neuCode}`) || !vJs.includes(`name: '${neuName}'`)) {
    abbruch('Im APK steckt eine andere Version als erwartet.', 'Wurde cap sync ausgeführt?');
  }
  if (!cJs.includes(`laserkalk-${neuName}-${neuCode}`)) abbruch('Im APK steckt eine alte Cache-Kennung.');

  // Jede Datei, die der Service Worker offline ausliefern will, muss drin sein.
  const liste = [...cJs.match(/const DATEIEN\s*=\s*\[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const fehlend = liste.filter(d => d !== './' && !holen(d.replace(/^\.\//, '')));
  if (fehlend.length) abbruch(`Im APK fehlen Dateien, die sw.js offline ausliefern will: ${fehlend.join(', ')}`);
  ok(`Paket geprüft: Version stimmt, alle ${liste.length} Offline-Dateien enthalten`);
}

/* ------------------------------------------------------------------ */
/* 5. Hochladen                                                        */
/* ------------------------------------------------------------------ */

sage(`Hochladen nach ${SEITEN_ZWEIG}`);

if (PROBE) {
  info('Probelauf – es wird nichts hochgeladen und nichts committet.');
  info(`Es entstünde: ${APK_NAME}, Web-Dateien, update.json (versionCode ${neuCode})`);
  console.log('\nProbelauf beendet. Versionsnummern sind angehoben; mit `git checkout .` zurücknehmen.');
  process.exit(0);
}

const baum = mkdtempSync(join(tmpdir(), 'laserkalk-pages-'));
rmSync(baum, { recursive: true, force: true });
try {
  execSync(`git fetch origin ${SEITEN_ZWEIG}:refs/remotes/origin/${SEITEN_ZWEIG} -q`, { cwd: WURZEL });
  execSync(`git worktree add ${baum} origin/${SEITEN_ZWEIG} --detach -q`, { cwd: WURZEL });

  cpSync(join(WURZEL, 'www'), baum, { recursive: true });
  ok('Web-Dateien übernommen');

  if (apkPfad) {
    copyFileSync(apkPfad, join(baum, APK_NAME));
    ok(`${APK_NAME} übernommen`);

    // Alte Pakete ausräumen – jede Fassung sind rund 4,5 MB.
    const alte = readdirSync(baum).filter(f => /^LaserKalk-.*\.apk$/.test(f) && f !== APK_NAME).sort();
    for (const f of alte.slice(0, Math.max(0, alte.length - (APKS_BEHALTEN - 1)))) {
      unlinkSync(join(baum, f));
      info(`altes Paket entfernt: ${f}`);
    }
  }

  /*
   * update.json NUR mitschicken, wenn das dazugehörige APK auch wirklich
   * dort liegt. Sonst schickt die Update-Prüfung die Leute auf eine
   * 404-Adresse — genau der Fehler, der beim Veröffentlichen von Hand
   * zweimal beinahe passiert wäre.
   */
  if (existsSync(join(baum, APK_NAME))) {
    copyFileSync(join(WURZEL, 'update.json'), join(baum, 'update.json'));
    ok('update.json umgestellt – die Update-Prüfung meldet die neue Fassung');
  } else {
    warnung('Kein APK veröffentlicht: update.json bleibt auf der bisherigen Fassung stehen,');
    warnung('damit niemand auf eine nicht vorhandene Datei geschickt wird.');
  }

  execSync('git add -A', { cwd: baum });
  const nachricht =
    `LaserKalk ${neuName} veröffentlicht\n\n${hinweise}\n\n` +
    `Web-App auf Cache laserkalk-${neuName}-${neuCode}.` +
    (apkPfad ? ` Paket ${APK_NAME} (versionCode ${neuCode}, ${signiert ? 'signiert' : 'Debug-Signatur'}).` : '') +
    `\n\nErzeugt mit release.mjs.\n`;
  execSync(`git -c user.name="LaserKalk Release" -c user.email="nicowarscher@gmx.at" commit -q -F -`,
    { cwd: baum, input: nachricht });
  execSync(`git push origin HEAD:${SEITEN_ZWEIG} -q`, { cwd: baum });
  ok('hochgeladen');
} finally {
  try { execSync(`git worktree remove ${baum} --force`, { cwd: WURZEL, stdio: 'ignore' }); } catch { /* egal */ }
}

/* ------------------------------------------------------------------ */
/* 6. Versionsanhebung in main festhalten                              */
/* ------------------------------------------------------------------ */

/*
 * Ohne diesen Schritt bliebe main mit angehobener, aber uncommitteter
 * Version zurück — während draußen bereits die neue Fassung liegt. Beim
 * nächsten Lauf stünde dann eine falsche Ausgangsversion in den Dateien.
 */
if (COMMITTEN) {
  sage('Versionsanhebung in main festhalten');
  try {
    execSync('git add www/js/core/version.js www/sw.js android/app/build.gradle update.json', { cwd: WURZEL });
    execSync('git -c user.name="LaserKalk Release" -c user.email="nicowarscher@gmx.at" commit -q -F -',
      { cwd: WURZEL, input: `LaserKalk ${neuName} (Build ${neuCode})\n\n${hinweise}\n` });
    ok('committet');
    execSync('git push -q origin HEAD:main', { cwd: WURZEL });
    ok('nach main gepusht');
  } catch (e) {
    warnung('Konnte nicht committen oder pushen: ' + (e.message || e));
    warnung('Bitte von Hand: git commit -am "LaserKalk ' + neuName + '" && git push');
  }
}

/* ------------------------------------------------------------------ */
/* 7. Live gegenprüfen                                                 */
/* ------------------------------------------------------------------ */

sage('Live gegenprüfen');
info('GitHub Pages braucht meist eine halbe bis zwei Minuten …');

async function warteAuf(pfad, pruefung, sekunden = 240) {
  const ende = Date.now() + sekunden * 1000;
  while (Date.now() < ende) {
    try {
      const a = await fetch(`${BASIS_URL}/${pfad}?t=${Date.now()}`);
      if (a.ok && await pruefung(a)) return true;
    } catch { /* weiter versuchen */ }
    await new Promise(r => setTimeout(r, 5000));
  }
  return false;
}

const swDa = await warteAuf('sw.js', async a => (await a.text()).includes(`laserkalk-${neuName}-${neuCode}`));
if (swDa) ok(`sw.js ist live (laserkalk-${neuName}-${neuCode})`);
else warnung('sw.js zeigt noch die alte Kennung – GitHub Pages braucht länger. Später nachsehen.');

if (apkPfad) {
  const apkDa = await warteAuf(APK_NAME, async a => Number(a.headers.get('content-length')) > 1_000_000, 120);
  if (apkDa) ok(`${APK_NAME} ist abrufbar`);
  else warnung(`${APK_NAME} ist noch nicht abrufbar – später nachsehen.`);

  const upDa = await warteAuf('update.json', async a => (await a.json()).versionCode === neuCode, 120);
  if (upDa) ok('update.json meldet die neue Fassung');
  else warnung('update.json ist noch nicht aktuell – später nachsehen.');
}

/* ------------------------------------------------------------------ */

console.log('\n' + '='.repeat(48));
console.log(`LaserKalk ${neuName} (Build ${neuCode}) ist veröffentlicht.`);
console.log(`  Web-App:  ${BASIS_URL}/`);
if (apkPfad) console.log(`  Paket:    ${BASIS_URL}/${APK_NAME}${signiert ? '' : '   (Debug-Signatur!)'}`);
if (!COMMITTEN) {
  console.log('\nNoch zu tun im Haupt-Repo:');
  console.log(`  git commit -am "LaserKalk ${neuName}" && git push`);
}
