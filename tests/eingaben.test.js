/**
 * eingaben.test.js — Eingabeprüfung der Zahlenfelder (§41).
 *
 * Grundsatz: Eine unverständliche Eingabe wird ABGELEHNT, nicht zu 0 gemacht.
 * Der Unterschied ist im Betrieb bares Geld — ein vertippter Einkaufspreis,
 * der stillschweigend zu 0,00 € wird, verschenkt Material.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeZahl, parseNum, toCent, toBp, roundHalf } from '../www/js/core/money.js';
import { pruefeKalkulation, neueKalkulation, neueZeit, berechne } from '../www/js/calc/engine.js';
import { defaultSettings } from '../www/js/core/defaults.js';

/* ------------------------------------------------------------------ */
/* Zahlenformate                                                       */
/* ------------------------------------------------------------------ */

test('Deutsche und englische Schreibweise ergeben denselben Wert', () => {
  for (const [a, b] of [['1,5', '1.5'], ['0,25', '0.25'], ['1.234,56', '1234.56']]) {
    assert.equal(pruefeZahl(a).wert, pruefeZahl(b).wert, `${a} = ${b}`);
  }
  assert.equal(pruefeZahl('1,5').wert, 1.5);
  assert.equal(pruefeZahl('1.234,56').wert, 1234.56);
});

test('Leerzeichen und Tausenderpunkte stören nicht', () => {
  assert.equal(pruefeZahl(' 1 234,56 ').wert, 1234.56);
  assert.equal(pruefeZahl("1'250").wert, 1250);
  assert.equal(pruefeZahl('  12  ').wert, 12);
});

test('Leeres Feld bedeutet 0 und ist ausdrücklich als leer gekennzeichnet', () => {
  const p = pruefeZahl('');
  assert.equal(p.ok, true);
  assert.equal(p.wert, 0);
  assert.equal(p.leer, true);
  assert.equal(pruefeZahl('   ').leer, true);
});

/* ------------------------------------------------------------------ */
/* Mitkopierte Einheiten                                               */
/* ------------------------------------------------------------------ */

test('Passende Einheit aus dem CAD darf mitkopiert werden', () => {
  assert.equal(pruefeZahl('12,5 mm', { einheit: 'mm' }).wert, 12.5);
  assert.equal(pruefeZahl('3 min', { einheit: 'min' }).wert, 3);
  assert.equal(pruefeZahl('7,85 kg', { einheit: 'kg' }).wert, 7.85);
  assert.equal(pruefeZahl('2,5 m²', { einheit: 'm²' }).wert, 2.5);
  assert.equal(pruefeZahl('2,5 m2', { einheit: 'm²' }).wert, 2.5, 'm2 wie m²');
  assert.equal(pruefeZahl('70 €/h', { einheit: '€/h' }).wert, 70);
  assert.equal(pruefeZahl('70 €', { einheit: '€/h' }).wert, 70, '€ in einem €/h-Feld ist eindeutig');
  assert.equal(pruefeZahl('15 %', { einheit: '%' }).wert, 15);
});

test('FREMDE Einheit wird abgelehnt und NICHT umgerechnet', () => {
  const p = pruefeZahl('2,5 cm', { einheit: 'mm' });
  assert.equal(p.ok, false);
  assert.equal(p.wert, null);
  assert.match(p.grund, /cm/);
  assert.match(p.grund, /mm/);
  // Das ist der Kern: 2,5 cm wird weder zu 2,5 noch zu 25.
  assert.notEqual(p.wert, 25);

  assert.equal(pruefeZahl('3 s', { einheit: 'min' }).ok, false, 'Sekunden in einem Minutenfeld');
  assert.equal(pruefeZahl('5 kg', { einheit: 'm²' }).ok, false);
});

test('Unbekannte Einheit wird benannt, nicht verschluckt', () => {
  const p = pruefeZahl('12 fuß', { einheit: 'mm' });
  assert.equal(p.ok, false);
  assert.match(p.grund, /keine bekannte Einheit/);
});

test('Ein Feld ohne eigene Einheit nimmt keine Einheit an', () => {
  const p = pruefeZahl('12 mm');
  assert.equal(p.ok, false);
  assert.match(p.grund, /nur eine Zahl/);
});

/* ------------------------------------------------------------------ */
/* Unsinn wird abgelehnt statt zu 0 gemacht                            */
/* ------------------------------------------------------------------ */

test('Text, Sonderzeichen und halbe Eingaben werden abgelehnt', () => {
  for (const v of ['abc', '-', '+', ',', '.', 'kg', '€', '???']) {
    const p = pruefeZahl(v, { einheit: 'mm' });
    assert.equal(p.ok, false, `„${v}" muss abgelehnt werden`);
    assert.equal(p.wert, null, `„${v}" darf nicht zu einer Zahl werden`);
    assert.ok(p.grund.length > 0, `„${v}" braucht eine Begründung`);
  }
});

test('Der alte Weg hätte hier stillschweigend 0 geliefert', () => {
  // Genau der Unterschied, um den es geht:
  assert.equal(parseNum('abc', 0), 0);
  assert.equal(pruefeZahl('abc').ok, false);
  assert.equal(toCent('12,5 mm', 0), 0);
  assert.equal(pruefeZahl('12,5 mm', { einheit: 'mm' }).wert, 12.5);
});

test('NaN und Unendlich kommen nie durch', () => {
  for (const v of [NaN, Infinity, -Infinity]) {
    assert.equal(pruefeZahl(v).ok, false, String(v));
  }
  for (const v of ['Infinity', '1e999', 'NaN']) {
    assert.equal(pruefeZahl(v).ok, false, v);
  }
  // Eine echte Zahl kommt selbstverständlich durch.
  assert.equal(pruefeZahl(42).wert, 42);
  assert.equal(pruefeZahl(-3.5).wert, -3.5);
});

test('Negative Zahlen sind erlaubt — das Feld entscheidet, nicht der Parser', () => {
  // Eine Gutschrift bei den Zusatzkosten ist ein legitimer negativer Betrag.
  assert.equal(pruefeZahl('-10', { einheit: '€' }).wert, -10);
  // Der Rechenkern klemmt dort ab, wo negativ unsinnig wäre.
  const S = defaultSettings();
  const c = neueKalkulation(S);
  c.zeiten = [{ ...neueZeit('laser', 'Laser', -3000, 'gesamt'), minuten: -10 }];
  assert.equal(berechne(c).zeitenSummeCent, 0);
});

/* ------------------------------------------------------------------ */
/* Prüfung der ganzen Kalkulation                                      */
/* ------------------------------------------------------------------ */

const S = defaultSettings();

test('Stückzahl: 0, negativ, unplausibel hoch, krumm', () => {
  const c = neueKalkulation(S);
  assert.match(pruefeKalkulation({ ...c, stueckzahl: 0 }).fehler.join(), /mindestens 1/);
  assert.match(pruefeKalkulation({ ...c, stueckzahl: -3 }).fehler.join(), /mindestens 1/);
  assert.match(pruefeKalkulation({ ...c, stueckzahl: NaN }).fehler.join(), /mindestens 1/);
  assert.match(pruefeKalkulation({ ...c, stueckzahl: 2_000_000 }).fehler.join(), /unplausibel/);
  assert.match(pruefeKalkulation({ ...c, stueckzahl: 7.5 }).hinweise.join(), /ganze Zahl/);
  assert.equal(pruefeKalkulation({ ...c, stueckzahl: 10 }).fehler.length, 0);
});

test('Negative Sätze, Zeiten und Prozentwerte werden als Fehler gemeldet', () => {
  const c = neueKalkulation(S);
  c.zeiten = [{ ...neueZeit('laser', 'Laser', -100, 'gesamt'), minuten: -5 }];
  c.verschnittBp = -100;
  c.materialAufschlagBp = -100;
  c.gewinnBp = -100;
  c.mwstBp = -100;
  const f = pruefeKalkulation(c).fehler.join(' | ');
  assert.match(f, /Negative Zeit/);
  assert.match(f, /Negativer Stundensatz/);
  assert.match(f, /Verschnitt darf nicht negativ/);
  assert.match(f, /Materialaufschlag darf nicht negativ/);
  assert.match(f, /Gewinnaufschlag darf nicht negativ/);
  assert.match(f, /MwSt\. darf nicht negativ/);
});

test('Negative Blechmaße und Mengen werden abgefangen', () => {
  const c = neueKalkulation(S);
  for (const [v, muster] of [
    [{ methode: 'rechteck', laengeMm: -1, breiteMm: 10 }, /negativ/],
    [{ methode: 'gewicht', gewichtKg: -1 }, /Gewicht darf nicht negativ/],
    [{ methode: 'flaeche', flaecheM2: -1 }, /Fläche darf nicht negativ/],
    [{ methode: 'tafeln', tafeln: -1 }, /Tafelanzahl darf nicht negativ/],
    [{ methode: 'kosten', kostenCent: -1 }, /Materialkosten dürfen nicht negativ/],
  ]) {
    assert.match(pruefeKalkulation({ ...c, verbrauch: v }).fehler.join(' | '), muster, JSON.stringify(v));
  }
});

test('Bauteil größer als die Tafel ist ein Hinweis, kein Fehler', () => {
  const c = neueKalkulation(S);
  c.material = { werkstoff: 'S235JR', dickeMm: 2, dichte: 7850, tafelLaengeMm: 2500, tafelBreiteMm: 1250, preisProM2Cent: 3200 };
  c.verbrauch = { methode: 'rechteck', laengeMm: 3000, breiteMm: 1400, proStueck: true };
  const p = pruefeKalkulation(c);
  assert.equal(p.fehler.length, 0, 'die Kalkulation bleibt rechenbar');
  assert.match(p.hinweise.join(), /größer als eine Tafel/);
});

test('Unbestätigte DXF-Einheit ist ein harter Fehler', () => {
  const c = neueKalkulation(S);
  c.dxf = { einheitUnsicher: true, einheitBestaetigt: false };
  assert.match(pruefeKalkulation(c).fehler.join(), /Einheit der DXF-Datei/);
  c.dxf.einheitBestaetigt = true;
  assert.equal(pruefeKalkulation(c).fehler.length, 0);
});

test('Cent-Umrechnung bleibt exakt — auch an der halben Stelle', () => {
  assert.equal(toCent('1,005'), 101, 'nicht 100 (Gleitkomma-Falle)');
  assert.equal(toCent('0,004'), 0);
  assert.equal(toCent('0,005'), 1);
  assert.equal(toCent('-1,005'), -101);
  assert.equal(toBp('12,5'), 1250);
  assert.equal(roundHalf(-0.5), -1, 'halb vom Nullpunkt weg, auch negativ');
});
