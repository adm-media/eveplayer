# Architecture

The `README.md` is the API reference; this file explains the *why* behind the
non-obvious parts, in particular the adaptive-bitrate (ABR) / "Auto" quality
subsystem, which has been reworked several times and whose current shape is not
self-evident from the code.

For decisions with real trade-offs and rejected alternatives, see `docs/adr/`.

---

## 1. Big picture

`@admmedia/eveplayer` wraps a single Video.js 8 `Player` behind one
class, `EvePlayer` (`src/EvePlayer.ts`). Consumers never touch Video.js:
they get the typed surface in `src/types.ts` and nothing else
(`src/index.ts` re-exports only `EvePlayer` + types).

```
consumer ──▶ EvePlayer (src/EvePlayer.ts)
                 │  creates <video class="video-js">, appends into `container`
                 ▼
             videojs(...)  ──▶ Player (this.vjs)
                 │
                 ├─ tech: Html5 + @videojs/http-streaming (VHS)  ── HLS / DASH / CMAF
                 ├─ control bar + custom components (PiP, settings gear)
                 └─ events ──▶ EventEmitter (src/EventEmitter.ts) ──▶ consumer .on()/.off()
```

Playback engine: `@videojs/http-streaming` ("VHS"). `html5.vhs.overrideNative`
is `!(IS_ANY_SAFARI || IS_IOS)`, so HLS and DASH are parsed and driven in JS
(MSE) on Chromium/Firefox, while Safari and iOS play HLS through the native
engine (forcing MSE there wedges playback — see ADR-0003). DASH still runs
through MSE on Safari regardless, since it has no native DASH. Quality levels
come from VHS tech representations (`tech.vhs.representations()`), so
`getQualityLevels()` / the custom ABR selector are inert for HLS on Safari/iOS
(native playback exposes no rendition list) and for progressive MP4 (no quality
concept).

Other subsystems (see `README.md` for the consumer-facing view): custom
control-bar buttons, the CSS-driven PiP overlay (not the native API), chapter
cues vs. subtitle text tracks, DRM (stubbed, not wired).

---

## 2. ABR / "Auto" quality selection

### 2.1 What "Auto" has to do

On an HLS/DASH source VHS exposes a rendition ladder. In **Auto** mode the
player must pick, before every segment, the highest rendition the connection
can currently sustain. Manual mode pins one rendition (`setQualityLevel`) by
enabling only that representation; `getQualityLevels()` lists them.

The reference behaviour we target is that of mature commercial players: on the
same stream and line, they reach the top rendition and hold it, stepping down
only on real congestion.

### 2.2 Why the built-in VHS selectors were not enough

VHS's default selector is `lastBandwidthSelector` → `simpleSelector`. It keeps
the highest rendition whose **declared peak `BANDWIDTH`**, times
`Config.BANDWIDTH_VARIANCE` (default **1.2**), stays under
`vhs.systemBandwidth`, then additionally filters by rendered player size. Three
properties of that made "Auto" sit one or two rungs below that reference, or
freeze outright, on identical input:

1. **`limitRenditionByPlayerDimensions` (default `true`)** caps Auto to the
   smallest rendition covering the player's *rendered CSS pixel size*,
   regardless of bandwidth. Observed directly: a stream estimated at ~100 Mbps
   stayed on 720p in Auto, jumped to 1080p on a manual pick, dropped back to
   720p the instant Auto was re-enabled — the signature of the dimension cap,
   not a bandwidth problem. → We set it **`false`**.

2. **`systemBandwidth` is a harmonic mean**, not the network estimate:
   `1 / (1/bandwidth + 1/throughput)`, where `throughput` is the
   decrypt/transmux/append rate. It is always well below the real link speed,
   and with JS transmux under load it can drop *below a mid-rendition's
   bitrate*, at which point Auto freezes on the bottom rendition on a
   connection that is comfortably fast enough (observed: stuck at 360p on the
   `800k / 4M / 8M` test ladder).

3. **Gating on declared peak.** MPEG-DASH `bandwidth` is a max-over-window
   value; HLS streams frequently omit `AVERAGE-BANDWIDTH`. QVBR-style encodes
   declare peak 20–40 % above the real average. Requiring
   `estimate > peak × 1.2` therefore demands far more headroom than the
   rendition actually needs.

### 2.3 The Network Information API detour

VHS's `vhs.bandwidth` **getter** (not a stored value) does this when
`useNetworkInformationApi` is enabled — and it defaults to **`true`**:

```
if (navigator.connection is present) {
  if (downlink*1e6 >= 10Mbps && measured >= 10Mbps)  use max(measured, downlink*1e6)
  else                                               use downlink*1e6   // measurement discarded
}
```

`navigator.connection.downlink` is a coarse, bucketed browser guess that
saturates at 10 Mbps. On any line where it reads < 10 Mbps (common), the
getter **replaces** the real segment measurement with it. Observed directly:
real measurement tracked 60–70 Mbps while `vhs.bandwidth` sat frozen at
`downlink*1e6 = 1.5e6`, pinning Auto to the bottom rendition. Simply disabling
the flag fixed that symptom but was rejected (see ADR-0001), and the behaviour
is browser/session dependent (Firefox/Safari have no `navigator.connection`, so
it only bites Chromium).

Current resolution: **leave the flag at its default and stop depending on that
getter.** The custom selector reads the raw measurement straight off the
segment loader (`mainSegmentLoader_.bandwidth`), which the flag never
rewrites. The flag still informs VHS's *initial*, pre-first-segment guess,
which is harmless. See ADR-0001.

### 2.4 The custom selector (`eveAbrPlaylistSelector`)

`vhs.selectPlaylist` is a runtime property on the VHS handler, re-read by VHS
before every segment decision (on `bandwidthupdate` and a timer) and bound by
VHS to the handler instance. We reassign it on every `loadstart`
(`applyCustomAbrSelector`), because each new source gets a fresh handler.

Algorithm, per call:

1. **Estimate.** Read `mainSegmentLoader_.bandwidth` (raw, segment-measured,
   pre-`systemBandwidth`, pre-NetInfo). Fold it into a per-handler EWMA
   (`this.__abrEwma`) with an **asymmetric** weight:
   - newest sample **below** the average → weight `EWMA_WEIGHT_DOWN` (0.7):
     react to congestion within one segment;
   - newest sample **above** → weight `EWMA_WEIGHT_UP` (0.45): climb steadily,
     don't flip-flop.

2. **Targets.** For each enabled representation, the comparison bitrate is
   `AVERAGE-BANDWIDTH` when the manifest provides it, else
   `peak × PEAK_TO_AVERAGE_RATIO` (0.75) as a stand-in for the real average.

3. **Raw pick.** Highest rendition whose target `< estimate`; if none,
   the lowest rendition.

4. **Buffer-gated optimism.** When the forward buffer is
   `≥ HEALTHY_BUFFER_SECONDS` (10 s), recompute the pick with
   `estimate × HEALTHY_BUFFER_ESTIMATE_BONUS` (1.4). Use that higher pick
   **only if** it is above the raw pick **and** the raw pick is not itself a
   downswitch from the current rendition. So the bonus can only ever push
   *up*, and a genuine bandwidth drop is never masked by "the buffer is still
   full" (a plain unconditional multiplier previously delayed 1080→720 by a
   whole buffer's worth of playback).

No player-dimension filtering (see §2.2 point 1).

Tunables live at the top of the block in `src/EvePlayer.ts`:

| constant | value | raise it to… |
|---|---|---|
| `PEAK_TO_AVERAGE_RATIO` | 0.75 | *lower* → reach the top rung sooner |
| `EWMA_WEIGHT_DOWN` | 0.7 | drop faster on congestion |
| `EWMA_WEIGHT_UP` | 0.45 | recover faster, but more oscillation |
| `HEALTHY_BUFFER_SECONDS` | 10 | *lower* → buffer-optimism engages sooner |
| `HEALTHY_BUFFER_ESTIMATE_BONUS` | 1.4 | more aggressive climb when buffer is healthy |

### 2.5 Known limits

- Decision granularity is **one segment** (~6 s here). VHS's custom selector
  hook cannot switch mid-segment, so recovery after a throttle lift is
  ~1 segment behind. Commercial players have the same floor.
- `Vhs.BANDWIDTH_VARIANCE` is still globally set to `1.0`
  (`ensureVhsBandwidthVarianceTuned`) for VHS's own fallback/initial paths;
  the custom selector does not use it. It is a page-level static shared by
  every VHS player on the page.
- `this.__abrEwma` is stored on the VHS handler, so it resets naturally per
  source. It is not persisted across `setSource()`.

### 2.6 Verifying against real playback

jsdom/Vitest cannot exercise any of this — there is no real transmux or
buffered range — so ABR changes are validated by hand against a real HLS/DASH
stream in a browser. With a player on the page, in the Chrome console:

```js
const vhs = document.querySelector('video').player.tech(true).vhs;
setInterval(() => console.log({
  measuredMbps: +(vhs.playlistController_.mainSegmentLoader_.bandwidth / 1e6).toFixed(1),
  systemMbps:   +(vhs.systemBandwidth / 1e6).toFixed(1),
  downlink:     navigator.connection && navigator.connection.downlink,
  resolution:   vhs.playlists.media().attributes.RESOLUTION,
}), 2000);
```

---

## 3. Build / consumption reminders

- After any `src/` change, **`yarn build`** — consumers resolve `dist/`, and a
  stale `dist/*.d.ts` has already caused a silent type mismatch.
- `video.js` and `@videojs/http-streaming` are regular deps and are bundled by
  the consumer's install; the CSS entry (`.../style.css`) is imported
  separately.
