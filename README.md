# LaserKalk

Kalkulations-App für **Laserschneiden und Blechteile** in einem Metallbaubetrieb.
Material · DXF-Auswertung · Zeiten · nachvollziehbarer Verkaufspreis.

Vollständig offline, ohne Backend, ohne Tracking, ohne Berechtigungen.
Heller Hintergrund als Standard, Dunkelmodus unter Einstellungen → Darstellung.
Sprache: Deutsch. Alle Preise und Sätze werden vom Betrieb selbst gepflegt.

> Das technische Konzept — Datenmodell, DXF-Verfahren, bekannte Grenzen —
> steht in **[ARCHITEKTUR.md](ARCHITEKTUR.md)**.

---

## Was die App kann (Version 1)

| Bereich | Umfang |
|---|---|
| **Neue Kalkulation** | Grunddaten, Material, Verschnitt, Materialaufschlag, Zeiten, Gas, Zusatzkosten, Gewinn, Mindestauftragswert, MwSt. — Preis live |
| **Schnellkalkulation** | Material, Verbrauch, Stückzahl, CAD/Laser/Bediener/Entgraten → Gesamtpreis und Preis/Stück |
| **DXF-Kalkulation** | Datei laden → Fläche, Löcher, Schnittlänge, Einstiche, Gewicht, geschätzte Laserzeit → Verkaufspreis |
| **Materialien** | Gruppe/Werkstoff/Stärke, Tafelmaß, Dichte, drei Preisarten (Tafel/kg/m²) mit automatischer Ableitung, Lieferant, Preisdatum, Suche und Filter |
| **Einstellungen** | Stundensätze, Aufschläge, Gewinnmodus, Bearbeitungsarten, Gase, Materialgruppen & Dichten, Schnittparameter, Maschinenkalkulation, DXF-Toleranzen |
| **Kalkulationen** | Verlauf mit Suche, öffnen, bearbeiten, duplizieren, löschen |
| **Backup** | Vollbackup JSON, Materialien und Kalkulationen einzeln als JSON und CSV (Excel), Wiederherstellung mit Prüfsumme |

Vorbereitet, aber bewusst noch nicht ausgeliefert: echtes Form-Nesting,
Restblechverwaltung, Angebots-PDF, Kundendatenbank.

---

## Starten

### Im Browser (Entwicklung und Werkstatt-PC)

```bash
npx http-server laserkalk/www -p 4611 -c-1
# dann http://localhost:4611 öffnen
```

Ein Server ist nötig, weil die App aus ES-Modulen besteht — über `file://`
blockiert der Browser das Laden.

### Auf dem Android-Handy ohne Store (PWA)

Die App im Chrome des Handys öffnen und **„Zum Startbildschirm hinzufügen"**
wählen. Danach läuft sie offline wie eine installierte App; der Service Worker
(`www/sw.js`) hält alle Dateien im Cache.

### Als echte Android-App (Capacitor)

Gleiche Toolchain wie Spanwerk, aber eigene App-ID:

```bash
npm install
npx cap add android --config laserkalk/capacitor.config.json
npx cap sync android --config laserkalk/capacitor.config.json

$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
cd android; .\gradlew bundleRelease assembleRelease --no-daemon
```

Die App braucht **keine Berechtigungen** — die DXF-Auswahl läuft über das
normale Dateifeld des WebViews.

---

## Tests

```bash
cd laserkalk
node --test tests/*.test.js
```

70 Tests über Geldrechnung, Kalkulationskern, Materialableitung,
DXF-Parser und -Geometrie, Nesting, Maschinenkalkulation, Backup und CSV.
Sie laufen ohne Browser, weil Logik und Oberfläche getrennt sind.

Enthalten ist unter anderem die Beispielrechnung aus der Anforderung
(Material 30 € + 25 %, CAD 10 min, Laser 120 min, Entgraten 15 min):
Ergebnis **125,42 € netto**, **12,54 € je Stück** — auf den Cent.

---

## Symbole neu erzeugen

```bash
node laserkalk/icon-gen.js
```

Erzeugt `www/icons/icon.svg` sowie die PNGs 192/512/maskable ohne externe
Abhängigkeiten (eigener Rasterizer + PNG-Encoder über `node:zlib`).

---

## Erste Schritte im Betrieb

1. **Einstellungen → Stundensätze** prüfen (Laser 30 €/h, CAD 70 €/h,
   Bediener 65 €/h, Entgraten 65 €/h sind nur Startwerte).
2. **Einstellungen → Gewinn**: entscheiden, ob die Stundensätze bereits
   Verkaufspreise sind (Modus B) oder ein Gewinnaufschlag draufkommt (Modus A).
   Das verhindert eine doppelte Gewinnrechnung.
3. **Materialien**: die eigenen Bleche mit Einkaufspreisen anlegen. Über
   „Vorlage erzeugen" entsteht die Struktur (S235JR, 1.4301, AlMg3) — **ohne
   Preise**, die trägt der Betrieb selbst ein. Alternativ per CSV importieren.
4. **Einstellungen → Schnittparameter**: die mitgelieferten
   Schnittgeschwindigkeiten sind grobe Richtwerte und gehören an der eigenen
   Maschine gemessen. Davon hängt die geschätzte Laserzeit ab.
5. **Einstellungen → Backup**: nach der Ersteinrichtung ein Vollbackup
   speichern und regelmäßig wiederholen.

---

## Wichtige Grundsätze

- **Geld ist immer ganzzahlig in Cent.** Es gibt keinen Gleitkomma-Euro im
  System; Prozente laufen über Basispunkte. Jede Position wird gerundet und
  dann summiert, damit die Detailaufstellung exakt zur Summe passt.
- **Bei DXF wird nicht geraten.** Unklare Einheiten müssen bestätigt werden,
  offene Konturen, doppelte Linien und zu kurze Segmente werden gemeldet, und
  jeder automatisch ermittelte Wert (Fläche, Schnittlänge, Einstiche,
  Laserzeit) ist manuell überschreibbar. Die App schreibt sichtbar dazu, ob
  ein Wert geschätzt oder eingegeben ist.
- **Kalkulationen sind reproduzierbar.** Das Material wird als Kopie in der
  Kalkulation gespeichert. Ein späterer Preisänderung im Materialstamm ändert
  ein altes Angebot nicht mehr.
- **Startwerte sind nur Startwerte.** Nach dem ersten Start kommt jeder Satz
  und jeder Preis aus der Datenbank.
