# Event Category Mapper — Referenz

## App-Kategorien (exakte CSV-Werte)

Die Spalte `Kategorien` muss **exakt** einen dieser `name`-Werte enthalten (oder leer bleiben). Das Backend matcht nur auf `name`, nicht auf `description`.

| name (in CSV schreiben) | description (nur für Mapping-Logik) |
|---|---|
| `Musik & Nightlife` | Konzerte, Musikalisches |
| `Familie & Kinder` | Familien Events, Events für Kinder |
| `Workshops & PopUps` | Workshops & PopUps, DIY |
| `Märkte & Messen` | Flohmärkte, Wochenmärkte, Messen |
| `Show & Performance` | Shows, Comedy |
| `Kultur` | Kulinarische Events |
| `Sport & Fitness` | Sport, Fitness, Sportarten uvm. |

**Fallback:** Keine eindeutige Zuordnung → `Kategorien` leer → Backend setzt `categoryId` auf `default`.

## Generische Mapping-Regeln

Input: `sourceCategory`, `Titel`, `Beschreibung` (alles lowercase vergleichen).

Prüfreihenfolge: **Erste passende Regel gewinnt.** Site-Overrides (unten) haben Vorrang vor generischen Regeln, sofern explizit definiert.

| Signale (sourceCategory / Titel / Beschreibung) | Kategorie |
|---|---|
| flohmarkt, wochenmarkt, markt, messe, tauschhäuschen, umsonst- und tausch, weihnachtsmarkt | `Märkte & Messen` |
| metal, punk, techno, hardcore, trap, dubstep, jungle, drum'n'bass, breaks, afrobeats, amapiano, bouyon, bass, folk, country, rock, post-punk, dark wave, doom, black metal, stoner, progressive, thrash, konzert, live, dj, hip-hop, rap, reggae, ska, soul, r&b, elektronisch, elektronik, party, club, nightlife, disco, house, trance | `Musik & Nightlife` |
| comedy, bingospass, bingo, show, kabarett, performance, slam, theater, tanz, oper, musical, zirkus, varieté | `Show & Performance` |
| workshop, camp, diy, paint & sip, podiumsgespräch, vortrag, diskussion, gespräch, ki, ai, austausch, praxis, perspektiven, basteln, kurs, seminar | `Workshops & PopUps` |
| kinder, familie, eltern, kids, baby, teens, jugend | `Familie & Kinder` |
| sport, fitness, lauf, turnier, yoga, fußball, basketball, marathon, laufen | `Sport & Fitness` |
| ausstellung, museum, galerie, kulinarisch, biergarten, gastronomie, kino, film, lesung, literatur, kultur, fest, eröffnung, sommerfest | `Kultur` |
| unklar / kein Treffer | leer |

## Site-Overrides

Site-Overrides werden **vor** den generischen Regeln geprüft (sofern im Scraper-Skill referenziert).

### z-bau-scraper

Internes Feld: `genre` (h3). Zusätzliche Regeln:

**Beschreibung ≠ genre:** `Beschreibung` nur aus expandiertem Text; `genre` (h3) nie in `Beschreibung` kopieren. Ohne expandierten Text bleibt `Beschreibung` leer.

| Signale | Kategorie |
|---|---|
| biergarten w/ (Musik-Act im Titel oder Genre) | `Musik & Nightlife` |
| kulinarisch, biergarten (ohne Musik-Act), z-bräu, gemeinschaftsgarten, nordgarten, schenke, feel-good | `Kultur` |

**Biergarten-Mehrdeutigkeit:**

| Event | genre | Ergebnis |
|---|---|---|
| Biergarten w/ LightUp! | Breaks, Dubstep, Jungle | `Musik & Nightlife` |
| Biergarten | (leer) | `Kultur` |
| Midzommar Z-Bräu | Z-Bräu Sommerfest | `Kultur` |

### frankenkids-scraper

Default: `Familie & Kinder` wenn Quell-Tags kinder-/familienbezogen oder Seite nur Familien-Events listet. Bei Sport/Konzert/Markt: generische Regeln anwenden.

### franmeisters-scraper

Default: `Workshops & PopUps` (Workshop/DIY/Basteln-Seite). Bei Markt/Messe: `Märkte & Messen`.

### rausgegangen-markt-scraper

Default: `Märkte & Messen`.

### rausgegangen-party-scraper

Default: `Musik & Nightlife`.

### rausgegangen-ausstellung-scraper

Default: `Kultur` (keine App-Kategorie „Ausstellung“).

### e-werk-scraper

| Quell-Kategorie | Kategorie |
|---|---|
| Party | `Musik & Nightlife` |
| Kino | `Kultur` |
| Kleinkunst & Slam | `Show & Performance` |
| Treff & Initiative | `Kultur` |
| Konzert, Genre (Techno, Folk, …) | `Musik & Nightlife` |

### gate-nuernberg-scraper

Club, Party, DJ, Techno, House → `Musik & Nightlife`. Bei Mehrfach-Tags (z. B. `Club;Party`): `Musik & Nightlife`.

### curt-termine-scraper

| CURT-Kategorie | Kategorie |
|---|---|
| KONZERT | `Musik & Nightlife` |
| THEATER, TANZ | `Show & Performance` |
| KINO | `Kultur` |
| MESSE, MARKT | `Märkte & Messen` |
| WORKSHOP, VORTRAG | `Workshops & PopUps` |
| KINDER, FAMILIE | `Familie & Kinder` |
| SPORT | `Sport & Fitness` |

### parks-nuernberg-scraper

Bei Mehrfach-Tags Priorität: Markt/Flohmarkt > Musik/Party > Comedy/Show/Quiz > Gastronomie → `Kultur`.

### meistersingerhalle-scraper, fuerth-veranstaltungen-scraper

Nur generische Keyword-Regeln (kein fester Default).

## Backend-Hinweis

CSV-Import (`POST /events/import/csv`) mappt `Kategorien` via `mapCategoryToId()`:

1. Exakter Treffer auf Kategorie-`name` (case-insensitive)
2. Exakter Treffer auf Kategorie-ID
3. Input enthält vollständigen Kategorie-`name` als Teilstring
4. Sonst: `default`

Rohe Quell-Genres wie `Metal`, `Party` oder `Flohmarkt` werden **nicht** automatisch gemappt — daher die Zuordnung im Scraper.
