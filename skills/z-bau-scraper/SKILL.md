---
name: z-bau-scraper
description: Extrahiert Event-Details von https://z-bau.com/programm durch Aufklappen der Collapse-Elemente und optionalem "Mehr"-Button für vollständige Beschreibungen. Verwendet Browser-Automation (Playwright MCP) um alle Events zu expandieren, vollständige Beschreibungen zu laden und Event-Informationen zu extrahieren. Ordnet Events App-Eventkategorien zu. Schreibt Daten nach data/. Nutze diesen Skill NUR auf explizite Anfrage des Users wenn Events von z-bau.com gescraped werden sollen.
---

# Z-Bau Scraper

Dieser Skill extrahiert Event-Details von https://z-bau.com/programm. Es gibt keine separaten Detailseiten; die Events sind Collapse-Elemente auf einer Seite. Details werden per "Mehr Infos" und bei Bedarf zusätzlich per "Mehr" geladen. Alle CSV-Dateien werden verbindlich im Ordner `data/` verwaltet.

## Feste Werte

### Veranstaltungsort
`Z-Bau – Haus für Gegenwartskultur, Frankenstraße 200, 90461 Nürnberg`

### Kontaktdaten
- Telefon: `0911 43 34 92 0`
- E-Mail: `kontakt@z-bau.com`
- Webseite: `https://z-bau.com/`

## Verbindliche Ausführungsvorgaben

1. **Gemeinsame CSV-Regeln (Referenz: `skills/csv-handling`)**: Die App verwaltet den Bestand, Validierung, Chunking und CSV-Speicherung automatisch. Der Agent schreibt keine Dateien direkt auf Festplatte, sondern meldet Kandidaten per `announce_plan` und speichert gefundene Events sofort einzeln per `add_event`.
2. **Nur Playwright MCP & Custom Tools**: Verwende ausschließlich Playwright MCP für die Browser-Interaktion und die Custom Tools `announce_plan`, `add_event` und `report_step`. Keine Shell-/Dateischreiboperationen für CSVs.
3. **Limit**: Standardmäßig maximal **30 neue Events** pro Lauf erfassen.

## Datenqualität (Pipeline-kompatibel)

### Gemeinsame CSV-Regeln (Referenz: `skills/csv-handling`)

- Die App übernimmt Validierung, Quoting, Chunking bei >50 Zeilen und Vergangenheitsfilterung (`Startdatum >= heute + 1 Tag`).
- Der Agent übergibt für jedes Event die 17 Standardfelder an `add_event`.

### Regel: Tickets + Ticket-URL

- `tickets`: nur `ja` oder `nein`
- `ticketUrl`: URL wenn vorhanden, sonst leer

### Regel: Kategorien (App-Eventkategorie)

- `category` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
- Rohes Z-Bau-Genre (h3) nur intern als `genre` für die Zuordnung nutzen.
- `genre` niemals in `description` kopieren.

### Regel: Abgesagte Events

Vor `add_event` Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

## Eventkategorie-Zuordnung

Details: `skills/event-category-mapper/` im Anwendungsordner (Site-Override: z-bau-scraper).

## Sofortiger Ablauf bei Ausführung

1. Bestand und Bereinigung wurden bereits vorab automatisch von der App erledigt (Phase 0).
2. Navigiere zu `https://z-bau.com/programm`.
3. Schließe Cookie-Banner ("Okay"), falls vorhanden.
4. Finde Event-Listeneinträge mit "Mehr Infos".
5. Rufe `announce_plan` mit allen gefundenen Kandidaten auf (`title`, `startDate`, `detailUrl`).
6. Verarbeite Events einzeln (standardmäßig maximal 30 neue Events):
   - Optional `report_step` aufrufen ("Lese Details zu ...").
   - "Mehr Infos" und ggf. "Mehr" öffnen.
   - Daten extrahieren und App-Kategorie zuordnen.
   - `add_event` mit den 17 Feldern aufrufen.
   - Bei Erreichen von 30 neuen Events stoppen.
7. Beende den Lauf. Die App führt abschließend automatisch `node csv-import-check.js data` aus.
8. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `z-bau-optimization.md`) ODER `Keine Optimierung nötig`.

## Workflow

### Phase 1: Seite laden & Kandidaten überblicken

1. Navigiere zu `https://z-bau.com/programm`
2. Cookie-Banner schließen
3. Struktur mit Snapshot prüfen
4. Alle sichtbaren Events als Kandidatenliste sammeln und `announce_plan` aufrufen.

### Phase 2: Details extrahieren & einzeln speichern

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. Für jedes Event "Mehr Infos" öffnen (ggf. "Mehr" für vollständigen Text).
2. Felder extrahieren:
   - **title**, **description** (nur aus Textbereich, nicht Genre)
   - **startDate** (YYYY-MM-DD), **endDate**, **startTime**, **endTime**
   - **location** (statischer Wert)
   - **category** (App-Kategorie-Name via Mapping über `skills/event-category-mapper`)
   - **price**, **tickets** (ja/nein), **ticketUrl**
   - **email**, **phone**, **website** (statische Werte), **socialMedia**, **imageUrl**, **detailUrl**
3. `add_event` aufrufen und Antwort prüfen.
4. Bei 30 neuen Events stoppen.

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `z-bau-optimization.md`) ODER `Keine Optimierung nötig`.

## Ausgabe

- **CSV-Dateien**: neu `data/z-bau-events-data-YYYY-MM-DD.csv` (und ggf. `-2`, `-3` … in `data/`)
- **Statusmeldung**:
  - Anzahl entfernter vergangener Events (`Startdatum < heute + 1 Tag`)
  - Anzahl neu hinzugefügter Events
  - Gesamtanzahl und Anzahl Chunks
  - Kategorie-Statistik
  - Ergebnis des CSV-Import-Checks (`OK`)

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `z-bau-optimization.md`.

1. **Beim Start** (`Phase 0`): Lese die Datei `z-bau-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/z-bau-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `z-bau-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
