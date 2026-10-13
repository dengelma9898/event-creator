---
name: rausgegangen-party-scraper
  description: Extrahiert Event-Details von https://rausgegangen.de/nurnberg/kategorie/party/ über Detailseiten. Verwendet Playwright MCP, meldet Kandidaten via announce_plan und übergibt Events einzeln per add_event an die App (maximal 30 neue Events pro Run). Schreibt keine CSV-Dateien manuell.
---

# Rausgegangen Party Scraper

Dieser Skill extrahiert Event-Details von https://rausgegangen.de/nurnberg/kategorie/party/?geospatial_query_type=CITY&lat=49.453872&lng=11.077298&city=nurnberg.

WICHTIG: Die Event-Liste ist nur Einstiegspunkt. Relevante Daten kommen von den Detailseiten. Die CSV-Dateien und das 50er-Chunking werden verbindlich und automatisch durch die App im Ordner `data/` verwaltet.

## Dauerhafte Ausführungsregeln

1. **Kein manuelles CSV-Schreiben**: Die App übernimmt das Schreiben, Vergangenheitsfilterung, Deduplizieren und 50er-Chunking. Der Agent ruft `announce_plan` und `add_event` auf.
2. **Nur Playwright MCP & Custom Tools**: Keine externen Skripte, keine manuellen Dateizugriffe.

## Datenqualität (Pipeline-kompatibel)

### Regel: Kategorien (App-Eventkategorie)

- `Kategorien` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
- Quell-Kategorie nur intern als `sourceCategory` für die Zuordnung nutzen.

### Regel: Veranstaltungsort vervollständigen (Referenz: `skills/address-completion`)

- Liefert die Detailseite nur den Namen der Einrichtung ohne Straße/PLZ/Stadt, führe **vor `add_event`** die kurze Adresssuche aus `skills/address-completion` per Playwright aus.
- Wird keine verlässliche Adresse gefunden, speichere das Event trotzdem mit dem vorhandenen Namen.

### Regel: Abgesagte Events

Vor Übergabe an `add_event` Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

Siehe README „Gemeinsame Regeln“ und `.cursorrules` Regel 8.

## Eventkategorie-Zuordnung

Details: `event-category-mapper` im Anwendungsordner (Site-Override: rausgegangen-party-scraper).

## Workflow

### Phase 0: Bestand prüfen (automatisch durch die App)

- Die App hat bereits vor dem Agentenstart bestehende CSVs geprüft, vergangene Events entfernt und den Snapshot vorbereitet.

### Phase 1: Liste analysieren & Plan melden

1. Navigiere zur URL.
2. Cookie-Banner schließen (Button `Ablehnen`).
3. Alle Event-Detail-Links sammeln.
4. Rufe `announce_plan` mit allen gefundenen Kandidaten auf.

### Phase 2: Details extrahieren & per `add_event` übergeben

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. Bereits bekannte Detail-URLs überspringen.
2. Bei Erreichen von 30 neuen Events stoppen und zu Phase 3 gehen.
3. Für jedes neue Event Detailseite öffnen.
4. Felder extrahieren und per `add_event` übergeben:
   - **Titel**, **Beschreibung**, **Startdatum** (YYYY-MM-DD), **Enddatum**, **Startzeit**, **Endzeit**, **Veranstaltungsort**, **Kategorien** (Mapping über `event-category-mapper`), **Preis**, **Tickets** (ja/nein), **Ticket-URL**, **E-Mail**, **Telefon**, **Webseite**, **Social Media**, **Bild-URL**, **Detail-URL**.

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `rausgegangen-party-optimization.md`) ODER `Keine Optimierung nötig`

## Ausgabe

- **Status**: Gefundene Kandidaten, via `add_event` übergebene Events, abgelehnte/übersprungene Events.

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `rausgegangen-party-optimization.md`.

1. **Beim Start** (`Phase 0`): Lese die Datei `rausgegangen-party-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/rausgegangen-party-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `rausgegangen-party-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
