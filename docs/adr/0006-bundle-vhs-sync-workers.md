# ADR-0006: Inline `video.js` and `@videojs/http-streaming` into `dist/`, pinned to `core.es.js` / `sync-workers`

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

`@videojs/http-streaming` (VHS) was listed in `tsup.config.ts`'s `external`, so
the shipped `dist/index.js` contained a bare `import "@videojs/http-streaming"`
and every consumer's bundler resolved and processed VHS itself.

VHS's ESM build (`videojs-http-streaming.es.js`, the `module` entry a bundler
picks) constructs its transmuxer and decrypter Web Workers by **serialising a
live function at runtime**:

```js
const workerCode = transform(getWorkerString(function () { /* mux.js inline */ }));
// getWorkerString = fn => fn.toString().replace(/^function.+?{/, '').slice(0, -1)
```

The worker body is literally `fn.toString()`. That is fine unminified. But when
a consumer minifies VHS with **Terser** (Create React App / webpack, whose
presets do `mangle` plus `reduce_vars` / `collapse_vars` / `unused` / helper
hoisting), the string produced by `.toString()` is left referencing an
identifier that only existed in the surrounding module scope. Inside the Blob
worker that becomes:

```
Uncaught ReferenceError: f is not defined
    at <blob-uuid>:3:1843
```

It reproduces only when **all three** hold:

- the segments are MPEG-TS: the transmuxer worker (TS → fMP4 for MSE) only runs
  for TS; fMP4/CMAF segments bypass it and play fine;
- the build is minified (dev servers are unaffected);
- the minifier does cross-scope work: Terser does; esbuild's minifier (Vite) is
  conservative and does not. A webpack build with near-default Terser options is
  usually spared too; an aggressive CRA-style preset reliably triggers it.

> **Corrected on 2026-09-30.** A controlled reproduction (see *Update:
> reproduction* below) showed that the minifier is not the cause and that the
> crash is not limited to MPEG-TS. The consumer's **Babel** pass over
> `node_modules` injects module-scope helper imports into the worker function;
> Terser only renames the missing helper to `f`. The decision stands.

A consumer *can* patch around it (alias `@videojs/http-streaming` to a prebuilt
VHS bundle, or exclude it from minification), but that is one workaround per
consuming project, re-applied on every CRA/webpack app.

VHS ships prebuilt bundles in `dist/`:

| build | worker | size | notes |
|---|---|---|---|
| `videojs-http-streaming.es.js` (the `module` entry) | live `fn` + `toString()`, **not** minified | ~1 MB | breaks under a consumer's Terser |
| `videojs-http-streaming.min.js` | Blob worker, but the worker `fn` is already VHS-minified + self-contained | 374 KB | UMD; still uses `fn.toString()`, so a second Terser pass is low-risk, not no-risk |
| `videojs-http-streaming-sync-workers.js` | **no Worker / Blob / `toString()`** (transmux on the main thread) | ~1.25 MB | UMD; `require`s `video.js` + `@xmldom/xmldom` |

## Decision

Inline both `video.js` and VHS into the build: nothing playback-related is left
for a consumer's bundler or minifier to touch.

`tsup.config.ts`:

- `external: []`: nothing is external.
- `noExternal: ['video.js', '@videojs/http-streaming', '@xmldom/xmldom']`:
  inline all three. `@xmldom/xmldom` is a transitive need of the `sync-workers`
  VHS bundle (DASH manifest parsing).
- `esbuildOptions.alias`:
  - `@videojs/http-streaming` →
    `@videojs/http-streaming/dist/videojs-http-streaming-sync-workers.js`: no
    Worker / Blob / `fn.toString()`, so no minifier (this library's, or a
    consumer's if they ever double-bundle) can mangle a serialised worker into
    a free-identifier crash.
  - `video.js` → `video.js/core.es.js`: Video.js without its own bundled copy
    of VHS. The *default* `video.js` entry (`video.es.js`) bundles its own VHS
    with the same vulnerable worker, which would otherwise sneak back in
    regardless of the alias above.
- `minify: true`: safe, since nothing left in the bundle builds a worker from a
  stringified function. Keeps `dist/index.js` at ~740 KB.

`video.js` and `@videojs/http-streaming` both move from `dependencies` to
`devDependencies` (build-time only); `@xmldom/xmldom` is inlined too. **The
package has zero runtime dependencies.**

This is the second, final cut of this decision (see History below for why the
first cut, VHS only, `video.js` left external, turned out not to be enough).

## Alternatives considered

- **Pin to `videojs-http-streaming.min.js` instead.** Keeps the transmuxer off
  the main thread (its Web Worker survives), and it is the artefact VHS
  recommends for production. Rejected as the default: `min.js` still builds its
  worker with `fn.toString()` on a live function, so a second Terser pass over
  the inlined copy is only *unlikely* to reintroduce a free identifier, not
  unable to. `sync-workers` removes the mechanism entirely, which is worth more
  than the worker offload for a library that must build correctly in every
  consumer's pipeline. `min.js` is also UMD-only like `sync-workers`, so it
  would need the same `video.js` inlining to avoid the dynamic-require problem
  described in History, and it buys nothing over `sync-workers` while keeping
  the `fn.toString()` risk. Revisit if main-thread transmux jank on live TS is
  actually reported.
- **Leave VHS `external`, document the consumer-side workaround.** Rejected:
  every CRA/webpack consumer hits it and re-implements the same alias; bad DX
  and a support burden.
- **Keep VHS `external` but change the library's own import to a deep path.**
  Rejected: a bare deep import into a package that is no longer a declared
  dependency is fragile, and a UMD deep path left external still has to be
  resolved and processed by the consumer.
- **Consumer minifier config only** (`keep_fnames` etc.). Rejected: the free
  identifier comes from `compress` hoisting, not only from `mangle`, so
  `keep_fnames` is not a reliable fix, and it is still per-consumer. (The
  2026-09-30 reproduction goes further: the build breaks with minification
  turned off entirely, so no minifier setting can fix it.)
- **Declare `video.js` / VHS as `peerDependencies`.** Same outcome as leaving
  them `external`: the consumer's toolchain resolves, transpiles and minifies
  VHS. Measured on 2026-09-30 to break under a CRA-style Babel pass and to
  ship two copies of VHS (see below).

## Consequences

**Good**

- The entire class of "consumer minifier breaks the VHS worker" bug is gone:
  there is no serialised worker function left to mangle. The built
  `dist/index.js` contains zero `getWorkerString` / `new Worker(` / `new Blob(`
  / `toString().replace`, and zero `Dynamic require` / external `import`/
  `require` of any kind.
- Consumers install nothing for playback: no `video.js`, `@videojs/http-
  streaming`, or `@xmldom/xmldom` in their own dependency tree.
- **Zero runtime dependencies**, full stop.
- Works identically for ESM and CJS consumers (the VHS-only first cut broke
  ESM specifically; see History).
- One fewer moving part in every consuming app's bundler config.

**Costs / watch-outs**

- **TS transmux runs on the main thread**, an inherent trade-off of the
  `sync-workers` VHS build. For MPEG-TS HLS this can cause playback-start /
  seek jank on weak devices. fMP4/CMAF is unaffected (no transmux). If this
  bites, there is no drop-in fix: `videojs-http-streaming.min.js` was
  considered and rejected above for the same reason it can't be swapped in
  later without re-solving the dynamic-require problem.
- `dist/index.js` sits at ~740 KB. It is a video player library shipping its
  own engine and streaming stack; acceptable, and it is `dist`, not `src`.
- A consumer that *also* depends on `video.js` or `@videojs/http-streaming`
  directly ships a second, separate copy and can double-register the VHS
  source handler. Consumers should not touch either directly (the whole point
  of this library).
- Both `tsup` aliases and the full `noExternal` list must stay together:
  dropping either the `video.js` or the VHS alias alone reintroduces a real
  dependency or resurrects the original worker bug.
- Both pinned paths (`.../videojs-http-streaming-sync-workers.js`,
  `video.js/core.es.js`) are stable across their current major versions but
  are not documented public entry points; check they still exist on a major
  VHS or Video.js bump.
- Bundling means VHS/`video.js` upgrades ship only when the library is rebuilt
  and republished, not when a consumer bumps a transitive range.
- `videojs-contrib-eme` (optional peer, DRM, not yet wired up) will need
  bundling here too when it lands, so it registers against this same Video.js
  copy.

## History

- VHS was `external` from the initial build setup, a regular `dependency`,
  alongside `video.js` (also `external`). The `ReferenceError`-in-the-Blob-
  worker crash above was seen in a downstream CRA/webpack app's production
  build on MPEG-TS HLS streams, which is what prompted moving VHS in-bundle.
- **First cut:** inlined only VHS, pinned to `sync-workers`, kept `video.js`
  external, `minify: false`. Fixed the Terser crash for the standalone VHS
  path, but two problems surfaced immediately:
  1. The *default* `video.js` entry (`video.es.js`, what a bundler picks)
     bundles its **own** copy of VHS (`getWorkerString`, `fn.toString()`
     worker and all), so Video.js's internal VHS still dragged the vulnerable
     worker into the consumer's bundle regardless of the standalone alias.
  2. `sync-workers` is UMD-only (no ESM build). esbuild wraps it in a lazy
     `__commonJS()` shim, and its `require('video.js')` to an *external*
     inside that shim, in **ESM output**, is lowered to esbuild's throwing
     `__require()` helper: `Dynamic require of "video.js" is not supported`,
     wherever a global `require` is absent (Vite, native ESM, some webpack
     setups). The `dist/index.cjs` build was fine; `dist/index.js` was not.
  - Fix: also inline `video.js`, aliased to `video.js/core.es.js`: the second
    and final cut, now the **Decision** above. `minify: true` became safe once
    nothing left in the bundle builds a worker from a stringified function,
    and it brought `dist/index.js` down to ~740 KB (smaller than the ~1.15 MB
    of the VHS-only, `video.js`-external first cut).
  - Verified on the built bundle: no `Dynamic require`, no external `import`/
    `require` at all, zero `getWorkerString` / `new Worker(` / `workerCode`; a
    jsdom smoke test imports `dist/index.js`, constructs `EvePlayer`, and
    runs `setSource()` without throwing.

## Update: reproduction (2026-09-30)

Before the 1.0 release the decision was re-checked with a controlled
experiment instead of relying on the original field report.

**Setup.** The current `src/` was built the pre-decision way (`external:
['video.js', '@videojs/http-streaming']`, no aliases, not minified) and
imported by a one-file consumer app that creates an `EvePlayer` and plays an
HLS source. Each app build was loaded in headless Google Chrome (real H.264
support) against a public MPEG-TS stream and a public fMP4 stream; a run
passes when playback advances and no worker reports an error. The same app
was also built against the published `@admmedia/eveplayer@1.0.0`.

| Consumer build | `external` layout | Published 1.0.0 |
|---|---|---|
| webpack 5 + Terser 5, or Terser 4.8.1 with the CRA 4 `terserOptions`; no Babel over dependencies | plays (TS and fMP4) | plays |
| Create React App 4 production pipeline: webpack 4.44, `babel-preset-react-app/dependencies` with `helpers: true` and a production `browserslist` (`>0.2%, not dead, not op_mini all`), Terser 4.8.1 | **broken**: `Uncaught ReferenceError: f is not defined` in the worker, playback stuck at 0, **TS and fMP4** | plays, no worker created |
| the same CRA 4 pipeline with minification turned off | **broken**: `…babel_runtime_helpers_esm_createClass_js__WEBPACK_IMPORTED_MODULE_11__ is not defined` | not run |

**Root cause.** Create React App (and any webpack setup that runs Babel with
helpers over `node_modules`) transpiles VHS's worker function for the
production browser targets. Transpiling the classes inside that function makes
Babel add imports of runtime helpers (`_createClass`, …) at **module** scope.
`getWorkerString(fn)` then serialises a body that calls those helpers without
containing them, and the Blob worker throws as soon as it evaluates. Terser only
renamed the missing helper to `f`. This also explains why dev builds were
unaffected: CRA's development `browserslist` targets current browsers only, so
no class transform and no helpers.

This corrects the Context above on two points: the minifier is not the cause,
and the failure is not limited to MPEG-TS (the worker dies at start-up, which
stalls fMP4 playback as well in this setup). It does not change the decision.
It strengthens it: whether an `external` or peer-dependency VHS works depends
on how each consumer compiles `node_modules`, which a published library cannot
control.

**Size.** The `external` layout also ships **two copies of VHS**: the default
`video.js` entry (`video.es.js`) bundles one, and the separate
`@videojs/http-streaming` import adds the other. Measured on the same app:

| Consumer build | `external` layout | Published 1.0.0 |
|---|---|---|
| webpack 5, default production minification | 1.06 MB (299 KB gzip) | 0.74 MB (212 KB gzip) |
| CRA 4 pipeline | 1.20 MB (324 KB gzip) | 0.88 MB (240 KB gzip) |

The saving comes from the entry points chosen (`core.es.js` plus a single VHS),
not from inlining as such. It holds as long as the consuming app does not load a
second `video.js` of its own.
