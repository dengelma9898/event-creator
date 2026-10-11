import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  APP_CATEGORIES,
  APP_CATEGORIES_SET,
  isValidAddress,
  isValidTime,
  assessEventQuality,
} from '../shared/event-quality.js';

describe('Event-Qualität: Adress-Validierung (geocodierbar)', () => {
  it('akzeptiert Adressen, die das Backend per Geocoding auffinden kann', () => {
    const validSamples = [
      // klassische Vollanschrift
      'Frankenstraße 200, 90461 Nürnberg',
      'Z-Bau, Frankenstraße 200, 90461 Nürnberg',
      'Hauptstr. 12a, 90762 Fürth',
      'Am Plärrer 14, 90443 Nürnberg',
      'Messezentrum 1, 90471 Nürnberg',
      // PLZ nach der Stadt (Reihenfolge egal)
      'Albrecht-Dürer-Haus - Albrecht-Dürer-Str. 39 Nürnberg, 90403',
      'Mehrgenerationenhaus Mütterzentrum Fürth - Rosenstraße 16-20 Fürth, 90762',
      // ohne Hausnummer (Straße/Venue + PLZ + Stadt)
      'Frankenstraße, 90461 Nürnberg',
      'Erfahrungsfeld der Sinne, Johann-Soergel-Weg, 90403 Nürnberg',
      'Mono Bar, 90402 Nürnberg',
      'Veste Coburg - Coburg, 96450',
      // ohne PLZ, aber Straße + Hausnummer + Stadt
      'PZ-Kulturraum Lauf, Nürnberger Straße 19, Lauf an der Pegnitz',
      'Z-Bau, Frankenstraße 200, Nürnberg',
    ];

    for (const addr of validSamples) {
      assert.equal(isValidAddress(addr), true, `Sollte gültig sein: "${addr}"`);
    }
  });

  it('weist Angaben ab, die sich nicht auf einen Ort abbilden lassen', () => {
    const invalidSamples = [
      'Meistersingerhalle - Großer Saal', // nur Venue-Name, kein Ort
      'DEUTSCHES MUSEUM NÜRNBERG – ZUKUNFTSMUSEUM',
      'Fürth, Innenstadt', // nur Stadtteil, keine Stelle
      'Z-Bau – Haus für Gegenwartskultur, Frankenstraße 200', // Straßenname ohne Ort (mehrdeutig)
      '90461 Nürnberg', // nur Ort, keine Stelle
      'Frankenstraße 200', // keine PLZ & Stadt
      'Weitere Termine für diese Veranstaltung, Freitag, 28. August 2026',
      'Kategorie 1, Eintritt 12 Euro Early Bird Tickets: 12 €',
      '',
      '   ',
      undefined,
      null,
    ];

    for (const addr of invalidSamples) {
      assert.equal(isValidAddress(addr), false, `Sollte ungültig sein: "${addr}"`);
    }
  });
});

describe('Event-Qualität: Zeit-Validierung', () => {
  it('akzeptiert leere Zeitangaben oder das Format HH:mm', () => {
    assert.equal(isValidTime(''), true);
    assert.equal(isValidTime(undefined), true);
    assert.equal(isValidTime('20:00'), true);
    assert.equal(isValidTime('09:30'), true);
    assert.equal(isValidTime('23:59'), true);
    assert.equal(isValidTime('00:00'), true);
  });

  it('weist ungültige Zeitformate ab', () => {
    assert.equal(isValidTime('24:00'), false);
    assert.equal(isValidTime('12:60'), false);
    assert.equal(isValidTime('20 Uhr'), false);
    assert.equal(isValidTime('8:00'), false); // einstellige Stunde ohne führende Null
    assert.equal(isValidTime('abc'), false);
  });
});

describe('Event-Qualität: App-Kategorien', () => {
  it('enthält genau die 7 Standardkategorien der App', () => {
    assert.equal(APP_CATEGORIES.length, 7);
    assert.ok(APP_CATEGORIES_SET.has('Musik & Nightlife'));
    assert.ok(APP_CATEGORIES_SET.has('Familie & Kinder'));
    assert.ok(APP_CATEGORIES_SET.has('Workshops & PopUps'));
    assert.ok(APP_CATEGORIES_SET.has('Märkte & Messen'));
    assert.ok(APP_CATEGORIES_SET.has('Show & Performance'));
    assert.ok(APP_CATEGORIES_SET.has('Kultur'));
    assert.ok(APP_CATEGORIES_SET.has('Sport & Fitness'));
  });
});

describe('Event-Qualität: Qualitätsbewertung (assessEventQuality)', () => {
  it('erzeugt einen vollständigen Report mit Warnungen und Validitäts-Status', () => {
    // Unvollständige Adresse -> isValid: false
    const badAddress = assessEventQuality({
      location: 'Meistersingerhalle - Großer Saal',
      startTime: '20:00',
      imageUrl: 'https://example.com/img.jpg',
    });
    assert.equal(badAddress.isValid, false);
    assert.equal(badAddress.hasInvalidAddress, true);
    assert.equal(badAddress.hasNoTime, false);
    assert.equal(badAddress.hasNoImage, false);
    assert.ok(badAddress.issues.some((i) => i.id === 'invalid-address'));

    // Fehlende Zeit und fehlendes Bild
    const missingTimeAndImg = assessEventQuality({
      location: 'Frankenstraße 200, 90461 Nürnberg',
      startTime: '',
      imageUrl: '',
    });
    assert.equal(missingTimeAndImg.isValid, true);
    assert.equal(missingTimeAndImg.hasInvalidAddress, false);
    assert.equal(missingTimeAndImg.hasNoTime, true);
    assert.equal(missingTimeAndImg.hasNoImage, true);
    assert.equal(missingTimeAndImg.issues.length, 2);

    // Vollständig sauber
    const clean = assessEventQuality({
      location: 'Frankenstraße 200, 90461 Nürnberg',
      startTime: '20:00',
      imageUrl: 'https://example.com/pic.jpg',
    });
    assert.equal(clean.isValid, true);
    assert.equal(clean.issues.length, 0);
  });
});
