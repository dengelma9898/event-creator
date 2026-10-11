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
        entry: 'src/preload/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'src/preload/preload.ts',
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: {
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
