---
name: gate-nuernberg-scraper
description: Extrahiert Event-Details von https://gate-nuernberg.de/#section_events durch Navigation zu den Detailseiten jedes Events. Verwendet Browser-Automation (Playwright MCP) um alle Event-Links zu finden, auf die Detailseiten zu navigieren und vollständige Event-Informationen zu extrahieren. Ordnet Events App-Eventkategorien zu. Schreibt Daten nach data/. Nutze diesen Skill NUR auf explizite Anfrage des Users wenn Events von gate-nuernberg.de gescraped werden sollen.
---

# GATE Nürnberg Scraper

Dieser Skill extrahiert Event-Details von der GATE Club/Lounge Webseite https://gate-nuernberg.de/#section_events. Die Events werden auf der Hauptseite angezeigt und verlinken zu Detailseiten unter `/Events/Show/{id}/{slug}`. Alle CSV-Dateien werden verbindlich im Ordner `data/` verwaltet.

## Fester Veranstaltungsort

Immer:
```
GATE
Flughafenstraße 100
90411 Nürnberg
Terminal 2. OG
```

## Feste Kontaktdaten

Statisch hardcodieren:
```
Telefon: 0151 70206773
E-Mail: kontakt@gate-nuernberg.de
Webseite: https://gate-nuernberg.de/
```

## Datenqualität (Pipeline-kompatibel)

### Gemeinsame CSV-Regeln (Referenz: `skills/csv-handling`)

- **Dateibenennung (neu, datumsgestempelt)**: `data/gate-events-data-YYYY-MM-DD.csv` (+ `-2`, `-3` … bei >50). Nur im Ordner `data/` speichern.
- **Max. 50 Einträge pro CSV**: siehe `csv-handling`.
- **Vergangenheitsbereinigung** (`Startdatum < heute + 1 Tag`): siehe `csv-handling` (Events von heute sind nach App-Vorgabe nicht erlaubt, erst ab morgen).
- **Carry-Forward-Merge & Dedupe** (per `Detail-URL`): siehe `csv-handling` — beim Run jüngsten Bestand aus `data/` laden, bereinigen, mit neuen Events mergen, neues datumsgestempeltes Snapshot in `data/` schreiben.
- **Quoting & Zeichenbereinigung**: siehe `csv-handling`.

### Regel: Tickets (ja/nein) + Ticket-URL

- **Tickets**: Nur "ja" oder "nein"
- **Ticket-URL**: Die eigentliche Ticket-Shop-URL (z.B. https://feierliste.ticket.io/...), leer wenn keine

### Regel: Kategorien (App-Eventkategorie)

- `Kategorien` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
- Quell-Kategorie nur intern als `sourceCategory` für die Zuordnung nutzen.

### Regel: Abgesagte Events

Vor CSV-Aufnahme Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

Siehe README „Gemeinsame Regeln“ und `.cursorrules` Regel 8.

## Eventkategorie-Zuordnung

Details: `skills/event-category-mapper/` im Anwendungsordner (Site-Override: gate-nuernberg-scraper).

## 🚨 SOFORTIGER BEFEHL BEI AUSFÜHRUNG

**WENN DIESER SKILL AUSGEFÜHRT WIRD:**

1. **PRÜFE MCP-STATUS (PFLICHT)**: Playwright MCP prüfen.
2. Bestand und Bereinigung wurden bereits vorab automatisch von der App erledigt (Phase 0).
3. **NAVIGIERE** zu https://gate-nuernberg.de/#section_events
4. **SCHLIESSE COOKIE-BANNER** falls vorhanden.
5. **FINDE** alle Event-Links (`/Events/Show/{id}/{slug}`) und rufe `announce_plan` mit allen gefundenen Kandidaten auf.
6. **KLICKE** auf Event-Links um zur Detailseite zu navigieren.
7. **EXTRAHIERE** alle verfügbaren Event-Details (standardmäßig max. 30 neue Events).
8. **SETZE Veranstaltungsort & Kontaktdaten** fest und rufe `add_event` auf.
9. **STOPPE** nach maximal 30 neuen Events.
10. Beende den Lauf. Die App führt abschließend automatisch `node csv-import-check.js data` aus.
11. **MELDE PFLICHT-REPORT**: `Optimierung hinzugefügt` (Eintrag in `gate-nuernberg-optimization.md`) oder `Keine Optimierung nötig`.

## Workflow

### Phase 1: Liste analysieren & Kandidaten überblicken

1. Navigiere zu https://gate-nuernberg.de/#section_events
2. Cookie-Banner schließen
3. Event-Links sammeln (`/Events/Show/{id}/{slug}`) und `announce_plan` aufrufen.

### Phase 2: Details extrahieren & einzeln speichern

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. Detailseite jedes Events aufrufen.
2. Felder extrahieren:
   - **title**, **description**, **startDate** (YYYY-MM-DD), **startTime**
   - **price**, **tickets** (ja/nein), **ticketUrl**
   - **location**: `GATE, Flughafenstraße 100, 90411 Nürnberg, Terminal 2. OG`
   - **email**: `kontakt@gate-nuernberg.de`, **phone**: `0151 70206773`, **website**: `https://gate-nuernberg.de/`
   - **category**: Zuordnung über `skills/event-category-mapper`
   - **imageUrl**, **detailUrl**
3. `add_event` aufrufen.
4. Bei Erreichen von 30 neuen Events stoppen.

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. Melde den Pflicht-Report zur Optimierung.

## Ausgabe

- **CSV-Dateien**: neu `data/gate-events-data-YYYY-MM-DD.csv` (und ggf. `-2`, `-3` … in `data/`)
- **Status**: Entfernte vergangene Events, neu gescrapte Events, Gesamtanzahl Chunks, Kategorie-Statistik, CSV-Check-Ergebnis

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `gate-nuernberg-optimization.md`.

1. **Beim Start** (`Phase 0`): Lese die Datei `gate-nuernberg-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/gate-nuernberg-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `gate-nuernberg-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
