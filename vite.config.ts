import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { RENDERER_CSP } from './src/shared/renderer-policy';

/**
 * Die gepackte App laedt den Renderer per `file://` – dort greifen keine
 * HTTP-Header, also braucht es den CSP als <meta>-Tag im Dokument.
 * Im Dev-Server liefert main.ts die Policy stattdessen per Header.
 */
function cspMetaTag(): Plugin {
  return {
    name: 'csp-meta-tag',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => ({
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: RENDERER_CSP },
            injectTo: 'head-prepend',
          },
        ],
      }),
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    cspMetaTag(),
    electron([
      {
        entry: 'src/main/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['@cursor/sdk', 'electron'],
            },
          },
        },
      },
      {
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            // Bewusst kein `entry`/`build.lib`: Mit `"type": "module"` ergänzt
            // vite-plugin-electron `formats: ['es']`, Vite fügt das Array mit
            // unserem `['cjs']` zusammen und beide Formate schreiben in dieselbe
            // `preload.cjs` – je nach Rennen entsteht ESM, das der Sandbox-
            // Preload nicht laden kann (`window.electronAPI` fehlt).
            rollupOptions: {
              input: 'src/preload/preload.ts',
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
});
