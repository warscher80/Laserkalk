/**
 * defaults.js — STARTWERTE.
 *
 * §37: Diese Werte sind ausdrücklich nur Startwerte. Sie werden beim allerersten
 * App-Start einmalig in die Datenbank geschrieben. Danach liest und schreibt die
 * gesamte Anwendung ausschließlich die Datenbank — hier steht dann nichts mehr,
 * was das Ergebnis beeinflusst.
 *
 * Beträge in Cent, Prozente in Basispunkten (25 % = 2500).
 */

export const SETTINGS_ID = 'app';

export function defaultSettings() {
  return {
    id: SETTINGS_ID,

    /* --- Stundensätze (§37) --- */
    laserSatzCent: 3000,      // 30,00 €/h  Maschinenstundensatz
    cadSatzCent: 7000,        // 70,00 €/h  CAD / Programmierung
    bedienerSatzCent: 6500,   // 65,00 €/h  Bediener / Rüsten
    entgratSatzCent: 6500,    // 65,00 €/h  Entgraten / Nachbearbeitung

    /* --- Aufschläge --- */
    materialAufschlagBp: 2500, // 25 %
    verschnittBp: 1000,        // 10 %
    gewinnBp: 1500,            // 15 %
    /**
     * §26: 'aufschlag'  = Gewinnaufschlag zusätzlich anwenden
     *      'inklusive'  = kein zusätzlicher Gewinn, da die Stundensätze bereits
     *                     Verkaufspreise sind (verhindert doppelte Gewinnrechnung)
     */
    gewinnModus: 'aufschlag',

    /* --- Steuer & Mindestwert --- */
    mwstBp: 2000,              // 20 % (Österreich)
    mindestwertCent: 3000,     // 30,00 € netto
    mindestwertAktiv: true,

    /* --- Laserzeit-Schätzung (§18) --- */
    nebenzeitSek: 20,          // Nebenzeit je Bauteil (Positionieren, Verfahrwege)
    nebenzeitModus: 'proStueck',
    standardGasId: 'gas_luft',
    standardMaschineId: 'mach_1',

    /* --- DXF (§12) --- */
    dxfEinheitStandard: 'mm',
    dxfToleranzMm: 0.01,       // Verkettungstoleranz für Konturschluss
    dxfFlachToleranzMm: 0.005, // Sehnenhöhe beim Abflachen von Bögen/Splines
    dxfMinSegmentMm: 0.05,     // darunter gilt ein Segment als "extrem kurz"
    dxfFlaechenBasis: 'netto', // §14 Standardauswahl

    /* --- Sonstiges --- */
    waehrung: 'EUR',
    theme: 'light',
    nummernPraefix: 'K',
    nummernZaehler: 1,
    schemaVersion: 1,
  };
}

/** §5: Dichten als Startwert je Materialgruppe — in der Datenbank frei änderbar. */
export function defaultMaterialGroups() {
  return [
    { id: 'grp_stahl',     name: 'Stahl',            dichteStd: 7850, sort: 10, aktiv: true },
    { id: 'grp_edelstahl', name: 'Edelstahl',        dichteStd: 7900, sort: 20, aktiv: true },
    { id: 'grp_alu',       name: 'Aluminium',        dichteStd: 2700, sort: 30, aktiv: true },
    { id: 'grp_corten',    name: 'Cortenstahl',      dichteStd: 7850, sort: 40, aktiv: true },
    { id: 'grp_verzinkt',  name: 'Verzinktes Blech', dichteStd: 7850, sort: 50, aktiv: true },
    { id: 'grp_sonstige',  name: 'Sonstige',         dichteStd: 7850, sort: 60, aktiv: true },
  ];
}

/** §22: Bearbeitungsarten. Frei erweiterbar, jede mit eigenem Stundensatz. */
export function defaultProcesses() {
  return [
    { id: 'prc_entgraten', name: 'Entgraten',         satzCent: 6500, aktiv: true, sort: 10 },
    { id: 'prc_schleifen', name: 'Schleifen',         satzCent: 6500, aktiv: true, sort: 20 },
    { id: 'prc_bohren',    name: 'Bohren',            satzCent: 6500, aktiv: true, sort: 30 },
    { id: 'prc_senken',    name: 'Senken',            satzCent: 6500, aktiv: true, sort: 40 },
    { id: 'prc_gewinde',   name: 'Gewinde schneiden', satzCent: 6500, aktiv: true, sort: 50 },
    { id: 'prc_kanten',    name: 'Kanten',            satzCent: 7500, aktiv: true, sort: 60 },
    { id: 'prc_schweissen',name: 'Schweißen',         satzCent: 7500, aktiv: true, sort: 70 },
    { id: 'prc_reinigen',  name: 'Reinigen',          satzCent: 5500, aktiv: true, sort: 80 },
    { id: 'prc_satinieren',name: 'Satinieren',        satzCent: 6500, aktiv: true, sort: 90 },
    { id: 'prc_verpacken', name: 'Verpacken',         satzCent: 5500, aktiv: true, sort: 100 },
    { id: 'prc_sonstige',  name: 'Sonstige Bearbeitung', satzCent: 6500, aktiv: true, sort: 110 },
  ];
}

/**
 * §23: Schneidgase.
 * Druckluft ist standardmäßig im Maschinenstundensatz enthalten ('inklusive' = 0 €).
 * O2/N2 werden separat berechnet — Preise sind Startwerte und frei einstellbar.
 */
export function defaultGases() {
  return [
    { id: 'gas_luft', name: 'Druckluft',      modus: 'inklusive', preisCent: 0,   sort: 10 },
    { id: 'gas_o2',   name: 'Sauerstoff O₂',  modus: 'proStunde', preisCent: 300, sort: 20 },
    { id: 'gas_n2',   name: 'Stickstoff N₂',  modus: 'proStunde', preisCent: 900, sort: 30 },
    { id: 'gas_sonst',name: 'Sonstiges Gas',  modus: 'proStunde', preisCent: 0,   sort: 40 },
  ];
}

/** §38: Maschine mit Verrechnungssatz und optionaler Selbstkosten-Rechnung. */
export function defaultMachines() {
  return [{
    id: 'mach_1',
    name: 'Laser 1',
    verrechnungssatzCent: 3000,
    aktiv: true,
    kalk: {
      anschaffungCent: 0,
      elektroinstallationCent: 0,
      nutzungsdauerJahre: 8,
      stundenProJahr: 1500,
      wartungProJahrCent: 0,
      raumkostenProJahrCent: 0,
      strompreisCentProKwh: 0,
      stromverbrauchKw: 0,
      sonstigeFixkostenProJahrCent: 0,
    },
  }];
}

/**
 * §17: Schnittparameter — Startwerte für gängige Kombinationen.
 * ACHTUNG: Das sind grobe Richtwerte für eine mittlere Faserlaserleistung.
 * Sie MÜSSEN an die eigene Maschine angepasst werden — dafür ist die
 * Schnittparameter-Tabelle in den Einstellungen da.
 */
export function defaultCutParams() {
  const P = (groupId, werkstoff, dickeMm, gas, v, pierce) => ({
    id: `cp_${groupId}_${String(dickeMm).replace('.', '_')}_${gas}`,
    groupId, werkstoff, dickeMm, gas, maschineId: 'mach_1',
    vSchnittMmMin: v, piercingSek: pierce,
    notizen: 'Startwert – bitte an die eigene Maschine anpassen',
  });
  return [
    // Stahl / Druckluft
    P('grp_stahl', 'S235JR', 1.0, 'Druckluft', 12000, 0.2),
    P('grp_stahl', 'S235JR', 1.5, 'Druckluft', 10000, 0.25),
    P('grp_stahl', 'S235JR', 2.0, 'Druckluft', 8000, 0.3),
    P('grp_stahl', 'S235JR', 3.0, 'Druckluft', 5200, 0.5),
    P('grp_stahl', 'S235JR', 4.0, 'Druckluft', 3800, 0.7),
    // Stahl / Sauerstoff
    P('grp_stahl', 'S235JR', 5.0, 'Sauerstoff O₂', 2600, 0.9),
    P('grp_stahl', 'S235JR', 6.0, 'Sauerstoff O₂', 2200, 1.1),
    P('grp_stahl', 'S235JR', 8.0, 'Sauerstoff O₂', 1600, 1.5),
    P('grp_stahl', 'S235JR', 10.0, 'Sauerstoff O₂', 1200, 2.0),
    // Edelstahl / Stickstoff
    P('grp_edelstahl', '1.4301', 1.0, 'Stickstoff N₂', 11000, 0.2),
    P('grp_edelstahl', '1.4301', 1.5, 'Stickstoff N₂', 8500, 0.25),
    P('grp_edelstahl', '1.4301', 2.0, 'Stickstoff N₂', 6500, 0.35),
    P('grp_edelstahl', '1.4301', 3.0, 'Stickstoff N₂', 4000, 0.6),
    P('grp_edelstahl', '1.4301', 4.0, 'Stickstoff N₂', 2600, 0.9),
    // Aluminium / Stickstoff
    P('grp_alu', 'AlMg3', 1.0, 'Stickstoff N₂', 12000, 0.25),
    P('grp_alu', 'AlMg3', 2.0, 'Stickstoff N₂', 7000, 0.4),
    P('grp_alu', 'AlMg3', 3.0, 'Stickstoff N₂', 4500, 0.7),
    P('grp_alu', 'AlMg3', 4.0, 'Stickstoff N₂', 3000, 1.0),
  ];
}

/**
 * §4: KEINE Materialpreise werden fest programmiert.
 * Diese Vorlage legt nur die Struktur (Werkstoff + Blechstärke + Tafelmaß) an,
 * ALLE Preise stehen auf 0 und müssen vom Betrieb gepflegt werden.
 * Wird nur auf ausdrücklichen Knopfdruck in den Einstellungen erzeugt.
 */
export function beispielMaterialien() {
  const out = [];
  const mk = (groupId, werkstoff, dichte, dicken) => {
    for (const d of dicken) {
      out.push({
        id: `mat_${groupId}_${werkstoff.replace(/[^\w]/g, '')}_${String(d).replace('.', '_')}`,
        groupId, werkstoff,
        bezeichnung: `${werkstoff} ${String(d).replace('.', ',')} mm`,
        dickeMm: d,
        tafelLaengeMm: 2500, tafelBreiteMm: 1250,
        ekTafelCent: 0, ekProKgCent: 0, preisProM2Cent: 0,
        preisQuelle: 'tafel',
        dichte,
        lieferant: '', artikelnummer: '', preisDatum: '', notizen: '',
        aktiv: true,
      });
    }
  };
  mk('grp_stahl', 'S235JR', 7850, [1.0, 1.5, 2.0, 3.0, 4.0]);
  mk('grp_edelstahl', '1.4301', 7900, [1.0, 1.5, 2.0, 3.0]);
  mk('grp_alu', 'AlMg3', 2700, [1.0, 1.5, 2.0, 3.0]);
  return out;
}
