# Frankenkids Scraper — Referenz

> Selektoren können sich ändern. Bei leeren Feldern zuerst `browser_snapshot` auf einer Detailseite — dann Selektoren hier und im `browser_run_code_unsafe`-Code anpassen.

## DOM-Struktur (Stand: Tribe Events / WordPress)

| Feld | Selektor / Quelle |
|------|-------------------|
| Container | `.tribe-events-pg-template`, `#tribe-events-content` |
| Titel | erstes `h2` im Container |
| Quell-Kategorie | `.tribe-events-event-categories` oder erste GROSSBUCHSTABEN-Zeile |
| Beginn/Ende | Text `Beginn` / `Ende` + nächste Zeile (`15. August 2026 10:00`) |
| Fallback Datum | `.tribe-event-date-start` |
| Ort | `.tribe-events-venue`, `address`, Textblock nach Datum |
| Beschreibung | `.tribe-events-single-event-description p` oder erstes `p` > 30 Zeichen |
| Website | Link „Zur Veranstaltungs-Website“ |
| Bild | `.tribe-events-event-image img` oder `meta[property="og:image"]` |

## Listen-Seite

- URLs: `a[href*="/veranstaltungen/"]` auf `frankenkids.de`
- Ausschließen: `/veranstaltungen_franken`, `eventkalender`
- Pagination: `/veranstaltungen_franken/page/{N}/` (N=2..5)
- URL-Pre-Filter: `/YYYY-MM-DD/` in URL mit Datum < morgen (heute + 1 Tag) → nicht laden

## Modals

- Newsletter (häufig): `.ays_pb_material_close_icon`
- Cookie-Banner: selten; falls sichtbar „Speichern“ / „Alle akzeptieren“

## Datum-Konvertierung

`"15. August 2026 10:00"` → `2026-08-15`, `10:00` — Monate januar–dezember (auch `märz`/`maerz`).

## browser_run_code_unsafe — Gerüst

Variablen vor dem Lauf aus Phase 0 setzen:

```javascript
async (page) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const MIN_START = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const EXISTING_URLS = new Set([/* Detail-URLs aus CSV */]);
  const TARGET = 15;
  // mapCategory, isCancelled, normalizeUrl — im Playwright-Kontext
  // extractDetailFromPage: page.evaluate(() => { /* ALLES inline */ })
  // collectUrls, closeModals, pagination, detail loop
  return { newCount, skipped, errors, events, categoryStats };
}
```

## Kategorie-Mapping

Erste passende Regel gewinnt. Default: `Familie & Kinder`.

1. Märkte & Messen — flohmarkt, troedelmarkt, messe, markt
2. Workshops & PopUps — workshop, schnuppertraining, kurs, …
3. Sport & Fitness — sport, wingtsun, yoga, …
4. Kultur — museum, führung/fuehrung, ausstellung, kirchweih, volksfest, fest, kino
5. Show & Performance — theater, zaubershow, musical, …
6. Musik & Nightlife — `\b(konzert|live|dj|party|club|…)\b` — **nicht** Substring `musik`
7. Familie & Kinder — kinder, familie, freizeitpark, …

### False Positives

| Situation | Richtig |
|-----------|---------|
| „Musikengel“ (Kirchenführung) | Kultur |
| Führungen / Museen | Kultur |
| WingTsun Schnuppertraining | Workshops & PopUps |
| Kirchweih / Volksfest | Kultur |

## Fehlerbehandlung

- Detailseite fehlgeschlagen: überspringen, in `errors` loggen
- `errors.length > 0`: User kurz informieren
- Nach CSV-Schreiben: `node csv-import-check.js data`
