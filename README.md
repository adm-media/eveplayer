# @admmedia/eveplayer

A production-grade, framework-agnostic TypeScript player library built on [Video.js](https://videojs.com/).

Supports **MP4**, **MP3**, **HLS** (`.m3u8`), **MPEG-DASH** (`.mpd`), and **CMAF** delivered over HLS or DASH manifests. Targets modern evergreen browsers and Safari (iOS and macOS).

A React wrapper is maintained in a separate repository and consumes this package as a dependency.

---

## Installation

Published publicly on npm:

```bash
npm install @admmedia/eveplayer
# or
yarn add @admmedia/eveplayer
```

**This package has no runtime dependencies.** `video.js` and
`@videojs/http-streaming` (VHS) are both **inlined into the shipped bundle** —
you do not install them, and no bundler config is needed. VHS is pinned to its
prebuilt `sync-workers` build and `video.js` to its VHS-free `core.es.js` entry,
so that no consumer minifier can break VHS's transmuxer worker (see
[ADR-0006](docs/adr/0006-bundle-vhs-sync-workers.md)); the trade-off is that
MPEG-TS segments are transmuxed on the main thread rather than in a Web Worker.

> | Package                   | Version | Bundled from          | How it ships                           |
> |---------------------------|---------|-----------------------|----------------------------------------|
> | `video.js`                | `8.x`   | `video.js/core.es.js` | **inlined** — not a dependency         |
> | `@videojs/http-streaming` | `3.x`   | `…-sync-workers.js`   | **inlined** — not a dependency         |
> | `videojs-contrib-eme`     | `^5`    | —                     | optional peer dependency (DRM, future) |

Import the stylesheet separately (see below).

### CDN (no build step)

For a plain HTML page with no bundler, load the pre-built browser bundle from
[jsDelivr](https://www.jsdelivr.com/package/npm/@admmedia/eveplayer). It
self-registers as the `EvePlayer` global:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@admmedia/eveplayer/dist/style.css" />
<script src="https://cdn.jsdelivr.net/npm/@admmedia/eveplayer/dist/index.global.js"></script>

<script>
  const player = new EvePlayer.EvePlayer(document.getElementById('player-container'));
</script>
```

Pin an exact version in the URL for production
(`@admmedia/eveplayer@1.0.0/dist/...`) — the unpinned path always resolves to
latest.

---

## Minimal working example

```ts
import { EvePlayer } from '@admmedia/eveplayer';
import '@admmedia/eveplayer/style.css';

const container = document.getElementById('player-container')!;

const player = new EvePlayer(container, {
  widescreen: true,
  autoplay: false,
  muted: false,
});

player.setSource({
  sources: [{ src: 'https://example.com/video.mp4', type: 'video/mp4' }],
  poster: 'https://example.com/poster.jpg',
});

player.on('play', () => console.log('Playing'));
player.on('timeupdate', ({ currentTime }) => console.log('Time:', currentTime));
player.on('error', (err) => console.error('Error:', err.code, err.message));

// When done (e.g. navigating away)
player.dispose();
```

---

## API reference

### `new EvePlayer(container, options?)`

| Option           | Type      | Default | Description                                              |
|------------------|-----------|---------|----------------------------------------------------------|
| `autoplay`       | `boolean` | `false` | Start playback automatically                             |
| `muted`          | `boolean` | `false` | Start muted. Initial state only: once unmuted (by the viewer or by `player.muted = false`) the player never re-mutes itself, source swaps included |
| `loop`           | `boolean` | `false` | Loop playback                                            |
| `widescreen`     | `boolean` | `false` | Fixed 16:9 frame on the container, filled by the player: other aspect ratios are letterboxed inside it, the box never resizes with the media. See "Sizing" below |
| `hideControls`   | `boolean` | `false` | Hide the Video.js control bar                            |
| `hidePlayButton` | `boolean` | `false` | Hides the big play button overlay; poster stays visible  |
| `background`     | `boolean` | `false` | Decorative "background video" mode for use behind other UI. Implies `hideControls`; also defaults `autoplay`/`muted`/`loop` to `true` (only where not explicitly set), hides the loading spinner and error overlay, disables the native right-click context menu, and marks the container `aria-hidden` |
| `hideSpeed`      | `boolean` | `false` | Hide the "Playback speed" section from the settings menu |
| `pip`            | `boolean` | `true`  | Show the custom CSS Picture-in-Picture button             |
| `pipPlaceholderText` | `string` | `'Video is playing in picture-in-picture'` | Text shown in the in-flow placeholder that holds the player's space while PiP is active. Empty string = blank placeholder that still reserves the space |
| `settings`       | `boolean` | `true`  | Show the settings (gear) menu; auto-hidden per source unless it has ≥2 quality levels or a "Playback speed" section |
| `quality`        | `boolean` | `true`  | Show the "Quality" section inside the settings menu (auto-hidden if fewer than 2 levels) |
| `captionSettings`| `boolean` | `true`  | Show the "captions settings" entry in the subtitles/CC menu (the text-track styling dialog). `false` drops both the entry and the dialog |
| `chapters`       | `boolean` | `true`  | Show the chapters button in the control bar. It only appears when the source has a `kind: 'chapters'` track with cues; `false` removes it even then |
| `playbackRates`  | `number[]`| `[0.5, 0.75, 1, 1.25, 1.5, 2]` | Playback-speed steps offered in the settings menu |
| `showProgressDot`| `boolean` | `false` | Show the scrubber dot at the head of the played portion of the progress bar |
| `showVolumeDot`  | `boolean` | `false` | Show the handle dot at the head of the filled portion of the volume bar |
| `thumbnails`     | `boolean` | `true`  | Show a thumbnail-preview popup on progress-bar hover (DASH sources with a thumbnail-tile track) |
| `fluid`          | `boolean` | `true`  | Full container width, height from the media's aspect ratio (16:9 until known). `false` lays the player out at the media's intrinsic size and leaves sizing to your CSS. Overridden by `widescreen`. See "Sizing" below |
| `language`       | `string`  | —       | BCP-47 language code for UI labels                       |
| `minBandwidth`   | `number`  | —       | Floor, in bits/s, for the estimate the Auto selector uses |
| `maxBandwidth`   | `number`  | —       | Ceiling, in bits/s, for the same estimate                 |

#### Sizing

The player's box is decided by `widescreen` and `fluid`:

| Options | Box | Use it for |
|---------|-----|------------|
| default (`fluid: true`) | Container width, height from the media's aspect ratio (16:9 until known) | Most pages: the box follows the video |
| `widescreen: true` | Fixed 16:9 frame; other ratios letterboxed in black inside | Space reserved before the media loads (SSR placeholder), equal tiles in a grid or carousel. Override the container's `aspect-ratio` or `height` for another frame, add `video { object-fit: cover }` to crop instead of letterboxing |
| `fluid: false` | Media's intrinsic pixel size | Boxes sized entirely by your CSS: add `.my-player .video-js { width: 100%; height: 100% }` |

To ship UI strings for a locale Video.js doesn't already have, register a
dictionary before creating the player and then pass the same code as
`language`:

```ts
EvePlayer.addLanguage('it', { Play: 'Riproduci', Pause: 'Pausa' /* ... */ });
```

Video.js is bundled privately inside this package (see "Installation" above)
— a consumer's own `import videojs from 'video.js'` is a separate module
instance, so calling `videojs.addLanguage()` on it has no effect on this
library's players. `EvePlayer.addLanguage()` is the only way to reach the
copy actually in use, and only needs to be called once (not per player
instance).

### Version

`EvePlayer.version` (static, read-only) is the library version baked in at
build time (the `package.json` version of the published package). Useful when
reporting an issue or checking which build a page actually loaded:

```ts
console.log(EvePlayer.version); // e.g. '1.0.0'
```

### Playback

| Method / Property            | Type / Signature             | Description                          |
|------------------------------|------------------------------|--------------------------------------|
| `play()`                     | `() => Promise<void>`        | Start playback                       |
| `pause()`                    | `() => void`                 | Pause playback                       |
| `currentTime` (get/set)      | `number`                     | Current playback position (seconds)  |
| `duration`                   | `number` *(read-only)*       | Total duration (seconds)             |
| `paused`                     | `boolean` *(read-only)*      | True when paused                     |
| `readyState`                 | `number` *(read-only)*       | HTMLMediaElement.readyState (0–4)    |
| `ended`                      | `boolean` *(read-only)*      | True when playback has ended         |
| `loop` (get/set)             | `boolean`                    | Loop playback                        |

### Volume

| Method / Property | Type / Signature | Description                 |
|-------------------|------------------|-----------------------------|
| `volume` (get/set)| `number`         | Volume level (0.0–1.0)      |
| `muted` (get/set) | `boolean`        | Muted state                 |

### Playback rate

| Method / Property        | Type / Signature | Description     |
|--------------------------|------------------|-----------------|
| `playbackRate` (get/set) | `number`         | Playback speed  |

### Source

| Method                     | Signature                                      | Description                                             |
|----------------------------|------------------------------------------------|---------------------------------------------------------|
| `setSource(desc)`          | `(source: SourceDescription) => void`          | Load a new source. Safe to call at any time.            |
| `getSource()`              | `() => SourceDescription \| undefined`         | Returns the current source description.                 |
| `reset()`                  | `() => void`                                   | Clears the playback engine back to a sourceless state, keeping volume and mute state. Use before `setSource()` when swapping to a genuinely different source |

`SourceDescription.textTracks` side-loads WebVTT tracks (subtitles or a
`kind: 'chapters'` cue file) that aren't embedded in the HLS/DASH manifest
itself:

```ts
player.setSource({
  sources: [{ src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' }],
  textTracks: [
    { kind: 'chapters', src: 'https://example.com/chapters.vtt', srclang: 'en' },
    { kind: 'subtitles', src: 'https://example.com/subs.it.vtt', srclang: 'it', label: 'Italiano' },
  ],
});
```

Side-loaded tracks are cleared automatically on the next `setSource()` call —
no manual cleanup needed when switching sources.

`textTracks` is validated defensively: it must be an **array**, and each entry
must be an object with a non-empty `src` and a `kind` from the `TextTrackKind`
union (`subtitles`, `captions`, `descriptions`, `chapters`, `metadata`).
Anything else (a bare URL string instead of an array, a missing/unknown `kind`,
an entry with no `src`) is dropped with a `console.warn` and never reaches
Video.js — an unknown `kind` would otherwise be silently coerced to `subtitles`
and light up a phantom entry in the CC menu.

> Pass `sources: []` for a poster-only / no-video state — an empty array skips
> `.src()` entirely instead of raising a "source not supported" error.

### Audio tracks

| Method                  | Signature                       | Description                                    |
|-------------------------|---------------------------------|------------------------------------------------|
| `getAudioTracks()`      | `() => AudioTrack[]`            | List available audio tracks                    |
| `setAudioTrack(id)`     | `(id: string) => void`          | Enable track by id, disable all others         |

### Text tracks

| Method                       | Signature                                         | Description                |
|------------------------------|---------------------------------------------------|----------------------------|
| `getTextTracks()`            | `() => TextTrack[]`                               | List subtitle/caption tracks |
| `setTextTrack(id, mode)`     | `(id: string, mode: TextTrack['mode']) => void`   | Set track display mode     |

The subtitles/CC control-bar button opens a native Video.js menu (languages +
"captions off"). By default it also carries a "captions settings" entry that
opens Video.js's text-track styling dialog (font, colour, background, edge
style), re-skinned to match the EVE settings flyout. Pass `captionSettings:
false` to remove that entry and the dialog entirely.

### Bookmarks

| Method               | Signature                    | Description                                           |
|----------------------|------------------------------|-------------------------------------------------------|
| `setBookmarks(bms)`  | `(bms: Bookmark[]) => void`  | Render cue markers on the progress bar. Pass `[]` to clear. |

### Chapters

Reads cues from a `kind: 'chapters'` text track on the current source — either
embedded in the manifest or side-loaded via `setSource()`'s `textTracks`
option (see Source above). Kept separate from `getTextTracks()`/`setTextTrack()`
— chapters aren't a language/subtitle choice.

| Method                | Signature             | Description                                        |
|------------------------|-----------------------|------------------------------------------------------|
| `getChapterCues()`     | `() => ChapterCue[]`  | All cues from any 'chapters' text track (usually one) |

Subscribe to `chapterentercue` (see Events below) to react as playback crosses
each chapter boundary.

When a chapters track with cues is present, Video.js's own chapters control-bar
button (the list icon) appears automatically, sitting with the audio/subtitles
menus. Its popup is anchored to the player's bottom-right corner and skinned to
match the settings / audio / subs menus; clicking a row seeks to that chapter
and the row for the chapter playing carries the accent checkmark. Pass
`chapters: false` to remove the button even when a chapters track is present
(`getChapterCues()` and `chapterentercue` keep working).

### Picture-in-Picture

CSS-based floating overlay — **not** the native browser Picture-in-Picture API.
The player container becomes `position: fixed` in the bottom-right corner and
is draggable by the user. Native browser PiP is disabled on the underlying
`<video>` element.

While PiP is active, an in-flow placeholder (`.vjsp-pip-placeholder`) is dropped
where the player sat, matching its size at activation so surrounding content
doesn't jump. It shows `pipPlaceholderText` centered (default
`'Video is playing in picture-in-picture'`); pass an empty string for a blank
placeholder that still reserves the space.

| Method / Property     | Type / Signature | Description                              |
|------------------------|-------------------|--------------------------------------------|
| `isPip`                | `boolean` *(read-only)* | True when the floating PiP overlay is active |
| `requestPip()`         | `() => void`      | Activate the floating PiP overlay (no-op if already active) |
| `exitPip()`            | `() => void`      | Deactivate the overlay and restore the player in-flow (no-op if not active) |

Toggle the `pip` constructor option to show/hide the control bar button; the
methods above work regardless of whether the button is shown.

### Quality selector (adaptive bitrate)

Reads representations from `@videojs/http-streaming` (HLS/DASH only — no-op
for progressive MP4/MP3 sources). The control bar button auto-hides when fewer
than 2 levels are available.

> **Safari / iOS:** empty for HLS (native playback, no rendition list) and
> size-gated. See [Streaming engine](#streaming-engine) below. DASH is
> unaffected.

| Method                  | Signature               | Description                                          |
|--------------------------|--------------------------|--------------------------------------------------------|
| `getQualityLevels()`     | `() => QualityLevel[]`  | All levels, `Auto` (ABR) first; `selected` marks the current one |
| `setQualityLevel(id)`    | `(id: string) => void`  | Lock playback to a specific level, disabling ABR       |
| `setAutoQuality()`       | `() => void`            | Restore adaptive bitrate (re-enables all levels)       |

### Delivery telemetry

```ts
const stats = player.getPlaybackStats();
if (stats?.fetchRate !== undefined && stats.fetchRate < 1) {
  // The player is pulling media more slowly than it plays it.
}
```

`getPlaybackStats()` returns what the adaptive-streaming engine has measured
for the source currently loaded, or `undefined` where there is no engine to ask
(Safari playing HLS natively, and progressive `.mp4`). The counters restart from
zero on every `setSource()`, because each source gets a fresh engine handler.

| Field                | Meaning                                                             |
|----------------------|---------------------------------------------------------------------|
| `fetchRate`          | Seconds of media fetched per second spent downloading. **Judge the connection on this one.** |
| `contentBitrate`     | What the stream really costs, measured from the bytes delivered      |
| `measuredBandwidth`  | The engine's estimate from the last segment only, TTFB included      |
| `peakBitrate`        | The manifest's `BANDWIDTH`, which HLS defines as the **peak**        |
| `averageBitrate`     | The manifest's `AVERAGE-BANDWIDTH`, where declared                   |
| `bytesTransferred` / `transferDuration` / `secondsLoaded` | Raw counters the rates are derived from. `secondsLoaded` counts media once even when the audio is a separate rendition with its own loader |
| `requestsErrored` / `requestsTimedout` | Segment requests that failed                      |

Two traps worth naming, because both produce confident wrong answers:

- **Do not compare throughput against `peakBitrate`.** It is the declared peak,
  commonly well above the real average, so the ratio invents a shortfall on a
  perfectly healthy stream.
- **Do not treat `measuredBandwidth` as line capacity.** A player at steady
  state stops asking for data it does not need, so the figure settles near the
  stream's own bitrate however fast the connection is.

`fetchRate` sidesteps both: it counts only time spent inside requests, and
needs no declared bitrate at all.

### Thumbnail preview (progress-bar hover)

For **DASH** sources whose manifest carries a
[DASH-IF `thumbnail_tile`](http://dashif.org/guidelines/thumbnail_tile) image
track, or **HLS** sources whose master playlist carries an
`EXT-X-IMAGE-STREAM-INF`/`EXT-X-TILES` image trick-play track (e.g. AWS
MediaConvert's `ImageBasedTrickPlay` on a CMAF/HLS output), hovering the
progress bar shows a sprite-cropped thumbnail popup that tracks the cursor —
entirely built-in, no setup required beyond the `thumbnails` constructor
option (default `true`). The manifest is fetched and parsed for this
independently of `@videojs/http-streaming`, which only parses audio/video
renditions and never sees the image track.

Not part of the public API surface (no getter/event) — it's a self-contained UI
feature, the same way Picture-in-Picture and the quality selector are. Sources
without a thumbnail track (including plain MP4/MP3) simply show nothing on
hover. Out of scope: HLS sidecar WebVTT thumbnail tracks, `$Time$`-based DASH
`SegmentTemplate`s, and non-tiled HLS image playlists (one full-frame image
per segment, no `EXT-X-TILES` grid).

### Poster & visibility

| Method              | Signature               | Description                                                     |
|---------------------|-------------------------|-----------------------------------------------------------------|
| `setPoster(url)`    | `(url: string) => void` | Update the poster image                                         |
| `setVisible(v)`     | `(v: boolean) => void`  | Toggle visibility without unmounting (uses `visibility: hidden`)|

### Fullscreen

| Method / Property    | Type / Signature    | Description                   |
|----------------------|---------------------|-------------------------------|
| `isFullscreen`       | `boolean` (read-only)| True when in fullscreen       |
| `requestFullscreen()`| `() => void`        | Enter fullscreen              |
| `exitFullscreen()`   | `() => void`        | Exit fullscreen               |

### Events

```ts
player.on(event, handler)   // subscribe
player.off(event, handler)  // unsubscribe (use stable references)
player.once(event, handler) // subscribe for one firing only
```

| Event              | Payload                               | Description                          |
|--------------------|---------------------------------------|--------------------------------------|
| `play`             | —                                     | Playback started                     |
| `pause`            | —                                     | Playback paused                      |
| `ended`            | —                                     | Playback ended                       |
| `timeupdate`       | `{ currentTime: number }`             | Periodic time update                 |
| `readystatechange` | `{ readyState: number }`              | Ready state changed                  |
| `loadedmetadata`   | `{ size: PlayerSize }`                | Metadata loaded                      |
| `audiotrackchange` | `{ track: AudioTrack }`               | Active audio track changed           |
| `texttrackchange`  | `{ track: TextTrack }`                | Active text track changed            |
| `error`            | `PlayerError` (`{ code, message, category }`) | Playback error               |
| `sourceset`        | `{ source: SourceDescription }`       | Source was set via setSource()       |
| `ratechange`       | `{ playbackRate: number }`            | Playback rate changed                |
| `volumechange`     | `{ volume: number; muted: boolean }`  | Volume or mute state changed         |
| `fullscreenchange` | `{ isFullscreen: boolean }`           | Fullscreen state changed             |
| `pipchange`        | `{ isPip: boolean }`                  | CSS Picture-in-Picture overlay toggled |
| `qualitychange`    | `{ level: QualityLevel }`             | Quality **selection** changed (a level was pinned, or ABR restored) |
| `renditionchange`  | `{ level: QualityLevel; previous: QualityLevel \| undefined }` | The rendition actually playing changed, whoever chose it. `previous` is `undefined` for a source's first rendition; compare bitrates for the direction, a step down being the engine reporting a struggling connection |
| `chapterentercue`  | `{ cue: ChapterCue }`                 | Playback crossed into a chapter cue  |
| `gapskip`          | `{ from: number; to: number }`       | Auto-seeked over a detected buffer gap (manifest discontinuity or missing segment) |
| `stall`            | `{ duration: number }`               | Playback resumed after a mid-playback rebuffer; `duration` in seconds. Not fired for the initial pre-first-play buffering wait |
| `dispose`          | —                                     | Player is being torn down            |

`PlayerError.category` groups the numeric `code` so consumers can branch (e.g. offer a
retry for `network`, not for `source-unsupported`) without hardcoding `HTMLMediaElement`
error codes: `'aborted' | 'network' | 'decode' | 'source-unsupported' | 'encrypted' | 'unknown'`.
`'encrypted'` means the source needs a decryption key/CDM — this player does not negotiate
DRM yet, so this always means playback is blocked, not that a key was rejected.

`gapskip` and `stall` are two distinct streaming-health signals, not always correlated —
one can fire without the other:

- **`gapskip`** fires when `@videojs/http-streaming` detects a buffer gap (a manifest
  discontinuity or a segment missing from the buffer) and **auto-seeks over it** on its
  own — VHS's own `PlaybackWatcher` already re-emits this directly on the player, so
  nothing here reaches into VHS internals. It's not an error: VHS resolved the problem
  transparently. If the jump is instant, playback may never even pass through `waiting`.
- **`stall`** fires when playback **resumes** after a mid-playback rebuffer — i.e. the
  player had already started, then had to wait for data (native `waiting`), then resumed
  (`playing`). The clock only starts once playback has genuinely begun at least once, so
  the initial pre-first-play buffering wait is never counted as a stall; repeated
  `waiting` events without an intervening `playing` don't reset the clock, so one long
  stall with several micro-`waiting`s is reported once, with the correct total duration.
  All of this can happen from plain network congestion, with no gap in the manifest at all.

### Lifecycle

| Method      | Description                                                              |
|-------------|--------------------------------------------------------------------------|
| `dispose()` | Destroys Video.js, removes DOM nodes, clears all listeners. Safe to call multiple times. |

---

## Format support matrix

| Format    | Chrome | Firefox | Edge | Safari (macOS) | Safari (iOS) |
|-----------|--------|---------|------|----------------|--------------|
| MP4 (H.264) | ✅   | ✅      | ✅   | ✅             | ✅           |
| MP3       | ✅     | ✅      | ✅   | ✅             | ✅           |
| HLS       | ✅ *   | ✅ *    | ✅ * | ✅ (native)    | ✅ (native)  |
| MPEG-DASH | ✅ *   | ✅ *    | ✅ * | ⚠️ unreliable * | ⚠️ limited  |
| CMAF/HLS  | ✅ *   | ✅ *    | ✅ * | ✅ (native)    | ✅ (native)  |
| CMAF/DASH | ✅ *   | ✅ *    | ✅ * | ⚠️ unreliable * | ⚠️ limited  |

> \* Played by `@videojs/http-streaming` (VHS) in JavaScript through MSE.
> Safari and iOS play **HLS / CMAF-over-HLS natively** instead — VHS is used
> there only for **DASH**. "⚠️ limited" is iOS's constrained MSE for DASH.
> "⚠️ unreliable" on Safari macOS: real DASH/CMAF sources have been observed
> to load and buffer normally (`paused: false`, healthy `buffered` ranges)
> while `currentTime` never advances — no `error` event fires, and VHS's own
> stall-recovery (`PlaybackWatcher`) does not resolve it. Reproduced across
> the entire published version history of this library (0.1.0 through
> current), which rules out a regression here — the cause sits in Safari's
> `MediaSource` implementation and/or `@videojs/http-streaming`'s handling of
> it, not in this package. **Until resolved upstream, prefer an HLS source
> for Safari** rather than relying on DASH there.

### Streaming engine

`html5.vhs.overrideNative` is `!(IS_ANY_SAFARI || IS_IOS)`:

- **Chromium / Firefox** — HLS and DASH run through VHS (MSE + JS transmux).
  Quality levels, the custom "Auto" ABR selector, and the "Quality" menu section
  all work.
- **Safari / iOS** — HLS plays on the native engine (forcing it through MSE
  wedges playback). Consequences: `getQualityLevels()` is empty and the
  "Quality" section is hidden for HLS, and native ABR is **size-gated** (Safari
  picks the rendition matching the player's rendered pixel box, so a small
  player stays on a low rendition — size the player to the quality you want).
  DASH still runs through VHS on Safari, so its quality API and ABR are
  unaffected **when playback works** — but DASH/CMAF-DASH playback itself has
  been observed to silently stall on Safari macOS (loads, buffers, but
  `currentTime` never advances). See the compatibility table above; prefer
  HLS for Safari until this is resolved upstream.

The underlying `<video>` carries `playsinline` so iOS plays in place instead of
forcing the OS fullscreen player.

---

## Theming

Override CSS custom properties on any ancestor element to theme the player:

```css
/* Scope to a specific page section */
.my-page {
  --eve-accent:        #00b4d8;  /* progress bar, play-progress bar, active states */
  --eve-control-bg:    rgba(0, 0, 0, 0.7);
  --eve-control-color: #fff;
  --eve-radius:        8px;
}
```

| Property              | Default                            | Used for                                    |
|------------------------|------------------------------------|----------------------------------------------|
| `--eve-accent`        | `#e00`                             | Played-progress bar, hover states, active quality/PiP icon |
| `--eve-control-bg`    | `rgba(0, 0, 0, 0.55)`              | Control bar and popup menu backgrounds        |
| `--eve-control-color` | `#fff`                             | Control bar and menu text/icon color          |
| `--eve-radius`        | `4px`                              | Corner radius on menus and popups             |
| `--eve-bar-height`    | `42px`                             | Control bar height                            |
| `--eve-transition`    | `0.18s ease`                       | Shared hover/state transition timing          |
| `--eve-pip-width`     | `340px`                            | Width of the floating PiP overlay             |
| `--eve-pip-radius`    | `10px`                             | Corner radius of the floating PiP overlay     |
| `--eve-pip-shadow`    | `0 12px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)` | Drop shadow of the floating PiP overlay |

> Bookmark markers on the progress bar are currently a fixed color (not
> themeable via `--eve-accent`) to keep them visible against the
> accent-colored played-progress bar.

---

## SSR / Next.js

**Never** call `new EvePlayer()` at module scope — it accesses `document` and
`window` internally, which are unavailable during server-side rendering.

Use dynamic import with `ssr: false`:

```ts
// components/VideoWrapper.tsx
'use client';
import { useEffect, useRef } from 'react';

export default function VideoWrapper() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Runs only in the browser
    let player: import('@admmedia/eveplayer').EvePlayer;

    void (async () => {
      const { EvePlayer } = await import('@admmedia/eveplayer');
      player = new EvePlayer(containerRef.current!, { widescreen: true });
      player.setSource({ sources: [{ src: '/video.mp4', type: 'video/mp4' }] });
    })();

    return () => player?.dispose();
  }, []);

  return <div ref={containerRef} />;
}
```

Or use Next.js `dynamic`:

```ts
const VideoWrapper = dynamic(() => import('./VideoWrapper'), { ssr: false });
```

---

## CORS

HLS manifests, segment URLs, and DRM key servers **must** respond with
`Access-Control-Allow-Origin` headers that allow the page origin. This library
does not manage CORS headers — configure them on your CDN or origin server.

---

## React wrapper

A React wrapper package is maintained in a separate repository. It wraps
`EvePlayer` in a `useEffect` lifecycle, maps `PlayerEventMap` events to React
callback props, and re-exports all public types from this package.

---

## License

[Apache-2.0](./LICENSE) © ADM Media Consulting SA

The package bundles Video.js, `@videojs/http-streaming` and a few smaller
libraries, under Apache-2.0 and MIT. See [NOTICE](./NOTICE); the full
copyright notices and license texts ship in `dist/THIRD_PARTY_NOTICES.txt`.
