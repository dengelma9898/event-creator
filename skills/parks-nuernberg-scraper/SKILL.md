---
name: parks-nuernberg-scraper
description: Extrahiert Event-Details von https://www.parks-nuernberg.de/eventkalender/ durch Klick auf "Weitere Informationen" um die Event-Details zu öffnen. Verwendet Browser-Automation (Playwright MCP oder cursor-ide-browser MCP) um alle Events zu finden, Details zu laden und vollständige Event-Informationen zu extrahieren. Ordnet Events App-Eventkategorien zu. Schreibt Daten nach data/. Nutze diesen Skill NUR auf explizite Anfrage des Users wenn Events von parks-nuernberg.de gescraped werden sollen.
---

# PARKS Nürnberg Scraper

Dieser Skill extrahiert Event-Details von der PARKS Nürnberg Eventkalender-Seite https://www.parks-nuernberg.de/eventkalender/. Die Events werden in einer Liste angezeigt; per Klick auf **"Weitere Informationen"** werden die Details geöffnet (Accordion/Collapse oder Navigation zur Detailseite). Alle CSV-Dateien werden verbindlich im Ordner `data/` verwaltet.

## Fester Veranstaltungsort

Immer:
```
PARKS (im Stadtpark)
Berliner Platz 9
90409 Nürnberg
```

## Feste Kontaktdaten

Statisch hardcodieren:
```
Telefon: 091180196371
E-Mail: info@parks-nuernberg.de
Webseite: https://www.parks-nuernberg.de/
```

## Verbindliche Ausführungsvorgaben

1. **Gemeinsame CSV-Regeln (Referenz: `skills/csv-handling`)**: Die App verwaltet den Bestand, Validierung, Chunking und CSV-Speicherung automatisch. Der Agent schreibt keine Dateien direkt auf Festplatte, sondern meldet Kandidaten per `announce_plan` und speichert gefundene Events sofort einzeln per `add_event`.
2. **Nur Browser-Automation & Custom Tools**: Verwende Browser-Automation (Playwright MCP) und die Custom Tools `announce_plan`, `add_event` und `report_step`. Keine Shell-/Dateischreiboperationen für CSVs.
3. **Limit**: Standardmäßig maximal **30 neue Events** pro Lauf erfassen.

## Datenqualität (Pipeline-kompatibel)

### Gemeinsame CSV-Regeln (Referenz: `skills/csv-handling`)

- Die App übernimmt Validierung, Quoting, Chunking bei >50 Zeilen und Vergangenheitsfilterung (`Startdatum >= heute + 1 Tag`).
- Der Agent übergibt für jedes Event die 17 Standardfelder an `add_event`.

### Regel: Tickets (ja/nein) + Ticket-URL

- **tickets**: "ja" wenn Ticket-URL existiert, "nein" sonst
- **ticketUrl**: Link zum PARKS Ticketshop oder Ticket-Anbieter, leer wenn keine

### Regel: Kategorien (App-Eventkategorie)

- `category` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
- Quell-Kategorie nur intern als `sourceCategory` für die Zuordnung nutzen.

### Regel: Abgesagte Events

Vor `add_event` Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

## Eventkategorie-Zuordnung

Details: `skills/event-category-mapper/` im Anwendungsordner (Site-Override: parks-nuernberg-scraper).

## SOFORTIGER BEFEHL BEI AUSFÜHRUNG

1. Bestand und Bereinigung wurden bereits vorab automatisch von der App erledigt (Phase 0).
2. **NAVIGIERE** zu https://www.parks-nuernberg.de/eventkalender/
3. **SCHLIESSE COOKIE-BANNER** falls vorhanden.
4. **FINDE** alle Event-Einträge in der Liste und rufe `announce_plan` mit allen gefundenen Kandidaten auf.
5. **FÜR JEDES EVENT** (standardmäßig max. 30 neue pro Run):
   - Klicke auf "Weitere Informationen" → Details öffnen.
   - Extrahiere alle Event-Details (17 Felder) und ordne die App-Kategorie zu.
   - Setze Veranstaltungsort: `PARKS (im Stadtpark), Berliner Platz 9, 90409 Nürnberg`.
   - Setze Kontaktdaten: `Telefon: 091180196371`, `E-Mail: info@parks-nuernberg.de`, `Webseite: https://www.parks-nuernberg.de/`.
   - Rufe `add_event` auf.
6. **STOPPE** nach maximal 30 neuen Events.
7. Beende den Lauf. Die App führt abschließend automatisch `node csv-import-check.js data` aus.
8. **MELDE PFLICHT-REPORT**: `Optimierung hinzugefügt` (Eintrag in `parks-nuernberg-optimization.md`) oder `Keine Optimierung nötig`.

## Workflow

### Phase 1: Seite laden & Kandidaten überblicken

1. Navigiere zu https://www.parks-nuernberg.de/eventkalender/
2. Cookie-Banner schließen
3. Struktur analysieren und alle sichtbaren Events als Kandidaten per `announce_plan` melden.

### Phase 2: Details extrahieren & einzeln speichern

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. "Weitere Informationen" öffnen und Felder extrahieren:
   - **title**, **description**, **startDate** (YYYY-MM-DD), **endDate**, **startTime**, **endTime**
   - **price**, **tickets** (ja/nein), **ticketUrl**
   - **location**: `PARKS (im Stadtpark), Berliner Platz 9, 90409 Nürnberg`
   - **email**: `info@parks-nuernberg.de`, **phone**: `091180196371`, **website**: `https://www.parks-nuernberg.de/`
   - **category**: Zuordnung über `skills/event-category-mapper`
   - **imageUrl**, **detailUrl**
2. `add_event` aufrufen.
3. Bei Erreichen von 30 neuen Events stoppen.

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. Melde den Pflicht-Report zur Optimierung.
6. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `parks-nuernberg-optimization.md`) ODER `Keine Optimierung nötig`

## Ausgabe

- **CSV-Dateien**: neu `data/parks-events-data-YYYY-MM-DD.csv` (und ggf. `-2`, `-3` … in `data/`)
- **Status**: Entfernte vergangene Events, neu gescrapte Events, Gesamtanzahl Chunks, Kategorie-Statistik, CSV-Check-Ergebnis

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `parks-nuernberg-optimization.md`.

1. **Beim Start** (`Phase 0`): Lese die Datei `parks-nuernberg-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/parks-nuernberg-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `parks-nuernberg-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
