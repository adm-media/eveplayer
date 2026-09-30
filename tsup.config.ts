/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Build-time constant for `EvePlayer.version`: the `package.json` version at
// the moment of the build (`prepublishOnly` runs `yarn build`, so a published
// bundle always carries the version it was published as). `src/globals.d.ts`
// declares the identifier for tsc; esbuild inlines the literal here.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts'],
  // 'iife' is the CDN build (jsdelivr / unpkg / a plain <script> tag): a
  // self-executing bundle exposing `window.EvePlayer`, built with the same
  // aliases and inlining as esm/cjs below — no separate config, no drift.
  format: ['esm', 'cjs', 'iife'],
  globalName: 'EvePlayer',
  platform: 'browser',
  dts: true,
  clean: true,
  sourcemap: true,
  // Fully self-contained: nothing is left external. A consumer installs zero
  // runtime deps and needs zero bundler config. Two aliases do the work:
  //
  //   video.js  ->  video.js/core.es.js
  //     The default `video.js` entry (`video.es.js`) *bundles its own copy of
  //     `@videojs/http-streaming`*, worker `fn.toString()` and all — so pulling
  //     in plain `video.js` (external or inlined) drags that transmuxer worker
  //     back in regardless of the VHS alias below. `core.es.js` is Video.js
  //     without the bundled VHS (the layout Video.js itself recommends when you
  //     want to pin the streaming engine).
  //
  //   @videojs/http-streaming  ->  .../videojs-http-streaming-sync-workers.js
  //     VHS's prebuilt bundle that has NO Worker / Blob / `fn.toString()` at
  //     all (transmux runs on the main thread), so no minifier — ours or the
  //     consumer's — can mangle a serialised worker into `ReferenceError`.
  //     It is UMD-only (no ESM build exists); because `video.js` is inlined
  //     too, its `require('video.js')` resolves inside the bundle and does not
  //     become esbuild's throwing `__require` shim.
  //
  // `@xmldom/xmldom` (pulled in by the VHS bundle for DASH manifest parsing) is
  // inlined as well.
  //
  // Trade-off: a consumer that also imports `video.js` directly gets a second,
  // separate copy (this library's design is that consumers never touch Video.js
  // directly). If `videojs-contrib-eme` DRM is ever wired up it must be bundled
  // here too, against this same Video.js copy.
  //
  // Minifying the whole bundle — ours and the vendored code — is safe precisely
  // because nothing in it builds a worker from a stringified function, and it
  // keeps `dist/` to a sane size. See docs/adr/0006.
  define: { __EVE_VERSION__: JSON.stringify(version) },
  external: [],
  noExternal: ['video.js', '@videojs/http-streaming', '@xmldom/xmldom'],
  minify: true,
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      'video.js': 'video.js/core.es.js',
      '@videojs/http-streaming':
        '@videojs/http-streaming/dist/videojs-http-streaming-sync-workers.js',
    };
  },
  outDir: 'dist',
});
