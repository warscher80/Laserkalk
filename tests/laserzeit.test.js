/**
 * laserzeit.test.js — die geschätzte Laserzeit (§18) und die Auswahl der
 * Schnittparameter.
 *
 * EINHEITEN, einmal verbindlich:
 *   Schnittlänge      mm
 *   Schnittgeschw.    mm/min      →  Schneidzeit = Länge / v          [min]
 *   Piercing          Sekunden    →  Einstiche × Piercing / 60        [min]
 *   Nebenzeit         Sekunden    →  Nebenzeit / 60                   [min]
 *   Ergebnis          Minuten JE STÜCK
 *
 * Die Schätzung ist nur so gut wie die Schnittparameter-Tabelle. Deshalb
 * gilt hier durchgehend: lieber KEIN Wert als ein geratener.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { laserzeitMin } from '../www/js/dxf/analyze.js';
import { findeSchnittparameter } from '../www/js/core/material.js';
import { defaultCutParams } from '../www/js/core/defaults.js';

/* ------------------------------------------------------------------ */
/* Formel und Einheiten                                                */
/* ------------------------------------------------------------------ */

test('Grundformel stimmt in allen drei Bestandteilen', () => {
  // 8000 mm bei 8000 mm/min = 1,000 min
  // 4 Einstiche × 0,3 s = 1,2 s = 0,02 min
  // 20 s Nebenzeit = 0,3333… min
  const min = laserzeitMin({
    schnittlaengeMm: 8000, einstiche: 4, vSchnittMmMin: 8000,
    piercingSek: 0.3, nebenzeitSek: 20,
  });
  assert.ok(Math.abs(min - (1 + 0.02 + 20 / 60)) < 1e-12);
  assert.equal(Math.round(min * 100) / 100, 1.35);
});

test('Einheiten: doppelte Geschwindigkeit halbiert die Schneidzeit', () => {
  const a = laserzeitMin({ schnittlaengeMm: 6000, einstiche: 0, vSchnittMmMin: 6000, piercingSek: 0 });
  const b = laserzeitMin({ schnittlaengeMm: 6000, einstiche: 0, vSchnittMmMin: 12000, piercingSek: 0 });
  assert.equal(a, 1);
  assert.equal(b, 0.5);
});

test('Ohne Nebenzeit-Angabe wird keine Nebenzeit unterstellt', () => {
  assert.equal(laserzeitMin({ schnittlaengeMm: 1000, einstiche: 0, vSchnittMmMin: 1000, piercingSek: 0 }), 1);
});

/* ------------------------------------------------------------------ */
/* Randfälle: es gibt keinen stillschweigenden Ersatzwert               */
/* ------------------------------------------------------------------ */

test('Geschwindigkeit 0 oder fehlend ergibt null, nicht 0 Minuten', () => {
  for (const v of [0, -100, null, undefined, NaN, Infinity, '', 'schnell']) {
    assert.equal(
      laserzeitMin({ schnittlaengeMm: 5000, einstiche: 2, vSchnittMmMin: v, piercingSek: 0.3 }),
      null, `v = ${String(v)}`);
  }
});

test('Negative und unsinnige Eingaben ergeben nie eine negative Zeit', () => {
  const min = laserzeitMin({
    schnittlaengeMm: -5000, einstiche: -3, vSchnittMmMin: 8000,
    piercingSek: -1, nebenzeitSek: -60,
  });
  assert.equal(min, 0, 'alles Negative zählt als 0');

  const gemischt = laserzeitMin({
    schnittlaengeMm: 8000, einstiche: 2, vSchnittMmMin: 8000,
    piercingSek: -0.3, nebenzeitSek: 30,
  });
  assert.equal(gemischt, 1.5, 'negative Piercingzeit wird ignoriert, der Rest bleibt gültig');
});

test('Nicht-Zahlen in Länge oder Einstichen werden als 0 gewertet', () => {
  assert.equal(laserzeitMin({ schnittlaengeMm: 'abc', einstiche: null, vSchnittMmMin: 1000, piercingSek: 1 }), 0);
  assert.equal(laserzeitMin({ schnittlaengeMm: NaN, einstiche: NaN, vSchnittMmMin: 1000, piercingSek: NaN }), 0);
});

test('Sehr lange Schnitte bleiben rechenbar', () => {
  // 5 km Schnitt bei 1000 mm/min = 5000 min ≈ 83 h
  assert.equal(laserzeitMin({ schnittlaengeMm: 5_000_000, einstiche: 0, vSchnittMmMin: 1000, piercingSek: 0 }), 5000);
});

/* ------------------------------------------------------------------ */
/* Auswahl der Schnittparameter                                        */
/* ------------------------------------------------------------------ */

const P = defaultCutParams();

test('Exakter Treffer nach Werkstoff, Stärke und Gas', () => {
  const t = findeSchnittparameter(P, {
    groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: 2, gas: 'Druckluft', maschineId: 'mach_1',
  });
  assert.equal(t.exakt, true);
  assert.equal(t.ausserhalb, false);
  assert.equal(t.hinweis, '');
  assert.equal(t.param.vSchnittMmMin, 8000);
  assert.equal(t.param.piercingSek, 0.3);
});

test('Leere Tabelle: kein Parameter, klare Meldung, keine Schätzung', () => {
  const t = findeSchnittparameter([], { werkstoff: 'S235JR', dickeMm: 2 });
  assert.equal(t.param, null);
  assert.match(t.hinweis, /Keine Schnittparameter/);
  assert.equal(laserzeitMin({
    schnittlaengeMm: 5000, einstiche: 1,
    vSchnittMmMin: t.param?.vSchnittMmMin, piercingSek: t.param?.piercingSek,
  }), null);
});

test('Naher Treffer wird verwendet, aber als ungenau gemeldet', () => {
  // 2,5 mm gibt es nicht in der Tabelle – 2 oder 3 mm liegen nah genug.
  const t = findeSchnittparameter(P, {
    groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: 2.5, gas: 'Druckluft', maschineId: 'mach_1',
  });
  assert.ok(t.param, 'ein naher Eintrag wird genommen');
  assert.equal(t.exakt, false);
  assert.equal(t.ausserhalb, false, '0,5 mm Abweichung ist noch im Rahmen');
  assert.match(t.hinweis, /Bitte prüfen/);
});

test('Weit außerhalb der Tabelle: als „außerhalb" gekennzeichnet', () => {
  // 20 mm Stahl – die mitgelieferte Tabelle endet weit darunter.
  const t = findeSchnittparameter(P, {
    groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: 20, gas: 'Druckluft', maschineId: 'mach_1',
  });
  assert.equal(t.ausserhalb, true, '20 mm darf nicht mit einem dünnen Blech geschätzt werden');
  assert.match(t.hinweis, /KEIN Schnittparameter/);
  assert.match(t.hinweis, /von Hand/);
});

test('Fremder Werkstoff ohne passende Gruppe gilt als außerhalb', () => {
  const t = findeSchnittparameter(P, {
    groupId: 'grp_titan', werkstoff: 'Titan Grade 2', dickeMm: 2, gas: 'Druckluft', maschineId: 'mach_1',
  });
  assert.equal(t.ausserhalb, true);
  assert.match(t.hinweis, /KEIN Schnittparameter/);
});

test('Gleiche Gruppe, anderer Werkstoff bleibt brauchbar', () => {
  // 1.4301 und 1.4404 sind beide Edelstahl – die Gruppe trägt die Schätzung.
  const t = findeSchnittparameter(P, {
    groupId: 'grp_edelstahl', werkstoff: '1.4404', dickeMm: 2, gas: 'Stickstoff', maschineId: 'mach_1',
  });
  assert.equal(t.ausserhalb, false);
  assert.equal(t.exakt, false);
  assert.ok(t.param.groupId === 'grp_edelstahl');
});

test('Andere Stärke im selben Werkstoff wird korrekt gewählt', () => {
  for (const d of [1, 1.5, 2, 3]) {
    const t = findeSchnittparameter(P, {
      groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: d, gas: 'Druckluft', maschineId: 'mach_1',
    });
    assert.equal(Number(t.param.dickeMm), d, `${d} mm`);
    assert.equal(t.exakt, true);
  }
});

test('Dünneres Blech schneidet schneller — die Tabelle ist monoton', () => {
  const v = (d) => findeSchnittparameter(P, {
    groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: d, gas: 'Druckluft', maschineId: 'mach_1',
  }).param.vSchnittMmMin;
  assert.ok(v(1) > v(1.5) && v(1.5) > v(2) && v(2) > v(3));
});

test('Zusammenspiel: Parameter finden und Zeit rechnen', () => {
  const t = findeSchnittparameter(P, {
    groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: 2, gas: 'Druckluft', maschineId: 'mach_1',
  });
  // Bauteil 300 × 180 mm mit 4 Bohrungen: 960 mm außen + 4 × 62,8 mm ≈ 1211 mm, 5 Einstiche
  const min = laserzeitMin({
    schnittlaengeMm: 1211, einstiche: 5,
    vSchnittMmMin: t.param.vSchnittMmMin, piercingSek: t.param.piercingSek,
    nebenzeitSek: 20,
  });
  // 1211/8000 = 0,1514 + 5×0,3/60 = 0,025 + 0,3333 = 0,5097 min
  assert.equal(Math.round(min * 1000) / 1000, 0.51);
});
