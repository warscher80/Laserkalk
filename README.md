# LaserKalk

Kalkulations-App für **Laserschneiden und Blechteile** in einem Metallbaubetrieb.
Material · DXF-Auswertung · Zeiten · nachvollziehbarer Verkaufspreis.

Rechnet vollständig offline, ohne Backend und ohne Tracking. Die einzige
Netzverbindung ist die **Update-Prüfung** — ein einfacher Abruf einer kleinen
Textdatei ohne Kennung, abschaltbar unter Einstellungen → Updates.
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
| **Updates** | Meldet neue Versionen; als Web-App aktualisiert sie sich selbst nach Bestätigung |

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

### Als Web-App auf Handy oder Tablet (Android und iPhone)

Die App liegt unter **https://warscher80.github.io/Laserkalk/**
(GitHub Pages, Zweig `gh-pages`).

- **Android:** in Chrome öffnen → Menü → „Zum Startbildschirm hinzufügen".
- **iPhone/iPad:** in **Safari** öffnen (Chrome kann das auf iOS nicht) →
  Teilen → „Zum Home-Bildschirm".

Danach läuft sie offline wie eine installierte App; der Service Worker
(`www/sw.js`) hält alle Dateien im Cache.

**Wichtig auf iOS:** Solange die App nur ein Lesezeichen ist, kann Safari den
Speicher nach etwa einer Woche ohne Benutzung leeren. Als Home-Bildschirm-App
bleiben die Daten erhalten. Die App weist im Backup-Bereich darauf hin.

**Neu veröffentlichen:** `www/` in den Zweig `gh-pages` schieben und dabei
`CACHE` in `www/sw.js` erhöhen — sonst liefert der Service Worker weiter die
alten Dateien aus.

### Als echte Android-App (Capacitor)

Gleiche Toolchain wie Spanwerk, aber eigene App-ID `at.warscher.laserkalk`.
Das Android-Projekt liegt in `laserkalk/android/` und ist im Repo enthalten.

**Wichtig:** Die Capacitor-CLI 8 kennt kein `--config`. Alle `cap`-Befehle
müssen deshalb **aus dem Ordner `laserkalk/`** laufen — dort liegt die eigene
`capacitor.config.json`. Aus dem Repo-Wurzelverzeichnis würde Capacitor die
Spanwerk-Konfiguration verwenden.

```powershell
npm install                    # einmalig, im Repo-Wurzelverzeichnis

cd laserkalk
npx cap sync android           # Web-Assets ins Android-Projekt kopieren

$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew assembleDebug        # Test-APK (Debug-Signatur)
.\gradlew bundleRelease assembleRelease   # Store-Build, braucht keystore.properties
```

Ergebnisse:
`android\app\build\outputs\apk\debug\app-debug.apk` bzw.
`…\apk\release\app-release.apk` und `…\bundle\release\app-release.aab`.

Nach Änderungen an Logo oder Farben `node icon-gen.js` ausführen — das
erzeugt die PWA-Symbole **und** die Android-Launcher-Symbole und
Startbildschirme neu.

Bei App-Änderungen `versionCode` und `versionName` in
`laserkalk/android/app/build.gradle` erhöhen (aktuell 1 / 1.0.0).

Die App braucht **keine Berechtigungen** außer `INTERNET` (von Capacitor für
den lokalen WebView-Server gesetzt) — die DXF-Auswahl läuft über das normale
Dateifeld des WebViews.

#### Signieren für den Store

Ein Release-Build braucht einen eigenen Upload-Keystore für
`at.warscher.laserkalk`. Der Spanwerk-Keystore gehört zu einer anderen
App-ID und kann dafür **nicht** verwendet werden. Der Keystore und
`laserkalk/android/keystore.properties` gehören nicht ins Repo
(beide sind in `.gitignore`).

---

## Tests

```bash
node --test tests/*.test.js      # im Ordner laserkalk/
```

**189 Tests** über Geldrechnung, Eingabeprüfung, Kalkulationskern,
Materialableitung, Laserzeit, DXF-Parser und -Geometrie, Nesting,
Maschinenkalkulation, Backup/Wiederherstellung, CSV und Update-Prüfung.
Sie laufen ohne Browser, weil Logik und Oberfläche getrennt sind.

Verankert sind unter anderem:

| Datei | Was sie absichert |
|---|---|
| `kalkulation.test.js` | Alle Verbrauchsmethoden, Verschnitt, Aufschlag, Gewinn, Mindestwert, MwSt., Zeitmodi, Gas, Zusatzkosten, Staffel, Rundung, sehr kleine und sehr große Beträge |
| `dxf-referenz.test.js` | 20 erzeugte Referenz-DXF mit von Hand hergeleiteten Sollwerten |
| `laserzeit.test.js` | Einheiten und Randfälle der Zeitschätzung, Auswahl der Schnittparameter |
| `eingaben.test.js` | Zahlenformate, mitkopierte Einheiten, abgelehnter Unsinn |
| `io.test.js` | Backup-Prüfung, atomare Wiederherstellung |
| `update.test.js` | Version, Gradle-Datei, Service-Worker-Cache und Dateiliste dürfen nicht auseinanderlaufen |

**Der Regressionsfall des Betriebs** (S235JR 2 mm, Tafel 2500×1250 zu 100,00 €,
Bauteil 1000×500 mm, 10 Stück, 10 % Verschnitt, 25 % Aufschlag, CAD 10 min,
Laser 2 min/Stk, Bediener 15 min, Entgraten 1 min/Stk, 15 % Gewinn, 20 % MwSt.)
steht in `kalkulation.test.js` und muss auf den Cent ergeben:
Material-EK **160,00 €** · Material-VK **220,00 €** · Zeitkosten **48,75 €** ·
Kalkulationspreis **268,75 €** · **309,06 € netto** · **30,91 € je Stück** ·
**370,87 € brutto**.

### Wo gerundet wird

Kaufmännisch (halb vom Nullpunkt weg) und nur an diesen Stellen: Materialkosten,
Verschnitt, Materialaufschlag, jede Zeitposition, Gas, jede Zusatzposition,
Gewinn, MwSt., Preis je Stück. **Jede Position wird einzeln gerundet und erst
dann summiert** — deshalb passt die Detailaufstellung auf den Cent zur Summe.
Mengen (Minuten, m², kg) werden vor der Geldrechnung von Gleitkomma-Rauschen
befreit (`glatt()`), sonst kippt z. B. 0,7 min × 3 Stück eine halbe
Cent-Rundung.

---

## Auto-Update

Die App aktualisiert sich auf zwei Wegen — je nachdem, wie sie installiert ist.

### Als Web-App / PWA: aktualisiert sich selbst

Der Service Worker lädt eine neue Fassung im Hintergrund und meldet
„Neue Version verfügbar". Übernommen wird sie **erst auf Knopfdruck** und mit
genau einem Neuladen — nie mitten in einer offenen Kalkulation. Neu
veröffentlichen heißt: Dateien hochladen, `CACHE` in `www/sw.js` erhöhen. Fertig.

### Als installiertes APK: meldet neue Versionen

Die App fragt eine kleine JSON-Datei ab und zeigt einen Hinweis, wenn dort eine
höhere `versionCode` steht. Sie **installiert nichts von selbst** — Sie tippen
auf „Herunterladen" und spielen das Paket wie gewohnt ein. Genau deshalb braucht
die App keine Berechtigung zum Installieren von Apps.

**Einrichten (einmalig):**

1. `update.json` (Vorlage liegt im Projektordner) und das APK auf einen
   Webserver legen, z. B. GitHub Pages:
   ```json
   {
     "versionCode": 2,
     "versionName": "1.0.1",
     "apkUrl": "https://warscher80.github.io/…/LaserKalk-1.0.1.apk",
     "hinweise": "Was neu ist",
     "pflicht": false
   }
   ```
2. In der App unter **Einstellungen → Updates** die Adresse der `update.json`
   eintragen und einmal „Jetzt nach Updates suchen" drücken.

**Bei jeder neuen Version:** `versionCode` und `versionName` in
`android/app/build.gradle`, `www/js/core/version.js` und `CACHE` in `www/sw.js`
erhöhen (`npm test` prüft, dass die drei zusammenpassen), APK bauen, APK und
`update.json` hochladen.

**Was übertragen wird:** ein GET auf die Update-Datei, ohne Cookies, ohne
Kennung, ohne Angaben zu Gerät, Betrieb oder Kalkulationen. Prüfabstand
standardmäßig 24 Stunden, abschaltbar. Downloadadressen werden nur über
`https` akzeptiert. Läuft die App über den Play Store, übernimmt der Store das
Aktualisieren — dann einfach keine Adresse eintragen.

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
