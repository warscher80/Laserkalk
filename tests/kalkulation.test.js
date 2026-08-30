/**
 * kalkulation.test.js — Kalkulationskern vollständig durchgerechnet.
 *
 * WO WIRD GERUNDET? Das ist die entscheidende Frage bei Geld, deshalb hier
 * einmal vollständig und verbindlich. Gerundet wird kaufmännisch (halb vom
 * Nullpunkt weg) und AUSSCHLIESSLICH an diesen Stellen:
 *
 *   1. Materialkosten      roundHalf(Fläche_m² × Preis_je_m²)       je Auftrag
 *                          roundHalf(Gewicht_kg × Preis_je_kg)
 *                          roundHalf(Tafeln × Tafelpreis)
 *   2. Verschnitt          pctOf(EK, bp)            = roundHalf(EK·bp/10000)
 *   3. Materialaufschlag   pctOf(EK+Verschnitt, bp)
 *   4. Jede Zeitposition   costFromMinutes         = roundHalf(min·Satz/60)
 *   5. Gas                 wie 4. bzw. roundHalf(min·Preis)
 *   6. Jede Zusatzposition costFromQty             = roundHalf(Menge·Einzel)
 *   7. Gewinnaufschlag     pctOf(Kalkulationspreis, bp)
 *   8. MwSt.               pctOf(Nettopreis, bp)
 *   9. Preis je Stück      divCent(Netto, Stückzahl)
 *
 * Jede Position wird EINZELN gerundet und erst dann summiert. Nur so stimmt
 * die Detailaufstellung auf den Cent mit der Endsumme überein — ein Betrieb,
 * der die Positionen nachaddiert, muss auf denselben Wert kommen.
 * Zwischen diesen Punkten gibt es keinen weiteren Rundungsschritt, und es
 * existiert kein Geldbetrag als Gleitkommazahl: alles ist ganzzahliger Cent.
 *
 * Die Stückzahl ist ganzzahlig (abgeschnitten, mindestens 1); Flächen,
 * Gewichte und Minuten dürfen Nachkommastellen haben — sie sind kein Geld.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { berechne, neueKalkulation, neueZeit, staffel } from '../www/js/calc/engine.js';
import { defaultSettings } from '../www/js/core/defaults.js';
import { roundHalf } from '../www/js/core/money.js';
import { flaechengewichtKgProM2, tafelFlaecheM2 } from '../www/js/core/material.js';

const S = defaultSettings();

/** Material des Regressionsfalls: S235JR 2 mm, Tafel 2500×1250, 100 € je Tafel. */
function materialRegression() {
  return {
    werkstoff: 'S235JR', bezeichnung: 'S235JR 2,0 mm', dickeMm: 2, dichte: 7850,
    tafelLaengeMm: 2500, tafelBreiteMm: 1250,
    ekTafelCent: 10000,       // 100,00 € je Tafel
    preisProM2Cent: 3200,     // 100,00 € / 3,125 m² = 32,00 €/m²
    ekProKgCent: 204,         // 100,00 € / 49,0625 kg = 2,0382… € → 2,04 €/kg
  };
}

/** Grundgerüst ohne Automatik-Werte, damit jeder Test nur seine Größe variiert. */
function leer(over = {}) {
  const c = neueKalkulation(S, over);
  c.material = materialRegression();
  c.verschnittBp = 0;
  c.materialAufschlagBp = 0;
  c.gewinnAktiv = false;
  c.mindestwertAktiv = false;
  c.mwstBp = 0;
  c.zeiten = [];
  c.verbrauch = { methode: 'kosten', kostenCent: 0, proStueck: false };
  return c;
}

/* ================================================================== */
/* DER REGRESSIONSFALL                                                 */
/* ================================================================== */

/**
 * Vom Betrieb unabhängig nachgerechneter Fall. Er ist der Anker dieser
 * Testdatei: schlägt er fehl, hat sich die Kalkulationslogik verändert —
 * egal wie plausibel die neue Zahl aussieht.
 *
 *   Material  S235JR 2 mm, Tafel 2500×1250, 100,00 €/Tafel → 32,00 €/m²
 *   Bauteil   1000 × 500 mm = 0,5 m² je Stück, 10 Stück = 5,0 m²
 *   Verschnitt 10 %, Materialaufschlag 25 %
 *   CAD 10 min einmalig 70 €/h · Laser 2 min/Stk 30 €/h
 *   Bediener 15 min einmalig 65 €/h · Entgraten 1 min/Stk 65 €/h
 *   Gewinn 15 %, MwSt. 20 %
 */
test('REGRESSION: Referenzkalkulation des Betriebs — 309,06 € netto auf den Cent', () => {
  const c = leer({ stueckzahl: 10 });
  c.verbrauch = { methode: 'rechteck', laengeMm: 1000, breiteMm: 500, proStueck: true };
  c.verschnittBp = 1000;            // 10 %
  c.materialAufschlagBp = 2500;     // 25 %
  c.zeiten = [
    { ...neueZeit('cad', 'CAD', 7000, 'einmalig'), minuten: 10 },
    { ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: 2 },
    { ...neueZeit('bediener', 'Bediener', 6500, 'einmalig'), minuten: 15 },
    { ...neueZeit('prozess', 'Entgraten', 6500, 'proStueck'), minuten: 1 },
  ];
  c.gewinnAktiv = true;
  c.gewinnBp = 1500;                // 15 %
  c.mwstBp = 2000;                  // 20 %

  const r = berechne(c);

  // Das im Auftrag genannte Tafelgewicht — es begründet den kg-Preis.
  assert.equal(roundHalf(tafelFlaecheM2(c.material) * 2 * 7.85 * 100) / 100, 49.06);

  assert.equal(r.material.ekCent, 16000, 'Material-EK 160,00 €');           // 5,0 m² × 32,00 €
  assert.equal(r.material.verschnittCent, 1600, 'Verschnitt 10 % = 16,00 €');
  assert.equal(r.material.aufschlagCent, 4400, 'Aufschlag 25 % auf 176,00 € = 44,00 €');
  assert.equal(r.material.vkCent, 22000, 'Material-Verkaufspreis 220,00 €');

  // Zeitkosten einzeln: 11,67 + 10,00 + 16,25 + 10,83
  assert.deepEqual(r.zeiten.map(z => z.kostenCent), [1167, 1000, 1625, 1083]);
  assert.equal(r.zeitenSummeCent, 4875, 'Zeitkosten 48,75 €');

  assert.equal(r.kalkulationCent, 26875, 'Kalkulationspreis 268,75 €');
  assert.equal(r.gewinnCent, 4031, 'Gewinn 15 % von 268,75 € = 40,31 €');
  assert.equal(r.vkNettoCent, 30906, 'Verkaufspreis netto 309,06 €');
  assert.equal(r.vkProStueckCent, 3091, 'Preis je Stück 30,91 €');
  assert.equal(r.mwstCent, 6181, 'MwSt. 20 % = 61,81 €');
  assert.equal(r.vkBruttoCent, 37087, 'Verkaufspreis brutto 370,87 €');

  // Und die Detailaufstellung muss den Kalkulationspreis exakt ergeben.
  const summe = r.positionen.reduce((s, p) => s + p.cent, 0);
  assert.equal(summe, r.kalkulationCent, 'Positionen addieren sich zum Kalkulationspreis');
});

/* ================================================================== */
/* Materialverbrauch: alle fünf Methoden                               */
/* ================================================================== */

test('Material 1: Rechteckfläche je Stück', () => {
  const c = leer({ stueckzahl: 4 });
  c.verbrauch = { methode: 'rechteck', laengeMm: 500, breiteMm: 250, proStueck: true };
  const r = berechne(c);
  // 0,125 m² × 4 = 0,5 m² × 32,00 € = 16,00 €
  assert.equal(r.material.ekCent, 1600);
  assert.equal(r.material.flaecheGesamtM2, 0.5);
  // Gewicht = 0,5 m² × 2 mm × 7,85 kg/dm³ = 7,85 kg
  assert.equal(roundHalf(r.material.gewichtGesamtKg * 1000) / 1000, 7.85);
});

test('Material 1b: Rechteckfläche als Gesamtmenge skaliert NICHT mit der Stückzahl', () => {
  const c = leer({ stueckzahl: 4 });
  c.verbrauch = { methode: 'rechteck', laengeMm: 500, breiteMm: 250, proStueck: false };
  assert.equal(berechne(c).material.ekCent, 400);   // 0,125 m² × 32,00 €
});

test('Material 2: manuelle Fläche in m²', () => {
  const c = leer({ stueckzahl: 3 });
  c.verbrauch = { methode: 'flaeche', flaecheM2: 1.25, proStueck: true };
  assert.equal(berechne(c).material.ekCent, roundHalf(3.75 * 3200));  // 120,00 €
  assert.equal(berechne(c).material.ekCent, 12000);
});

test('Material 3: Gewicht in kg', () => {
  const c = leer({ stueckzahl: 2 });
  c.verbrauch = { methode: 'gewicht', gewichtKg: 12.5, proStueck: true };
  // 25 kg × 2,04 €/kg = 51,00 €
  assert.equal(berechne(c).material.ekCent, 5100);
  // und die Rückrechnung auf die Fläche: 25 kg / 15,7 kg/m² = 1,592… m²
  const r = berechne(c);
  assert.ok(Math.abs(flaechengewichtKgProM2(c.material) - 15.7) < 1e-9, '2 mm × 7,85 kg/dm³');
  assert.ok(Math.abs(r.material.flaecheGesamtM2 - 25 / 15.7) < 1e-9);
});

test('Material 4: ganze Tafeln — Standard ist die Gesamtmenge', () => {
  const c = leer({ stueckzahl: 10 });
  c.verbrauch = { methode: 'tafeln', tafeln: 3 };   // proStueck nicht gesetzt
  const r = berechne(c);
  assert.equal(r.material.proStueck, false, 'Tafeln zählen für den ganzen Auftrag');
  assert.equal(r.material.ekCent, 30000, '3 × 100,00 €');
  // Halbe Tafeln sind erlaubt: 2,5 × 100,00 €
  c.verbrauch.tafeln = 2.5;
  assert.equal(berechne(c).material.ekCent, 25000);
});

test('Material 4b: Tafeln ausdrücklich je Stück', () => {
  const c = leer({ stueckzahl: 4 });
  c.verbrauch = { methode: 'tafeln', tafeln: 0.5, proStueck: true };
  assert.equal(berechne(c).material.ekCent, 20000, '0,5 × 4 = 2 Tafeln');
});

test('Material 5: direkter Materialbetrag', () => {
  const c = leer({ stueckzahl: 6 });
  c.verbrauch = { methode: 'kosten', kostenCent: 4999 };
  assert.equal(berechne(c).material.ekCent, 4999, 'Direkteingabe ist der Gesamtbetrag');
  c.verbrauch.proStueck = true;
  assert.equal(berechne(c).material.ekCent, 4999 * 6, 'je Stück ausdrücklich gewählt');
});

test('Material: negative Eingaben können den Einkaufspreis nie unter 0 drücken', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: -5000 };
  assert.equal(berechne(c).material.ekCent, 0);
  c.verbrauch = { methode: 'rechteck', laengeMm: -1000, breiteMm: 500, proStueck: true };
  assert.equal(berechne(c).material.ekCent, 0);
});

/* ================================================================== */
/* Verschnitt, Aufschlag, Gewinn, Mindestwert, MwSt.                   */
/* ================================================================== */

test('Verschnitt und Materialaufschlag: Reihenfolge ist verbindlich', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: 10000 };
  c.verschnittBp = 1000;
  c.materialAufschlagBp = 2500;
  const r = berechne(c);
  assert.equal(r.material.verschnittCent, 1000, '10 % von 100,00 €');
  assert.equal(r.material.nachVerschnittCent, 11000);
  assert.equal(r.material.aufschlagCent, 2750, '25 % von 110,00 € — nicht von 100,00 €');
  assert.equal(r.material.vkCent, 13750);
  // Gegenprobe: die falsche Reihenfolge ergäbe 135,00 € statt 137,50 €.
  assert.notEqual(r.material.vkCent, 13500);
});

test('Gewinnaufschlag an und aus', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: 20000 };
  c.gewinnBp = 1500;

  c.gewinnAktiv = false;
  const aus = berechne(c);
  assert.equal(aus.gewinnCent, 0);
  assert.equal(aus.vkNettoCent, 20000);

  c.gewinnAktiv = true;
  const an = berechne(c);
  assert.equal(an.gewinnCent, 3000);
  assert.equal(an.vkNettoCent, 23000);
  assert.equal(an.vkVorMindestCent, 23000);
});

test('Gewinn wird auf ALLES gerechnet, nicht nur auf die Zeit', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: 10000 };
  c.zeiten = [{ ...neueZeit('laser', 'Laser', 3000, 'gesamt'), minuten: 60 }];
  c.gewinnAktiv = true; c.gewinnBp = 1000;
  const r = berechne(c);
  assert.equal(r.kalkulationCent, 13000);
  assert.equal(r.gewinnCent, 1300);
});

test('Mindestauftragswert hebt an, senkt aber nie', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: 1200 };
  c.mindestwertAktiv = true;
  c.mindestwertCent = 3000;
  const klein = berechne(c);
  assert.equal(klein.vkVorMindestCent, 1200);
  assert.equal(klein.vkNettoCent, 3000);
  assert.equal(klein.mindestwertAngewendet, true);

  c.verbrauch.kostenCent = 9000;
  const gross = berechne(c);
  assert.equal(gross.vkNettoCent, 9000);
  assert.equal(gross.mindestwertAngewendet, false);

  c.mindestwertAktiv = false;
  c.verbrauch.kostenCent = 1200;
  assert.equal(berechne(c).vkNettoCent, 1200, 'abgeschaltet greift er nicht');
});

test('Mindestwert wirkt vor der MwSt., nicht danach', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: 1000 };
  c.mindestwertAktiv = true; c.mindestwertCent = 5000;
  c.mwstBp = 2000;
  const r = berechne(c);
  assert.equal(r.vkNettoCent, 5000);
  assert.equal(r.mwstCent, 1000);
  assert.equal(r.vkBruttoCent, 6000);
});

test('MwSt.: 20 %, 10 % und 0 %', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: 12345 };
  for (const [bp, mwst] of [[2000, 2469], [1000, 1235], [0, 0]]) {
    c.mwstBp = bp;
    const r = berechne(c);
    assert.equal(r.mwstCent, mwst, `${bp / 100} % MwSt.`);
    assert.equal(r.vkBruttoCent, 12345 + mwst);
  }
});

/* ================================================================== */
/* Zeiten                                                              */
/* ================================================================== */

test('Zeitmodi: einmalig, je Stück, Gesamtzeit', () => {
  const c = leer({ stueckzahl: 8 });
  c.zeiten = [
    { ...neueZeit('cad', 'CAD einmalig', 6000, 'einmalig'), minuten: 30 },
    { ...neueZeit('laser', 'Laser je Stück', 3000, 'proStueck'), minuten: 5 },
    { ...neueZeit('bediener', 'Rüsten einmalig', 6000, 'einmalig'), minuten: 10 },
    { ...neueZeit('prozess', 'Entgraten je Stück', 6000, 'proStueck'), minuten: 2 },
    { ...neueZeit('prozess', 'Lackieren gesamt', 6000, 'gesamt'), minuten: 90 },
  ];
  const r = berechne(c);
  assert.deepEqual(r.zeiten.map(z => z.minutenGesamt), [30, 40, 10, 16, 90]);
  assert.deepEqual(r.zeiten.map(z => z.kostenCent), [3000, 2000, 1000, 1600, 9000]);
  assert.equal(r.laserMinutenGesamt, 40, 'nur Laserzeiten zählen für Gas');

  // Verdoppelte Stückzahl: nur die Stück-Positionen verdoppeln sich.
  const r2 = berechne({ ...c, stueckzahl: 16 });
  assert.deepEqual(r2.zeiten.map(z => z.minutenGesamt), [30, 80, 10, 32, 90]);
});

test('Zeit: krumme Minuten und Sätze runden je Position kaufmännisch', () => {
  const c = leer({ stueckzahl: 3 });
  c.zeiten = [
    { ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: 1.5 },   // 4,5 min → 225 Ct
    { ...neueZeit('cad', 'CAD', 7000, 'einmalig'), minuten: 7 },          // 816,66… → 817
    { ...neueZeit('prozess', 'Feilen', 6500, 'proStueck'), minuten: 0.7 },// 2,1 min → 227,5 → 228
  ];
  const r = berechne(c);
  assert.deepEqual(r.zeiten.map(z => z.kostenCent), [225, 817, 228]);
  assert.equal(r.zeitenSummeCent, 1270);
  // Die Summe der gerundeten Positionen — NICHT die Rundung der Summe (1269,66…).
  assert.notEqual(r.zeitenSummeCent, 1270 - 1);
});

test('Zeit: 0 Minuten und 0 Satz kosten nichts und erzeugen keine Position', () => {
  const c = leer();
  c.zeiten = [
    { ...neueZeit('laser', 'Laser', 3000, 'gesamt'), minuten: 0 },
    { ...neueZeit('cad', 'CAD', 0, 'einmalig'), minuten: 0 },
  ];
  const r = berechne(c);
  assert.equal(r.zeitenSummeCent, 0);
  assert.equal(r.positionen.filter(p => p.gruppe === 'CAD / Programmierung').length, 0);
});

test('Zeit: negative Minuten und negative Sätze werden auf 0 geklemmt', () => {
  const c = leer();
  c.zeiten = [{ ...neueZeit('laser', 'Laser', -3000, 'gesamt'), minuten: -60 }];
  const r = berechne(c);
  assert.equal(r.zeitenSummeCent, 0, 'niemals ein negativer Zeitbetrag');
  assert.equal(r.vkNettoCent, 0);
});

/* ================================================================== */
/* Gas                                                                 */
/* ================================================================== */

test('Gas: alle vier Abrechnungsarten', () => {
  const c = leer({ stueckzahl: 5 });
  c.zeiten = [{ ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: 6 }];  // 30 min gesamt

  c.gas = { modus: 'inklusive', preisCent: 900 };
  assert.equal(berechne(c).gas.kostenCent, 0, 'inklusive kostet extra nichts');

  c.gas = { modus: 'proStunde', preisCent: 900 };            // 9,00 €/h × 0,5 h
  assert.equal(berechne(c).gas.kostenCent, 450);

  c.gas = { modus: 'proMinute', preisCent: 15 };             // 0,15 €/min × 30
  assert.equal(berechne(c).gas.kostenCent, 450);

  c.gas = { modus: 'pauschal', preisCent: 1200, proStueck: false };
  assert.equal(berechne(c).gas.kostenCent, 1200);

  c.gas = { modus: 'pauschal', preisCent: 1200, proStueck: true };
  assert.equal(berechne(c).gas.kostenCent, 6000, 'Pauschale je Stück × 5');
});

test('Gas hängt an der Laserzeit, nicht an der Gesamtzeit', () => {
  const c = leer({ stueckzahl: 2 });
  c.zeiten = [
    { ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: 10 },   // 20 min
    { ...neueZeit('prozess', 'Entgraten', 6500, 'proStueck'), minuten: 30 },
  ];
  c.gas = { modus: 'proMinute', preisCent: 10 };
  const r = berechne(c);
  assert.equal(r.laserMinutenGesamt, 20);
  assert.equal(r.gas.kostenCent, 200, 'nur die 20 Laserminuten');
});

/* ================================================================== */
/* Zusatzkosten                                                        */
/* ================================================================== */

test('Zusatzkosten: einmalig, je Stück, krumme Mengen, Gutschrift', () => {
  const c = leer({ stueckzahl: 4 });
  c.zusatz = [
    { bezeichnung: 'Versand', menge: 1, einheit: 'Pauschal', einzelpreisCent: 1490, modus: 'einmalig' },
    { bezeichnung: 'Verpackung', menge: 1, einheit: 'Stk', einzelpreisCent: 235, modus: 'proStueck' },
    { bezeichnung: 'Pulvern', menge: 0.35, einheit: 'm²', einzelpreisCent: 4500, modus: 'proStueck' },
    { bezeichnung: 'Rabatt', menge: 1, einheit: 'Pauschal', einzelpreisCent: -1000, modus: 'einmalig' },
  ];
  const r = berechne(c);
  // 14,90 + 9,40 + roundHalf(1,4 × 45,00 = 6300) − 10,00
  assert.deepEqual(r.zusatz.map(z => z.kostenCent), [1490, 940, 6300, -1000]);
  assert.equal(r.zusatzSummeCent, 7730);
  assert.equal(r.vkNettoCent, 7730);
});

/* ================================================================== */
/* Stückzahl, Staffel, Deckungsbeitrag                                 */
/* ================================================================== */

test('Stückzahl: 0, negativ und krumm werden sauber abgefangen', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: 1000 };
  for (const eingabe of [0, -5, null, undefined, NaN, '', 'abc']) {
    assert.equal(berechne({ ...c, stueckzahl: eingabe }).stueckzahl, 1, `Eingabe ${String(eingabe)}`);
  }
  assert.equal(berechne({ ...c, stueckzahl: 7.9 }).stueckzahl, 7, 'wird abgeschnitten, nicht gerundet');
});

test('Preisstaffel: Stückpreis sinkt monoton, Gesamtpreis steigt monoton', () => {
  const c = leer();
  c.verbrauch = { methode: 'rechteck', laengeMm: 200, breiteMm: 100, proStueck: true };
  c.zeiten = [
    { ...neueZeit('cad', 'CAD', 7000, 'einmalig'), minuten: 45 },
    { ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: 3 },
  ];
  const st = staffel(c, [1, 5, 10, 25, 50, 100]);
  for (let i = 1; i < st.length; i++) {
    assert.ok(st[i].proStueckCent <= st[i - 1].proStueckCent,
      `Stückpreis bei ${st[i].stueckzahl}: ${st[i].proStueckCent} > ${st[i - 1].proStueckCent}`);
    assert.ok(st[i].gesamtCent > st[i - 1].gesamtCent);
  }
  // Die Staffel muss dasselbe rechnen wie eine einzelne Kalkulation.
  assert.equal(st[3].gesamtCent, berechne({ ...c, stueckzahl: 25 }).vkNettoCent);
});

test('Preis je Stück ist der gerundete Anteil, nicht die Einzelkalkulation', () => {
  const c = leer({ stueckzahl: 3 });
  c.verbrauch = { methode: 'kosten', kostenCent: 1000 };
  const r = berechne(c);
  assert.equal(r.vkNettoCent, 1000);
  assert.equal(r.vkProStueckCent, 333, '10,00 € / 3 = 3,3333… → 3,33 €');
  // Ehrlich bleiben: 3 × 3,33 € ≠ 10,00 €. Die Gesamtsumme ist die verbindliche.
  assert.notEqual(r.vkProStueckCent * 3, r.vkNettoCent);
});

test('Deckungsbeitrag = Netto minus zugekaufte Kosten', () => {
  const c = leer({ stueckzahl: 2 });
  c.verbrauch = { methode: 'kosten', kostenCent: 5000 };
  c.materialAufschlagBp = 2000;
  c.zeiten = [{ ...neueZeit('laser', 'Laser', 3000, 'gesamt'), minuten: 60 }];
  c.zusatz = [{ bezeichnung: 'Zukauf', menge: 1, einzelpreisCent: 2000, modus: 'einmalig' }];
  const r = berechne(c);
  assert.equal(r.vkNettoCent, 6000 + 3000 + 2000);
  assert.equal(r.deckungsbeitragCent, r.vkNettoCent - 5000 - 2000);
});

/* ================================================================== */
/* Rundung, sehr kleine und sehr große Beträge                         */
/* ================================================================== */

test('Rundung: halbe Cent gehen kaufmännisch nach oben', () => {
  const c = leer();
  // 0,5 min × 30,00 €/h = 25,00 Ct — glatt; 0,51 min → 25,5 Ct → 26 Ct
  c.zeiten = [{ ...neueZeit('laser', 'L', 3000, 'gesamt'), minuten: 0.51 }];
  assert.equal(berechne(c).zeitenSummeCent, 26);
  // 1 Ct × 50 % = 0,5 → 1 Ct
  const g = leer();
  g.verbrauch = { methode: 'kosten', kostenCent: 1 };
  g.gewinnAktiv = true; g.gewinnBp = 5000;
  assert.equal(berechne(g).gewinnCent, 1);
});

test('Jeder Geldwert im Ergebnis ist eine ganze Zahl', () => {
  const c = leer({ stueckzahl: 7 });
  c.verbrauch = { methode: 'rechteck', laengeMm: 333, breiteMm: 177, proStueck: true };
  c.verschnittBp = 1234; c.materialAufschlagBp = 777;
  c.zeiten = [
    { ...neueZeit('cad', 'CAD', 7333, 'einmalig'), minuten: 11.3 },
    { ...neueZeit('laser', 'Laser', 2999, 'proStueck'), minuten: 1.7 },
  ];
  c.gas = { modus: 'proMinute', preisCent: 7 };
  c.zusatz = [{ bezeichnung: 'X', menge: 1.33, einzelpreisCent: 999, modus: 'proStueck' }];
  c.gewinnAktiv = true; c.gewinnBp = 1234;
  c.mwstBp = 2000;
  const r = berechne(c);

  const geld = [
    r.material.ekCent, r.material.verschnittCent, r.material.aufschlagCent, r.material.vkCent,
    r.zeitenSummeCent, r.gas.kostenCent, r.zusatzSummeCent, r.kalkulationCent, r.gewinnCent,
    r.vkNettoCent, r.mwstCent, r.vkBruttoCent, r.vkProStueckCent, r.vkProStueckBruttoCent,
    r.deckungsbeitragCent, ...r.zeiten.map(z => z.kostenCent), ...r.zusatz.map(z => z.kostenCent),
    ...r.positionen.map(p => p.cent),
  ];
  for (const w of geld) {
    assert.ok(Number.isInteger(w), `kein ganzzahliger Cent-Betrag: ${w}`);
  }
  assert.equal(r.positionen.reduce((s, p) => s + p.cent, 0), r.kalkulationCent);
});

test('Sehr kleiner Betrag: 1 Cent Material bleibt 1 Cent', () => {
  const c = leer();
  c.verbrauch = { methode: 'kosten', kostenCent: 1 };
  const r = berechne(c);
  assert.equal(r.vkNettoCent, 1);
  assert.equal(r.vkProStueckCent, 1);
});

test('Sehr großer Betrag: 1000 Stück Großformat bleibt exakt', () => {
  const c = leer({ stueckzahl: 1000 });
  c.verbrauch = { methode: 'tafeln', tafeln: 1000 };          // 1000 × 100,00 € = 100.000,00 €
  c.verschnittBp = 1500;
  c.materialAufschlagBp = 3000;
  c.zeiten = [{ ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: 12 }];
  c.gewinnAktiv = true; c.gewinnBp = 1200;
  c.mwstBp = 2000;
  const r = berechne(c);

  assert.equal(r.material.ekCent, 10_000_000);
  assert.equal(r.material.verschnittCent, 1_500_000);
  assert.equal(r.material.aufschlagCent, 3_450_000);          // 30 % von 115.000,00 €
  assert.equal(r.material.vkCent, 14_950_000);
  assert.equal(r.zeitenSummeCent, 600_000);                   // 12.000 min × 30 €/h
  assert.equal(r.kalkulationCent, 15_550_000);
  assert.equal(r.gewinnCent, 1_866_000);
  assert.equal(r.vkNettoCent, 17_416_000);                    // 174.160,00 €
  assert.equal(r.vkProStueckCent, 17_416);
  assert.equal(r.vkBruttoCent, 20_899_200);
  // Weit unterhalb der sicheren Ganzzahlgrenze von JavaScript.
  assert.ok(r.vkBruttoCent < Number.MAX_SAFE_INTEGER);
});

test('Reproduzierbarkeit: dieselbe Eingabe ergibt zweimal dasselbe Ergebnis', () => {
  const c = leer({ stueckzahl: 13 });
  c.verbrauch = { methode: 'rechteck', laengeMm: 617, breiteMm: 293, proStueck: true };
  c.verschnittBp = 875; c.materialAufschlagBp = 1750;
  c.zeiten = [{ ...neueZeit('laser', 'Laser', 3175, 'proStueck'), minuten: 3.7 }];
  c.gewinnAktiv = true; c.mwstBp = 2000;
  const a = berechne(c), b = berechne(JSON.parse(JSON.stringify(c)));
  assert.deepEqual(a, b);
});

/* ================================================================== */
/* Verlässlichkeit: wann darf ein Preis nicht als Preis auftreten?     */
/* ================================================================== */

test('DXF ohne auswertbare Fläche sperrt den Preis', () => {
  const c = leer();
  c.verbrauch = { methode: 'dxf', proStueck: true };
  c.dxf = { flaechenBasis: 'netto', nettoFlaecheM2: 0, bboxFlaecheM2: 0 };
  const r = berechne(c);
  assert.equal(r.material.ekCent, 0);
  assert.equal(r.preisUnsicher, true, 'ein 0-€-Material darf nicht als Preis durchgehen');
  assert.match(r.unsicherheiten.map(u => u.text).join(), /keine Materialfläche/);

  // Mit Fläche ist der Preis wieder belastbar.
  c.dxf.nettoFlaecheM2 = 0.15;
  const ok = berechne(c);
  assert.equal(ok.preisUnsicher, false);
  assert.equal(ok.material.ekCent, roundHalf(0.15 * 3200));
});

test('Unbestätigte DXF-Einheit sperrt den Preis', () => {
  const c = leer();
  c.verbrauch = { methode: 'dxf', proStueck: true };
  c.dxf = { flaechenBasis: 'netto', nettoFlaecheM2: 0.5, einheitUnsicher: true, einheitBestaetigt: false };
  assert.equal(berechne(c).preisUnsicher, true);
  c.dxf.einheitBestaetigt = true;
  assert.equal(berechne(c).preisUnsicher, false);
});

test('Offene Konturen sind ein hoher, aber kein sperrender Vorbehalt', () => {
  const c = leer();
  c.verbrauch = { methode: 'dxf', proStueck: true };
  c.dxf = { flaechenBasis: 'netto', nettoFlaecheM2: 0.5, flaecheUnsicher: true };
  const r = berechne(c);
  assert.equal(r.preisUnsicher, false, 'der Preis bleibt bedienbar');
  assert.equal(r.unsicherheiten[0].schwere, 'hoch');
  assert.match(r.unsicherheiten[0].text, /offenen Konturen/);
});
