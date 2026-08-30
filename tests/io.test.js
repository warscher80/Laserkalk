import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baueBackup, leseBackup, pruefsumme, materialienCsv, leseMaterialCsv,
  kalkulationenCsv, csvSplit, MATERIAL_CSV_SPALTEN,
} from '../www/js/io/backup.js';
import { rasterNesting, restStreifen } from '../www/js/calc/nesting.js';
import { maschinenkosten, maschinenmarge } from '../www/js/calc/machine.js';
import { MemoryAdapter, STORES } from '../www/js/core/db.js';
import { neueKalkulation, neueZeit } from '../www/js/calc/engine.js';
import { defaultSettings } from '../www/js/core/defaults.js';
import { musterMaterial } from './helper.js';

/* ---------------- Backup ---------------- */

const daten = () => ({
  materials: [{ id: 'm1', werkstoff: 'S235JR', dickeMm: 2, ekTafelCent: 31250 }],
  materialGroups: [{ id: 'g1', name: 'Stahl', dichteStd: 7850 }],
  calculations: [{ id: 'c1', nummer: 'K-2026-0001', stueckzahl: 5 }],
});

test('Backup: Export und Import liefern dieselben Daten', () => {
  const text = baueBackup(daten(), ['materials', 'materialGroups', 'calculations']);
  const gelesen = leseBackup(text);
  assert.equal(gelesen.ok, true);
  assert.equal(gelesen.warnungen.length, 0);
  assert.deepEqual(gelesen.daten.materials, daten().materials);
  assert.deepEqual(gelesen.daten.calculations, daten().calculations);
});

test('Backup: fremde oder beschaedigte Dateien werden abgelehnt', () => {
  assert.equal(leseBackup('kein json').ok, false);
  assert.equal(leseBackup('{"a":1}').ok, false);
  assert.match(leseBackup('{"a":1}').fehler, /LaserKalk-Backup/);

  const zukunft = JSON.stringify({ format: 'laserkalk-backup', version: 99, daten: {} });
  const r = leseBackup(zukunft);
  assert.equal(r.ok, false);
  assert.match(r.fehler, /neueren App-Version/);
});

test('Backup: veraenderte Datei wird erkannt, aber nicht blockiert', () => {
  const text = baueBackup(daten(), ['materials']);
  const obj = JSON.parse(text);
  obj.daten.materials[0].ekTafelCent = 99999;
  const r = leseBackup(JSON.stringify(obj));
  assert.equal(r.ok, true);
  assert.ok(r.warnungen.some(w => /Pruefsumme|Prüfsumme/.test(w)));
});

test('Backup: fehlerhafte Eintraege werden uebersprungen und gezaehlt', () => {
  const obj = JSON.parse(baueBackup(daten(), ['materials']));
  obj.daten.materials.push({ kein: 'id' }, null);
  obj.pruefsumme = pruefsumme(JSON.stringify(obj.daten));
  const r = leseBackup(JSON.stringify(obj));
  assert.equal(r.ok, true);
  assert.equal(r.daten.materials.length, 1);
  assert.ok(r.warnungen.some(w => /fehlerhafte Eintr/.test(w)));
});

/* ---------------- CSV ---------------- */

test('CSV: Zeilen mit Semikolon und Anfuehrungszeichen werden korrekt zerlegt', () => {
  assert.deepEqual(csvSplit('a;b;c'), ['a', 'b', 'c']);
  assert.deepEqual(csvSplit('a;"b;c";d'), ['a', 'b;c', 'd']);
  assert.deepEqual(csvSplit('a;"sagt ""hallo""";c'), ['a', 'sagt "hallo"', 'c']);
  assert.deepEqual(csvSplit('a;;c'), ['a', '', 'c']);
});

test('CSV: Material-Export und -Import ergeben wieder dieselben Werte', () => {
  const gruppen = [{ id: 'g1', name: 'Stahl', dichteStd: 7850 }];
  const mats = [{
    id: 'm1', groupId: 'g1', werkstoff: 'S235JR', bezeichnung: 'S235JR 2,0 mm',
    dickeMm: 2, tafelLaengeMm: 2500, tafelBreiteMm: 1250, dichte: 7850,
    ekTafelCent: 31250, preisQuelle: 'tafel',
    lieferant: 'Muster GmbH; Filiale', artikelnummer: 'ART-1', preisDatum: '2026-08-01',
    notizen: 'Zeile mit "Anfuehrung"', aktiv: true,
  }];
  const csv = materialienCsv(mats, gruppen);
  assert.ok(csv.split('\r\n')[0].startsWith('﻿Materialgruppe'), 'BOM fuer Excel');

  const gelesen = leseMaterialCsv(csv, gruppen);
  assert.equal(gelesen.fehler.length, 0, gelesen.fehler.join(' '));
  assert.equal(gelesen.materialien.length, 1);
  const m = gelesen.materialien[0];
  assert.equal(m.werkstoff, 'S235JR');
  assert.equal(m.dickeMm, 2);
  assert.equal(m.tafelLaengeMm, 2500);
  assert.equal(m.dichte, 7850);
  assert.equal(m.ekTafelCent, 31250);
  assert.equal(m.lieferant, 'Muster GmbH; Filiale');
  assert.equal(m.preisDatum, '2026-08-01');
  assert.equal(m.notizen, 'Zeile mit "Anfuehrung"');
  assert.equal(m.groupId, 'g1');
  assert.equal(m.aktiv, true);
});

test('CSV-Import: falscher Kopf und ungueltige Zeilen werden gemeldet', () => {
  const r1 = leseMaterialCsv('Spalte1;Spalte2\r\na;b', []);
  assert.ok(r1.fehler.length > 0);
  assert.match(r1.fehler[0], /CSV-Kopf/);

  const kopf = MATERIAL_CSV_SPALTEN.join(';');
  const r2 = leseMaterialCsv(`${kopf}\r\nStahl;S235JR;;abc;;;;;;;;;;;;;ja\r\nStahl;;;2;;;;;;;;;;;;;ja`, []);
  assert.equal(r2.materialien.length, 0);
  assert.ok(r2.warnungen.some(w => /Blechst/.test(w)));
  assert.ok(r2.warnungen.some(w => /kein Werkstoff/.test(w)));
});

test('CSV-Import: fehlende Materialgruppen werden gemeldet, nicht still angelegt', () => {
  const kopf = MATERIAL_CSV_SPALTEN.join(';');
  const r = leseMaterialCsv(`${kopf}\r\nMessing;CuZn37;;1,5;2000;1000;8400;100,00;;;tafel;;;;;;ja`, []);
  assert.deepEqual(r.neueGruppen, ['Messing']);
  assert.equal(r.materialien[0].groupId, '');
  assert.equal(r.materialien[0].dickeMm, 1.5);
  assert.equal(r.materialien[0].ekTafelCent, 10000);
});

test('CSV: Kalkulationsuebersicht enthaelt die Endpreise', () => {
  const c = neueKalkulation(defaultSettings(), { id: 'c1', nummer: 'K-1', datum: '2026-08-30', kunde: 'Muster' });
  c.material = musterMaterial();
  c.stueckzahl = 10;
  c.verbrauch = { methode: 'kosten', kostenCent: 3000, proStueck: false };
  c.zeiten = [{ ...neueZeit('laser', 'Laser', 3000, 'gesamt'), minuten: 120 }];
  c.gewinnAktiv = false; c.mindestwertAktiv = false; c.verschnittBp = 0;
  const csv = kalkulationenCsv([c]);
  const zeilen = csv.split('\r\n');
  assert.ok(zeilen[0].includes('VK netto EUR'));
  assert.ok(zeilen[1].includes('K-1'));
  assert.ok(zeilen[1].includes('30.08.2026'));
  assert.ok(zeilen[1].includes('Muster'));
});

/* ---------------- Nesting ---------------- */

test('Nesting: Rasterberechnung fuer 2500 x 1250 und 300 x 180', () => {
  const n = rasterNesting({
    tafelLaengeMm: 2500, tafelBreiteMm: 1250,
    teilBreiteMm: 300, teilHoeheMm: 180,
    randMm: 10, stegMm: 5, menge: 50,
  });
  assert.equal(n.ok, true);
  // ohne Drehung: floor((2480+5)/305)=8 Spalten, floor((1230+5)/185)=6 Reihen = 48
  // mit Drehung:  floor((2480+5)/185)=13 Spalten, floor((1230+5)/305)=4 Reihen = 52
  assert.equal(n.proTafel, 52);
  assert.equal(n.drehung, 90);
  assert.equal(n.tafeln, 1);
  assert.ok(n.ausnutzungProzent > 89 && n.ausnutzungProzent < 90, `Ausnutzung ${n.ausnutzungProzent}`);
  assert.ok(Math.abs(n.verschnittProzent + n.ausnutzungProzent - 100) < 1e-9);
});

test('Nesting: mehrere Tafeln und Restflaeche', () => {
  const n = rasterNesting({
    tafelLaengeMm: 2000, tafelBreiteMm: 1000,
    teilBreiteMm: 500, teilHoeheMm: 400, randMm: 0, stegMm: 0, menge: 10,
  });
  // ungedreht 4 x 2 = 8, gedreht 5 x 2 = 10 -> die bessere Variante gewinnt
  assert.equal(n.proTafel, 10);
  assert.equal(n.drehung, 90);
  assert.equal(n.tafeln, 1);
  // 10 x 0,2 m2 fuellen die 2 m2 Tafel exakt aus
  assert.equal(n.restflaecheM2, 0);
  assert.ok(Math.abs(n.flaecheProStueckM2 - 0.2) < 1e-9);

  // Bei 11 Stueck wird eine zweite Tafel gebraucht.
  const n2 = rasterNesting({
    tafelLaengeMm: 2000, tafelBreiteMm: 1000,
    teilBreiteMm: 500, teilHoeheMm: 400, randMm: 0, stegMm: 0, menge: 11,
  });
  assert.equal(n2.tafeln, 2);
  assert.ok(n2.flaecheProStueckM2 > n.flaecheProStueckM2, 'die angebrochene zweite Tafel schlaegt durch');
});

test('Nesting: zu grosses Bauteil wird sauber abgelehnt', () => {
  const n = rasterNesting({
    tafelLaengeMm: 2500, tafelBreiteMm: 1250,
    teilBreiteMm: 3000, teilHoeheMm: 200, menge: 1,
  });
  assert.equal(n.ok, false);
  assert.match(n.grund, /passt/);
  assert.equal(n.tafeln, 0);
});

test('Nesting: fehlende Masse werden nicht geraten', () => {
  assert.equal(rasterNesting({ tafelLaengeMm: 0, tafelBreiteMm: 1250, teilBreiteMm: 100, teilHoeheMm: 100 }).ok, false);
});

test('Restbleche werden aus dem Nesting abgeleitet', () => {
  const n = rasterNesting({
    tafelLaengeMm: 2500, tafelBreiteMm: 1250,
    teilBreiteMm: 300, teilHoeheMm: 180, randMm: 10, stegMm: 5, menge: 1,
  });
  const reste = restStreifen(n, 2500, 1250, 300, 180, 10, 5);
  assert.ok(Array.isArray(reste));
  for (const r of reste) assert.ok(r.laengeMm > 0 && r.breiteMm > 0);
});

/* ---------------- Maschinenkalkulation ---------------- */

test('Maschinenstundensatz: Selbstkosten je Stunde', () => {
  const k = maschinenkosten({
    anschaffungCent: 12_000_000,          // 120.000 EUR
    elektroinstallationCent: 800_000,     //   8.000 EUR
    nutzungsdauerJahre: 8,
    stundenProJahr: 1500,
    wartungProJahrCent: 600_000,          //   6.000 EUR
    raumkostenProJahrCent: 300_000,       //   3.000 EUR
    sonstigeFixkostenProJahrCent: 150_000,//   1.500 EUR
    strompreisCentProKwh: 25,             //     0,25 EUR/kWh
    stromverbrauchKw: 18,
  });
  assert.equal(k.investition, 12_800_000);
  assert.equal(k.abschreibungProJahr, 1_600_000);       // 16.000 EUR/Jahr
  assert.equal(k.abschreibungProStunde, Math.round(1_600_000 / 1500));
  assert.equal(k.stromProStunde, 450);                  // 18 kW x 0,25 EUR = 4,50 EUR
  const erwartet = Math.round(1_600_000 / 1500) + Math.round(600_000 / 1500)
    + Math.round(300_000 / 1500) + Math.round(150_000 / 1500) + 450;
  assert.equal(k.selbstkostenProStunde, erwartet);
  assert.equal(k.vollstaendig, true);
});

test('Maschinenstundensatz: unvollstaendige Eingaben ergeben keine Fantasiewerte', () => {
  const k = maschinenkosten({ anschaffungCent: 1000000 });
  assert.equal(k.vollstaendig, false);
  assert.equal(k.abschreibungProStunde, 0);
});

test('Marge gegenueber dem Verrechnungssatz', () => {
  const m = maschinenmarge(2000, 3000);
  assert.equal(m.diffCent, 1000);
  assert.equal(m.prozent, 50);
  assert.equal(maschinenmarge(3000, 2000).diffCent, -1000);
});

/* ---------------- Speicheradapter ---------------- */

test('Der Speicheradapter erfuellt seinen Vertrag', async () => {
  const a = await new MemoryAdapter().open();
  assert.equal(await a.get('materials', 'x'), undefined);
  await a.put('materials', { id: 'x', wert: 1 });
  assert.deepEqual(await a.get('materials', 'x'), { id: 'x', wert: 1 });
  await a.bulkPut('materials', [{ id: 'y', wert: 2 }, { id: 'z', wert: 3 }]);
  assert.equal((await a.all('materials')).length, 3);
  await a.del('materials', 'y');
  assert.equal((await a.all('materials')).length, 2);
  await a.clear('materials');
  assert.equal((await a.all('materials')).length, 0);
  for (const s of STORES) assert.deepEqual(await a.all(s), []);
});

test('Der Adapter gibt Kopien heraus, keine Verweise', async () => {
  const a = await new MemoryAdapter().open();
  const obj = { id: 'x', tief: { wert: 1 } };
  await a.put('materials', obj);
  obj.tief.wert = 99;
  const gelesen = await a.get('materials', 'x');
  assert.equal(gelesen.tief.wert, 1, 'eine Aenderung am Original darf die Datenbank nicht veraendern');
});
