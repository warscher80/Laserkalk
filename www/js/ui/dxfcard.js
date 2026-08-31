/**
 * dxfcard.js — DXF-Bereich der Kalkulationsansicht (§9–§16, §30, §31).
 *
 * Zuständig für: Datei laden, Analyse anstoßen, Vorschau zeichnen, Kennwerte
 * anzeigen, Prüfmeldungen ausgeben, Einheit bestätigen, Werte manuell
 * überschreiben und die Bauteilauswahl bei mehreren Teilen.
 */

import { h, card, field, num, select, seg, note, toast, sheet, bestaetige } from './components.js';
import { store } from '../core/store.js';
import { analysiereDxf, gewichtKg } from '../dxf/analyze.js';
import { DxfFehler, EINHEIT_FAKTOR } from '../dxf/parser.js';
import { zeichne as zeichneVorschau } from '../dxf/render.js';
import { waehleDatei, leseDatei } from '../io/files.js';
import { DXF_BASIS } from '../calc/engine.js';
import { num as fmtNum } from '../core/money.js';

const EINHEITEN = [['mm', 'Millimeter'], ['cm', 'Zentimeter'], ['m', 'Meter'], ['inch', 'Zoll']];

/** Punkte einer Analyse zählen – große Geometrien werden beim Speichern verworfen. */
export function punkteZaehlen(dxf) {
  if (!dxf) return 0;
  let n = 0;
  for (const k of dxf.konturen || []) n += k.pts.length;
  for (const k of dxf.offeneKetten || []) n += k.pts.length;
  return n;
}

/** Bereitet die DXF-Daten zum Speichern auf (Geometrie nur bis 20.000 Punkte). */
export function dxfFuerSpeicher(dxf) {
  if (!dxf) return null;
  const kopie = { ...dxf };
  if (punkteZaehlen(dxf) > 20000) {
    kopie.konturen = [];
    kopie.offeneKetten = [];
    kopie.geometrieVerworfen = true;
  }
  return kopie;
}

/**
 * Fasst die erkannten Bauteile zu den Werten zusammen, mit denen gerechnet wird (§31).
 * modus 'gesamt' : Summe über alle Bauteile × deren Stückzahl
 * modus 'einzeln': nur das gewählte Bauteil
 */
export function aggregiere(dxf) {
  if (!dxf || !dxf.roh) return;
  const roh = dxf.roh;
  const modus = dxf.bauteilModus || 'gesamt';

  if (modus === 'einzeln' && roh.bauteile.length) {
    const b = roh.bauteile.find(x => x.nr === dxf.bauteilNr) || roh.bauteile[0];
    dxf.bauteilNr = b.nr;
    dxf.breiteMm = b.breiteMm;
    dxf.hoeheMm = b.hoeheMm;
    dxf.autoNettoFlaecheM2 = b.nettoFlaecheMm2 / 1_000_000;
    dxf.autoBboxFlaecheM2 = (b.breiteMm * b.hoeheMm) / 1_000_000;
    dxf.autoSchnittlaengeMm = b.schnittlaengeMm;
    dxf.autoEinstiche = b.einstiche;
  } else {
    let flaeche = 0, laenge = 0, stiche = 0;
    const mehrfach = roh.bauteile.some(b => (b.stueckzahl || 1) !== 1);
    for (const b of roh.bauteile) {
      const q = Math.max(0, Math.trunc(Number(b.stueckzahl) || 1));
      flaeche += b.nettoFlaecheMm2 * q;
      laenge += b.schnittlaengeMm * q;
      stiche += b.einstiche * q;
    }
    if (!roh.bauteile.length || (!mehrfach && roh.offeneKonturenAnzahl)) {
      // offene Konturen gehören zu keinem Bauteil – Gesamtwerte der Zeichnung nehmen
      flaeche = roh.nettoFlaecheMm2;
      laenge = roh.schnittlaengeMm;
      stiche = roh.einstiche;
    }
    dxf.breiteMm = roh.breiteMm;
    dxf.hoeheMm = roh.hoeheMm;
    dxf.autoNettoFlaecheM2 = flaeche / 1_000_000;
    dxf.autoBboxFlaecheM2 = roh.bboxFlaecheM2;
    dxf.autoSchnittlaengeMm = laenge;
    dxf.autoEinstiche = stiche;
  }

  if (!dxf.nettoManuell) dxf.nettoFlaecheM2 = dxf.autoNettoFlaecheM2;
  if (!dxf.laengeManuell) dxf.schnittlaengeMm = dxf.autoSchnittlaengeMm;
  if (!dxf.einsticheManuell) dxf.einstiche = dxf.autoEinstiche;
  dxf.bboxFlaecheM2 = dxf.autoBboxFlaecheM2;
}

/** Legt aus einem Analyseergebnis den DXF-Teil des Kalkulationsdokuments an. */
export function ausAnalyse(roh, dateiname, standardBasis) {
  const dxf = {
    dateiname,
    roh,
    einheit: roh.einheit,
    einheitUnsicher: roh.einheitUnsicher,
    einheitBestaetigt: !roh.einheitUnsicher,
    warnungen: roh.warnungen,
    meldungen: roh.meldungen,
    konturenAnzahl: roh.konturenAnzahl,
    loecherAnzahl: roh.loecherAnzahl,
    offeneKonturenAnzahl: roh.offeneKonturenAnzahl,
    flaecheUnsicher: roh.flaecheUnsicher,
    konturen: roh.konturen,
    offeneKetten: roh.offeneKetten,
    bbox: roh.bbox,
    bauteilModus: 'gesamt',
    bauteilNr: 1,
    flaechenBasis: roh.flaecheUnsicher ? 'bbox' : (standardBasis || 'netto'),
    manuelleFlaecheM2: 0,
    nestingFlaecheProStueckM2: 0,
    nettoManuell: false, laengeManuell: false, einsticheManuell: false,
  };
  aggregiere(dxf);
  return dxf;
}

/**
 * Baut die DXF-Karte.
 * @param {object} o { calc, aufAenderung(strukturell), aufNeuBerechnen() }
 */
export function dxfKarte(o) {
  const box = h('div');
  // Verweise auf die Anzeigeelemente. Sie werden bei jeder Neuberechnung
  // aktualisiert, OHNE die Karte neu zu zeichnen – sonst verliert das gerade
  // bearbeitete Eingabefeld den Fokus.
  let anzeige = null;
  let laeuft = false;      // Auswertung läuft gerade

  const neu = () => { anzeige = null; box.textContent = ''; box.appendChild(inhalt()); };

  /** Obergrenze für die Dateigröße. Darüber ist die Auswertung sinnlos langsam. */
  const MAX_MB = 30;

  /**
   * Wertet die Datei in einem eigenen Strang aus, damit die Oberfläche
   * bedienbar bleibt. Kann der Browser keine Modul-Worker (alte WebViews),
   * wird direkt gerechnet — dann blockiert es kurz, liefert aber dasselbe.
   */
  function analysiereNebenbei(text, opts) {
    return new Promise((fertig, schiefgegangen) => {
      let worker;
      try {
        worker = new Worker(new URL('../dxf/worker.js', import.meta.url), { type: 'module' });
      } catch {
        try { fertig(analysiereDxf(text, opts)); } catch (e) { schiefgegangen(e); }
        return;
      }
      const abbruch = setTimeout(() => {
        worker.terminate();
        schiefgegangen(new DxfFehler(`Die Auswertung hat länger als 60 Sekunden gedauert und wurde abgebrochen. Die Zeichnung ist vermutlich zu umfangreich; bitte im CAD auf die Schnittkonturen reduzieren.`));
      }, 60000);
      worker.onmessage = (e) => {
        clearTimeout(abbruch);
        worker.terminate();
        if (e.data.ok) fertig(e.data.ergebnis);
        else schiefgegangen(e.data.art === 'DxfFehler' ? new DxfFehler(e.data.meldung) : new Error(e.data.meldung));
      };
      worker.onerror = () => {
        // Worker nicht nutzbar (z. B. blockiert): still auf den Hauptstrang zurück.
        clearTimeout(abbruch);
        worker.terminate();
        try { fertig(analysiereDxf(text, opts)); } catch (e) { schiefgegangen(e); }
      };
      worker.postMessage({ id: 1, text, opts });
    });
  }

  const laden = async (datei) => {
    if (!datei) return;
    const mb = datei.size / 1024 / 1024;
    if (mb > MAX_MB) {
      toast(`Die Datei ist ${mb.toFixed(1)} MB groß. Verarbeitet werden höchstens ${MAX_MB} MB — bitte im CAD auf die Schnittkonturen reduzieren (Text, Bemaßung und Hilfslinien entfernen).`, 'bad');
      return;
    }
    if (datei.size === 0) { toast('Die Datei ist leer.', 'bad'); return; }

    let text;
    try { text = await leseDatei(datei); }
    catch (e) { toast(e.message, 'bad'); return; }

    const s = store.settings;
    laeuft = true;
    neu();
    try {
      const roh = await analysiereNebenbei(text, {
        standardEinheit: s.dxfEinheitStandard,
        tolMm: s.dxfToleranzMm,
        flachToleranzMm: s.dxfFlachToleranzMm,
        minSegmentMm: s.dxfMinSegmentMm,
        dateiname: datei.name,
      });
      o.calc.dxf = ausAnalyse(roh, datei.name, s.dxfFlaechenBasis);
      o.calc.verbrauch.methode = 'dxf';
      o.calc.verbrauch.proStueck = true;
      if (!o.calc.bauteil) o.calc.bauteil = datei.name.replace(/\.dxf$/i, '');
      laeuft = false;
      o.aufAenderung();
      toast(roh.warnungen.length ? 'DXF geladen – bitte die Hinweise prüfen.' : 'DXF erfolgreich ausgewertet.', roh.warnungen.length ? 'warn' : 'ok');
    } catch (e) {
      laeuft = false;
      neu();
      if (e instanceof DxfFehler) toast(e.message, 'bad');
      else { console.error(e); toast('Die DXF-Datei konnte nicht gelesen werden: ' + (e.message || e), 'bad'); }
    }
  };

  const dateiWaehlen = async () => laden(await waehleDatei('.dxf,application/dxf,image/vnd.dxf,text/plain'));

  function inhalt() {
    if (laeuft) {
      return card('DXF-Import', h('.drop', null,
        h('.d1', { text: 'Zeichnung wird ausgewertet …' }),
        h('.d2', { text: 'Die Auswertung läuft nebenbei, die App bleibt bedienbar.' })));
    }
    const d = o.calc.dxf;
    if (!d) {
      const drop = h('.drop', { onclick: dateiWaehlen },
        h('.d1', { text: 'DXF-Datei auswählen' }),
        h('.d2', { text: 'Fläche, Schnittlänge, Einstiche und Gewicht werden automatisch ermittelt' }),
      );
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('over');
        const f = e.dataTransfer?.files?.[0];
        if (f) laden(f);
      });
      return card('DXF-Import', drop);
    }

    const mat = o.calc.material;
    const inhaltEl = h('div');

    /* --- Einheit bestätigen (§12) --- */
    if (d.einheitUnsicher && !d.einheitBestaetigt) {
      inhaltEl.appendChild(note('warn', d.roh?.autoEinheit?.hinweis || 'Die Einheit der DXF-Datei ist nicht eindeutig.', 'Einheit bestätigen:'));
      inhaltEl.appendChild(h('.grid', null,
        field('Einheit der Zeichnung', select(EINHEITEN, d.einheit, (v) => { einheitWechseln(v); })),
        h('.field', null, h('label', { text: ' ' }),
          h('button.btn.primary.block', { text: 'Einheit bestätigen', onclick: () => { d.einheitBestaetigt = true; o.aufAenderung(); } })),
      ));
    }

    /* --- Vorschau + Kennwerte (§10) --- */
    const canvas = h('canvas.dxfcanvas');
    const kachel = (k) => {
      const wert = h('.v');
      const el = h('.kv', null, h('.k', { text: k }), wert);
      return { el, wert };
    };
    const kacheln = {
      breite: kachel('Breite'), hoehe: kachel('Höhe'),
      netto: kachel('Nettofläche'), laenge: kachel('Schnittlänge'),
      konturen: kachel('Konturen'), einstiche: kachel('Einstiche'),
      gStueck: kachel('Gewicht/Stück'), gGesamt: kachel('Gewicht gesamt'),
    };
    anzeige = { kacheln, hinweise: {} };
    inhaltEl.appendChild(h('.dxfwrap', null, canvas,
      h('.dxfkv', null, ...Object.values(kacheln).map(x => x.el))));
    werteSchreiben();
    setTimeout(() => {
      if (d.konturen && (d.konturen.length || d.offeneKetten?.length)) {
        zeichneVorschau(canvas, { bbox: d.bbox, konturen: d.konturen, offeneKetten: d.offeneKetten || [] });
      } else {
        zeichneVorschau(canvas, null);
      }
    }, 0);

    /* --- Prüfmeldungen (§11) --- */
    if (d.warnungen?.length) inhaltEl.appendChild(note('warn', d.warnungen, 'DXF-Prüfung:'));
    if (d.meldungen?.length) inhaltEl.appendChild(note('info', d.meldungen, 'Hinweise:'));

    /* --- Bauteile (§31) --- */
    if (d.roh?.bauteile?.length > 1) {
      inhaltEl.appendChild(h('.field.mt', null,
        h('label', { text: `${d.roh.bauteile.length} getrennte Bauteile erkannt` }),
        seg([['gesamt', 'Ganze DXF'], ['einzeln', 'Einzelnes Bauteil']], d.bauteilModus, (v) => {
          d.bauteilModus = v; aggregiere(d); o.aufAenderung();
        }),
      ));
      const liste = h('.list');
      for (const b of d.roh.bauteile) {
        const aktiv = d.bauteilModus === 'einzeln' && d.bauteilNr === b.nr;
        liste.appendChild(h('.item' + (d.bauteilModus === 'einzeln' && !aktiv ? '.inaktiv' : ''), {
          onclick: d.bauteilModus === 'einzeln' ? () => { d.bauteilNr = b.nr; aggregiere(d); o.aufAenderung(); } : null,
        },
          h('.ib', null,
            h('.i1', { text: `Bauteil ${b.nr}${aktiv ? ' ✓' : ''}` }),
            h('.i2', { text: `${fmtNum(b.breiteMm, 1)} × ${fmtNum(b.hoeheMm, 1)} mm · ${b.loecher} Löcher · ${fmtNum(b.schnittlaengeMm / 1000, 2)} m Schnitt` }),
          ),
          d.bauteilModus === 'gesamt'
            ? h('div', { style: { width: '86px', flex: '0 0 auto' } },
                num(b.stueckzahl ?? 1, (v) => { b.stueckzahl = v; aggregiere(d); o.aufNeuBerechnen(); },
                  { unit: '×', regel: 'anzahl', 'aria-label': `Stückzahl Bauteil ${b.nr}`,
                    onclick: e => e.stopPropagation() }))
            : h('.ir', null, h('.v', { text: fmtNum(b.nettoFlaecheMm2 / 1_000_000, 4) }), h('.s', { text: 'm²' })),
        ));
      }
      inhaltEl.appendChild(liste);
    }

    /* --- Flächenbasis (§14) --- */
    inhaltEl.appendChild(h('.field.mt', null,
      h('label', { text: 'Welche Fläche zählt für die Materialkosten?' }),
      select(Object.entries(DXF_BASIS).map(([k, v]) => ({
        value: k, label: v,
        disabled: (k === 'tafel' && !(Number(mat?.tafelLaengeMm) > 0)) || (k === 'nesting' && !(d.nestingFlaecheProStueckM2 > 0)),
      })), d.flaechenBasis, (v) => { d.flaechenBasis = v; o.aufAenderung(); }),
      h('.hint', { text: basisHinweis(d, mat) }),
    ));
    if (d.flaechenBasis === 'manuell') {
      inhaltEl.appendChild(field('Materialfläche je Stück',
        num(d.manuelleFlaecheM2, (v) => { d.manuelleFlaecheM2 = v; o.aufNeuBerechnen(); }, { unit: 'm²', regel: 'mass' })));
    }
    if (d.flaechenBasis === 'nesting') {
      inhaltEl.appendChild(note('info', `Aus dem Rechteck-Nesting (Bounding Box, 0°/90°): ${fmtNum(d.nestingFlaecheProStueckM2, 5)} m² je Stück. Echtes Form-Nesting kann mehr Teile unterbringen.`));
    }

    /* --- Manuelle Korrekturen (§11: automatische Werte müssen korrigierbar sein) --- */
    const korrFeld = (label, schluessel, wert, setzen, unit, regel = 'massOptional') => {
      const f = field(label, num(wert, (v) => { setzen(v); o.aufNeuBerechnen(); },
        unit ? { unit, regel } : { regel }), ' ');
      anzeige.hinweise[schluessel] = f.querySelector('.hint');
      return f;
    };
    inhaltEl.appendChild(h('.grid.g3.mt', null,
      korrFeld('Nettofläche', 'netto', d.nettoFlaecheM2, (v) => {
        d.nettoFlaecheM2 = v;
        d.nettoManuell = Math.abs(v - (d.autoNettoFlaecheM2 || 0)) > 1e-9;
      }, 'm²'),
      korrFeld('Schnittlänge', 'laenge', d.schnittlaengeMm, (v) => {
        d.schnittlaengeMm = v;
        d.laengeManuell = Math.abs(v - (d.autoSchnittlaengeMm || 0)) > 1e-6;
      }, 'mm'),
      korrFeld('Einstiche', 'einstiche', d.einstiche, (v) => {
        d.einstiche = v;
        d.einsticheManuell = d.einstiche !== d.autoEinstiche;
      }, '', 'anzahl'),
    ));
    werteSchreiben();

    if (d.nettoManuell || d.laengeManuell || d.einsticheManuell) {
      inhaltEl.appendChild(h('button.btn.small.ghost.mt', {
        text: 'Automatische Werte wiederherstellen',
        onclick: () => {
          d.nettoManuell = d.laengeManuell = d.einsticheManuell = false;
          aggregiere(d); o.aufAenderung();
        },
      }));
    }

    /* --- Kopfzeile der Karte --- */
    const titel = h('span', null, 'DXF: ' + (d.dateiname || 'Zeichnung'),
      h('span.sp', { text: `${d.einheit} · ${d.konturenAnzahl} Konturen` }));
    const karte = card(titel, inhaltEl,
      h('.btnrow.mt', null,
        h('button.btn.small', { text: 'Andere DXF laden', onclick: dateiWaehlen }),
        h('button.btn.small', { text: 'Einheit ändern', onclick: einheitDialog }),
        h('button.btn.small.bad', {
          text: 'DXF entfernen',
          onclick: async () => {
            if (!await bestaetige('DXF entfernen?', 'Die Analyseergebnisse werden aus dieser Kalkulation gelöscht. Die Zeiten und Kosten bleiben erhalten.', 'Entfernen', true)) return;
            o.calc.dxf = null;
            if (o.calc.verbrauch.methode === 'dxf') o.calc.verbrauch.methode = 'rechteck';
            o.aufAenderung();
          },
        }),
      ));
    return karte;
  }

  async function einheitDialog() {
    const d = o.calc.dxf;
    const gewaehlt = await sheet('Einheit der DXF-Datei', (schliessen) => {
      let wahl = d.einheit;
      const s = select(EINHEITEN, wahl, v => { wahl = v; });
      return h('div', null,
        h('p.small.muted', { text: `Erkannt wurde „${d.roh?.autoEinheit?.quelle || 'Standard'}". Bei einer Änderung wird die Zeichnung neu vermessen.` }),
        field('Einheit', s),
        h('.sheetfoot', null,
          h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(null) }),
          h('button.btn.primary', { text: 'Übernehmen', onclick: () => schliessen(wahl) }),
        ));
    });
    if (gewaehlt) einheitWechseln(gewaehlt);
  }

  /** Einheit wechseln: alle Längen und Flächen werden umgerechnet. */
  function einheitWechseln(neueEinheit) {
    const d = o.calc.dxf;
    if (!d || !d.roh) return;
    const alt = EINHEIT_FAKTOR[d.einheit] || 1;
    const neu = EINHEIT_FAKTOR[neueEinheit] || 1;
    const f = neu / alt;
    if (f === 1) { d.einheit = neueEinheit; d.einheitBestaetigt = true; o.aufAenderung(); return; }

    const roh = d.roh;
    const skalPunkte = pts => pts.map(([x, y]) => [x * f, y * f]);
    roh.konturen = roh.konturen.map(k => ({ ...k, pts: skalPunkte(k.pts), flaeche: k.flaeche * f * f, laenge: k.laenge * f }));
    roh.offeneKetten = roh.offeneKetten.map(k => ({ ...k, pts: skalPunkte(k.pts), laenge: k.laenge * f }));
    for (const key of ['minX', 'minY', 'maxX', 'maxY', 'breite', 'hoehe']) roh.bbox[key] *= f;
    roh.breiteMm *= f; roh.hoeheMm *= f;
    roh.nettoFlaecheMm2 *= f * f; roh.nettoFlaecheM2 *= f * f; roh.bboxFlaecheM2 *= f * f;
    roh.schnittlaengeMm *= f;
    for (const b of roh.bauteile) {
      b.breiteMm *= f; b.hoeheMm *= f;
      b.nettoFlaecheMm2 *= f * f; b.schnittlaengeMm *= f;
      for (const key of ['minX', 'minY', 'maxX', 'maxY', 'breite', 'hoehe']) b.bbox[key] *= f;
    }
    d.einheit = neueEinheit;
    d.einheitUnsicher = false;
    d.einheitBestaetigt = true;
    d.konturen = roh.konturen;
    d.offeneKetten = roh.offeneKetten;
    d.bbox = roh.bbox;
    d.nettoManuell = d.laengeManuell = false;
    aggregiere(d);
    o.aufAenderung();
    toast(`Einheit auf ${neueEinheit} gesetzt – Maße wurden umgerechnet.`, 'ok');
  }

  /**
   * Schreibt die abgeleiteten Werte in die vorhandenen Anzeigeelemente.
   * Wird bei jeder Neuberechnung aufgerufen – dadurch stimmen Gewicht,
   * Stückzahl und die Marken „automatisch/manuell" immer, ohne dass die
   * Karte neu aufgebaut werden muss.
   */
  function werteSchreiben() {
    const d = o.calc.dxf;
    if (!d || !anzeige) return;
    const mat = o.calc.material;
    const dicke = Number(mat?.dickeMm) || 0;
    const dichte = Number(mat?.dichte) || 0;
    const stk = Math.max(1, Math.trunc(Number(o.calc.stueckzahl) || 1));
    const gStueck = gewichtKg(d.nettoFlaecheM2 || 0, dicke, dichte);
    const k = anzeige.kacheln;

    const setz = (ziel, wert, einheit) => {
      ziel.wert.textContent = '';
      ziel.wert.appendChild(document.createTextNode(wert));
      if (einheit) ziel.wert.appendChild(h('small', { text: ' ' + einheit }));
    };
    setz(k.breite, fmtNum(d.breiteMm || 0, 2), 'mm');
    setz(k.hoehe, fmtNum(d.hoeheMm || 0, 2), 'mm');
    setz(k.netto, fmtNum(d.nettoFlaecheM2 || 0, 5), 'm²');
    setz(k.laenge, fmtNum((d.schnittlaengeMm || 0) / 1000, 3), 'm');
    setz(k.konturen, String(d.konturenAnzahl || 0), `davon ${d.loecherAnzahl || 0} Löcher`);
    setz(k.einstiche, String(d.einstiche || 0), d.einsticheManuell ? 'manuell' : 'geschätzt');
    setz(k.gStueck, dicke && dichte ? fmtNum(gStueck, 3) : '–', 'kg');
    setz(k.gGesamt, dicke && dichte ? fmtNum(gStueck * stk, 2) : '–', `kg (${stk} Stk)`);

    const marke = (feld, manuell, autoText) => {
      const el = anzeige.hinweise[feld];
      if (!el) return;
      el.textContent = manuell ? 'manuell korrigiert' : autoText;
      el.classList.toggle('warn', !!manuell);
    };
    marke('netto', d.nettoManuell, 'automatisch aus der DXF');
    marke('laenge', d.laengeManuell, 'automatisch aus der DXF');
    marke('einstiche', d.einsticheManuell, 'geschätzt aus den Konturen');
  }

  box._neu = neu;
  box._werte = werteSchreiben;
  box._dateiWaehlen = dateiWaehlen;
  neu();
  return box;
}

function basisHinweis(d, mat) {
  switch (d.flaechenBasis) {
    case 'netto': return d.flaecheUnsicher
      ? 'Achtung: wegen offener Konturen ist die Nettofläche unsicher.'
      : 'Nur die tatsächliche Bauteilfläche – der Verschnitt wird über den Verschnittaufschlag abgedeckt.';
    case 'bbox': return `Umschließendes Rechteck ${fmtNum(d.breiteMm, 1)} × ${fmtNum(d.hoeheMm, 1)} mm = ${fmtNum(d.bboxFlaecheM2 || 0, 5)} m². Rechnet den Verschnitt großzügig mit ein.`;
    case 'tafel': return mat?.tafelLaengeMm > 0
      ? `Komplette Tafel ${fmtNum(mat.tafelLaengeMm, 0)} × ${fmtNum(mat.tafelBreiteMm, 0)} mm je Stück.`
      : 'Für dieses Material ist kein Tafelmaß hinterlegt.';
    case 'manuell': return 'Eigener Wert je Stück.';
    case 'nesting': return 'Ergebnis aus dem Rechteck-Nesting.';
    default: return '';
  }
}
