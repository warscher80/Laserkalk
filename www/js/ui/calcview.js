/**
 * calcview.js — vollständige Kalkulation (§2–§8, §17–§28, §36).
 *
 * Eine Ansicht für drei Wege: neue Kalkulation, DXF-Kalkulation und das
 * Bearbeiten einer gespeicherten Kalkulation. Der Preis wird bei jeder Eingabe
 * neu berechnet und unten dauerhaft angezeigt.
 */

import {
  h, card, field, text, num, money, prozent, select, seg, switchRow, note, toast, icon,
  sheet, res, entprellt, leere, beiFeldpruefung, ergebnisSperre, formularFehler,
} from './components.js';
import { store } from '../core/store.js';
import { berechne, neueKalkulation, neueZeit, pruefeKalkulation, staffel, METHODEN } from '../calc/engine.js';
import { laserzeitMin, gewichtKg } from '../dxf/analyze.js';
import { findeSchnittparameter, materialLabel } from '../core/material.js';
import { rasterNesting } from '../calc/nesting.js';
import { eur, num as fmtNum, pct, glatt, costFromMinutes } from '../core/money.js';
import { isoDate, minStr } from '../core/util.js';
import { materialAuswahl } from './matpicker.js';
import { dxfKarte, dxfFuerSpeicher, aggregiere } from './dxfcard.js';

const MODI = [['einmalig', 'einmalig'], ['proStueck', 'pro Stück'], ['gesamt', 'Gesamtzeit']];

export async function render(ctx, modus = 'voll') {
  const settings = store.settings;
  const param = ctx.param || [];
  const istNeu = !param[0] || param[0] === 'neu';

  let calc;
  if (!istNeu) {
    const vorhanden = store.kalkulation(param[0]);
    if (!vorhanden) {
      return { kopf: { titel: 'Nicht gefunden', zurueck: '/history' }, el: note('bad', 'Diese Kalkulation existiert nicht mehr.') };
    }
    calc = JSON.parse(JSON.stringify(vorhanden));
    if (calc.dxf) aggregiere(calc.dxf);
  } else {
    calc = neueKalkulation(settings, { datum: isoDate() });
    calc.zeiten = [
      { ...neueZeit('cad', 'CAD / Programmierung', settings.cadSatzCent, 'einmalig') },
      { ...neueZeit('laser', 'Laserzeit', settings.laserSatzCent, 'proStueck') },
      { ...neueZeit('bediener', 'Bediener / Rüsten', settings.bedienerSatzCent, 'einmalig') },
      { ...neueZeit('prozess', 'Entgraten', settings.entgratSatzCent, 'proStueck'), prozessId: 'prc_entgraten' },
    ];
    const standardGas = store.gas(settings.standardGasId) || store.gase()[0];
    if (standardGas) calc.gas = { gasId: standardGas.id, name: standardGas.name, modus: standardGas.modus, preisCent: standardGas.preisCent, proStueck: false };
    const ersteMat = store.materialien(true)[0];
    if (ersteMat) { calc.materialId = ersteMat.id; calc.material = matSnapshot(ersteMat); }
  }

  let gespeichert = JSON.stringify(calc);
  const schmutzig = () => JSON.stringify(calc) !== gespeichert;

  /* ---------------- Aufbau ---------------- */

  const wurzel = h('div');
  const ergebnisBox = h('div');
  const detailBox = h('div');
  let letztesErgebnis = null;

  const matBox = h('div');
  const zeitBox = h('div');
  /** Anzeige-Auffrischer je Zeitzeile – wird von zeichneZeiten() neu gefüllt. */
  let zeitAuffrischer = [];
  const zusatzBox = h('div');
  const preisBox = h('div');
  const dxfBox = dxfKarte({
    calc,
    aufAenderung: () => { dxfBox._neu(); autoLaser(false); zeichneMaterial(); zeichneZeiten(); aktualisiere(); },
    aufNeuBerechnen: () => { autoLaser(false); aktualisiere(); },
  });

  const kopfBauen = () => ({
    titel: calc.bauteil || (istNeu ? (modus === 'dxf' ? 'DXF-Kalkulation' : 'Neue Kalkulation') : 'Kalkulation'),
    untertitel: [calc.nummer, calc.kunde, calc.projekt].filter(Boolean).join(' · ') || 'noch nicht gespeichert',
    zurueck: '/home',
    aktionen: [{ icon: 'save', label: 'Speichern', onclick: speichern }],
  });

  /* ---------------- Live-Berechnung ---------------- */

  const aktualisiere = () => {
    /*
     * Erst die Felder, dann die Rechnung. Ein fehlerhaftes oder noch offenes
     * Feld darf keinen Preis erzeugen — auch keinen, der zufällig plausibel
     * aussieht, weil der Rechenkern intern einen Ersatzwert einsetzt.
     */
    if (!ergebnisSperre(wurzel, ergebnisBox, [])) {
      leere(detailBox);
      letztesErgebnis = null;
      ctx.zeigePreis({ unsicher: true, unsicherGrund: 'Eingaben prüfen' });
      ctx.setzeKopf(kopfBauen());
      return;
    }
    let r;
    try { r = berechne(calc); }
    catch (e) { console.error(e); toast('Berechnungsfehler: ' + e.message, 'bad'); return; }
    letztesErgebnis = r;

    ctx.zeigePreis({
      nettoCent: r.vkNettoCent,
      proStueckCent: r.vkProStueckCent,
      stueckzahl: r.stueckzahl,
      unsicher: r.preisUnsicher,
      // Den TATSÄCHLICHEN Grund nennen, nicht pauschal die Einheit —
      // sonst sucht der Benutzer an der falschen Stelle.
      unsicherGrund: r.preisUnsicher ? kurzGrund(r) : '',
      aktion: { label: 'Speichern', onclick: speichern },
    });
    for (const f of zeitAuffrischer) f();
    zeichneErgebnis(r);
    zeichneDetails(r);
    if (dxfBox._werte) dxfBox._werte();
    ctx.setzeKopf(kopfBauen());
  };
  const aktualisiereSpaeter = entprellt(aktualisiere, 60);

  /**
   * Baut die Karten neu auf, deren INHALT von der Stückzahl abhängt
   * (Zeitzeilen „Gesamt … min", Nesting-Vorschau). Bewusst entprellt und nur
   * von Feldern aus aufgerufen, die außerhalb dieser Karten liegen – so geht
   * beim Tippen kein Eingabefokus verloren.
   */
  const strukturSpaeter = entprellt(() => {
    zeichneMaterial();   // Nesting-Vorschau hängt an der Stückzahl
    aktualisiere();
  }, 260);

  /* ---------------- Grunddaten (§2) ---------------- */

  const grunddaten = card('Grunddaten',
    h('.grid', null,
      field('Kunde', text(calc.kunde, v => { calc.kunde = v; aktualisiereSpaeter(); }, { placeholder: 'Firma / Name' })),
      field('Projekt', text(calc.projekt, v => { calc.projekt = v; aktualisiereSpaeter(); }, { placeholder: 'Auftrag / Baustelle' })),
      h('.field.full', null, h('label', { text: 'Bauteilbezeichnung' }),
        text(calc.bauteil, v => { calc.bauteil = v; aktualisiereSpaeter(); }, { placeholder: 'z. B. Konsole links' })),
      field('Angebotsnummer (optional)', text(calc.angebotsnummer, v => { calc.angebotsnummer = v; }, { placeholder: 'frei' })),
      field('Datum', h('input', {
        type: 'date', value: calc.datum || isoDate(),
        oninput: e => { calc.datum = e.target.value; },
      })),
      field('Stückzahl', num(calc.stueckzahl, v => {
        calc.stueckzahl = v;
        aktualisiereSpaeter();
        strukturSpaeter();
      }, { unit: 'Stk', regel: 'stueckzahl' }), 'Ganze Zahl, mindestens 1.'),
      h('.field', null, h('label', { text: 'Interne Notiz' }),
        text(calc.notiz, v => { calc.notiz = v; }, { placeholder: 'nur intern sichtbar' })),
    ),
  );

  /* ---------------- Material (§3, §6, §7, §8) ---------------- */

  function matSnapshot(m) {
    if (!m) return null;
    return {
      id: m.id, groupId: m.groupId, werkstoff: m.werkstoff, bezeichnung: materialLabel(m),
      dickeMm: Number(m.dickeMm) || 0, dichte: Number(m.dichte) || 0,
      tafelLaengeMm: Number(m.tafelLaengeMm) || 0, tafelBreiteMm: Number(m.tafelBreiteMm) || 0,
      ekTafelCent: Number(m.ekTafelCent) || 0, ekProKgCent: Number(m.ekProKgCent) || 0,
      preisProM2Cent: Number(m.preisProM2Cent) || 0,
      lieferant: m.lieferant || '', preisDatum: m.preisDatum || '',
      snapshotAm: isoDate(),
    };
  }

  const picker = materialAuswahl({
    materialId: calc.materialId,
    onChange: (m) => {
      calc.materialId = m ? m.id : '';
      calc.material = matSnapshot(m);
      autoLaser(false);
      if (calc.dxf) dxfBox._neu();
      zeichneMaterial();
      zeichneZeiten();
      aktualisiere();
    },
  });

  function zeichneMaterial() {
    leere(matBox);
    const v = calc.verbrauch;
    const mat = calc.material;
    const inhalt = h('div');

    inhalt.appendChild(picker);

    inhalt.appendChild(h('.field.mt', null,
      h('label', { text: 'Materialverbrauch ermitteln über' }),
      seg(Object.entries(METHODEN)
        .filter(([k]) => k !== 'dxf' || calc.dxf)
        .map(([k, l]) => [k, kurzMethode(k)]),
        v.methode, (nv) => { v.methode = nv; zeichneMaterial(); aktualisiere(); }, 'wrap small'),
      h('.hint', { text: METHODEN[v.methode] || '' }),
    ));

    const eingabe = h('div');
    switch (v.methode) {
      case 'rechteck':
        eingabe.appendChild(h('.grid', null,
          field('Länge', num(v.laengeMm, x => { v.laengeMm = x; aktualisiereSpaeter(); }, { unit: 'mm', regel: 'mass' })),
          field('Breite', num(v.breiteMm, x => { v.breiteMm = x; aktualisiereSpaeter(); }, { unit: 'mm', regel: 'mass' })),
        ));
        break;
      case 'flaeche':
        eingabe.appendChild(field('Fläche', num(v.flaecheM2, x => { v.flaecheM2 = x; aktualisiereSpaeter(); }, { unit: 'm²', regel: 'mass' })));
        break;
      case 'gewicht':
        eingabe.appendChild(field('Gewicht', num(v.gewichtKg, x => { v.gewichtKg = x; aktualisiereSpaeter(); }, { unit: 'kg', regel: 'mass' }),
          mat?.ekProKgCent > 0 ? `Preis je kg: ${eur(mat.ekProKgCent)}` : 'Achtung: kein Preis je kg im Material hinterlegt.',
          mat?.ekProKgCent > 0 ? '' : 'warn'));
        break;
      case 'tafeln':
        eingabe.appendChild(field('Anzahl Tafeln', num(v.tafeln, x => { v.tafeln = x; aktualisiereSpaeter(); }, { unit: 'Tafeln', regel: 'mass' }),
          mat?.tafelLaengeMm > 0 ? `Tafel ${fmtNum(mat.tafelLaengeMm, 0)} × ${fmtNum(mat.tafelBreiteMm, 0)} mm · ${eur(mat.ekTafelCent || 0)}` : 'Kein Tafelmaß im Material hinterlegt.'));
        break;
      case 'kosten':
        eingabe.appendChild(field('Materialkosten (Einkauf)', money(v.kostenCent, x => { v.kostenCent = x; aktualisiereSpaeter(); }, { regel: 'preis' })));
        break;
      case 'dxf':
        eingabe.appendChild(note('info', 'Die Materialfläche kommt aus der DXF-Analyse. Die Auswahl der Flächenbasis steht in der DXF-Karte.'));
        break;
    }
    if (v.methode !== 'dxf') {
      eingabe.appendChild(h('.field', null,
        h('label', { text: 'Der eingegebene Wert gilt' }),
        seg([['stk', 'je Stück'], ['ges', 'für den ganzen Auftrag']], v.proStueck ? 'stk' : 'ges',
          (nv) => { v.proStueck = nv === 'stk'; aktualisiere(); }, 'small'),
      ));
    }
    inhalt.appendChild(eingabe);

    inhalt.appendChild(h('.grid.mt', null,
      h('.field', null, h('label', { text: 'Verschnitt' }),
        seg([0, 500, 1000, 1500, 2000, 2500].map(b => [b, (b / 100) + ' %']), calc.verschnittBp,
          (nv) => { calc.verschnittBp = Number(nv); zeichneMaterial(); aktualisiere(); }, 'small wrap'),
        h('div.mt', null, prozent(calc.verschnittBp, x => { calc.verschnittBp = x; aktualisiereSpaeter(); }, { regel: 'prozentVerschnitt' })),
        h('.hint', { text: `Standard aus den Einstellungen: ${pct(settings.verschnittBp)}` })),
      field('Materialaufschlag', prozent(calc.materialAufschlagBp, x => { calc.materialAufschlagBp = x; aktualisiereSpaeter(); }, { regel: 'prozentAufschlag' }),
        `Standard: ${pct(settings.materialAufschlagBp)}`),
    ));

    matBox.appendChild(card('Material & Verbrauch', inhalt));

    /* Nesting-Vorschau (§32) – nur wenn Tafelmaß und Bauteilmaß bekannt sind */
    const nest = nestingErgebnis();
    if (nest) {
      const inhaltN = h('div');
      if (!nest.ok) inhaltN.appendChild(note('warn', nest.grund));
      else {
        inhaltN.appendChild(h('.results', null,
          res('Stück je Tafel', String(nest.proTafel), '', `${nest.spalten} × ${nest.reihen}${nest.drehung ? ' (gedreht)' : ''}`),
          res('Benötigte Tafeln', String(nest.tafeln), '', `für ${nest.menge} Stk`),
          res('Ausnutzung', fmtNum(nest.ausnutzungProzent, 1), '%', `Verschnitt ${fmtNum(nest.verschnittProzent, 1)} %`),
          res('Restfläche', fmtNum(nest.restflaecheM2, 3), 'm²'),
        ));
        inhaltN.appendChild(h('.hint', { text: nest.hinweis }));
        if (calc.dxf) {
          inhaltN.appendChild(h('button.btn.small.block.mt', {
            text: `Materialfläche aus dem Rechteck-Nesting übernehmen (${fmtNum(nest.flaecheProStueckM2, 5)} m²/Stück)`,
            onclick: () => {
              calc.dxf.nestingFlaecheProStueckM2 = nest.flaecheProStueckM2;
              calc.dxf.flaechenBasis = 'nesting';
              calc.verbrauch.methode = 'dxf';
              dxfBox._neu(); zeichneMaterial(); aktualisiere();
            },
          }));
        }
      }
      matBox.appendChild(card(h('span', null, 'Nesting-Vorschau', h('span.sp', { text: 'Rechteck, 0°/90°' })), inhaltN));
    }
  }

  /** Kurzform des ersten sperrenden Vorbehalts für die Preisleiste. */
  function kurzGrund(r) {
    const u = (r.unsicherheiten || []).find(x => x.schwere === 'blockierend');
    if (!u) return 'Eingangsdaten ungeklärt';
    if (/Einheit/.test(u.text)) return 'DXF-Einheit bestätigen';
    if (/Materialfläche/.test(u.text)) return 'Zeichnung liefert keine Fläche';
    return 'Eingangsdaten ungeklärt';
  }

  function nestingErgebnis() {
    const mat = calc.material;
    if (!mat || !(mat.tafelLaengeMm > 0) || !(mat.tafelBreiteMm > 0)) return null;
    let w = 0, hh = 0;
    if (calc.dxf) { w = calc.dxf.breiteMm; hh = calc.dxf.hoeheMm; }
    else if (calc.verbrauch.methode === 'rechteck') { w = calc.verbrauch.laengeMm; hh = calc.verbrauch.breiteMm; }
    if (!(w > 0) || !(hh > 0)) return null;
    return rasterNesting({
      tafelLaengeMm: mat.tafelLaengeMm, tafelBreiteMm: mat.tafelBreiteMm,
      teilBreiteMm: w, teilHoeheMm: hh,
      menge: Math.max(1, Math.trunc(Number(calc.stueckzahl) || 1)),
    });
  }

  /* ---------------- Zeiten (§18–§22, §28) ---------------- */

  /** §18: Laserzeit aus DXF und Schnittparametern schätzen. */
  function laserSchaetzung() {
    const d = calc.dxf;
    const mat = calc.material;
    if (!d || !mat || !(d.schnittlaengeMm > 0)) return null;
    const treffer = findeSchnittparameter(store.schnittparameter(), {
      groupId: mat.groupId, werkstoff: mat.werkstoff, dickeMm: mat.dickeMm,
      gas: calc.gas?.name, maschineId: settings.standardMaschineId,
    });
    if (!treffer.param) return { min: null, hinweis: treffer.hinweis };
    // Ein Treffer außerhalb der Tabelle ist keine Schätzung, sondern ein Raten.
    if (treffer.ausserhalb) return { min: null, hinweis: treffer.hinweis, ausserhalb: true };
    const min = laserzeitMin({
      schnittlaengeMm: d.schnittlaengeMm,
      einstiche: d.einstiche,
      vSchnittMmMin: treffer.param.vSchnittMmMin,
      piercingSek: treffer.param.piercingSek,
      nebenzeitSek: settings.nebenzeitSek,
    });
    return { min, param: treffer.param, exakt: treffer.exakt, hinweis: treffer.hinweis };
  }

  /** Übernimmt die Schätzung, wenn noch nichts von Hand eingetragen wurde. */
  function autoLaser(erzwingen) {
    const zeile = calc.zeiten.find(z => z.art === 'laser');
    if (!zeile) return;
    const s = laserSchaetzung();
    if (!s || !(s.min > 0)) return;
    if (erzwingen || zeile.quelle === 'auto' || !(Number(zeile.minuten) > 0)) {
      zeile.minuten = Math.round(s.min * 100) / 100;
      zeile.modus = 'proStueck';
      zeile.quelle = 'auto';
    }
  }

  function zeichneZeiten() {
    leere(zeitBox);
    zeitAuffrischer = [];
    const inhalt = h('div');

    calc.zeiten.forEach((z, i) => {
      const istLaser = z.art === 'laser';
      const kostenAnzeige = h('span.pc');
      const minutenAnzeige = h('.hint');
      const marke = istLaser ? h('span.badge') : null;
      const schaetzHinweis = istLaser ? h('.hint') : null;
      const uebernehmen = istLaser ? h('button.btn.small.block.mt', {
        text: 'Geschätzte Laserzeit übernehmen',
        onclick: () => { autoLaser(true); zeichneZeiten(); aktualisiere(); },
      }) : null;

      const zeitFeld = num(z.minuten, v => {
        z.minuten = v;
        if (istLaser) z.quelle = 'manuell';
        auffrischen();
        aktualisiereSpaeter();
      }, { unit: 'min', regel: 'zeit' });
      const zeitInput = zeitFeld.querySelector ? zeitFeld.querySelector('input') : zeitFeld;

      /**
       * Schreibt alle abgeleiteten Anzeigen dieser Zeile neu.
       * Das Eingabefeld selbst wird nur überschrieben, wenn der Wert
       * automatisch stammt UND gerade nicht darin getippt wird.
       */
      function auffrischen() {
        const n = Math.max(1, Math.trunc(Number(calc.stueckzahl) || 1));
        // Genau wie im Rechenkern rechnen, sonst weicht die Zeilenanzeige
        // vom Preis unten ab (glatt() gegen Gleitkomma-Rauschen, kaufmännisch runden).
        const min = Math.max(0, Number(z.minuten) || 0);
        const minGes = glatt(z.modus === 'proStueck' ? min * n : min);
        kostenAnzeige.textContent = eur(costFromMinutes(minGes, Math.max(0, Math.trunc(Number(z.satzCent) || 0))));
        minutenAnzeige.textContent = `Gesamt ${minStr(minGes)}`;
        if (!istLaser) return;

        marke.className = 'badge ' + (z.quelle === 'auto' ? 'auto' : 'man');
        marke.textContent = z.quelle === 'auto' ? 'Geschätzte Laserzeit' : 'Manuell eingegeben';

        if (zeitInput && document.activeElement !== zeitInput) {
          const soll = String(Math.round((Number(z.minuten) || 0) * 100) / 100).replace('.', ',');
          if (zeitInput.value !== soll) zeitInput.value = soll;
        }

        const s = laserSchaetzung();
        if (!s) {
          schaetzHinweis.hidden = true;
          uebernehmen.hidden = true;
          return;
        }
        schaetzHinweis.hidden = false;
        if (s.min === null) {
          schaetzHinweis.className = 'hint warn';
          schaetzHinweis.textContent = s.hinweis || 'Für dieses Material sind keine Schnittparameter hinterlegt – die Laserzeit muss von Hand eingegeben werden.';
          uebernehmen.hidden = true;
          return;
        }
        schaetzHinweis.className = 'hint' + (s.exakt ? '' : ' warn');
        schaetzHinweis.textContent =
          `Schätzung: ${fmtNum(s.min, 2)} min/Stück (${fmtNum(s.param.vSchnittMmMin, 0)} mm/min, ` +
          `${fmtNum(s.param.piercingSek, 2)} s je Einstich, ${settings.nebenzeitSek} s Nebenzeit)` +
          (s.exakt ? '' : ' – ' + s.hinweis);
        uebernehmen.hidden = Math.abs((Number(z.minuten) || 0) - s.min) < 0.005;
      }

      const zeile = h('.posrow', null,
        h('.ph', null,
          h('span.pn', null, z.name, marke),
          kostenAnzeige,
          z.art === 'prozess' ? h('button.iconbtn.bad', {
            'aria-label': 'Position entfernen',
            onclick: () => { calc.zeiten.splice(i, 1); zeichneZeiten(); aktualisiere(); },
          }, icon('x', 16)) : null,
        ),
        h('.grid', null,
          field('Zeit', zeitFeld),
          field('Stundensatz', money(z.satzCent, v => { z.satzCent = v; auffrischen(); aktualisiereSpaeter(); }, { einheit: '€/h', regel: 'satz' })),
        ),
        seg(MODI, z.modus, (v) => { z.modus = v; auffrischen(); aktualisiere(); }, 'small'),
        minutenAnzeige,
        schaetzHinweis,
        uebernehmen,
      );

      auffrischen();
      zeitAuffrischer.push(auffrischen);
      inhalt.appendChild(zeile);
    });

    inhalt.appendChild(h('button.btn.block.mt', { onclick: prozessHinzufuegen },
      icon('plus', 18), 'Bearbeitung hinzufügen'));
    inhalt.appendChild(h('.hint', { text: 'Wichtig: Die Bedienerzeit wird getrennt von der Laserzeit gerechnet – der Bediener steht nicht die ganze Maschinenzeit daneben.' }));

    zeitBox.appendChild(card('Zeiten & Bearbeitung', inhalt));
  }

  async function prozessHinzufuegen() {
    const prozesse = store.prozesse(true);
    if (!prozesse.length) { toast('Unter Einstellungen → Bearbeitungsarten zuerst eine Bearbeitung anlegen.', 'warn'); return; }
    const wahl = await sheet('Bearbeitung hinzufügen', (schliessen) => {
      const liste = h('.list');
      for (const p of prozesse) {
        liste.appendChild(h('.item', { onclick: () => schliessen(p) },
          h('.ib', null, h('.i1', { text: p.name }), h('.i2', { text: eur(p.satzCent) + '/h' })),
          h('.ir', null, icon('plus', 18)),
        ));
      }
      return h('div', null, liste,
        h('.sheetfoot', null, h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(null) })));
    });
    if (!wahl) return;
    calc.zeiten.push({ ...neueZeit('prozess', wahl.name, wahl.satzCent, 'proStueck'), prozessId: wahl.id });
    zeichneZeiten();
    aktualisiere();
  }

  /* ---------------- Gas (§23) ---------------- */

  function zeichneGas() {
    const gase = store.gase();
    const g = calc.gas || (calc.gas = { modus: 'inklusive', preisCent: 0 });
    const inhalt = h('div');
    inhalt.appendChild(h('.grid', null,
      field('Schneidgas', select(gase.map(x => [x.id, x.name]), g.gasId, (v) => {
        const gas = store.gas(v);
        calc.gas = { gasId: v, name: gas.name, modus: gas.modus, preisCent: gas.preisCent, proStueck: false };
        zeichneGasKarte(); autoLaser(false); zeichneZeiten(); aktualisiere();
      })),
      field('Abrechnung', select([
        ['inklusive', 'Im Maschinensatz enthalten'],
        ['proStunde', 'Preis je Stunde'],
        ['proMinute', 'Preis je Minute'],
        ['pauschal', 'Pauschalbetrag'],
      ], g.modus, (v) => { g.modus = v; zeichneGasKarte(); aktualisiere(); })),
    ));
    if (g.modus !== 'inklusive') {
      inhalt.appendChild(h('.grid', null,
        field('Preis', money(g.preisCent, v => { g.preisCent = v; aktualisiereSpaeter(); },
          { einheit: g.modus === 'proStunde' ? '€/h' : g.modus === 'proMinute' ? '€/min' : '€', regel: 'preis' })),
        g.modus === 'pauschal'
          ? h('.field', null, h('label', { text: 'Pauschale gilt' }),
              seg([['ges', 'je Auftrag'], ['stk', 'je Stück']], g.proStueck ? 'stk' : 'ges',
                (v) => { g.proStueck = v === 'stk'; aktualisiere(); }, 'small'))
          : h('.field', null, h('label', { text: 'Bezugsgröße' }),
              h('.hint', { text: 'Gerechnet wird mit der gesamten Laserzeit dieser Kalkulation.' })),
      ));
    } else {
      inhalt.appendChild(h('.hint', { text: 'Druckluft ist üblicherweise im Maschinenstundensatz enthalten – es entstehen keine zusätzlichen Kosten.' }));
    }
    return card('Gas / Schneidmedium', inhalt);
  }

  const gasBox = h('div');
  function zeichneGasKarte() { leere(gasBox); gasBox.appendChild(zeichneGas()); }

  /* ---------------- Zusatzkosten (§24) ---------------- */

  function zeichneZusatz() {
    leere(zusatzBox);
    const inhalt = h('div');
    if (!calc.zusatz.length) {
      inhalt.appendChild(h('.hint', { text: 'Keine zusätzlichen Positionen. Typisch: Verzinken, Pulverbeschichten, Transport, Zukaufteile.' }));
    }
    calc.zusatz.forEach((z, i) => {
      const kosten = h('span.pc');
      const nach = () => {
        const n = Math.max(1, Math.trunc(Number(calc.stueckzahl) || 1));
        const menge = (Number(z.menge) || 0) * (z.modus === 'proStueck' ? n : 1);
        kosten.textContent = eur(Math.round(menge * (Number(z.einzelpreisCent) || 0)));
      };
      inhalt.appendChild(h('.posrow', null,
        h('.ph', null,
          text(z.bezeichnung, v => { z.bezeichnung = v; }, { placeholder: 'Bezeichnung', style: { minHeight: '40px', padding: '8px 10px', fontSize: '14px' } }),
          kosten,
          h('button.iconbtn.bad', { 'aria-label': 'Position entfernen', onclick: () => { calc.zusatz.splice(i, 1); zeichneZusatz(); aktualisiere(); } }, icon('x', 16)),
        ),
        h('.grid.g3', null,
          field('Menge', num(z.menge, v => { z.menge = v; nach(); aktualisiereSpaeter(); }, { regel: 'menge' })),
          field('Einheit', text(z.einheit, v => { z.einheit = v; }, { placeholder: 'Stk' })),
          field('Einzelpreis', money(z.einzelpreisCent, v => { z.einzelpreisCent = v; nach(); aktualisiereSpaeter(); }, { regel: 'betrag' })),
        ),
        seg([['einmalig', 'je Auftrag'], ['proStueck', 'je Stück']], z.modus, v => { z.modus = v; nach(); aktualisiere(); }, 'small'),
      ));
      nach();
    });
    inhalt.appendChild(h('button.btn.block.mt', {
      onclick: () => {
        calc.zusatz.push({ bezeichnung: '', menge: 1, einheit: 'Stk', einzelpreisCent: 0, modus: 'einmalig' });
        zeichneZusatz(); aktualisiere();
      },
    }, icon('plus', 18), 'Position hinzufügen'));
    zusatzBox.appendChild(card('Zusätzliche Kosten', inhalt));
  }

  /* ---------------- Preisbildung (§25–§27) ---------------- */

  function zeichnePreisbildung() {
    leere(preisBox);
    const inhalt = h('div');

    if (settings.gewinnModus === 'inklusive') {
      inhalt.appendChild(note('info', 'In den Einstellungen ist hinterlegt: die Stundensätze sind bereits Verkaufspreise. Ein zusätzlicher Gewinnaufschlag ist deshalb standardmäßig aus.'));
    }
    inhalt.appendChild(switchRow('Gewinnaufschlag anwenden', calc.gewinnAktiv,
      v => { calc.gewinnAktiv = v; zeichnePreisbildung(); aktualisiere(); },
      'Aus, wenn die Stundensätze bereits Verkaufspreise enthalten'));
    if (calc.gewinnAktiv) {
      inhalt.appendChild(field('Gewinnaufschlag', prozent(calc.gewinnBp, v => { calc.gewinnBp = v; aktualisiereSpaeter(); }, { regel: 'prozentAufschlag' }), `Standard: ${pct(settings.gewinnBp)}`));
    }

    inhalt.appendChild(switchRow('Mindestauftragswert anwenden', calc.mindestwertAktiv,
      v => { calc.mindestwertAktiv = v; zeichnePreisbildung(); aktualisiere(); }));
    if (calc.mindestwertAktiv) {
      inhalt.appendChild(field('Mindestauftragswert (netto)', money(calc.mindestwertCent, v => { calc.mindestwertCent = v; aktualisiereSpaeter(); }, { regel: 'preis' })));
    }

    inhalt.appendChild(field('Mehrwertsteuer', prozent(calc.mwstBp, v => { calc.mwstBp = v; aktualisiereSpaeter(); }, { regel: 'prozentMwst' })));
    preisBox.appendChild(card('Preisbildung', inhalt));
  }

  /* ---------------- Ergebnis & Details (§36) ---------------- */

  function zeichneErgebnis(r) {
    leere(ergebnisBox);
    if (r.preisUnsicher) {
      ergebnisBox.appendChild(card('Ergebnis',
        note('bad', r.unsicherheiten.filter(u => u.schwere === 'blockierend').map(u => u.text),
          'Es wird kein Preis angezeigt, weil die Eingangsdaten ungeklärt sind:'),
        h('.hint', { text: 'Bestätigen Sie die Einheit in der DXF-Karte. Danach erscheint der Preis wieder.' }),
        pruefMeldungen()));
      return;
    }
    const kacheln = h('.results', null,
      res('Verkaufspreis netto', eur(r.vkNettoCent), '', r.mindestwertAngewendet ? `Mindestauftragswert ${eur(r.mindestwertCent)}` : `Kalkulation ${eur(r.kalkulationCent)}`, true),
      res('Preis je Stück', eur(r.vkProStueckCent), '', `${r.stueckzahl} Stück`, true),
      res('Brutto', eur(r.vkBruttoCent), '', `inkl. ${pct(r.mwstBp)} MwSt.`),
      res('Deckungsbeitrag', eur(r.deckungsbeitragCent), '', 'netto abzgl. Material-EK & Fremdleistung'),
    );
    ergebnisBox.appendChild(card('Ergebnis', kacheln,
      r.warnungen.length ? note('warn', r.warnungen) : null,
      r.unsicherheiten.length ? note('warn', r.unsicherheiten.map(u => u.text), 'Eingeschränkte Verlässlichkeit:') : null,
      pruefMeldungen()));
  }

  function pruefMeldungen() {
    const p = pruefeKalkulation(calc);
    const out = h('div');
    if (p.fehler.length) out.appendChild(note('bad', p.fehler, 'Bitte korrigieren:'));
    if (p.hinweise.length) out.appendChild(note('info', p.hinweise));
    return out;
  }

  function zeichneDetails(r) {
    leere(detailBox);
    if (r.preisUnsicher) return;   // keine Detailzahlen zu einem gesperrten Preis
    const d = h('.detail');

    /* Material */
    d.appendChild(h('.dg', { text: 'Material' }));
    if (calc.material) {
      d.appendChild(zeile(calc.material.bezeichnung, `${r.material.basisText}${r.material.flaecheGesamtM2 > 0 ? ` · ${fmtNum(r.material.flaecheGesamtM2, 4)} m² gesamt` : ''}`, null));
    }
    d.appendChild(zeile('Einkaufspreis', r.material.gewichtGesamtKg > 0 ? `${fmtNum(r.material.gewichtGesamtKg, 2)} kg` : '', eur(r.material.ekCent)));
    if (r.material.verschnittCent) d.appendChild(zeile(`Verschnitt ${pct(r.material.verschnittBp)}`, '', eur(r.material.verschnittCent)));
    if (r.material.aufschlagCent) d.appendChild(zeile(`Materialaufschlag ${pct(r.material.aufschlagBp)}`, `auf ${eur(r.material.nachVerschnittCent)}`, eur(r.material.aufschlagCent)));
    d.appendChild(zeile('Material Verkaufspreis', '', eur(r.material.vkCent), 'sum'));

    /* Zeiten, Gas, Zusatz */
    const gruppen = new Map();
    for (const p of r.positionen) {
      if (p.gruppe === 'Material') continue;
      if (!gruppen.has(p.gruppe)) gruppen.set(p.gruppe, []);
      gruppen.get(p.gruppe).push(p);
    }
    for (const [name, liste] of gruppen) {
      d.appendChild(h('.dg', { text: name }));
      for (const p of liste) d.appendChild(zeile(p.label, p.detail, eur(p.cent)));
    }

    /* Summen */
    d.appendChild(h('.dg', { text: 'Summe' }));
    d.appendChild(zeile('Kalkulationspreis netto', '', eur(r.kalkulationCent), 'sum'));
    if (r.gewinnAktiv) d.appendChild(zeile(`Gewinnaufschlag ${pct(r.gewinnBp)}`, '', eur(r.gewinnCent)));
    else d.appendChild(zeile('Gewinnaufschlag', 'nicht angewendet – Stundensätze sind Verkaufspreise', '–', 'sub'));
    if (r.mindestwertAngewendet) {
      d.appendChild(zeile('Berechneter Preis', '', eur(r.vkVorMindestCent), 'sub'));
      d.appendChild(zeile('Mindestauftragswert', 'angewendet', eur(r.mindestwertCent)));
    }
    d.appendChild(zeile('VERKAUFSPREIS NETTO', '', eur(r.vkNettoCent), 'total'));
    d.appendChild(zeile(`MwSt. ${pct(r.mwstBp)}`, '', eur(r.mwstCent)));
    d.appendChild(zeile('Verkaufspreis brutto', '', eur(r.vkBruttoCent), 'sum'));
    d.appendChild(zeile('Preis je Stück netto', `bei ${r.stueckzahl} Stück`, eur(r.vkProStueckCent), 'sum'));

    detailBox.appendChild(card('Kalkulationsdetails', d));

    /* Preisstaffel */
    const mengen = [...new Set([1, 5, 10, 25, 50, 100, r.stueckzahl])].sort((a, b) => a - b);
    const st = staffel(calc, mengen);
    const tab = h('table.staffel', null,
      h('thead', null, h('tr', null,
        h('th', { text: 'Stückzahl' }), h('th', { text: 'Preis/Stück' }), h('th', { text: 'Gesamt netto' }))),
      h('tbody', null, ...st.map(s => h('tr' + (s.stueckzahl === r.stueckzahl ? '.now' : ''), null,
        h('td', { text: String(s.stueckzahl) }),
        h('td', { text: eur(s.proStueckCent) }),
        h('td', { text: eur(s.gesamtCent) }),
      ))),
    );
    detailBox.appendChild(card(h('span', null, 'Preisstaffel', h('span.sp', { text: 'einmalige Kosten bleiben einmalig' })), tab));
  }

  function zeile(label, unter, wert, klasse = '') {
    return h('.dr' + (klasse ? '.' + klasse.trim().split(/\s+/).join('.') : ''), null,
      h('.dl', null, h('span', { text: label }), unter ? h('small', { text: unter }) : null),
      h('.dv', { text: wert ?? '' }));
  }

  /* ---------------- Speichern ---------------- */

  async function speichern() {
    // Zweiter Riegel: was nicht rechenbar ist, wird auch nicht gespeichert.
    const offen = formularFehler(wurzel);
    if (offen.fehler.length || offen.offen.length) {
      toast('Bitte zuerst die markierten Eingaben berichtigen.', 'bad');
      ergebnisSperre(wurzel, ergebnisBox, []);
      return;
    }
    const p = pruefeKalkulation(calc);
    if (p.fehler.length) { toast(p.fehler[0], 'bad'); return; }
    const zuSpeichern = { ...calc, dxf: dxfFuerSpeicher(calc.dxf) };
    if (zuSpeichern.dxf) delete zuSpeichern.dxf.roh;
    try {
      const doc = await store.saveKalkulation(zuSpeichern);
      calc.id = doc.id; calc.nummer = doc.nummer; calc.createdAt = doc.createdAt; calc.updatedAt = doc.updatedAt;
      if (!calc.datum) calc.datum = doc.datum;
      gespeichert = JSON.stringify(calc);
      ctx.setzeKopf(kopfBauen());
      toast(`Gespeichert als ${doc.nummer}.`, 'ok');
    } catch (e) {
      console.error(e);
      toast('Speichern fehlgeschlagen: ' + (e.message || e), 'bad');
    }
  }

  ctx.beiVerlassen(async () => {
    if (!schmutzig()) return true;
    const w = await sheet('Ungespeicherte Änderungen', (schliessen) => h('div', null,
      h('p', { text: 'Diese Kalkulation wurde geändert. Was soll damit passieren?', style: { fontSize: '14.5px' } }),
      h('.sheetfoot', null,
        h('button.btn', { text: 'Verwerfen', onclick: () => schliessen('weg') }),
        h('button.btn.primary', { text: 'Speichern', onclick: () => schliessen('speichern') }),
      ),
      h('button.btn.ghost.block.mt', { text: 'Hierbleiben', onclick: () => schliessen('bleiben') }),
    ), { klickAussenSchliesst: false });
    if (w === 'speichern') { await speichern(); return true; }
    return w !== 'bleiben';
  });

  /* ---------------- Zusammenbau ---------------- */

  zeichneMaterial();
  zeichneZeiten();
  zeichneGasKarte();
  zeichneZusatz();
  zeichnePreisbildung();

  const links = h('div');
  const rechts = h('div');
  if (modus === 'dxf') { links.appendChild(dxfBox); links.appendChild(grunddaten); }
  else { links.appendChild(grunddaten); links.appendChild(dxfBox); }
  links.appendChild(matBox);
  rechts.appendChild(zeitBox);
  rechts.appendChild(gasBox);
  rechts.appendChild(zusatzBox);
  rechts.appendChild(preisBox);

  wurzel.appendChild(h('.cols', null, links, rechts));
  wurzel.appendChild(ergebnisBox);
  wurzel.appendChild(detailBox);

  if (istNeu) autoLaser(false);
  beiFeldpruefung(wurzel, () => aktualisiere());
  aktualisiere();

  if (modus === 'dxf' && !calc.dxf) setTimeout(() => dxfBox._dateiWaehlen(), 260);

  return { kopf: kopfBauen(), el: wurzel };
}

function kurzMethode(k) {
  return { rechteck: 'L × B', kosten: '€ direkt', tafeln: 'Tafeln', gewicht: 'kg', flaeche: 'm²', dxf: 'DXF' }[k] || k;
}

/** Eigene Route /dxf: dieselbe Ansicht, DXF zuerst. */
export const dxfAnsicht = {
  render: (ctx) => render(ctx, 'dxf'),
};
