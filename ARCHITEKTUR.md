# LaserKalk — Architektur & technisches Konzept

Kalkulations-App für Laserschneiden und Blechteile (Metallbaubetrieb).
Version 1. Sprache: Deutsch. Alles offline, keine Cloud, kein Tracking.

---

## 1. Analyse der Anforderungen — die harten Punkte

| Anforderung | Bewertung | Konsequenz |
|---|---|---|
| Geldberechnung ohne Float-Fehler (§42) | kritisch | **Alles intern in ganzen Cent (Integer)**, Prozente als Basispunkte. Nie `0.1+0.2`. |
| Reproduzierbare Kalkulation (§36) | kritisch | Kalkulationskern ist eine **reine Funktion** `berechne(doc, settings)`. Gleicher Input ⇒ gleicher Output, ohne DOM, ohne Datum, ohne Zufall. Vollständig unit-getestet. |
| Dauerhafte Speicherung (§39, §43) | kritisch | IndexedDB über eine **austauschbare Adapter-Schicht** (siehe 3.). |
| Preise/Sätze nicht hart im Code (§37) | kritisch | Nur **Startwerte** in `core/defaults.js`, einmalig beim ersten Start in die DB geschrieben. Danach ausschließlich DB-Werte. |
| DXF-Analyse (§9–§16, §31) | riskant | Eigener Parser + Geometrie-Kern, siehe 5. **Nie stillschweigend raten** — jede Unsicherheit wird als Warnung ausgegeben und ist manuell überschreibbar. |
| Nesting (§32), Restbleche (§33) | Zukunft | Schnittstellen + Datenmodell vorhanden, V1 liefert nur rechteckiges Raster-Nesting als Vorschau. |

---

## 2. Technische Architektur

**Plattform:** Web-App (HTML/CSS/Vanilla-JS, ES-Module) → als **PWA** direkt auf Android
installierbar, und identisch als **Capacitor**-App paketierbar (gleiche Codebasis wie
Spanwerk, gleicher Werkzeugkasten, kein zweites Framework im Haus).

Warum kein React/Flutter/native Android:
- Der Betrieb hat bereits eine Capacitor-Toolchain (Spanwerk) — gleiche Build-Wege, gleiches Signieren.
- Kein Build-Schritt nötig: die App läuft direkt aus `www/`, ist offline-fähig und in 3 Sekunden auf jedem Gerät (Handy, Tablet, Werkstatt-PC) im Browser prüfbar.
- Die Kalkulationslogik ist in Node testbar (`npm test`) — dasselbe Modul, das im Browser läuft.

**Strikte Schichtentrennung** (§43):

```
www/js/
  core/    money.js util.js db.js repos.js defaults.js settings.js   ← Daten + Geld
  calc/    engine.js nesting.js                                      ← Kalkulationslogik (rein, DOM-frei)
  dxf/     parser.js geometry.js analyze.js render.js                ← DXF (rein, DOM-frei außer render)
  io/      backup.js                                                 ← Export/Import/Backup
  ui/      app.js home.js calc.js quick.js dxfcalc.js
           materials.js history.js settings.js components.js         ← nur Oberfläche
```

Regel: `ui/` darf `core/`, `calc/`, `dxf/`, `io/` benutzen — **niemals umgekehrt**.
Deshalb sind Kalkulation und DXF-Auswertung ohne Browser testbar.

---

## 3. Datenhaltung — warum IndexedDB statt SQLite

Gefordert war „lokale Datenbank, z. B. SQLite". Bewertung:

- **SQLite** im WebView braucht ein Capacitor-Plugin (`@capacitor-community/sqlite`). Das
  funktioniert nur nativ — im Browser und in der PWA gäbe es die App dann gar nicht,
  und jede Änderung müsste über einen Android-Build getestet werden.
- **IndexedDB** ist in Android-WebView, Chrome, Safari und Capacitor identisch verfügbar,
  transaktional, dauerhaft (übersteht App-Schließen, Neustart, Update) und braucht keine
  Berechtigung.

Deshalb: **IndexedDB**, aber hinter einer Adapter-Schnittstelle (`core/db.js`).
Der Adapter kennt nur `get/put/delete/all/bulkPut/clear` pro Store. Ein
`SqliteAdapter` kann später ohne Änderung an Repos, Logik oder UI eingehängt werden;
für die Tests existiert bereits ein `MemoryAdapter` — der Beweis, dass die Abstraktion trägt.

Zusätzlich: **automatisches Sicherungsnetz** — nach jedem Schreibvorgang wird ein
komprimiertes JSON-Backup in `localStorage` gespiegelt. Falls IndexedDB je vom System
geleert wird, bietet die App beim Start die Wiederherstellung an.

### Datenbankschema (Stores)

```
settings           1 Dokument 'app'
  laserSatzCent, cadSatzCent, bedienerSatzCent, entgratSatzCent,
  materialAufschlagBp, verschnittBp, gewinnBp, gewinnModus('aufschlag'|'inklusive'),
  mwstBp, mindestwertCent, mindestwertAktiv, nebenzeitSek, dxfEinheitStandard,
  waehrung, theme, letzteNummer, ...

materialGroups     id, name, dichteStd (kg/m³), sort, aktiv
                   → Stahl 7850 · Edelstahl 7900 · Aluminium 2700 · Corten 7850 ·
                     verzinkt 7850 · Sonstige 7850   (alle frei änderbar)

materials          id, groupId, werkstoff, bezeichnung, dickeMm,
                   tafelLaengeMm, tafelBreiteMm,
                   ekTafelCent, ekProKgCent, preisProM2Cent,   ← abgeleitet, überschreibbar
                   dichte, gewichtProTafelKg,                  ← abgeleitet
                   lieferant, artikelnummer, preisDatum, notizen, aktiv

cutParams          id, groupId|null, werkstoff, dickeMm, gas, maschine,
                   vSchnittMmMin, piercingSek, notizen
                   → Auswahl per Bestenpassung (Werkstoff+Dicke+Gas+Maschine)

processes          id, name, satzCent, aktiv, sort      (Entgraten, Schleifen, …)
gases              id, name, modus('inklusive'|'proStunde'|'proMinute'|'pauschal'), preisCent
machines           id, name, verrechnungssatzCent, kalkulation{...}  (§38)
calculations       vollständiges Kalkulationsdokument (siehe 4.)
remnants           Restbleche (§33 – Schema vorhanden, UI folgt)
meta               Schemaversion, Zähler
```

### Kalkulationsdokument

```jsonc
{
  "id": "...", "nummer": "K-2026-0007", "createdAt": …, "updatedAt": …,
  "kunde": "", "projekt": "", "bauteil": "", "angebotsnummer": "", "datum": "2026-08-30",
  "stueckzahl": 10, "notiz": "",
  "materialId": "...", "material": { …Snapshot zum Zeitpunkt der Kalkulation… },
  "verbrauch": { "methode": "rechteck|kosten|tafeln|gewicht|flaeche|dxf",
                 "laengeMm":0,"breiteMm":0,"kostenCent":0,"tafeln":0,
                 "gewichtKg":0,"flaecheM2":0,"proStueck":true },
  "dxf": { "…Analyse…", "flaechenBasis":"netto|bbox|manuell|tafel|nesting" },
  "verschnittBp": 1000, "materialAufschlagBp": 2500,
  "zeiten": [ { "art":"laser|cad|bediener|prozess", "name":"", "minuten":0,
                "satzCent":0, "modus":"einmalig|proStueck|gesamt", "quelle":"auto|manuell" } ],
  "gas": { "gasId":"", "modus":"", "preisCent":0, "minutenQuelle":"laser" },
  "zusatz": [ { "bezeichnung":"","menge":1,"einheit":"Stk","einzelpreisCent":0,"modus":"einmalig|proStueck" } ],
  "gewinnBp": 1500, "gewinnAktiv": true,
  "mwstBp": 2000, "mindestwertCent": 3000, "mindestwertAktiv": true
}
```

**Wichtig:** Das Material wird als *Snapshot* mitgespeichert. Ändert sich morgen der
Einkaufspreis, bleibt eine alte Kalkulation trotzdem nachvollziehbar — genau das
verlangt §36 („jederzeit nachvollziehbar, wie der Verkaufspreis entstanden ist").

---

## 4. Geldberechnung (§42)

- Jeder Betrag ist ein **Integer in Cent**. Es gibt keinen `float`-Euro im System.
- Stundensätze: Cent pro Stunde. `kosten = round(minuten * satzCent / 60)`.
- Prozente: **Basispunkte** (25 % = 2500 bp). `zuschlag = round(betrag * bp / 10000)`.
- Rundung: kaufmännisch, halb vom Null weg (`roundHalfAwayFromZero`).
- Jede *Position* wird gerundet und dann summiert — so stimmt die angezeigte
  Detailaufstellung exakt mit der Summe überein (keine „krummen" Restcents).
- Eingaben akzeptieren deutsches und englisches Format (`1.234,56` und `1234.56`).

---

## 5. DXF — Bibliothek, Auswertung, Grenzen

### 5.1 Welche Bibliothek?

Kandidaten: `dxf-parser` (npm), `dxf` (npm), `three.js`-DXF-Loader.
**Entscheidung: eigener, schlanker Parser** (`dxf/parser.js`, ~500 Zeilen). Gründe:

1. Alle npm-Kandidaten setzen einen Bundler voraus und ziehen 200–800 kB in eine
   App, die offline auf einem Werkstatt-Handy laufen soll.
2. `dxf-parser` liefert nur die *Entitäten* — Konturschluss, Innen/Außen-Erkennung,
   Flächen und Schnittlänge müsste man ohnehin selbst rechnen. Das ist der eigentliche
   Aufwand, nicht das Lesen der Datei.
3. Der DXF-Gruppencode-Aufbau (Paare aus Code + Wert) ist bewusst einfach; für die
   relevanten Entitäten ist ein eigener Parser überschaubar **und vollständig testbar**.
4. Keine Lizenz-/Update-Abhängigkeit für eine geschäftskritische App.

Unterstützte Entitäten: `LINE`, `LWPOLYLINE` (inkl. Bulge/Bögen), `POLYLINE`+`VERTEX`,
`ARC`, `CIRCLE`, `ELLIPSE` (inkl. Teilbögen), `SPLINE` (B-Spline-Auswertung über
Knotenvektor, Fallback über Fit-Points), `INSERT` (Blockreferenz mit Verschiebung,
Skalierung, Drehung, Zeilen-/Spalten-Arrays, rekursiv).
Ignoriert (mit Hinweis): `TEXT`, `MTEXT`, `DIMENSION`, `LEADER`, `HATCH`, `POINT`,
Layer `DEFPOINTS`. Binäres DXF und DWG werden **erkannt und klar abgelehnt** statt
falsch interpretiert.

### 5.2 Fläche, Innenausschnitte, Schnittlänge, Gewicht

1. **Diskretisieren:** Jede Entität wird in Polygonzüge zerlegt. Bögen/Kreise/Splines
   werden mit einer Sehnenhöhen-Toleranz von 0,02 mm abgeflacht — der Fehler auf die
   Fläche liegt damit weit unter der Fertigungstoleranz.
2. **Konturen bilden:** Alle Segmente kommen in ein räumliches Raster; Endpunkte
   werden mit einer Toleranz (Standard 0,01 mm, adaptiv zur Bauteilgröße) verkettet.
   Ergebnis: geschlossene Ketten (Konturen) und offene Ketten (Fehler → Warnung).
3. **Fläche:** Gauß'sche Trapezformel (Shoelace) je geschlossener Kontur.
4. **Innen/Außen:** Konturen werden nach Fläche absteigend sortiert; für jede Kontur
   wird über einen garantiert *innen* liegenden Punkt (Scanline-Verfahren, funktioniert
   auch bei konkaven Formen) die Verschachtelungstiefe bestimmt.
   Tiefe 0 = Außenkontur, 1 = Loch, 2 = Insel im Loch, …
   **Nettofläche = Σ Fläche × (Tiefe gerade ? +1 : −1)** — Löcher werden also korrekt
   abgezogen, Inseln in Löchern korrekt wieder addiert (§13).
5. **Schnittlänge:** Summe aller Segmentlängen, getrennt nach Außen- und Innenkonturen (§15).
6. **Einstiche:** 1 pro geschlossener Kontur + 1 pro offener Kette; manuell korrigierbar (§16).
7. **Gewicht:** `Nettofläche [m²] × Dicke [m] × Dichte [kg/m³]` — Dichte kommt aus der
   Materialdatenbank, nicht aus dem Code (§13).
8. **Mehrere Bauteile (§31):** Jede Kontur der Tiefe 0 ist ein eigenes Bauteil; die
   Kinder ungerader Tiefe darunter sind seine Löcher. Die App zeigt die erkannten
   Bauteile an und lässt wählen: „gesamte DXF als ein Teil" oder „Bauteile einzeln",
   dann je Bauteil mit eigener Stückzahl.

### 5.3 Prüfungen und Warnungen (§11)

Offene Konturen · doppelte Segmente · kollineare Überlappungen · Segmente < 0,05 mm ·
Nullflächen · Bauteil größer als die gewählte Tafel · unbekannte Einheit ·
nicht unterstützte Entitäten. Jede Warnung nennt **Anzahl und Auswirkung**, z. B.:
„Achtung: 2 offene Konturen erkannt. Flächen- und Gewichtsberechnung möglicherweise
ungenau." Bei offenen Konturen wird die Nettofläche als **unsicher** markiert und die
Bounding-Box als sichere Alternative vorgeschlagen.

### 5.4 Einheiten (§12)

Reihenfolge: `$INSUNITS` (1=inch, 4=mm, 5=cm, 6=m) → `$MEASUREMENT` → Plausibilitäts-
Heuristik über die Bauteilgröße. Ist der Wert **nicht eindeutig**, wird die Einheit
**nicht geraten**: Die App fragt den Benutzer und schlägt den Betriebsstandard mm vor.
Die Heuristik erscheint nur als Hinweis („Größe 12 × 8 — für mm ungewöhnlich klein").

### 5.5 Was technisch heikel bleibt — ehrliche Einschätzung

- **Splines:** rational (NURBS mit Gewichten) wird als nicht-rational genähert. Bei
  reinen Blechteilen praktisch irrelevant, wird aber in den Warnungen erwähnt.
- **Verschachtelte INSERTs mit ungleichmäßiger Skalierung** verzerren Bögen; wird erkannt
  und gemeldet.
- **Laserzeit ist immer eine Schätzung.** Ohne Kenntnis der Maschinensteuerung fehlen
  Beschleunigungsrampen, Eckenverzögerung und Verfahrwege zwischen Konturen. Deshalb:
  Schnittparameter-DB + einstellbare Nebenzeit + **jederzeit manuell überschreibbar**,
  und die App schreibt sichtbar dazu, ob der Wert geschätzt oder eingegeben ist (§18).
- **Überlappungserkennung** ist auf ein räumliches Raster begrenzt (Laufzeit); sie findet
  praxisrelevante Dubletten, ist aber kein CAD-Prüfprogramm.
- **Nesting** ist in V1 bewusst nur ein rechteckiges Raster (Bounding-Box, 0°/90°).
  Echtes Form-Nesting ist ein eigenes Projekt — die Schnittstelle steht (§32).

---

## 6. Umsetzung als Android-App

1. **Sofort nutzbar:** `www/` ist eine installierbare PWA (Manifest + Service Worker,
   vollständig offline). Auf Android über Chrome „Zum Startbildschirm hinzufügen".
2. **Als echte App:** Capacitor 8, gleiche Toolchain wie Spanwerk:
   `npx cap add android` mit `webDir: laserkalk/www`, eigene `appId`
   (`at.warscher.laserkalk`), signierter Gradle-Build. Siehe `laserkalk/README.md`.
   Kein Plugin, keine Berechtigung, kein Backend — die Datei-Auswahl für DXF läuft
   über das normale `<input type="file">` des WebViews.

---

## 7. Navigation & Oberfläche (§40)

```
STARTSEITE (6 große Kacheln)
├── NEUE KALKULATION  → Schritte: Grunddaten · Material · Zeiten · Zusatz · Details
├── SCHNELLKALKULATION → eine Seite, sofort Gesamtpreis + Preis/Stück
├── DXF-KALKULATION    → Datei → Analyse+Vorschau → Material → Stück → Preis
├── KALKULATIONEN      → Liste, Suche, öffnen/bearbeiten/duplizieren/löschen
├── MATERIALIEN        → Liste, Suche, Filter, anlegen/bearbeiten/duplizieren/löschen
└── EINSTELLUNGEN      → Sätze · Aufschläge · Bearbeitungsarten · Gase ·
                         Materialgruppen/Dichten · Schnittparameter ·
                         Maschinenkalkulation · Backup/Export
```

- Immer sichtbare **Preisleiste** am unteren Rand: `GESAMT NETTO` und `PREIS/STÜCK`,
  live bei jeder Eingabe (§2, §40).
- Touch-Ziele ≥ 48 px, Eingabefelder 16 px Schriftgröße (verhindert iOS-Zoom),
  `inputmode="decimal"` für Zifferntastatur, Dark- und Light-Mode.
- Ab 900 px Breite zweispaltig (Tablet/PC), sonst einspaltig.

---

## 8. Verbesserungsvorschläge (über die Anforderung hinaus)

1. **Material-Snapshot je Kalkulation** (siehe 3.) — sonst ändert ein Preisupdate
   rückwirkend alte Angebote.
2. **Gewinnmodus-Schalter global** (§26 A/B) — verhindert doppelte Gewinnrechnung
   systematisch statt per Erinnerung.
3. **Positionsweise „einmalig / pro Stück / Gesamtzeit"** (§28) statt einer globalen
   Regel — nur so stimmt die Kalkulation bei 1 Stück *und* bei 500 Stück.
4. **Automatische Angebotsnummer** (`K-JJJJ-####`, Zähler in den Einstellungen).
5. **„Was wäre wenn"-Stückzahlstaffel**: Preis/Stück bei 1 / 5 / 10 / 25 / 50 / 100
   direkt in den Kalkulationsdetails — der häufigste Rückfragefall am Telefon.
6. **Deckungsbeitrag-Zeile** (VK − Material-EK − Fremdleistung) als Frühwarnung.
7. **Automatisches Backup** ins `localStorage` nach jedem Schreibvorgang.
8. **Prüfsumme/Version im Export**, damit ein Restore nicht stillschweigend
   inkompatible Daten einspielt.

---

## 9. Entwicklungsreihenfolge (§45) — Stand Version 1

Umgesetzt: 1 Datenbank · 2 Materialdatenbank · 3 Einstellungen · 4 normale Kalkulation ·
5 Schnellkalkulation · 6 DXF-Import · 7 Geometrieanalyse · 8 Fläche · 9 Gewicht ·
10 Schnittlänge · 11 geschätzte Laserzeit · 12 Nachbearbeitungen · 13 Historie ·
14 Duplizieren · 15 Backup/Restore.

Vorbereitet, nicht ausgeliefert: Nesting (Raster-Vorschau vorhanden), Restbleche
(Schema vorhanden), Angebots-PDF, Kundendatenbank, Statistiken.
