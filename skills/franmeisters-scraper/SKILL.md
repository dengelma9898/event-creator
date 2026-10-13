---
name: franmeisters-scraper
description: Extrahiert Event-Details von https://franmeisters.de/kalender/ durch Navigation zu den Detailseiten jedes Events. Verwendet Browser-Automation (Playwright MCP oder cursor-ide-browser MCP) um alle Event-Links zu finden, auf die Detailseiten zu navigieren und vollständige Event-Informationen zu extrahieren. Ordnet Events App-Eventkategorien zu. Schreibt Daten nach data/. Nutze diesen Skill NUR auf explizite Anfrage des Users wenn Events von franmeisters.de/kalender/ gescraped werden sollen.
---

# Franmeisters DIY Bar Scraper

Dieser Skill extrahiert Event-Details von der Franmeisters DIY Bar Kalenderseite https://franmeisters.de/kalender/. Die Events werden in einer Liste angezeigt; per Klick auf ein Event-Element gelangt man zur Detailseite, wo die vollständigen Informationen zu finden sind. Alle CSV-Dateien werden verbindlich im Ordner `data/` verwaltet.

## Fester Veranstaltungsort

Immer: `Franmeisters DIY Bar, Obere Kanalstraße 11A, 90429 Nürnberg`

## Feste Kontaktdaten

Statisch hardcodieren:
```
Telefon: +49 173-2659419
E-Mail: info@franmeisters.de
Webseite: https://franmeisters.de/
```

## Datenqualität (Pipeline-kompatibel)

### Gemeinsame CSV-Regeln (Referenz: `skills/csv-handling`)

- **Dateibenennung (neu, datumsgestempelt)**: `data/franmeisters-events-data-YYYY-MM-DD.csv` (+ `-2`, `-3` … bei >50). Nur im Ordner `data/` speichern.
- **Max. 50 Einträge pro CSV**: siehe `csv-handling`.
- **Vergangenheitsbereinigung** (`Startdatum < heute + 1 Tag`): siehe `csv-handling` (Events von heute sind nach App-Vorgabe nicht erlaubt, erst ab morgen).
- **Carry-Forward-Merge & Dedupe** (per `Detail-URL`): siehe `csv-handling` — beim Run jüngsten Bestand aus `data/` laden, bereinigen, mit neuen Events mergen, neues datumsgestempeltes Snapshot in `data/` schreiben.
- **Quoting & Zeichenbereinigung**: siehe `csv-handling`.

### Regel: Tickets (ja/nein) + Ticket-URL

- **Tickets**: "ja" wenn Ticket-URL existiert, "nein" sonst
- **Ticket-URL**: Link zum Ticketkauf, leer wenn keine

### Regel: Kategorien (App-Eventkategorie)

- `Kategorien` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
- Quell-Kategorie nur intern als `sourceCategory` für die Zuordnung nutzen.

### Regel: Adress-Fallback (Referenz: `skills/address-completion`)

- Der feste Veranstaltungsort oben hat Vorrang. Nur falls der Ort dennoch unvollständig wäre, gilt die Adresssuche aus `skills/address-completion`.

### Regel: Abgesagte Events

Vor CSV-Aufnahme Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

Siehe README „Gemeinsame Regeln“ und `.cursorrules` Regel 8.

## Eventkategorie-Zuordnung

Details: `skills/event-category-mapper/` im Anwendungsordner (Site-Override: franmeisters-scraper).

## SOFORTIGER BEFEHL BEI AUSFÜHRUNG

**WENN DIESER SKILL AUSGEFÜHRT WIRD:**

1. Bestand und Bereinigung wurden bereits vorab automatisch von der App erledigt (Phase 0).
2. **NAVIGIERE** zu https://franmeisters.de/kalender/
3. **SCHLIESSE COOKIE-BANNER** falls vorhanden.
4. **FINDE** alle Event-Einträge in der Liste und rufe `announce_plan` mit allen gefundenen Kandidaten auf.
5. **FÜR JEDES EVENT** (standardmäßig max. 30 neue pro Run):
   - Klicke auf Event-Element → Navigation zur Detailseite.
   - Extrahiere die 17 Standardfelder und ordne die App-Kategorie zu.
   - Setze fest: `Veranstaltungsort: Franmeisters DIY Bar, Obere Kanalstraße 11A, 90429 Nürnberg`, `E-Mail: info@franmeisters.de`, `Telefon: +49 173-2659419`, `Webseite: https://franmeisters.de/`.
   - Rufe `add_event` auf.
   - Zurück zur Liste.
6. **STOPPE** nach maximal 30 neuen Events.
7. Beende den Lauf. Die App führt abschließend automatisch `node csv-import-check.js data` aus.
8. **MELDE PFLICHT-REPORT**: `Optimierung hinzugefügt` (Eintrag in `franmeisters-optimization.md`) oder `Keine Optimierung nötig`.

## Workflow

### Phase 1: Seite laden & Kandidaten überblicken

1. Navigiere zu https://franmeisters.de/kalender/
2. Cookie-Banner schließen
3. Event-Einträge sammeln und `announce_plan` aufrufen.

### Phase 2: Details extrahieren & einzeln speichern

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. Detailseite jedes Events öffnen.
2. Felder extrahieren:
   - **title**, **description**, **startDate** (YYYY-MM-DD), **endDate**, **startTime**, **endTime**
   - **price**, **tickets** (ja/nein), **ticketUrl**
   - **location**: `Franmeisters DIY Bar, Obere Kanalstraße 11A, 90429 Nürnberg`
   - **email**: `info@franmeisters.de`, **phone**: `+49 173-2659419`, **website**: `https://franmeisters.de/`
   - **category**: Zuordnung über `skills/event-category-mapper`
   - **imageUrl**, **detailUrl**
3. `add_event` aufrufen und zurück zur Liste navigieren.
4. Bei Erreichen von 30 neuen Events stoppen.

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. Melde den Pflicht-Report zur Optimierung.
6. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `franmeisters-optimization.md`) ODER `Keine Optimierung nötig`

## Ausgabe

- **CSV-Dateien**: neu `data/franmeisters-events-data-YYYY-MM-DD.csv` (und ggf. `-2`, `-3` … in `data/`)
- **Status**: Entfernte vergangene Events, neu gescrapte Events, Gesamtanzahl Chunks, Kategorie-Statistik, CSV-Check-Ergebnis

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `franmeisters-optimization.md`.

1. **Beim Start** (`Phase 0`): Lese die Datei `franmeisters-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/franmeisters-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `franmeisters-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
