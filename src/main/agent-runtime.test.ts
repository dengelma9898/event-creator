/**
 * Der Hauptprozess muss das Cursor-SDK im selben Node laden können wie die App.
 *
 * `@cursor/sdk` lädt beim ersten Shell-Aufruf ein natives tree-sitter-Add-on
 * (`vendor/tree-sitter/binding.node`) ohne jede Prüfung, ob es lauffähig ist.
 * Das Add-on ist gegen N-API 10 gebaut. Electron 34.5.8 bringt Node 20.19.1 mit
 * N-API 9 – und stirbt beim Laden mit SIGSEGV, ohne Meldung: der Lauf endet,
 * das Fenster verschwindet, die App beendet sich. Genau das ist einmal
 * passiert; es gab keinen Fehlertext, nur einen leeren Bildschirm.
 *
 * Diese Suite lädt das Add-on in einem Kindprozess unter der Electron-Binary
 * des Projekts. Segfaultet der Host, schlägt der Test fehl – nicht die App zur
 * Laufzeit, sondern hier, vor dem Build.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = process.env.EVENT_CREATOR_PROJECT_ROOT;
const requireFromProject = createRequire(path.join(projectRoot || '.', 'package.json'));

/** Die Electron-Binary, die `npm run dev` und der gepackte Build benutzen. */
function electronBinary(): string | null {
  try {
    const bin = requireFromProject('electron');
    return typeof bin === 'string' && fs.existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/**
 * Das native Add-on des SDK. Der Paketname traegt die Plattform
 * (`sdk-darwin-arm64`), deshalb wird er nicht hart verdrahtet.
 */
function treeSitterBinding(): string | null {
  const scope = path.join(projectRoot || '.', 'node_modules', '@cursor');
  if (!fs.existsSync(scope)) return null;
  for (const pkg of fs.readdirSync(scope)) {
    const candidate = path.join(scope, pkg, 'vendor', 'tree-sitter', 'binding.node');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const binary = electronBinary();
const binding = treeSitterBinding();

describe('Laufzeitumgebung des Agenten', () => {
  it('findet Electron-Binary und natives SDK-Add-on', () => {
    // Ohne eine der beiden Dateien wäre der Test stillschweigend grün.
    assert.ok(binary, 'Electron-Binary nicht auffindbar – node_modules/electron prüfen');
    assert.ok(binding, 'node_modules/@cursor/sdk-*/vendor/tree-sitter/binding.node nicht auffindbar');
  });

  it('lädt das native tree-sitter-Add-on im Electron-Hauptprozess ohne Absturz', { skip: !binary || !binding ? 'Electron oder SDK-Add-on nicht installiert' : false }, () => {
    const probe = [
      'const b = process.argv[1];',
      'console.log(JSON.stringify({ node: process.versions.node, napi: process.versions.napi }));',
      'require(b);',
      'console.log("ADDON_OK");',
    ].join('\n');

    const child = spawnSync(binary!, ['-e', probe, binding!], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });

    const runtime = (child.stdout || '').split('\n')[0] || '';
    const loaded = (child.stdout || '').includes('ADDON_OK');

    assert.equal(
      child.signal,
      null,
      `Electron ist beim Laden von ${path.basename(path.dirname(binding!))}/binding.node ` +
        `abgestürzt (Signal ${child.signal}). ${runtime} – bitte eine Electron-Version ` +
        'wählen, deren Node N-API 10 unterstützt (>= 38).'
    );
    assert.equal(child.status, 0, `Add-on nicht ladbar. ${runtime}\n${child.stderr || ''}`);
    assert.ok(loaded, `Add-on lud ohne Fehler, meldete aber kein Erfolg. ${runtime}`);
  });
});
