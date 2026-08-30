/**
 * machine.js — Maschinenstundensatz (§38).
 * Rechnet die Selbstkosten je Maschinenstunde aus den Fixkosten und dem Strom.
 * Reine Funktion, DOM-frei, testbar.
 */

import { roundHalf } from '../core/money.js';

/**
 * @param {object} k Eingaben (Beträge in Cent)
 * @returns {object} Aufstellung mit Selbstkosten je Maschinenstunde
 */
export function maschinenkosten(k) {
  const anschaffung = Math.max(0, Number(k.anschaffungCent) || 0);
  const elektro = Math.max(0, Number(k.elektroinstallationCent) || 0);
  const jahre = Math.max(0, Number(k.nutzungsdauerJahre) || 0);
  const stunden = Math.max(0, Number(k.stundenProJahr) || 0);
  const wartung = Math.max(0, Number(k.wartungProJahrCent) || 0);
  const raum = Math.max(0, Number(k.raumkostenProJahrCent) || 0);
  const sonstige = Math.max(0, Number(k.sonstigeFixkostenProJahrCent) || 0);
  const strompreis = Math.max(0, Number(k.strompreisCentProKwh) || 0);
  const kw = Math.max(0, Number(k.stromverbrauchKw) || 0);

  const investition = anschaffung + elektro;
  const abschreibungProJahr = jahre > 0 ? roundHalf(investition / jahre) : 0;
  const fixkostenProJahr = abschreibungProJahr + wartung + raum + sonstige;

  const abschreibungProStunde = stunden > 0 ? roundHalf(abschreibungProJahr / stunden) : 0;
  const wartungProStunde = stunden > 0 ? roundHalf(wartung / stunden) : 0;
  const raumProStunde = stunden > 0 ? roundHalf(raum / stunden) : 0;
  const sonstigeProStunde = stunden > 0 ? roundHalf(sonstige / stunden) : 0;
  const stromProStunde = roundHalf(kw * strompreis);

  const selbstkostenProStunde =
    abschreibungProStunde + wartungProStunde + raumProStunde + sonstigeProStunde + stromProStunde;

  return {
    investition, abschreibungProJahr, fixkostenProJahr,
    abschreibungProStunde, wartungProStunde, raumProStunde, sonstigeProStunde, stromProStunde,
    selbstkostenProStunde,
    vollstaendig: stunden > 0 && jahre > 0,
  };
}

/** Deckungsbeitrag je Maschinenstunde beim gewählten Verrechnungssatz. */
export function maschinenmarge(selbstkostenProStunde, verrechnungssatzCent) {
  const diff = (Number(verrechnungssatzCent) || 0) - (Number(selbstkostenProStunde) || 0);
  const proz = selbstkostenProStunde > 0 ? (diff / selbstkostenProStunde) * 100 : null;
  return { diffCent: diff, prozent: proz };
}
