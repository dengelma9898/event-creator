---
name: e-werk-scraper
description: Extrahiert Event-Details von https://www.e-werk.de/programm/alle-termine/ durch Navigation zu den Detailseiten jedes Events. Die Detailseiten enthalten einen Information-Block mit Ort, Einlass, Beginn, Preis, Ermäßigung etc. Verwendet Browser-Automation (Playwright MCP oder cursor-ide-browser MCP) um alle Event-Links zu finden, auf die Detailseiten zu navigieren und vollständige Event-Informationen zu extrahieren. Ordnet Events App-Eventkategorien zu. Schreibt Daten nach data/. Nutze diesen Skill NUR auf explizite Anfrage des Users wenn Events von e-werk.de gescraped werden sollen.
---

# E-Werk Erlangen Scraper

Dieser Skill extrahiert Event-Details von der E-Werk Kulturzentrum Termin-Seite https://www.e-werk.de/programm/alle-termine/. Die Events werden in einer Liste angezeigt; per Klick auf einen Event-Titel/Link wird zur **Detailseite** navigiert. Unter dem **Information-Block** (heading "Information") finden sich alle Event-Details in einer Tabelle (Ort, Einlass, Beginn, Preis, Ermäßigung, etc.). Alle CSV-Dateien werden verbindlich im Ordner `data/` verwaltet.

## Fester Veranstaltungsort

Kombinieren als: `[Ort aus Tabelle], E-Werk Kulturzentrum GmbH, Fuchsenwiese 1, 91054 Erlangen` (z.B. `Etage 1, E-Werk Kulturzentrum GmbH, Fuchsenwiese 1, 91054 Erlangen`).

## Feste Kontaktdaten

Bei allen E-Werk-Events sind die Kontaktdaten statisch:
```
Telefon: 09131 8005-0
E-Mail: info@e-werk.de
Webseite: https://www.e-werk.de/
```

## Datenqualität (Pipeline-kompatibel)

### Gemeinsame CSV-Regeln (Referenz: `skills/csv-handling`)

- **Dateibenennung (neu, datumsgestempelt)**: `data/e-werk-events-data-YYYY-MM-DD.csv` (+ `-2`, `-3` … bei >50). Nur im Ordner `data/` speichern.
- **Max. 50 Einträge pro CSV**: siehe `csv-handling`.
- **Vergangenheitsbereinigung** (`Startdatum < heute + 1 Tag`): siehe `csv-handling` (Events von heute sind nach App-Vorgabe nicht erlaubt, erst ab morgen).
- **Carry-Forward-Merge & Dedupe** (per `Detail-URL`): siehe `csv-handling` — beim Run jüngsten Bestand aus `data/` laden, bereinigen, mit neuen Events mergen, neues datumsgestempeltes Snapshot in `data/` schreiben.
- **Quoting & Zeichenbereinigung**: siehe `csv-handling`.

### Regel: Tickets (ja/nein) + Ticket-URL

- **Tickets**: Nur "ja" oder "nein"
- **Ticket-URL**: URL des Ticketshops (reservix, cinetixx etc.), leer wenn keine

### Regel: Kategorien (App-Eventkategorie)

- `Kategorien` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
- Quell-Kategorie nur intern als `sourceCategory` für die Zuordnung nutzen.

### Regel: Adress-Fallback (Referenz: `skills/address-completion`)

- Die feste Kombinationsregel für den Veranstaltungsort oben hat Vorrang. Nur falls der Ort dennoch unvollständig wäre, gilt die Adresssuche aus `skills/address-completion`.

### Regel: Abgesagte Events

Vor CSV-Aufnahme Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

Siehe README „Gemeinsame Regeln“ und `.cursorrules` Regel 8.

## Eventkategorie-Zuordnung

Details: `skills/event-category-mapper/` im Anwendungsordner (Site-Override: e-werk-scraper).

## SOFORTIGER BEFEHL BEI AUSFÜHRUNG

**WENN DIESER SKILL AUSGEFÜHRT WIRD:**

1. Bestand und Bereinigung wurden bereits vorab automatisch von der App erledigt (Phase 0).
2. **NAVIGIERE** zu https://www.e-werk.de/programm/alle-termine/
3. **SCHLIESSE COOKIE-BANNER** falls vorhanden.
4. **FINDE** alle Event-Einträge und rufe `announce_plan` mit allen gefundenen Kandidaten auf.
5. **FÜR JEDES EVENT** (standardmäßig max. 30 neue pro Run):
   - Extrahiere die Event-Details (bevorzuge schnelle In-Page Extraktion via `fetch(detailUrl)` und `DOMParser` im Page-Kontext, um seitenweite Navigationstimeouts zu vermeiden).
   - Finde den **Information-Block** und extrahiere Tabellendaten sowie Beschreibung.
   - Setze festen Ort & feste Kontaktdaten.
   - Rufe `add_event` auf.
6. **STOPPE** nach maximal 30 neuen Events (bereits gescrapte zählen nicht).
7. Beende den Lauf. Die App führt abschließend automatisch `node csv-import-check.js data` aus.
8. **MELDE PFLICHT-REPORT**: `Optimierung hinzugefügt` (Eintrag in `e-werk-optimization.md`) oder `Keine Optimierung nötig`.

## Workflow

### Phase 1: Liste laden & Kandidaten überblicken

1. Navigiere zu https://www.e-werk.de/programm/alle-termine/
2. Cookie-Banner schließen
3. Bei Bedarf "Mehr laden" klicken
4. Alle gefundenen Events per `announce_plan` melden.

### Phase 2: Details extrahieren & per `add_event` übergeben

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. Für jedes Event Duplikat-Check durchführen (bereits bekannte überspringen)
2. Bei Erreichen von 30 neuen Events stoppen und zu Phase 3 gehen
3. Details extrahieren (bevorzugt schnell per fetch/DOMParser oder Detailseite) und sofort das Custom-Tool `add_event` mit den 17 Feldern aufrufen:
   - **Titel**, **Beschreibung**, **Startdatum** (YYYY-MM-DD), **Enddatum**, **Startzeit**, **Endzeit**
   - **Preis**, **Tickets** (ja/nein), **Ticket-URL**
   - **Veranstaltungsort**: `[Ort aus Tabelle], E-Werk Kulturzentrum GmbH, Fuchsenwiese 1, 91054 Erlangen`
   - **E-Mail**: `info@e-werk.de`, **Telefon**: `09131 8005-0`, **Webseite**: `https://www.e-werk.de/`
   - **Kategorien**: Zuordnung über `event-category-mapper`
   - **Bild-URL**, **Detail-URL**
### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `e-werk-optimization.md`) ODER `Keine Optimierung nötig`

## Ausgabe

- **CSV-Dateien**: neu `data/e-werk-events-data-YYYY-MM-DD.csv` (und ggf. `-2`, `-3` … in `data/`)
- **Status**: Entfernte vergangene Events, neu gescrapte Events, Gesamtanzahl Chunks, Kategorie-Statistik, CSV-Check-Ergebnis

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `e-werk-optimization.md`. Wenn es nichts zu verbessern gibt, melde nur `Keine Optimierung nötig`.

1. **Beim Start** (`Phase 0`): Lese die Datei `e-werk-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/e-werk-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `e-werk-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
