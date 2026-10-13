---
name: fuerth-veranstaltungen-scraper
  description: Extrahiert Event-Details von https://www.fuerth.de/kultur-freizeit/veranstaltungen-termine/ per Browser-Automation mit Pagination. Meldet Kandidaten via announce_plan und übergibt Events einzeln per add_event an die App (maximal 30 neue Events pro Run). Schreibt keine CSV-Dateien manuell. Nutze diesen Skill NUR auf explizite Anfrage des Users wenn Events von fuerth.de gescraped werden sollen.
---

# Fürth Veranstaltungen Scraper

Dieser Skill extrahiert Event-Details von https://www.fuerth.de/kultur-freizeit/veranstaltungen-termine/. Die Liste zeigt **standardmäßig 10 Einträge pro Seite**; weitere Events sind über **Pagination** erreichbar. Die CSV-Dateien und das 50er-Chunking werden verbindlich und automatisch durch die App im Ordner `data/` verwaltet.

## Verbindliche Vorgaben

1. **Kein manuelles CSV-Schreiben**: Die App übernimmt das Schreiben, Vergangenheitsfilterung, Deduplizieren und 50er-Chunking. Der Agent ruft `announce_plan` und `add_event` auf.
2. **Pagination**: Alle Seiten sammeln, `announce_plan` aufrufen, bevor Detailseiten extrahiert werden.

## 🚨 PAGINATION – KRITISCH

1. Sammle zunächst alle Event-Links der **aktuellen** Seite
2. Prüfe ob eine **nächste Seite** / Paginierung existiert (z.B. "Weiter", ">", "Seite 2", etc.)
3. Klicke auf den Paginierungs-Button und lade die nächste Seite
4. Wiederhole bis keine weitere Seite mehr vorhanden ist
5. `announce_plan` mit allen gesammelten Kandidaten aufrufen
6. Erst dann: Für jede gesammelte URL die Detailseite aufrufen und per `add_event` übergeben

## Datenqualität (Pipeline-kompatibel)

### Regel: Tickets + Ticket-URL

- **Tickets**: Nur "ja" oder "nein"
- **Ticket-URL**: Eigene Spalte, leer wenn keine

### Regel: Kategorien (App-Eventkategorie)

- `Kategorien` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
- Quell-Kategorie nur intern als `sourceCategory` für die Zuordnung nutzen.

### Regel: Veranstaltungsort vervollständigen (Referenz: `skills/address-completion`)

- Liefert die Quelle nur den Namen der Einrichtung (z. B. „kultur.lokal.fürth“) ohne Straße/PLZ/Stadt, führe **vor `add_event`** die kurze Adresssuche aus `skills/address-completion` per Playwright aus (Region: Fürth).
- Wird keine verlässliche Adresse gefunden, speichere das Event trotzdem mit dem vorhandenen Namen.

### Regel: Abgesagte Events

Vor Übergabe an `add_event` Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

Siehe README „Gemeinsame Regeln“ und `.cursorrules` Regel 8.

## Eventkategorie-Zuordnung

Details: `event-category-mapper` im Anwendungsordner (Site-Override: fuerth-veranstaltungen-scraper).

## SOFORTIGER BEFEHL BEI AUSFÜHRUNG

**WENN DIESER SKILL AUSGEFÜHRT WIRD:**

1. **BESTAND**: Wurde bereits vor dem Start durch die App geladen und bereinigt.
2. **NAVIGIERE** zu https://www.fuerth.de/kultur-freizeit/veranstaltungen-termine/
3. **SCHLIESSE COOKIE-BANNER** falls vorhanden
4. **SAMMLE ALLE EVENT-LINKS** über alle Paginierungsseiten (Seite 1, 2, 3, ... bis letzte Seite)
5. **PLAN MELDEN**: Rufe das Custom-Tool `announce_plan` mit allen gefundenen Kandidaten auf.
6. **VERWENDE** Playwright MCP oder cursor-ide-browser MCP für Browser-Automation
7. **FÜR JEDES EVENT** (standardmäßig max. 30 neue pro Run):
   - Rufe Detail-URL auf
   - Extrahiere alle Event-Details von der Detailseite
   - Rufe sofort das Custom-Tool `add_event` mit den 17 Feldern auf
8. **STOPPE** nach maximal 30 neuen Events (bereits gescrapte zählen nicht)
9. **KEINE CSV SCHREIBEN**: Die App schreibt, validiert und chunked automatisch in `data/`.
10. **MELDE PFLICHT-REPORT**: `Optimierung hinzugefügt` (Eintrag in `fuerth-veranstaltungen-optimization.md`) oder `Keine Optimierung nötig`

## Workflow

### Phase 0: Bestand prüfen (automatisch durch die App)

- Die App hat bereits vor dem Agentenstart bestehende CSVs geprüft, vergangene Events entfernt und den Snapshot vorbereitet.

### Phase 1: Liste laden + Pagination + Plan melden

1. Navigiere zu https://www.fuerth.de/kultur-freizeit/veranstaltungen-termine/
2. Cookie-Banner schließen
3. Event-Links aller Seiten systematisch per Paginierung durchlaufen und sammeln
4. Rufe `announce_plan` mit der Kandidatenliste auf

### Phase 2: Details extrahieren & per `add_event` übergeben

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. Für jedes neue Event Duplikat prüfen (bereits bekannte überspringen)
2. Bei Erreichen von 30 neuen Events stoppen und zu Phase 3 gehen
3. Detailseite öffnen, Daten extrahieren und sofort `add_event` aufrufen:
   - **Titel**, **Beschreibung**, **Startdatum** (YYYY-MM-DD), **Enddatum**, **Startzeit**, **Endzeit**
   - **Preis**, **Tickets** (ja/nein), **Ticket-URL**
   - **Veranstaltungsort**, **Kategorien** (Mapping über `event-category-mapper`)
   - **Detail-URL**, **E-Mail**, **Telefon**, **Webseite**, **Social Media**, **Bild-URL**

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `fuerth-veranstaltungen-optimization.md`) ODER `Keine Optimierung nötig`

## Ausgabe

- **Status**: Gefundene Kandidaten, via `add_event` übergebene Events, abgelehnte/übersprungene Events.

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `fuerth-veranstaltungen-optimization.md`.

1. **Beim Start** (`Phase 0`): Lese die Datei `fuerth-veranstaltungen-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/fuerth-veranstaltungen-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `fuerth-veranstaltungen-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
