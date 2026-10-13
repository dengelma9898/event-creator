---
name: frankenkids-scraper
  description: Extrahiert Event-Details von https://www.frankenkids.de/veranstaltungen_franken/. Meldet Kandidaten via announce_plan und übergibt Events einzeln per add_event an die App (maximal 30 neue Events pro Run). Schreibt keine CSV-Dateien manuell. Nutze NUR auf explizite Anfrage für frankenkids.de/veranstaltungen_franken/.
---

# Frankenkids Event Scraper

## Workflow (4 Phasen, ohne externe Skripte)

### Phase 0: Bestand prüfen (automatisch durch die App)

- Die App hat bereits vor dem Agentenstart bestehende CSVs geprüft, vergangene Events entfernt und den Snapshot vorbereitet.

### Phase 1: Liste erfassen & Plan melden

1. MCP-Precheck: `user-playwright` muss `ready` sein
2. Listen-URL + Pagination `/veranstaltungen_franken/page/N/` (N=2..5, stop wenn leer)
3. Newsletter-Modal schließen: `.ays_pb_material_close_icon`
4. Event-URLs sammeln (`a[href*="/veranstaltungen/"]`, ohne `veranstaltungen_franken` / `eventkalender`)
5. URL-Pre-Filter: Pfad `/YYYY-MM-DD/` mit Datum < lokales Datum von morgen überspringen
6. Rufe das Custom-Tool `announce_plan` mit allen gefundenen Kandidaten auf.

### Phase 2: Details extrahieren & per `add_event` übergeben

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. Pro gesammelter Kandidaten-URL: Details extrahieren (bevorzugt zügig, maximal 30 neue Events)
2. Abgesagte Events filtern, Kategorien mappen (`event-category-mapper`)
3. Sofort das Custom-Tool `add_event` mit den 17 Feldern aufrufen:
   - **Titel**, **Beschreibung**, **Startdatum** (YYYY-MM-DD), **Enddatum**, **Startzeit**, **Endzeit**, **Veranstaltungsort**, **Kategorien**, **Preis**, **Tickets** (ja/nein), **Ticket-URL**, **E-Mail**, **Telefon**, **Webseite**, **Social Media**, **Bild-URL**, **Detail-URL**

**Volatilität:** Selektoren in [reference.md](reference.md) sind Stand heute. Wenn Extraktion leer/fehlerhaft: **eine** Detailseite per `browser_snapshot` prüfen, Selektoren anpassen, dann weiter.

Extraktions-Muster und `mapCategory`-Reihenfolge: [reference.md](reference.md)

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `frankenkids-optimization.md`) ODER `Keine Optimierung nötig`

## Datenregeln

### Verbindliche Standardregeln

- **Kein manuelles CSV-Schreiben**: Die App übernimmt das Schreiben, Vergangenheitsfilterung, Deduplizieren und 50er-Chunking. Der Agent ruft `announce_plan` und `add_event` auf.
- **Nur Playwright MCP & Custom Tools**: Keine externen Skripte, keine manuellen Dateizugriffe.

### Kategorien

- `Kategorien`: exakt einer der 7 App-Namen oder leer
- Rohes Frankenkids-Tag nur intern als `sourceCategory`
- Mapping: `event-category-mapper` (Override: frankenkids-scraper)

### Veranstaltungsort vervollständigen (Referenz: `skills/address-completion`)

- Liefert die Detailseite nur den Namen der Einrichtung ohne Straße/PLZ/Stadt, führe **vor `add_event`** die kurze Adresssuche aus `skills/address-completion` per Playwright aus.
- Wird keine verlässliche Adresse gefunden, speichere das Event trotzdem mit dem vorhandenen Namen.

### Abgesagte Events (überspringen)

- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

## Ausgabe

- **Status**: Gefundene Kandidaten, via `add_event` übergebene Events, abgelehnte/übersprungene Events.

## Anti-Patterns

| ❌ Nicht | ✅ Stattdessen |
|----------|----------------|
| `page.evaluate(fn.toString())` | Inline `page.evaluate(() => { ... })` |
| Einzelklicks pro Event | Ein `browser_run_code_unsafe`-Lauf |
| Externe Skripte für Scrape-Logik | Skill + Live-DOM bei Änderungen prüfen |
| Cookie-Banner erzwingen | Newsletter-Modal `.ays_pb_material_close_icon` |
| Pagination per Klick | Direkt `/page/N/` navigieren |
| `navigate_back` | `page.goto(detailUrl)` |
| Rohes `musik` als Keyword | Reihenfolge in reference.md |

## Verwendung

**NUR auf explizite Anfrage** des Users.

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `frankenkids-optimization.md`.

1. **Beim Start** (`Phase 0`): Lese die Datei `frankenkids-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/frankenkids-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie. (Selektoren in `reference.md` sind nur Stand-jetzt.)
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `frankenkids-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz oder ein Selektor noch aktuell ist – validiere **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
