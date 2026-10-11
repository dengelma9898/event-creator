---
name: meistersingerhalle-scraper
  description: Extrahiert Event-Details von https://meistersingerhalle.nuernberg.de/veranstaltungen/suche mit Pagination. Verwendet Playwright MCP, meldet Kandidaten via announce_plan und übergibt Events einzeln per add_event an die App (maximal 30 neue Events pro Run). Schreibt keine CSV-Dateien manuell.
---

# Meistersingerhalle Scraper

Dieser Skill extrahiert Event-Details von https://meistersingerhalle.nuernberg.de/veranstaltungen/suche. Die Seite verwendet **Pagination** - Events sind über mehrere Seiten verteilt. Zuerst werden alle Event-Links von allen Seiten gesammelt, `announce_plan` aufgerufen, dann werden Detailseiten einzeln aufgerufen und die Event-Informationen per `add_event` an die App übergeben. Alle CSV-Dateien werden verbindlich durch die App im Ordner `data/` verwaltet.

## Verbindliche Regeln

1. **Kein manuelles CSV-Schreiben**: Die App übernimmt das Schreiben, Vergangenheitsfilterung, Deduplizieren und 50er-Chunking. Der Agent ruft `announce_plan` und `add_event` auf.
2. **Nur Playwright MCP & Custom Tools**: Keine externen Skripte, keine manuellen Dateizugriffe.

## Datenqualität (Pipeline-kompatibel)

### Regel: Kategorien (App-Eventkategorie)

- `Kategorien` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
- Quell-Kategorie nur intern als `sourceCategory` für die Zuordnung nutzen.

### Regel: Veranstaltungsort (feste Adresse)

Die Detailseite nennt nur den Saal (z. B. „Meistersingerhalle - Großer Saal"). Das Backend braucht aber eine geocodierbare Adresse, sonst bekommt das Event keine Kartenposition. Deshalb IMMER im Format übergeben:

- `Meistersingerhalle - Großer Saal, Münchener Str. 21, 90478 Nürnberg`
- `Meistersingerhalle - Kleiner Saal, Münchener Str. 21, 90478 Nürnberg`

Bei anderen Sälen/Angaben: den Saalnamen von der Seite übernehmen und `, Münchener Str. 21, 90478 Nürnberg` anhängen. Nur wenn die Detailseite ausdrücklich einen anderen Veranstaltungsort außerhalb der Meistersingerhalle nennt, diesen (mit PLZ und Stadt) verwenden.

### Regel: Abgesagte Events

Vor Übergabe an `add_event` Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

Siehe README „Gemeinsame Regeln“ und `.cursorrules` Regel 8.

## Eventkategorie-Zuordnung

Details: `event-category-mapper` im Anwendungsordner (Site-Override: meistersingerhalle-scraper).

## 🚨 SOFORTIGER BEFEHL BEI AUSFÜHRUNG

**WENN DIESER SKILL AUSGEFÜHRT WIRD:**

1. **BESTAND**: Wurde bereits vor dem Start durch die App geladen und bereinigt.
2. **NAVIGIERE** zu https://meistersingerhalle.nuernberg.de/veranstaltungen/suche
3. **SCHLIESSE COOKIE-BANNER** falls vorhanden (klicke auf "Ablehnen"-Button)
4. **SAMMLE ALLE EVENT-LINKS** über alle Paginierungsseiten
5. **PLAN MELDEN**: Rufe das Custom-Tool `announce_plan` mit allen gefundenen Kandidaten auf.
6. **VERWENDE NUR** Playwright MCP Browser-Automation Tools
7. **KLICKE** auf jeden Event-Link um zur Detailseite zu navigieren (NUR wenn noch nicht gescrapt)
8. **EXTRAHIERE** alle verfügbaren Event-Details und rufe sofort `add_event` mit den 17 Feldern auf
9. **STOPPE** nach maximal 30 neuen Events (bereits gescrapte zählen nicht)
10. **KEINE CSV SCHREIBEN**: Die App schreibt, validiert und chunked automatisch in `data/`.
11. **MELDE PFLICHT-REPORT**: `Optimierung hinzugefügt` (Eintrag in `meistersingerhalle-optimization.md`) oder `Keine Optimierung nötig`

## Workflow

### Phase 0: Bestand prüfen (automatisch durch die App)

- Die App hat bereits vor dem Agentenstart bestehende CSVs geprüft, vergangene Events entfernt und den Snapshot vorbereitet.

### Phase 1: Liste analysieren + PAGINATION + Plan melden

1. Navigiere zur Suchseite
2. Cookie-Banner schließen
3. Event-Links von allen Paginierungsseiten sammeln (Button "Next Page" / Seitennummern iterieren)
4. Rufe `announce_plan` mit allen gefundenen Kandidaten auf

### Phase 2: Details extrahieren & per `add_event` übergeben

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

1. Duplikat prüfen (bereits bekannte URLs überspringen)
2. Bei Erreichen von 30 neuen Events stoppen und zu Phase 3 gehen
3. Für jedes neue Event Detailseite öffnen
4. Zu extrahierende Felder und Übergabe per `add_event`:
   - **Titel**, **Beschreibung**, **Startdatum** (YYYY-MM-DD), **Enddatum**, **Startzeit**, **Endzeit**
   - **Preis**, **Tickets** (ja/nein), **Ticket-URL**, **Veranstaltungsort**, **E-Mail**, **Telefon**, **Webseite**, **Social Media**, **Bild-URL**, **Detail-URL**
   - **Kategorien**: Zuordnung über `event-category-mapper`

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. **Pflicht-Report** melden: `Optimierung hinzugefügt` (datierten Eintrag an den Anfang von `meistersingerhalle-optimization.md`) ODER `Keine Optimierung nötig`

## Ausgabe

- **Status**: Gefundene Kandidaten, via `add_event` übergebene Events, abgelehnte/übersprungene Events.

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast. Dann kurze datierte Einträge an den ANFANG von `meistersingerhalle-optimization.md`.

1. **Beim Start** (`Phase 0`): Lese die Datei `meistersingerhalle-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/meistersingerhalle-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `meistersingerhalle-optimization.md`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln bleiben unverändert verbindlich.
