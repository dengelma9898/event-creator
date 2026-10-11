import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractJsonPayload, validatePreviewEvents } from './assistant-parser.js';

const FENCE = '```';

/**
 * Bildet die reale Agent-Antwort für eventkalenderfranken.de (03.10.2026) nach:
 * Fließtext + JSON-Block, dessen `skillContent` selbst ```-Codeblöcke enthält.
 */
function realisticAgentAnswer(): string {
  const payload = {
    name: 'Eventkalender Franken',
    sourceType: 'aggregator',
    columnCount: 16,
    previewEvents: [
      {
        title: 'Handmade & Kreativmarkt',
        dateTime: '18. Oktober 2026, 10:00–17:00 Uhr',
        location: 'PARKS Nürnberg - Berliner Platz 9, Nürnberg, 90409',
        category: 'Märkte & Messen',
        ticketUrl: '',
        detailUrl: 'https://www.eventkalenderfranken.de/veranstaltungen/handmade-kreativmarkt/',
      },
      {
        title: 'Holterdiepolter – Improvisationstheater',
        dateTime: '3. Oktober 2026, 20:00 Uhr',
        location: 'JTF Junges Theater Forchheim - Kasernstr. 9, Forchheim, 91301',
        category: 'Show & Performance',
      },
    ],
    skillContent: `---\nname: x\n---\n# Skill\n${FENCE}js\nawait page.goto(url);\n${FENCE}\nText danach\n${FENCE}\nnoch ein Block\n${FENCE}\n`,
  };
  return `Die Analyse ist abgeschlossen.\n\n${FENCE}json\n${JSON.stringify(payload, null, 2)}\n${FENCE}\n`;
}

describe('extractJsonPayload', () => {
  it('liest JSON, dessen skillContent eigene ```-Blöcke enthält (Fake-Success-Ursache)', () => {
    const text = realisticAgentAnswer();

    // Beweis der Ursache: der frühere non-greedy Regex scheitert an genau diesem Text.
    const oldMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    assert.ok(oldMatch);
    assert.throws(() => JSON.parse(oldMatch![1]));

    const parsed = extractJsonPayload(text);
    assert.ok(parsed, 'JSON muss trotz verschachtelter Codeblöcke gelesen werden');
    assert.equal(parsed.previewEvents.length, 2);
    assert.equal(parsed.previewEvents[0].title, 'Handmade & Kreativmarkt');
  });

  it('liest JSON auch bei Fließtext nach dem Block', () => {
    const text = `${realisticAgentAnswer()}\nViel Erfolg! ${FENCE}\n`;
    assert.ok(extractJsonPayload(text));
  });

  it('liest JSON ohne ```json-Marker über die äußersten Klammern', () => {
    assert.deepEqual(extractJsonPayload('Ergebnis: {"a":1} Ende'), { a: 1 });
  });

  it('liefert null für leeren Text, Fließtext und kaputtes JSON', () => {
    assert.equal(extractJsonPayload(''), null);
    assert.equal(extractJsonPayload(undefined), null);
    assert.equal(extractJsonPayload('Ich konnte die Seite nicht lesen. Tickets gibt es nicht.'), null);
    assert.equal(extractJsonPayload(`${FENCE}json\n{ kaputt ${FENCE}`), null);
  });
});

describe('validatePreviewEvents', () => {
  const ctx = { resolvedName: 'Eventkalender Franken' };

  it('übernimmt echte Events unverändert', () => {
    const parsed = extractJsonPayload(realisticAgentAnswer());
    const { events, rejected } = validatePreviewEvents(parsed.previewEvents, ctx);
    assert.equal(events.length, 2);
    assert.equal(rejected.length, 0);
    assert.equal(events[0].location, 'PARKS Nürnberg - Berliner Platz 9, Nürnberg, 90409');
  });

  it('verwirft Platzhalter-Titel und Platzhalter-Daten (kein Fake-Success)', () => {
    const { events, rejected } = validatePreviewEvents(
      [
        { title: 'Eventkalender Franken - Beispielveranstaltung 1', dateTime: 'Demnächst' },
        { title: 'Eventkalender Franken Veranstaltung', dateTime: '3. Oktober 2026' },
        { title: 'Echtes Konzert', dateTime: 'Kommende Woche' },
        { title: 'Noch ein Konzert', dateTime: '' },
        { title: '', dateTime: '3. Oktober 2026' },
        { title: 'Muster-Event', dateTime: '3. Oktober 2026' },
      ],
      ctx
    );
    assert.equal(events.length, 0);
    assert.equal(rejected.length, 6);
  });

  it('erfindet weder Ort noch Datum', () => {
    const { events } = validatePreviewEvents(
      [{ title: 'Echtes Konzert', dateTime: '04.10.2026, 20:00' }],
      ctx
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].location, 'Ort nicht angegeben');
    assert.equal(events[0].dateTime, '04.10.2026, 20:00');
  });

  it('reicht optionale Zusatzfelder durch und bereinigt URLs', () => {
    const { events } = validatePreviewEvents(
      [
        {
          title: 'Markt der Ideen',
          dateTime: '12.10.2026, 11:00 Uhr',
          location: 'Kulturzentrum',
          category: 'Märkte & Messen',
          description: 'Ein bunter Markt voller regionaler Produkte.',
          address: 'Hauptstraße 1, 90402 Nürnberg',
          price: 'Eintritt frei',
          organizer: 'Musterverein e.V.',
          imageUrl: 'https://example.com/banner.jpg',
          ticketUrl: 'https://tickets.example.com/buy',
          detailUrl: 'https://example.com/events/123',
        },
        {
          title: 'Konzert mit ungültigen URLs und Leerfeldern',
          dateTime: '13.10.2026, 19:00 Uhr',
          location: 'Club',
          description: '   ',
          address: '',
          price: ' 15 Euro ',
          imageUrl: 'javascript:alert(1)',
          ticketUrl: 'keine-url',
          detailUrl: 'ftp://unsafe.com/link',
        },
      ],
      ctx
    );

    assert.equal(events.length, 2);

    // Event 1: alle Felder sauber vorhanden
    assert.equal(events[0].description, 'Ein bunter Markt voller regionaler Produkte.');
    assert.equal(events[0].address, 'Hauptstraße 1, 90402 Nürnberg');
    assert.equal(events[0].price, 'Eintritt frei');
    assert.equal(events[0].organizer, 'Musterverein e.V.');
    assert.equal(events[0].imageUrl, 'https://example.com/banner.jpg');
    assert.equal(events[0].ticketUrl, 'https://tickets.example.com/buy');
    assert.equal(events[0].detailUrl, 'https://example.com/events/123');

    // Event 2: ungültige URLs und leere Strings herausgefiltert
    assert.equal(events[1].description, undefined);
    assert.equal(events[1].address, undefined);
    assert.equal(events[1].price, '15 Euro');
    assert.equal(events[1].imageUrl, undefined);
    assert.equal(events[1].ticketUrl, undefined);
    assert.equal(events[1].detailUrl, undefined);
  });

  it('liefert bei Nicht-Array eine leere Liste', () => {
    assert.equal(validatePreviewEvents(undefined, ctx).events.length, 0);
    assert.equal(validatePreviewEvents({ title: 'x' }, ctx).events.length, 0);
  });
});
