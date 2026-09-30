# ADR-0003: `overrideNative` — JS (MSE) playback where it helps, native HLS on Safari/iOS

- **Status:** Accepted (amended 2026-09-04 — originally "`overrideNative: true` on every browser")
- **Date:** 2026-08-18

## Context

The library must play HLS and DASH (CMAF) uniformly and expose a rendition
ladder for the "Auto" / quality UI. Browser support for adaptive formats is
uneven: Safari plays HLS natively but not DASH; Chromium and Firefox play
neither without MSE. Native playback also exposes no usable quality-selection
API and no consistent cross-browser event surface.

## Decision

Set `html5.vhs.overrideNative` to `!(videojs.browser.IS_ANY_SAFARI || videojs.browser.IS_IOS)`:

- **Chromium / Firefox:** `@videojs/http-streaming` ("VHS") drives HLS and DASH
  in JS through MSE. Quality levels come from `tech.vhs.representations()`;
  `getQualityLevels()` / `setQualityLevel()` and the custom ABR selector (see
  [ADR-0001](0001-custom-abr-auto-quality-selection.md)) are all built on that.
- **Safari / iOS:** HLS is left to the native engine. DASH still goes through
  MSE there anyway — Safari can't play it natively, so
  `Vhs.supportsTypeNatively('dash')` is false and VHS takes the source
  regardless of the flag — so the quality API and custom ABR keep working for
  DASH. For HLS on Safari they return nothing (the native player exposes no
  rendition list); that is accepted.
- Progressive MP4 has no rendition concept and is always the native element.

This is also VHS's own default for `overrideNative`.

## Amendment (2026-09-04): why the original "`true` everywhere" was reversed

`overrideNative: true` was unconditional from the initial implementation. On
Safari it forces HLS through MSE + JS transmux, and that path is unreliable
there:

- **HLS (VOD and with in-manifest CEA-608 captions):** playback wedges — a
  visible first frame, seeking repaints it, but `play()` never resolves or
  rejects and `HTMLMediaElement.error` stays `null`. The `MediaSource` never
  reaches `open`. Reproduced in Safari against `test-streams.mux.dev` HLS; a
  bare `<video>` with the same URL (native HLS) plays immediately.
- **Live fMP4/CMAF:** the video plane drops (black / "disappears") on certain
  init/discontinuity appends.
- Contributing factor found while debugging: building the player and calling
  `setSource()` on a detached element leaves Safari MSE unable to recover from
  the detached-then-attached sequence; native HLS is robust to it.

The format-support matrix already claimed native Safari HLS, so this change
brings the code in line with the documented behaviour.

## Alternatives considered

- **`overrideNative: true` on every browser (the original decision).** Rejected
  on the evidence above: MSE HLS on Safari wedges. One playback path is not
  worth a broken one.
- **`hls.js` / `dash.js` directly with a hand-built UI.** Rejected — see
  [ADR-0002](0002-single-eveplayer-class.md): the Video.js UI is most of the
  value.
- **Native everywhere, defer ABR to the browser.** Rejected: no DASH off
  Safari, no quality API on any browser, inconsistent events.

## Consequences

**Good**

- HLS is reliable on Safari and iOS (the native engine).
- DASH still works everywhere, MSE-driven, including on Safari.
- On Chromium/Firefox — the browsers where the quality UI and custom ABR
  actually matter — the representation list is always present for HLS and DASH.

**Costs / watch-outs**

- Two playback paths again: MSE on Chromium/Firefox (+ DASH on Safari), native
  HLS on Safari/iOS. Playback-adjacent code must not assume `tech.vhs` exists.
- `getQualityLevels()` returns `[]` and the settings-menu "Quality" section does
  not appear for **HLS on Safari/iOS**. Documented in README (Quality selector)
  and `architecture.md`. DASH on Safari is unaffected.
- On Safari/iOS native HLS the rendition is chosen by AVPlayer, and its ABR is
  **size-gated**: it picks the variant matching the video element's rendered
  pixel box (CSS size × `devicePixelRatio`), not just bandwidth. A small player
  gets a low rendition and will not climb — by design, AVPlayer will not pull
  1080p into a 400px box. Verified: the same stream on the same Safari picks
  360p in a 640px-wide player and 1080p at full width. This is not specific to
  this library (Castr's player behaves identically); there is no web API to
  override AVPlayer's peak bitrate / max resolution. Nothing to do beyond
  sizing the player sensibly.
- Chromium/Firefox keep the JS-transmux CPU/battery cost and the
  `systemBandwidth` distortion that drives [ADR-0001](0001-custom-abr-auto-quality-selection.md).
- We still ride VHS internals (`selectPlaylist`, `mainSegmentLoader_`,
  `representations()`) on the MSE path; a VHS upgrade can break the ABR/quality
  code with no type coverage over those.

## History

`overrideNative: true` was set from the first implementation, and the ABR work
(culminating in ADR-0001) was built on that MSE path, including one attempt to
disable VHS's Network Information API bandwidth override that was tried and then
reverted. On 2026-09-04 `overrideNative` was made Safari/iOS-aware after
MSE-HLS playback was found to wedge on Safari; `playsinline` was added to the
`<video>` in the same change (iOS inline playback).

## Update — 2026-09-11: alternate-audio switching is slow on Safari/iOS native HLS — confirmed independent of this library

Switching the audio language on Safari/iOS native HLS stalls for a few seconds
before the new audio starts (observed in Storybook: buffered-ahead drops to 0
for the duration — `currentTime` briefly has no buffered range at all).

**Confirmed independent of this library**: the same stream opened directly in
Safari — paste the `.m3u8` URL straight into the address bar, no page, no
Video.js, no player code at all — shows the same multi-second delay on
Safari's own built-in audio-language picker. This is AVFoundation flushing and
re-buffering around the current position on an alternate-audio switch, not
something `setAudioTrack()` can avoid or speed up (it only flips
`track.enabled` on Video.js's `AudioTrackList` — see `src/EvePlayer.ts`).

On Chromium/Firefox the same switch goes through VHS/MSE and swaps the audio
`SourceBuffer`'s content in place — typically no visible stall. Nothing to do
here; documented so a future "audio-language switch is slow" report on Safari
isn't mistaken for a regression in this library.

## Update — 2026-09-15: DASH on Safari macOS is unreliable, not "unaffected"

This ADR's reasoning assumed DASH plays fine on Safari macOS because it
always runs through VHS/MSE there regardless of `overrideNative` (Safari
can't play DASH natively, so `Vhs.supportsTypeNatively('dash')` is false —
see "Decision" above). That MSE routing is still accurate. What turned out
to be wrong is the assumption that MSE playback of DASH on Safari macOS
*works*.

Real-world testing (a genuine CMAF/DASH manifest, demuxed audio+video
AdaptationSets, HE-AAC audio) reproducibly stalls on Safari macOS: the
player loads the manifest, fetches and appends segments, `buffered` grows
normally (tens of seconds ahead), `paused` becomes `false` — but
`currentTime` never advances past the first fraction of a second, no
`error` event fires, and VHS's own stall-recovery (`PlaybackWatcher`
repeatedly re-seeking to the current time) does not resolve it.

Ruled out as candidates, each with a controlled before/after test:

- **A regression in this library** — reproduced identically across the
  entire published version history, from `0.1.0` (before the custom ABR
  selector, before the VHS bundling change) through the current version.
- **The `@videojs/http-streaming` bundling change** (`sync-workers` build +
  `video.js` → `core.es.js`, see [ADR-0006](0006-bundle-vhs-sync-workers.md))
  — Storybook doesn't build through the package's own bundler aliases at
  all, so this variable was never actually different between the "before"
  and "after" Storybook builds used in the initial (inconclusive) test; a
  later test with the real published npm tarballs for two versions
  straddling that change still reproduced the stall on both.
- **An early ABR rendition switch** (this library's custom playlist
  selector, see [ADR-0001](0001-custom-abr-auto-quality-selection.md)) —
  disabling the custom selector *and* re-enabling VHS's own
  `limitRenditionByPlayerDimensions` cap produced a run with zero rendition
  switches; the stall was identical.
- Codec support (`MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.5"')`
  → `true`), CORS (all manifest/segment requests 200 with
  `access-control-allow-origin: *`), and buffer/segment alignment (a single
  continuous `buffered` range, no gap) were all also ruled out.

**Conclusion**: the cause sits in Safari's `MediaSource` implementation
and/or `@videojs/http-streaming`'s handling of it for this class of DASH
content, not in this library or its configuration. The format-support table
in the README now marks Safari macOS DASH/CMAF-DASH "⚠️ unreliable" instead
of "✅". Consumers targeting Safari should prefer an HLS source when one is
available, rather than relying on DASH there.
