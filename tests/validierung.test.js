/**
 * validierung.test.js — die fachliche Eingabeprüfung (§41).
 *
 * HINTERGRUND — der Fehler, der diese Datei ausgelöst hat:
 * In der Schnellkalkulation blieb bei Stückzahl 0 die 0 im Feld stehen,
 * intern rechnete die App aber mit 1. Bei Laser-Minuten −1 blieb −1 stehen,
 * intern wurde 0 gerechnet. Es erschien ein plausibler Verkaufspreis und
 * keinerlei Fehlermeldung. Aus so einer Kalkulation wird ein Angebot.
 *
 * Die Regel dagegen lautet: Eine ungültige Eingabe liefert KEINEN Wert
 * (`wert: null`). Damit gibt es im Programm nichts, was an die Stelle des
 * Eingegebenen treten könnte — ein Ersatzwert ist gar nicht erst verfügbar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeFeld, pruefeWert, REGELN } from '../www/js/core/felder.js';

/** Kurzform: prüft und verlangt Ablehnung ohne Ersatzwert. */
function abgelehnt(eingabe, opts, muster) {
  const p = pruefeFeld(eingabe, opts);
  assert.equal(p.ok, false, `„${eingabe}" hätte abgelehnt werden müssen`);
  assert.equal(p.wert, null, `„${eingabe}" darf keinen Wert liefern (Ersatzwertgefahr)`);
  assert.ok(p.grund && p.grund.length > 5, `„${eingabe}" braucht eine verständliche Begründung`);
  if (muster) assert.match(p.grund, muster);
  return p;
}
function angenommen(eingabe, opts, wert) {
  const p = pruefeFeld(eingabe, opts);
  assert.equal(p.ok, true, `„${eingabe}" hätte angenommen werden müssen: ${p.grund}`);
  if (wert !== undefined) assert.equal(p.wert, wert);
  return p;
}

/* ================================================================== */
/* Der gemeldete Fehler                                                */
/* ================================================================== */

test('GEMELDET: Stückzahl 0 wird abgelehnt und liefert keine 1', () => {
  const p = abgelehnt('0', { regel: 'stueckzahl', einheit: 'Stk' }, /ganze Zahl ab 1/);
  assert.notEqual(p.wert, 1, 'niemals stillschweigend 1');
  assert.notEqual(p.wert, 0);
});

test('GEMELDET: Laser-Minuten −1 werden abgelehnt und liefern keine 0', () => {
  const p = abgelehnt('-1', { regel: 'zeit', einheit: 'min' }, /nicht negativ/);
  assert.notEqual(p.wert, 0, 'niemals stillschweigend 0');
});

test('GEMELDET: kein Ersatzwert bei irgendeiner ungültigen Eingabe', () => {
  const faelle = [
    ['0', 'stueckzahl'], ['-1', 'stueckzahl'], ['1,5', 'stueckzahl'], ['-7', 'stueckzahl'],
    ['-1', 'zeit'], ['-0,5', 'zeit'],
    ['-5', 'preis'], ['-0,01', 'preis'], ['-1', 'satz'],
    ['0', 'mass'], ['-3', 'mass'], ['0', 'dichte'], ['0', 'geschwindigkeit'],
    ['-10', 'prozentVerschnitt'], ['150', 'prozentVerschnitt'], ['101', 'prozentMwst'],
  ];
  for (const [eingabe, regel] of faelle) {
    const p = pruefeFeld(eingabe, { regel });
    assert.equal(p.ok, false, `${regel}: „${eingabe}"`);
    assert.equal(p.wert, null, `${regel}: „${eingabe}" liefert einen Ersatzwert (${p.wert})`);
  }
});

/* ================================================================== */
/* Stückzahl                                                           */
/* ================================================================== */

test('Stückzahl: gültige Werte', () => {
  angenommen('1', { regel: 'stueckzahl' }, 1);
  angenommen('10', { regel: 'stueckzahl' }, 10);
  angenommen('250', { regel: 'stueckzahl' }, 250);
  angenommen('1000000', { regel: 'stueckzahl' }, 1000000);
});

test('Stückzahl: 0, negativ, gebrochen und unplausibel hoch', () => {
  abgelehnt('0', { regel: 'stueckzahl' }, /mindestens|ab 1/);
  abgelehnt('-1', { regel: 'stueckzahl' });
  abgelehnt('1,5', { regel: 'stueckzahl' }, /keine ganze Zahl/);
  abgelehnt('2.5', { regel: 'stueckzahl' }, /keine ganze Zahl/);
  abgelehnt('0,9', { regel: 'stueckzahl' });
  abgelehnt('2000000', { regel: 'stueckzahl' }, /unplausibel/);
});

test('Stückzahl bekommt die Zifferntastatur, nicht die Dezimaltastatur', () => {
  assert.equal(REGELN.stueckzahl.ganz, true);
  assert.equal(REGELN.anzahl.ganz, true);
  assert.notEqual(REGELN.zeit.ganz, true, 'Minuten dürfen Nachkommastellen haben');
});

/* ================================================================== */
/* Zeiten — alle vier Positionen der Schnellkalkulation                */
/* ================================================================== */

test('Zeiten: negative CAD-, Laser-, Bediener- und Nachbearbeitungszeit', () => {
  for (const feld of ['CAD', 'Laser', 'Bediener', 'Entgraten']) {
    const p = abgelehnt('-1', { regel: 'zeit', einheit: 'min' }, /Zeit darf nicht negativ/);
    assert.equal(p.wert, null, `${feld}: kein Ersatzwert`);
  }
  abgelehnt('-0,25', { regel: 'zeit', einheit: 'min' });
  abgelehnt('-120', { regel: 'zeit', einheit: 'min' });
});

test('Zeiten: 0 und Nachkommastellen sind erlaubt', () => {
  angenommen('0', { regel: 'zeit', einheit: 'min' }, 0);
  angenommen('2,5', { regel: 'zeit', einheit: 'min' }, 2.5);
  angenommen('0,25', { regel: 'zeit', einheit: 'min' }, 0.25);
  abgelehnt('200000', { regel: 'zeit', einheit: 'min' }, /unplausibel/);
});

/* ================================================================== */
/* Preise und Sätze                                                    */
/* ================================================================== */

test('Preise und Stundensätze dürfen nicht negativ sein', () => {
  abgelehnt('-5', { regel: 'preis', einheit: '€' }, /Preis darf nicht negativ/);
  abgelehnt('-0,01', { regel: 'preis', einheit: '€' });
  abgelehnt('-70', { regel: 'satz', einheit: '€/h' }, /Stundensatz darf nicht negativ/);
  angenommen('0', { regel: 'preis' }, 0);
  angenommen('70', { regel: 'satz', einheit: '€/h' }, 70);
  angenommen('1234,56', { regel: 'preis', einheit: '€' }, 1234.56);
});

test('Zusatzkosten dürfen negativ sein — das ist eine Gutschrift', () => {
  angenommen('-10', { regel: 'betrag', einheit: '€' }, -10);
  angenommen('25,50', { regel: 'betrag', einheit: '€' }, 25.5);
});

/* ================================================================== */
/* Maße, Dichte, Geschwindigkeit                                       */
/* ================================================================== */

test('Länge, Breite, Stärke und Dichte müssen größer als 0 sein', () => {
  for (const regel of ['mass', 'dichte', 'geschwindigkeit']) {
    abgelehnt('0', { regel }, /größer als 0/);
    abgelehnt('-1', { regel });
  }
  angenommen('1000', { regel: 'mass', einheit: 'mm' }, 1000);
  angenommen('7850', { regel: 'dichte', einheit: 'kg/m³' }, 7850);
  angenommen('8000', { regel: 'geschwindigkeit', einheit: 'mm/min' }, 8000);
  abgelehnt('50000', { regel: 'dichte' }, /unplausibel/);
});

test('Optionale Maße dürfen 0 sein, aber nicht negativ', () => {
  angenommen('0', { regel: 'massOptional' }, 0);
  abgelehnt('-1', { regel: 'massOptional' }, /nicht negativ/);
});

/* ================================================================== */
/* Prozentwerte im fachlichen Bereich                                  */
/* ================================================================== */

test('Prozentwerte nur im fachlich sinnvollen Bereich', () => {
  angenommen('10', { regel: 'prozentVerschnitt', einheit: '%' }, 10);
  angenommen('100', { regel: 'prozentVerschnitt' }, 100);
  abgelehnt('101', { regel: 'prozentVerschnitt' }, /Mehr als 100/);
  abgelehnt('-1', { regel: 'prozentVerschnitt' });

  angenommen('20', { regel: 'prozentMwst' }, 20);
  abgelehnt('120', { regel: 'prozentMwst' }, /über 100/);

  angenommen('25', { regel: 'prozentAufschlag' }, 25);
  angenommen('500', { regel: 'prozentAufschlag' }, 500);
  abgelehnt('600', { regel: 'prozentAufschlag' }, /unplausibel/);
  abgelehnt('-5', { regel: 'prozentAufschlag' }, /nicht negativ/);
});

/* ================================================================== */
/* Leere Pflichtwerte                                                  */
/* ================================================================== */

test('Leere Pflichtfelder werden benannt, nicht als 0 gewertet', () => {
  const p = pruefeFeld('', { regel: 'mass', pflicht: true });
  assert.equal(p.ok, false);
  assert.equal(p.wert, null);
  assert.match(p.grund, /muss ausgefüllt werden/);

  // Ohne Pflichtkennzeichen bedeutet leer 0 – aber nur, wo 0 erlaubt ist.
  assert.equal(pruefeFeld('', { regel: 'zeit' }).ok, true);
  assert.equal(pruefeFeld('', { regel: 'zeit' }).wert, 0);
  assert.equal(pruefeFeld('', { regel: 'mass' }).ok, false, 'ein Maß von 0 bleibt unzulässig');
});

/* ================================================================== */
/* Zahlenformat und Einheiten                                          */
/* ================================================================== */

test('Deutsche Kommazahl und englischer Punkt ergeben dasselbe', () => {
  assert.equal(pruefeFeld('1,5', { regel: 'zeit' }).wert, 1.5);
  assert.equal(pruefeFeld('1.5', { regel: 'zeit' }).wert, 1.5);
  assert.equal(pruefeFeld('1.234,56', { regel: 'preis' }).wert, 1234.56);
  assert.equal(pruefeFeld('1234.56', { regel: 'preis' }).wert, 1234.56);
  assert.equal(pruefeFeld(' 1 000 ', { regel: 'mass' }).wert, 1000);
});

test('Passende Einheit darf mitkopiert werden, fremde nicht', () => {
  assert.equal(pruefeFeld('12,5 mm', { einheit: 'mm', regel: 'mass' }).wert, 12.5);
  assert.equal(pruefeFeld('2 min', { einheit: 'min', regel: 'zeit' }).wert, 2);
  assert.equal(pruefeFeld('70 €/h', { einheit: '€/h', regel: 'satz' }).wert, 70);

  abgelehnt('2,5 cm', { einheit: 'mm', regel: 'mass' }, /passt nicht/);
  abgelehnt('30 s', { einheit: 'min', regel: 'zeit' }, /passt nicht/);
  abgelehnt('5 fuß', { einheit: 'mm', regel: 'mass' }, /keine bekannte Einheit/);
});

test('NaN, Unendlich und unvollständige Zahlen werden abgelehnt', () => {
  for (const v of ['abc', '-', '+', ',', 'NaN', 'Infinity', '1e999', '?', '1,2,3,4']) {
    const p = pruefeFeld(v, { regel: 'zeit' });
    assert.equal(p.ok, false, `„${v}"`);
    assert.equal(p.wert, null, `„${v}" liefert einen Wert`);
  }
  for (const v of [NaN, Infinity, -Infinity]) {
    assert.equal(pruefeFeld(v, { regel: 'zeit' }).ok, false, String(v));
  }
});

/* ================================================================== */
/* Fehler verschwindet nach der Korrektur                              */
/* ================================================================== */

test('Nach der Korrektur ist die Eingabe sofort wieder gültig', () => {
  assert.equal(pruefeFeld('0', { regel: 'stueckzahl' }).ok, false);
  assert.equal(pruefeFeld('10', { regel: 'stueckzahl' }).ok, true, 'Korrektur wirkt sofort');
  assert.equal(pruefeFeld('10', { regel: 'stueckzahl' }).grund, '', 'keine Restmeldung');

  assert.equal(pruefeFeld('-1', { regel: 'zeit' }).ok, false);
  const gut = pruefeFeld('2', { regel: 'zeit' });
  assert.equal(gut.ok, true);
  assert.equal(gut.wert, 2);
  assert.equal(gut.grund, '');
});

/* ================================================================== */
/* Gespeicherte Werte prüfen (alte Kalkulation, Backup)                */
/* ================================================================== */

test('pruefeWert findet Unsinn auch in bereits gespeicherten Daten', () => {
  assert.equal(pruefeWert(10, 'stueckzahl'), '');
  assert.match(pruefeWert(0, 'stueckzahl'), /ab 1/);
  assert.match(pruefeWert(1.5, 'stueckzahl'), /ganze Zahl/);
  assert.match(pruefeWert(-1, 'zeit'), /nicht negativ/);
  assert.match(pruefeWert(0, 'dichte'), /größer als 0/);
  assert.match(pruefeWert(NaN, 'preis'), /Kein gültiger Zahlenwert/);
  assert.equal(pruefeWert(7850, 'dichte'), '');
});

test('Jede Regel hat eine verständliche deutsche Meldung', () => {
  for (const [name, r] of Object.entries(REGELN)) {
    assert.ok(r.text && r.text.length > 10, `${name}: Meldung fehlt`);
    assert.match(r.text, /[.!]$/, `${name}: Meldung ist kein ganzer Satz`);
    assert.ok(!/undefined|null|NaN/.test(r.text), `${name}: Meldung enthält Programmiererdeutsch`);
  }
});
