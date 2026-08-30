import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundHalf, parseNum, toCent, toBp, pctOf, addPct,
  costFromMinutes, costFromQty, divCent, centStr, eur, pct, glatt,
} from '../www/js/core/money.js';

test('roundHalf rundet halb vom Nullpunkt weg', () => {
  assert.equal(roundHalf(0.5), 1);
  assert.equal(roundHalf(1.5), 2);
  assert.equal(roundHalf(2.5), 3);
  assert.equal(roundHalf(-0.5), -1);
  assert.equal(roundHalf(-2.5), -3);
  assert.equal(roundHalf(NaN), 0);
});

test('parseNum versteht deutsches und englisches Zahlenformat', () => {
  assert.equal(parseNum('1.234,56'), 1234.56);
  assert.equal(parseNum('1234.56'), 1234.56);
  assert.equal(parseNum('1,5'), 1.5);
  assert.equal(parseNum('0,1'), 0.1);
  assert.equal(parseNum('2.500'), 2500);      // Tausendertrenner
  assert.equal(parseNum('2.5'), 2.5);         // Dezimalpunkt
  assert.equal(parseNum('12,50 €'), 12.5);
  assert.equal(parseNum(''), 0);
  assert.equal(parseNum('abc', 7), 7);
  assert.equal(parseNum('-3,25'), -3.25);
});

test('toCent arbeitet ohne Floating-Point-Fehler', () => {
  assert.equal(toCent('0,1'), 10);
  assert.equal(toCent('0,2'), 20);
  assert.equal(toCent('1,005'), 101);         // kaufmännisch aufgerundet
  assert.equal(toCent('1234,56'), 123456);
  assert.equal(toCent('70'), 7000);
  // Der klassische Float-Fehler darf nicht auftreten:
  assert.equal(toCent('0,1') + toCent('0,2'), toCent('0,3'));
});

test('Prozentrechnung über Basispunkte', () => {
  assert.equal(toBp('25'), 2500);
  assert.equal(toBp('12,5'), 1250);
  assert.equal(pctOf(3000, 2500), 750);       // 30,00 € + 25 % = 7,50 €
  assert.equal(addPct(3000, 2500), 3750);
  assert.equal(pctOf(1, 2500), 0);            // 1 Cent, 25 % -> 0 Cent (kaufmännisch)
  assert.equal(pctOf(2, 2500), 1);
  assert.equal(pct(2500), '25 %');
  assert.equal(pct(1250), '12,5 %');
});

test('glatt() entfernt Gleitkomma-Rauschen aus Mengen', () => {
  // Der Fall, der eine halbe Cent-Rundung kippen lässt:
  assert.equal(0.7 * 3, 2.0999999999999996);      // so rechnet JavaScript
  assert.equal(glatt(0.7 * 3), 2.1);              // so muss die App rechnen
  assert.equal(costFromMinutes(0.7 * 3, 6500), 227, 'ungeglättet fällt der halbe Cent nach unten');
  assert.equal(costFromMinutes(glatt(0.7 * 3), 6500), 228, 'geglättet kaufmännisch nach oben');

  assert.equal(glatt(0.1 + 0.2), 0.3);
  assert.equal(glatt(0.1 * 3), 0.3);
  // Echte Werte bleiben unverändert – auch sehr große und sehr kleine.
  assert.equal(glatt(2.1), 2.1);
  assert.equal(glatt(0), 0);
  assert.equal(glatt(1234567.89), 1234567.89);
  assert.equal(glatt(0.000123), 0.000123);
  assert.equal(glatt(-4.56), -4.56);
  assert.equal(glatt(NaN), 0);
  assert.equal(glatt(Infinity), 0);
});

test('Kosten aus Zeit und Menge', () => {
  assert.equal(costFromMinutes(10, 7000), 1167);    // 10 min à 70 €/h = 11,67 €
  assert.equal(costFromMinutes(120, 3000), 6000);   // 120 min à 30 €/h = 60,00 €
  assert.equal(costFromMinutes(15, 6500), 1625);    // 15 min à 65 €/h = 16,25 €
  assert.equal(costFromMinutes(0, 7000), 0);
  assert.equal(costFromQty(2.5, 400), 1000);
  assert.equal(divCent(12542, 10), 1254);
  assert.equal(divCent(100, 0), 0);
});

test('Formatierung deutsch', () => {
  assert.equal(centStr(123456), '1.234,56');
  assert.equal(eur(12542), '125,42 €');
  assert.equal(eur(0), '0,00 €');
});
