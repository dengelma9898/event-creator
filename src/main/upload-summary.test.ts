import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summarizeUpload } from '../shared/upload-summary.js';
import type { UploadFileResult, UploadResult } from '../shared/types.js';

/** Eine erfolgreich beantwortete Datei – die Kennzahlen kommen aus der Backend-Antwort. */
const okFile = (): UploadFileResult => ({
  fileName: 'a.csv',
  success: true,
  created: 0,
  duplicates: 0,
  failed: 0,
  totalRows: 0,
});

/** Baut ein Ergebnis; `totalRows` ist standardmäßig die Summe der drei Zähler. */
const result = (overrides: Partial<UploadResult>): UploadResult => {
  const base: UploadResult = {
    target: 'prod',
    success: true,
    created: 0,
    duplicates: 0,
    failed: 0,
    totalRows: 0,
    files: [okFile()],
    ...overrides,
  };
  if (overrides.totalRows === undefined) {
    base.totalRows = base.created + base.duplicates + base.failed;
  }
  return base;
};

describe('summarizeUpload – Erfolg (Wortlaut wie im Admin-Frontend)', () => {
  it('meldet „Import erfolgreich“ mit erstellten und verarbeiteten Zeilen', () => {
    const s = summarizeUpload(result({ created: 12 }));
    assert.equal(s.tone, 'success');
    assert.equal(s.headline, 'Import erfolgreich');
    assert.deepEqual(s.lines, ['12 von 12 Events wurden erstellt.']);
    assert.equal(s.action, 'none');
  });

  it('nennt übersprungene Duplikate in derselben Zeile', () => {
    const s = summarizeUpload(result({ created: 12, duplicates: 3 }));
    assert.equal(s.tone, 'success');
    assert.deepEqual(s.lines, ['12 von 15 Events wurden erstellt. 3 Duplikate übersprungen.']);
  });

  it('meldet „Import teilweise erfolgreich“ mit allen drei Zählern', () => {
    const s = summarizeUpload(result({ created: 10, failed: 2, duplicates: 1, detailsForDomi: 'x' }));
    assert.equal(s.tone, 'warning');
    assert.equal(s.headline, 'Import teilweise erfolgreich');
    assert.equal(s.lines[0], '10 erstellt, 2 fehlgeschlagen, 1 übersprungen.');
    assert.equal(s.offerDetails, true);
    assert.equal(s.action, 'none');
  });

  it('meldet „Import fehlgeschlagen“, wenn nichts erstellt werden konnte', () => {
    const s = summarizeUpload(result({ failed: 4, duplicates: 1, detailsForDomi: 'x' }));
    assert.equal(s.tone, 'error');
    assert.equal(s.headline, 'Import fehlgeschlagen');
    assert.equal(s.lines[0], 'Keine Events konnten erstellt werden. 4 fehlgeschlagen, 1 Duplikate.');
    assert.equal(s.offerDetails, true);
  });

  it('behandelt „nur Duplikate“ nicht als Fehler', () => {
    const s = summarizeUpload(result({ duplicates: 5 }));
    assert.equal(s.tone, 'success');
    assert.equal(s.headline, 'Alles war schon vorhanden.');
    assert.deepEqual(s.lines, ['Keine neuen Events erstellt. 5 Duplikate übersprungen.']);
  });

  it('sagt, wenn es nichts hochzuladen gab', () => {
    const s = summarizeUpload(result({}));
    assert.equal(s.headline, 'Es gab keine Termine zum Hochladen.');
    assert.equal(s.tone, 'success');
  });

  it('liefert die drei Kennzahlen aus der Backend-Antwort', () => {
    const s = summarizeUpload(result({ created: 7, duplicates: 2, failed: 1, detailsForDomi: 'x' }));
    assert.deepEqual(s.counts, { created: 7, duplicates: 2, failed: 1, totalRows: 10 });
  });

  it('nennt die Stage, an die hochgeladen wurde', () => {
    assert.equal(summarizeUpload(result({ created: 1, target: 'test' })).stageLabel, 'Test (Citylife)');
    assert.equal(summarizeUpload(result({ created: 1, target: 'prod' })).stageLabel, 'Prod (Nürnbergspots)');
  });

  it('kommt ohne Fachbegriffe aus', () => {
    const text = JSON.stringify(summarizeUpload(result({ created: 3, duplicates: 1, failed: 1, detailsForDomi: 'x' })));
    for (const word of ['CSV', 'API', 'Token', 'Firebase', 'HTTP', 'Backend', 'Upload']) {
      assert.ok(!text.includes(word), `„${word}“ gehört nicht in die Oberfläche`);
    }
  });
});

describe('summarizeUpload – Fehler', () => {
  const failed = (overrides: Partial<UploadResult>) => result({ success: false, files: [], ...overrides });

  it('bietet bei abgelaufener Anmeldung das erneute Anmelden an', () => {
    const s = summarizeUpload(failed({ errorKind: 'session-expired', error: 'Deine Anmeldung ist abgelaufen.' }));
    assert.equal(s.tone, 'error');
    assert.equal(s.action, 'login');
    assert.equal(s.headline, 'Anmeldung abgelaufen');
  });

  it('bietet ohne Verbindung das Anmelden an', () => {
    assert.equal(summarizeUpload(failed({ errorKind: 'not-connected' })).action, 'login');
  });

  it('bietet bei Netz- und Serverproblemen „Noch einmal versuchen“ an', () => {
    assert.equal(summarizeUpload(failed({ errorKind: 'network' })).action, 'retry');
    assert.equal(summarizeUpload(failed({ errorKind: 'server' })).action, 'retry');
  });

  it('bietet bei fehlender Berechtigung oder ungültiger Datei keine Wiederholung an', () => {
    assert.equal(summarizeUpload(failed({ errorKind: 'forbidden' })).action, 'none');
    assert.equal(summarizeUpload(failed({ errorKind: 'invalid-file' })).action, 'none');
  });

  it('zeigt ohne Antwort des Backends keine Kennzahlen', () => {
    assert.equal(summarizeUpload(failed({ errorKind: 'network' })).counts, null);
  });

  it('nennt bei einem Teilerfolg, was schon online ist, und behält die Kennzahlen', () => {
    const s = summarizeUpload(
      result({ success: false, created: 50, errorKind: 'network', error: 'Nicht erreichbar.', detailsForDomi: 'x' })
    );
    assert.deepEqual(s.lines, ['50 Termine sind schon online.', 'Nicht erreichbar.']);
    assert.equal(s.offerDetails, true);
    assert.equal(s.counts?.created, 50);
  });

  it('fällt ohne Ursache auf ein Serverproblem zurück', () => {
    assert.equal(summarizeUpload(failed({})).headline, 'Nürnbergspots hat die Termine nicht angenommen');
  });
});
