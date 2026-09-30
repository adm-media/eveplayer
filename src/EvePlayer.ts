/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import videojs from 'video.js';
// Registration side-effect only: self-registers as a video.js Html5 source
// handler for HLS/DASH (application/x-mpegURL, application/dash+xml). Without
// this import, .m3u8/.mpd sources fail with MEDIA_ERR_SRC_NOT_SUPPORTED in
// any non-Safari browser: it's a real `dependencies` entry (see
// package.json), not something consumers should need to import themselves.
import '@videojs/http-streaming';
import type Player from 'video.js/dist/types/player';
import type VjsButton from 'video.js/dist/types/button';
import { EventEmitter } from './EventEmitter';
import { findThumbnailTile, parseDashThumbnailTiles, type ThumbnailTile } from './dashThumbnails';
import { parseHlsThumbnailTiles } from './hlsThumbnails';
import type {
  AudioTrack,
  Bookmark,
  ChapterCue,
  LanguageDictionary,
  PlaybackStats,
  PlayerError,
  PlayerErrorCategory,
  PlayerEventMap,
  PlayerOptions,
  PlayerSize,
  QualityLevel,
  SourceDescription,
  SourceTextTrack,
  TextTrack,
  TextTrackKind,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The five W3C `TextTrackKind` values Video.js accepts as-is. Anything else (or
 * a missing value) is coerced by Video.js to `'subtitles'`, so `setSource()`
 * rejects side-loaded tracks whose `kind` is not in this set.
 */
const VALID_TEXT_TRACK_KINDS: ReadonlySet<string> = new Set<TextTrackKind>([
  'subtitles',
  'captions',
  'descriptions',
  'chapters',
  'metadata',
]);

const MEDIA_ERROR_INFO: Record<number, { message: string; category: PlayerErrorCategory }> = {
  1: { message: 'Aborted by user', category: 'aborted' },
  2: { message: 'Network error', category: 'network' },
  3: { message: 'Decode error', category: 'decode' },
  4: { message: 'Source not supported', category: 'source-unsupported' },
  5: { message: 'Encrypted, missing key', category: 'encrypted' },
};

// SVG icon for the PiP control bar button.
// Outer frame (stroke) + inner filled rectangle in the bottom-right corner.
const PIP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><rect x="12" y="11" width="9" height="7" rx="1" fill="currentColor" stroke="none"/></svg>`;

// SVG icon for the restore-from-PiP button (shown inside the floating window).
const PIP_RESTORE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

// SVG icons for the settings menu (gear button + its flyout).
// Same Feather-style stroke set as the PiP icons above, so the whole control
// bar reads as one icon family.
const SETTINGS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

// Back arrow shown in the settings-menu header.
const MENU_BACK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;

// Checkmark shown next to the active option in a settings sub-menu.
const MENU_CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

// Playback-speed steps offered in the settings menu when speed control is
// enabled (i.e. the `hideSpeed` option is not set). Overridable per instance
// via `PlayerOptions.playbackRates`.
const DEFAULT_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

// On-screen width the thumbnail hover popup aims for, in CSS pixels.
//
// Tile sprites (see dashThumbnails.ts / hlsThumbnails.ts) are encoded at wildly
// different sizes: HLS trick-play tiles are often well under 200px wide, while
// DASH thumbnail_tile sheets routinely yield tiles of 300px and up. Scaling the
// crop to a target width instead of by a fixed factor keeps the popup the same
// size whatever the source did, which a fixed multiplier cannot: a flat 2x blew
// a 312px DASH tile up into a 624px popup covering a good part of the player.
const THUMBNAIL_PREVIEW_WIDTH = 160;
// Ceiling on upscaling, so a very small tile stays soft rather than being
// blown up into a blocky mess.
const THUMBNAIL_PREVIEW_MAX_SCALE = 3;

/** Factor to draw a tile of `tileWidth` at, so the popup lands on the target width. */
function thumbnailPreviewScale(tileWidth: number): number {
  if (!tileWidth) return 1;
  return Math.min(THUMBNAIL_PREVIEW_WIDTH / tileWidth, THUMBNAIL_PREVIEW_MAX_SCALE);
}

// ---------------------------------------------------------------------------
// Custom Video.js PiP button (registered once per page load)
// ---------------------------------------------------------------------------

let _pipButtonRegistered = false;

function ensurePipButtonRegistered(): void {
  if (_pipButtonRegistered) return;
  _pipButtonRegistered = true;

  // getComponent()'s return is typed only as `typeof Component`, which omits
  // Button's own members (controlText, ...); recover the real Button class type.
  const Button = videojs.getComponent('Button') as unknown as typeof VjsButton;
  if (!Button) return;

  class VjspPipButton extends Button {
    constructor(...args: ConstructorParameters<typeof Button>) {
      super(...args);
      this.addClass('vjsp-pip-button');
      this.controlText('Picture in Picture');

      // Inject SVG icon into the placeholder span
      const placeholder = this.el().querySelector<HTMLElement>('.vjs-icon-placeholder');
      if (placeholder) {
        placeholder.innerHTML = PIP_ICON_SVG;
      }
    }

    handleClick(): void {
      this.player().trigger('vjsp:pip-toggle');
    }
  }

  videojs.registerComponent('VjspPipButton', VjspPipButton);
}

// ---------------------------------------------------------------------------
// VHS representation (internal, mirrors the @videojs/http-streaming API)
// ---------------------------------------------------------------------------

interface VhsRepresentation {
  id: string;
  height: number;
  bandwidth: number;
  enabled: (val?: boolean) => boolean | undefined;
  // The raw HLS/DASH playlist backing this representation: carries the full
  // manifest attributes (e.g. `AVERAGE-BANDWIDTH`) that `bandwidth` above
  // doesn't, since that's populated from the peak `BANDWIDTH` value only.
  // Used by the custom ABR selector below.
  playlist?: { attributes?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Custom Video.js settings button (gear), registered once per page load
//
// Opens the flyout built in EvePlayer._renderSettings: a stacked settings
// menu whose root lists "Quality" and "Playback speed" rows, each drilling into
// its own sub-panel. Replaces the old inline "Auto" text quality button.
// ---------------------------------------------------------------------------

let _settingsButtonRegistered = false;

function ensureSettingsButtonRegistered(): void {
  if (_settingsButtonRegistered) return;
  _settingsButtonRegistered = true;

  // getComponent()'s return is typed only as `typeof Component`, which omits
  // Button's own members (controlText, ...); recover the real Button class type.
  const Button = videojs.getComponent('Button') as unknown as typeof VjsButton;
  if (!Button) return;

  class VjspSettingsButton extends Button {
    constructor(...args: ConstructorParameters<typeof Button>) {
      super(...args);
      this.addClass('vjsp-settings-button');
      this.controlText('Settings');

      const placeholder = this.el().querySelector<HTMLElement>('.vjs-icon-placeholder');
      if (placeholder) {
        placeholder.innerHTML = SETTINGS_ICON_SVG;
      }
      // Hidden until _refreshSettingsVisibility decides there's something to
      // show (>= 2 quality levels, or speed control enabled).
      (this.el() as HTMLElement).style.display = 'none';
    }

    handleClick(): void {
      this.player().trigger('vjsp:settings-menu-toggle');
    }
  }

  videojs.registerComponent('VjspSettingsButton', VjspSettingsButton);
}

// ---------------------------------------------------------------------------
// Safari/iOS phantom native caption tracks (subs/caps button, registered
// once per page load)
//
// On Safari/iOS native HLS, AVFoundation sometimes exposes a native
// `kind: 'captions'` TextTrack that never carries a single cue (confirmed on
// device: `kind:"captions" id:"0" label:"" mode:"showing" cues:0`, on a
// stream whose manifest declares no subtitles/captions at all). Video.js's
// SubsCapsButton shows itself the moment that track appears. A real,
// manifest-declared subtitle rendition always surfaces as `kind:
// 'subtitles'`, never `'captions'`, so filtering on `kind` alone doesn't
// touch it. A `captions` track is hidden only until it actually produces a
// cue (not id-based, real device data showed no usable id convention).
// ---------------------------------------------------------------------------

const PENDING_SAFARI_CAPTION_TRACK = Symbol('vjspPendingSafariCaptionTrack');

interface PossiblySafariCaptionTrack {
  kind?: string;
  mode?: string;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  [PENDING_SAFARI_CAPTION_TRACK]?: boolean;
}

declare class VjsSubsCapsButtonShape {
  constructor(...args: unknown[]);
  createItems(...args: unknown[]): { track?: PossiblySafariCaptionTrack }[];
}

let _subsCapsButtonRegistered = false;

function ensureSubsCapsButtonRegistered(): void {
  if (_subsCapsButtonRegistered) return;
  _subsCapsButtonRegistered = true;

  const SubsCapsButton = videojs.getComponent(
    'SubsCapsButton'
  ) as unknown as typeof VjsSubsCapsButtonShape;
  if (!SubsCapsButton) return;

  class VjspSubsCapsButton extends SubsCapsButton {
    createItems(...args: unknown[]): { track?: PossiblySafariCaptionTrack }[] {
      return super
        .createItems(...args)
        .filter((item) => !item.track?.[PENDING_SAFARI_CAPTION_TRACK]);
    }
  }

  videojs.registerComponent(
    'SubsCapsButton',
    VjspSubsCapsButton as unknown as Parameters<typeof videojs.registerComponent>[1]
  );
}

// ---------------------------------------------------------------------------
// VHS ABR tuning (applied once per page load, not per player instance)
// ---------------------------------------------------------------------------

let _vhsBandwidthVarianceTuned = false;

// http-streaming's default playlist selector requires the *estimated*
// bandwidth to exceed a rendition's advertised peak `BANDWIDTH` (not its
// `AVERAGE-BANDWIDTH`) by this factor before it's even considered a
// candidate (see Config.BANDWIDTH_VARIANCE upstream). For sources encoded
// with a high peak-to-average ratio (QVBR-style encodes, common in ad-hoc
// test streams), the default 1.2x margin on top of an already-peak value
// means ABR needs roughly 2-3x the stream's real average bitrate in
// measured throughput before it will ever pick the top rendition, which
// reads as "auto quality never goes up" even on connections that are
// comfortably fast enough. Dropping the margin to 1.0 (no added slack
// beyond the peak value itself) brings switch-up behavior closer to
// players that weight average bitrate more heavily. This is a *global*
// static on the http-streaming module, not scoped to one player instance;
// it affects every Vhs-backed player on the page once set.
function ensureVhsBandwidthVarianceTuned(): void {
  if (_vhsBandwidthVarianceTuned) return;
  _vhsBandwidthVarianceTuned = true;
  // `BANDWIDTH_VARIANCE` is a `@videojs/http-streaming` static, not in
  // `@types/video.js`; model just that field.
  const vhs = (videojs as unknown as { Vhs?: { BANDWIDTH_VARIANCE: number } }).Vhs;
  // Guards against `@videojs/http-streaming` not having registered itself
  // (e.g. it failed to load, or, as in this package's own unit tests,
  // `video.js` itself is mocked out and never runs that registration).
  if (!vhs) return;
  vhs.BANDWIDTH_VARIANCE = 1.0;
}

// ---------------------------------------------------------------------------
// Custom "Auto" playlist selector (tuned for behaviour closer to mature
// commercial players)
// ---------------------------------------------------------------------------
//
// http-streaming's built-in selectors (`lastBandwidthSelector` /
// `simpleSelector`) pick the highest rendition whose declared *peak*
// `BANDWIDTH`, times `Config.BANDWIDTH_VARIANCE` (1.2 by default), stays
// under `vhs.systemBandwidth`. Two things about that make Auto park one (or
// two) rungs below where mature commercial players sit on the identical
// stream + line:
//
//  1. `systemBandwidth` is the *harmonic mean* of the network estimate and
//     the decrypt/transmux/append rate: `1 / (1/bandwidth + 1/throughput)`.
//     It is always well below the real link speed, and with JS transmux
//     (`overrideNative: true`) under load it can be dragged below a
//     mid-rendition's bitrate outright, at which point Auto freezes on the
//     bottom rendition even though the connection is comfortably fast
//     enough (observed: stuck at 360p on this asset's 800k/4M/8M ladder).
//  2. DASH `bandwidth` is a max-over-window (MPEG-DASH spec), and HLS
//     streams routinely omit `AVERAGE-BANDWIDTH`; QVBR-style encodes
//     declare peak ~20-40% above the real average. Gating on the full peak
//     therefore demands far more headroom than the rendition actually
//     needs.
//
// This selector instead:
//   - reads the *raw* segment-measured throughput straight off the segment
//     loader (`mainSegmentLoader_.bandwidth`): the real number, untouched
//     by `useNetworkInformationApi` (which only rewrites the `vhs.bandwidth`
//     getter), and NOT run through the `systemBandwidth` harmonic mean;
//   - smooths it with an *asymmetric* EWMA kept per VhsHandler: a falling
//     sample is weighted heavily (react to congestion within one segment),
//     a rising one lightly (climb steadily, don't flip-flop). This is what
//     keeps the automatic response quick on the way down without making it
//     jittery on the way up;
//   - compares against `AVERAGE-BANDWIDTH` when present, else against
//     `peak * PEAK_TO_AVERAGE_RATIO` as a stand-in for the real average;
//   - applies a buffer-based boost that can only ever push the pick *up*,
//     and only while the unboosted estimate still supports staying at the
//     current rendition, so a genuine bandwidth drop is never masked by
//     "but the buffer is still full". This reproduces the "buffer is fine,
//     go to 1080p" behaviour of mature players without the "buffer is fine,
//     ignore the drop" stall that a plain multiplier caused (1080→720 lagged
//     a whole buffer's worth of playback before);
//   - skips player-dimension filtering entirely (see
//     `limitRenditionByPlayerDimensions: false` in the constructor).
//
// Tunables: raise aggressiveness by lowering the ratio or raising the
// bonus / up-weight; lower them if a marginal line starts rebuffering after
// a step-up or the rendition oscillates.
const PEAK_TO_AVERAGE_RATIO = 0.75;
const EWMA_WEIGHT_DOWN = 0.7; // newest sample below the average → react fast
const EWMA_WEIGHT_UP = 0.45; // newest sample above the average → climb steadily
const HEALTHY_BUFFER_SECONDS = 10;
const HEALTHY_BUFFER_ESTIMATE_BONUS = 1.4;
const DEFAULT_INITIAL_BANDWIDTH = 4194304;

/**
 * Validates a `minBandwidth`/`maxBandwidth` pair from {@link PlayerOptions}:
 * each must be a finite number > 0 (or unset), and `min` must not exceed
 * `max` when both are set. Returns the pair unchanged if valid, or `{}` (both
 * dropped) with a `console.warn` otherwise — mirrors the graceful-degradation
 * style used elsewhere in this file (e.g. `_normalizeTextTracks`) rather than
 * throwing on a bad constructor option.
 */
function validateBandwidthCaps(
  minBandwidth: number | undefined,
  maxBandwidth: number | undefined
): { min?: number; max?: number } {
  const isValid = (n: number | undefined) => n === undefined || (Number.isFinite(n) && n > 0);
  if (!isValid(minBandwidth) || !isValid(maxBandwidth)) {
    console.warn(
      '[EvePlayer] constructor: minBandwidth/maxBandwidth must be finite numbers > 0; ignoring',
      { minBandwidth, maxBandwidth }
    );
    return {};
  }
  if (minBandwidth !== undefined && maxBandwidth !== undefined && minBandwidth > maxBandwidth) {
    console.warn(
      '[EvePlayer] constructor: minBandwidth must not exceed maxBandwidth; ignoring both',
      { minBandwidth, maxBandwidth }
    );
    return {};
  }
  return { min: minBandwidth, max: maxBandwidth };
}


// `this` is bound by http-streaming itself (not by us) to the VhsHandler
// instance (see applyCustomAbrSelector below for how/when it's attached).
// Exported for unit testing only; not part of the package's public API
// (index.ts does not re-export it).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eveAbrPlaylistSelector(this: any): VhsRepresentation['playlist'] | null {
  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
  const enabledReps: VhsRepresentation[] = (this.representations?.() ?? []).filter(
    (rep: VhsRepresentation) => rep.enabled()
  );
  if (enabledReps.length === 0) return null;

  // Raw segment-measured throughput (the real network number, before the
  // `systemBandwidth` harmonic mean and before any Network Information API
  // override of the `vhs.bandwidth` getter).
  const measured = Number(this.playlistController_?.mainSegmentLoader_?.bandwidth) || 0;
  if (measured > 0) {
    const prev =
      typeof this.__abrEwma === 'number' && this.__abrEwma > 0 ? this.__abrEwma : measured;
    const weight = measured < prev ? EWMA_WEIGHT_DOWN : EWMA_WEIGHT_UP;
    this.__abrEwma = weight * measured + (1 - weight) * prev;
  }
  const uncappedEstimate: number =
    (typeof this.__abrEwma === 'number' && this.__abrEwma > 0 ? this.__abrEwma : 0) ||
    Number(this.options_?.bandwidth) ||
    DEFAULT_INITIAL_BANDWIDTH;
  const minBandwidth: number =
    typeof this.__eveMinBandwidth === 'number' ? this.__eveMinBandwidth : 0;
  const maxBandwidth: number =
    typeof this.__eveMaxBandwidth === 'number' ? this.__eveMaxBandwidth : Infinity;
  const estimateRaw: number = Math.min(Math.max(uncappedEstimate, minBandwidth), maxBandwidth);

  let bufferAhead = 0;
  try {
    const buffered = this.tech_.buffered();
    const currentTime = Number(this.tech_.currentTime()) || 0;
    bufferAhead =
      buffered && buffered.length ? buffered.end(buffered.length - 1) - currentTime : 0;
  } catch {
    /* tech / buffered() not ready yet */
  }

  const scored = enabledReps.map((rep) => {
    // m3u8-parser exposes `AVERAGE-BANDWIDTH` as a raw string ('1217413'),
    // not a number; coerce, then fall back to a discounted peak.
    const averageBandwidth = Number(rep.playlist?.attributes?.['AVERAGE-BANDWIDTH']);
    const target = Number.isFinite(averageBandwidth)
      ? averageBandwidth
      : rep.bandwidth * PEAK_TO_AVERAGE_RATIO;
    return { rep, target };
  });
  const byTargetDesc = scored.slice().sort((a, b) => b.target - a.target);
  const lowestAvailable = scored.slice().sort((a, b) => a.target - b.target)[0];
  const pickFor = (estimate: number) =>
    byTargetDesc.find((candidate) => candidate.target < estimate) ?? lowestAvailable;

  const rawPick = pickFor(estimateRaw);

  // Buffer-based optimism (only ever pushes the pick *up*, and only while
  // the unboosted estimate still supports at least the current rendition).
  // If bandwidth genuinely dropped, `rawPick` is already a downswitch and we
  // let it stand instead of riding the buffer down.
  let finalPick = rawPick;
  if (bufferAhead >= HEALTHY_BUFFER_SECONDS) {
    const boostedPick = pickFor(Math.min(estimateRaw * HEALTHY_BUFFER_ESTIMATE_BONUS, maxBandwidth));
    let currentTarget = 0;
    try {
      const currentBandwidth = Number(this.playlists?.media()?.attributes?.BANDWIDTH) || 0;
      currentTarget = currentBandwidth * PEAK_TO_AVERAGE_RATIO;
    } catch {
      /* no active media playlist yet */
    }
    if (boostedPick.target > rawPick.target && rawPick.target >= currentTarget) {
      finalPick = boostedPick;
    }
  }

  return finalPick.rep.playlist ?? null;
  /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
}

// http-streaming's `vhs.selectPlaylist` is documented as a runtime property
// on the tech's VHS handler (README: "vhs.selectPlaylist"), re-read on every
// segment-selection decision, not a `videojs()` constructor option. (The
// constructor-level `playlistSelector` name only takes effect via the
// *source* object, i.e. `player.src({ ..., playlistSelector })`, not via
// `html5.vhs`.) Re-applied on every `loadstart` since each new source gets a
// fresh VhsHandler instance.
// Exported for unit testing only; not part of the package's public API.
export function applyCustomAbrSelector(
  tech: unknown,
  minBandwidth?: number,
  maxBandwidth?: number
): void {
  const vhs = (
    tech as
      | {
          vhs?: {
            selectPlaylist?: unknown;
            __eveMinBandwidth?: number;
            __eveMaxBandwidth?: number;
          };
        }
      | undefined
  )?.vhs;
  if (!vhs) return;
  vhs.__eveMinBandwidth = minBandwidth;
  vhs.__eveMaxBandwidth = maxBandwidth;
  vhs.selectPlaylist = eveAbrPlaylistSelector;
}

// ---------------------------------------------------------------------------
// Handler type helper
// ---------------------------------------------------------------------------

type VjsHandler<T> = T extends void ? () => void : (data: T) => void;

// ---------------------------------------------------------------------------
// EvePlayer
// ---------------------------------------------------------------------------

/**
 * Framework-agnostic video player built on Video.js 8 +
 * `@videojs/http-streaming`. Wraps a single Video.js `Player` behind a stable,
 * typed API so consuming apps never touch Video.js directly.
 *
 * One instance owns one `<video>` element, which it creates and appends into
 * the `container` passed to the constructor. Call {@link EvePlayer.dispose}
 * when you are done to tear down the DOM and listeners.
 *
 * Supports progressive MP4/MP3 plus HLS, MPEG-DASH and CMAF (over HLS or DASH).
 * The stylesheet must be imported separately:
 * `import '@admmedia/eveplayer/style.css'`.
 *
 * @example
 * ```ts
 * import { EvePlayer } from '@admmedia/eveplayer';
 * import '@admmedia/eveplayer/style.css';
 *
 * const player = new EvePlayer(document.getElementById('player')!, {
 *   widescreen: true,
 * });
 * player.setSource({
 *   sources: [{ src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' }],
 * });
 * player.on('play', () => console.log('playing'));
 * // later…
 * player.dispose();
 * ```
 */
export class EvePlayer {
  private readonly vjs: Player;
  private readonly emitter: EventEmitter;
  private readonly container: HTMLElement;
  private currentSource: SourceDescription | undefined;
  private bookmarks: Bookmark[] = [];
  private disposed = false;

  // Tracks the last value passed to `this.vjs.audioOnlyMode(...)` so we only
  // toggle it when it actually changes (each toggle relayouts the player and
  // returns a Promise). See `_setAudioOnlyMode` / `_isAudioOnlySource`.
  private _audioOnly = false;

  // Rendition the `renditionchange` event last reported, so a switch can carry
  // the level it came from and consumers can see the direction.
  private _lastRendition: QualityLevel | undefined;

  // The VHS playlist loader `_onMediaChange` is currently bound to. Each source
  // gets a fresh one, so the previous binding is dropped on the next loadstart.
  private _renditionSource: { off?: (event: string, cb: () => void) => void } | undefined;

  // True when the current source's declared type already told us definitively
  // whether it is audio-only (every `audio/*` → yes, any non-`audio/*` → no).
  // In that case the `loadedmetadata` 0x0-dimensions fallback below must NOT
  // run: Safari reports `videoWidth`/`videoHeight` as 0 at `loadedmetadata`
  // for native HLS (they only populate a frame or a `resize` later), which
  // would otherwise collapse a normal video stream to the audio-only control
  // bar. The fallback stays for genuinely type-less sources.
  private _audioOnlyResolvedFromType = false;

  // Cleanup refs for track listeners
  private readonly audioTrackChangeHandler: () => void;
  private readonly textTrackChangeHandler: () => void;
  private readonly safariCaptionWatchCleanups: Array<() => void> = [];

  // Chapter cues: tracks which native TextTrackCue objects already have an
  // 'enter' listener attached, so re-scanning (on loadedmetadata / text track
  // list changes) doesn't double-bind the same cue.
  private readonly boundChapterCues = new WeakSet<object>();

  // PiP state
  private _pipRestoreBtn: HTMLButtonElement | null = null;
  private _pipDragCleanup: (() => void) | null = null;
  // In-flow placeholder that holds the player's original space while PiP is
  // active (the container itself becomes `position: fixed` and leaves the flow).
  private _pipPlaceholder: HTMLElement | null = null;
  private readonly _pipPlaceholderText: string;

  // Settings menu (gear) state: quality + playback-speed flyout
  private _settingsMenu: HTMLElement | null = null;
  private _settingsLevel: 'root' | 'quality' | 'speed' = 'root';
  private _isAutoQuality = true;
  private _manualQualityLabel = '';
  private readonly _qualityEnabled: boolean;
  private readonly _speedEnabled: boolean;
  private readonly _playbackRates: number[];
  // Validated PlayerOptions.minBandwidth/maxBandwidth: see
  // validateBandwidthCaps and applyCustomAbrSelector above.
  private readonly _minBandwidth?: number;
  private readonly _maxBandwidth?: number;
  private _onSettingsDocClick: ((e: MouseEvent) => void) | null = null;
  private _onSettingsKeydown: ((e: KeyboardEvent) => void) | null = null;

  // Observers that keep the native audio/subs-caps popup menus re-parented at
  // the player root (video.js's MenuButton.update() rebuilds them back inside
  // their button on every track-list change).
  private readonly _nativeMenuObservers: MutationObserver[] = [];

  // Live drift countdown ("-M:SS" next to the native seek-to-live control)
  private _liveBehindEl: HTMLElement | null = null;
  private _liveBehindInterval: ReturnType<typeof setInterval> | null = null;

  // Mid-playback rebuffer ('stall') timing (see the 'waiting'/'playing'
  // handlers below). Reset per source on 'loadstart'.
  private _hasStartedPlayback = false;
  private _stallStartedAt: number | null = null;

  // Thumbnail-tile hover preview (DASH-IF thumbnail_tile convention)
  private readonly _thumbnailsEnabled: boolean;
  private _thumbnailTiles: ThumbnailTile[] = [];
  private _thumbnailManifestUrl: string | null = null;
  private _thumbnailManifestKind: 'dash' | 'hls' | null = null;
  private _thumbnailFetchToken = 0;
  private _thumbnailPreviewEl: HTMLElement | null = null;
  private _thumbnailHoverBound = false;
  private _thumbnailHoverCleanup: (() => void) | null = null;

  /**
   * Version of this library, as published (the `package.json` version baked
   * in at build time). Handy for support/diagnostics (e.g. `EvePlayer.version`
   * from the browser console, or to tell which CDN build a page loaded).
   * Reads `'0.0.0-dev'` in non-bundled contexts (tests).
   */
  static readonly version: string =
    typeof __EVE_VERSION__ !== 'undefined' ? __EVE_VERSION__ : '0.0.0-dev';

  /**
   * Registers a Video.js UI-string dictionary for a locale (control bar labels,
   * menu items, etc.), then activate it by passing the same `code` as
   * {@link PlayerOptions.language}.
   *
   * Video.js is bundled privately inside this package (see the package README),
   * so a consumer's own `import videojs from 'video.js'` is a separate module
   * instance and calling `videojs.addLanguage()` on it has no effect on players
   * created by {@link EvePlayer}: this static method is the only way to
   * reach the copy this library actually uses. Registration is global and only
   * needs to happen once (e.g. at module load), not per player instance.
   */
  static addLanguage(code: string, dictionary: LanguageDictionary): void {
    videojs.addLanguage(code, dictionary);
  }

  /**
   * @param container - Element the player mounts into. A `<video class="video-js">`
   * is created and appended here; Video.js then wraps it in its own root element.
   * Must be in the DOM (this constructor touches `document`/`window`, so never
   * call it during server-side rendering).
   * @param options - Player configuration. See {@link PlayerOptions}.
   */
  constructor(container: HTMLElement, options: PlayerOptions = {}) {
    this.container = container;
    this.emitter = new EventEmitter();
    this._thumbnailsEnabled = options.thumbnails ?? true;
    this._pipPlaceholderText = options.pipPlaceholderText ?? 'Video is playing in picture-in-picture';
    this._qualityEnabled = options.quality !== false;
    this._speedEnabled = !options.hideSpeed;
    this._playbackRates =
      options.playbackRates && options.playbackRates.length > 0
        ? [...options.playbackRates]
        : [...DEFAULT_PLAYBACK_RATES];
    const bandwidthCaps = validateBandwidthCaps(options.minBandwidth, options.maxBandwidth);
    this._minBandwidth = bandwidthCaps.min;
    this._maxBandwidth = bandwidthCaps.max;

    // Register custom control bar components (browser-only, safe here)
    ensurePipButtonRegistered();
    ensureSettingsButtonRegistered();
    ensureSubsCapsButtonRegistered();
    ensureVhsBandwidthVarianceTuned();

    const isBackground = options.background ?? false;

    // Container modifier classes
    if (options.widescreen) container.classList.add('vjsp-widescreen');
    if (options.hidePlayButton) container.classList.add('vjsp-hide-play');
    if (options.showProgressDot) container.classList.add('vjsp-show-progress-dot');
    if (options.showVolumeDot) container.classList.add('vjsp-show-volume-dot');
    if (isBackground) {
      container.classList.add('vjsp-background');
      // Purely decorative (nothing here for a screen reader to announce or
      // a keyboard user to reach).
      container.setAttribute('aria-hidden', 'true');
    }

    // Create the <video> element inside the container
    const videoEl = document.createElement('video');
    videoEl.className = 'video-js';
    // Disable the browser's native PiP button (we provide our own CSS-based PiP)
    videoEl.setAttribute('disablePictureInPicture', '');
    // iOS Safari plays video inline only when this attribute is present, and
    // Video.js does not add it on its own. Without it, starting playback on an
    // iPhone kicks the video into the OS fullscreen player instead of playing
    // in place.
    videoEl.setAttribute('playsinline', '');
    if (isBackground) {
      // The native context menu ("Show controls", "Save video as…", …) can
      // reintroduce controls/behaviors this mode exists to remove.
      videoEl.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    container.appendChild(videoEl);

    this.vjs = videojs(videoEl, {
      autoplay: options.autoplay ?? isBackground,
      muted: options.muted ?? isBackground,
      loop: options.loop ?? isBackground,
      controls: !options.hideControls && !isBackground,
      fluid: options.fluid ?? true,
      language: options.language,
      preload: 'auto',
      // video.js's own default is `false`: without this, `.vjs-seek-to-live-control`
      // (the red/gray dot + drift countdown from _updateLiveBehindLabel below) never
      // becomes visible for real live sources, even though LiveTracker still computes
      // live-edge state correctly in the background. The plain `.vjs-live-control`
      // fallback shows instead, which has no drift-tracking of its own.
      liveui: true,
      // LiveTracker additionally refuses to start tracking at all (regardless of
      // `liveui` above) unless the live/DVR seekable window is at least
      // `trackingThreshold` seconds wide (video.js's own default: 20). Short-DVR
      // live encoders (a handful of segments, e.g. 3-4 × 6s ≈ 18-24s) can easily
      // fall under that, silently disabling the entire seek-to-live control (no
      // dot swap, no countdown, nothing clickable) with no error or indication
      // why. Lower it so tracking starts for realistically short windows too.
      liveTracker: { trackingThreshold: 2 },
      // Native text-track styling dialog ("captions settings" entry in the
      // subs/caps menu). Passing `false` drops the child, and video.js's
      // SubsCapsButton.createItems only adds the CaptionSettingsMenuItem when
      // `getChild('textTrackSettings')` exists, so the menu entry goes too.
      textTrackSettings: options.captionSettings === false ? false : undefined,
      html5: {
        vhs: {
          // Drive HLS/DASH in JS through MSE everywhere VHS is actually needed,
          // but NOT on Safari / iOS, where the browser plays HLS natively and
          // forcing it through MSE wedges playback: a visible first frame, seek
          // repaints it, but `play()` hangs forever with no `error` because the
          // MediaSource never reaches `open`. DASH still runs through MSE on
          // Safari regardless of this flag (Safari can't play it natively, so
          // `Vhs.supportsTypeNatively('dash')` is false and VHS takes over
          // anyway), so `getQualityLevels()` and the custom ABR selector keep
          // working for DASH there; for HLS on Safari they are inert, since the
          // native player exposes no rendition list. This is also VHS's own
          // default for `overrideNative`. See ADR-0003.
          overrideNative: !(videojs.browser.IS_ANY_SAFARI || videojs.browser.IS_IOS),
          // VHS's default ABR caps Auto-quality selection to the smallest
          // rendition that covers the *rendered CSS size* of the player,
          // regardless of measured bandwidth (confirmed by testing: a
          // stream estimated at ~100 Mbps still stayed on 720p in Auto,
          // switched to 1080p immediately on a manual pick, and dropped
          // back to 720p the moment Auto was re-enabled): that pattern is
          // exactly this player-dimension cap, not a bandwidth issue.
          // Disabling it lets Auto pick purely by estimated bandwidth
          // (still governed by BANDWIDTH_VARIANCE above), which is what
          // most consumers actually expect "Auto" to mean.
          limitRenditionByPlayerDimensions: false,
          // Left at http-streaming's default (true) so VHS's *initial*,
          // pre-first-segment playlist guess can still be informed by
          // `navigator.connection.downlink`. Steady-state "Auto" no longer
          // depends on it: eveAbrPlaylistSelector reads the raw
          // segment-measured throughput off `mainSegmentLoader_.bandwidth`
          // directly, which this flag never rewrites. (When the flag is on
          // and `downlink` reads < 10 Mbps, the `vhs.bandwidth` *getter*
          // returns `downlink * 1e6` instead of the real measurement (see
          // videojs-http-streaming's `bandwidth` getter), so the custom
          // selector deliberately bypasses that getter.)
          useNetworkInformationApi: true,
        },
      },
    });

    this.vjs.ready(() => {
      const controlBar = this.vjs.getChild('controlBar');
      if (!controlBar) return;

      // Video.js's native playback-rate menu is superseded by the settings
      // menu's "Playback speed" panel; always remove it so there's only one
      // speed control.
      controlBar.removeChild('playbackRateMenuButton');

      // Chapters button (a default control-bar child). Drop it entirely when
      // `chapters: false`; otherwise it stays and reveals itself only once the
      // source carries a chapters track with cues (video.js's own behaviour).
      if (options.chapters === false) {
        controlBar.removeChild('chaptersButton');
      }

      // Remove Video.js's own PiP toggle (if present) and add ours
      controlBar.removeChild('pictureInPictureToggle');
      if (options.pip !== false) {
        controlBar.addChild('VjspPipButton', {});
      }

      // Settings button (gear) + flyout menu, added whenever it could carry
      // at least one section (quality picker or speed picker). Its actual
      // visibility is then governed per-source by _refreshSettingsVisibility.
      if (options.settings !== false && (this._qualityEnabled || this._speedEnabled)) {
        controlBar.addChild('VjspSettingsButton', {});
        this._setupSettingsMenu();
        // Speed-only players have something to show before any source loads;
        // reveal the gear now rather than waiting for `loadedmetadata`.
        this._refreshSettingsVisibility();
      }

      // Lift the native audio/subs-caps popup menus out of their buttons and
      // re-anchor them at the player's bottom-right corner (same spot as the
      // settings flyout), which also turns them click-only. See _hoistNativeMenus.
      this._hoistNativeMenus();
    });

    // TODO(drm): Initialise videojs-contrib-eme here when DRM is required.
    // Planned API: setDrmConfig(config: DrmConfig): void
    // Once the optional peer dep is present, call: this.vjs.eme();

    // ---------------------------------------------------------------------------
    // Bridge Video.js events → internal emitter
    // ---------------------------------------------------------------------------

    const checkLiveBehind = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const liveTracker = (this.vjs as any).liveTracker;
      if (!liveTracker) return;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      if (!liveTracker.isLive?.()) return;
      this._updateLiveBehindLabel(liveTracker);
    };

    this.vjs.on('play', () => {
      this.emitter.emit('play');
      if (this._liveBehindInterval) {
        clearInterval(this._liveBehindInterval);
        this._liveBehindInterval = null;
      }
    });
    this.vjs.on('pause', () => {
      this.emitter.emit('pause');
      // `timeupdate` doesn't fire while paused, but the live edge keeps
      // moving; without this the "-M:SS" countdown (and the moment the
      // native dot needs to flip to gray) would freeze the instant you
      // pause instead of ticking up like it does while playing.
      checkLiveBehind();
      this._liveBehindInterval = setInterval(checkLiveBehind, 1000);
    });
    this.vjs.on('ended', () => this.emitter.emit('ended'));
    this.vjs.on('timeupdate', () => {
      this.emitter.emit('timeupdate', { currentTime: this.currentTime });
      checkLiveBehind();
    });
    // Video.js has no single 'readystatechange' event (unlike some other player APIs
    // this wrapper's callers were previously built against), readyState transitions
    // instead surface as discrete native media events, so we re-derive and re-emit our
    // own 'readystatechange' from those. Without this, `on('readystatechange', ...)`
    // silently never fires, even once the media is genuinely playing.
    let lastEmittedReadyState = -1;
    const emitReadyStateChange = () => {
      const readyState = this.readyState;
      if (readyState === lastEmittedReadyState) return;
      lastEmittedReadyState = readyState;
      this.emitter.emit('readystatechange', { readyState });
    };
    ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'waiting', 'emptied'].forEach(
      (evt) => this.vjs.on(evt, emitReadyStateChange)
    );
    // `gapjumped` is @videojs/http-streaming's own signal that it auto-seeked
    // over a detected buffer gap (a manifest discontinuity or a segment
    // missing from the buffer); VHS re-emits it directly on the player
    // itself (its `attachStreamingEventListeners_`), so there's no need to
    // reach into VHS internals (`tech().vhs.playlistController_`) here.
    this.vjs.on('gapjumped', (event: unknown) => {
      const gapInfo = (event as { metadata?: { gapInfo?: { from?: number; to?: number } } })
        ?.metadata?.gapInfo;
      if (typeof gapInfo?.from === 'number' && typeof gapInfo?.to === 'number') {
        this.emitter.emit('gapskip', { from: gapInfo.from, to: gapInfo.to });
      }
    });
    // Mid-playback rebuffer timing: the clock starts on 'waiting' only once
    // playback has genuinely started at least once (so the initial
    // pre-first-play buffering wait is never counted as a stall) and stops
    // on the next 'playing'.
    this.vjs.on('playing', () => {
      this._hasStartedPlayback = true;
      if (this._stallStartedAt !== null) {
        const duration = (performance.now() - this._stallStartedAt) / 1000;
        this._stallStartedAt = null;
        this.emitter.emit('stall', { duration });
      }
    });
    this.vjs.on('waiting', () => {
      if (this._hasStartedPlayback && this._stallStartedAt === null) {
        this._stallStartedAt = performance.now();
      }
    });
    // Re-applied on every `loadstart` (each new source gets a fresh VHS
    // tech/handler, so the custom ABR selector needs re-attaching each time).
    this.vjs.on('loadstart', () => {
      this._hasStartedPlayback = false;
      this._stallStartedAt = null;
      applyCustomAbrSelector(
        this.vjs.tech({ IWillNotUseThisInPlugins: true }),
        this._minBandwidth,
        this._maxBandwidth
      );
      // A new source means a new rendition history, and a new playlist loader
      // to listen on.
      this._lastRendition = undefined;
      this._attachRenditionListener();
    });
    this.vjs.on('ratechange', () => {
      this.emitter.emit('ratechange', { playbackRate: this.playbackRate });
      this._syncSettingsMenu();
    });
    this.vjs.on('volumechange', () => {
      // Keep the *stored* `muted` option pinned to the live state. Video.js
      // re-applies its constructor-time `muted` option to the media element
      // every time a tech is (re)loaded (`Html5#createEl` replays `loop` /
      // `muted` / `playsinline` / `autoplay` from `options_`), and a tech
      // reload happens on `player.reset()` and on any source swap that hands
      // over to another tech. A player started `muted: true` to get autoplay
      // past the browser policy therefore re-muted itself behind the viewer's
      // back at exactly those points (a pre-live -> live handover being the
      // one that gets noticed). `muted` is the *initial* state, not a standing
      // instruction: once unmuted, it stays unmuted.
      this._syncMutedOption();
      this.emitter.emit('volumechange', { volume: this.volume, muted: this.muted });
    });
    this.vjs.on('fullscreenchange', () =>
      this.emitter.emit('fullscreenchange', { isFullscreen: this.isFullscreen })
    );
    this.vjs.on('error', () => {
      const err = this.vjs.error();
      if (!err) return;
      const code = err.code ?? 0;
      const info = MEDIA_ERROR_INFO[code];
      const playerError: PlayerError = {
        code,
        message: info?.message ?? err.message ?? 'Unknown error',
        category: info?.category ?? 'unknown',
      };
      this.emitter.emit('error', playerError);
    });
    this.vjs.on('loadedmetadata', () => {
      const size: PlayerSize = {
        width: this.vjs.videoWidth() ?? 0,
        height: this.vjs.videoHeight() ?? 0,
      };
      this.emitter.emit('loadedmetadata', { size });
      // Fallback for sources whose type was too ambiguous to classify in
      // setSource(): if the decoded media has no picture, treat it as
      // audio-only. Skipped when the declared type already settled it,
      // otherwise Safari's 0x0 dimensions at `loadedmetadata` for native HLS
      // would wrongly collapse the player to the audio-only control bar.
      if (
        !this._audioOnly &&
        !this._audioOnlyResolvedFromType &&
        size.width === 0 &&
        size.height === 0
      ) {
        this._setAudioOnlyMode(true);
      }
      this.renderBookmarks();
      this._refreshSettingsVisibility();
      this._bindChapterCueListeners();
      this._loadThumbnailTrack();
      this._bindThumbnailHover();
    });

    // Settings menu toggle triggered by the custom gear button
    this.vjs.on('vjsp:settings-menu-toggle', () => {
      this._toggleSettingsMenu();
    });

    // When the control bar fades out (pointer left the player / inactivity),
    // close every open menu too, otherwise the settings flyout or a hoisted
    // track menu would be left floating over a now-chromeless video.
    this.vjs.on('userinactive', () => {
      this._closeSettingsMenu();
      this._closeNativeMenus();
    });

    // PiP toggle triggered by the custom button
    this.vjs.on('vjsp:pip-toggle', () => {
      if (this.isPip) {
        this.exitPip();
      } else {
        this.requestPip();
      }
    });

    // Audio track change listener
    this.audioTrackChangeHandler = () => {
      const tracks = this.getAudioTracks();
      const enabled = tracks.find((t) => t.enabled);
      if (enabled) this.emitter.emit('audiotrackchange', { track: enabled });
    };
    (this.vjs.audioTracks() as unknown as EventTarget).addEventListener(
      'change',
      this.audioTrackChangeHandler
    );

    // Text track change listener
    this.textTrackChangeHandler = () => {
      const tracks = this.getTextTracks();
      for (const track of tracks) {
        if (track.mode === 'showing') this.emitter.emit('texttrackchange', { track });
      }
      // A chapters track can become available (or gain cues) independently of
      // loadedmetadata; re-scan here too.
      this._bindChapterCueListeners();
    };
    (this.vjs.textTracks() as unknown as EventTarget).addEventListener(
      'change',
      this.textTrackChangeHandler
    );

    if (videojs.browser.IS_ANY_SAFARI || videojs.browser.IS_IOS) {
      this._watchSafariCaptionTracks();
    }
  }

  /**
   * Marks a newly seen native `kind: 'captions'` track as pending (hidden
   * from the subs/caps menu, see `ensureSubsCapsButtonRegistered`), and
   * un-marks it the moment it produces its first real `cuechange`.
   */
  private _watchSafariCaptionTracks(): void {
    const trackList = this.vjs.textTracks() as unknown as EventTarget &
      ArrayLike<PossiblySafariCaptionTrack>;

    const watch = (track: PossiblySafariCaptionTrack): void => {
      if (track.kind !== 'captions' || track[PENDING_SAFARI_CAPTION_TRACK]) return;
      track[PENDING_SAFARI_CAPTION_TRACK] = true;
      if (track.mode === 'disabled') track.mode = 'hidden';

      const onCueChange = (): void => {
        track[PENDING_SAFARI_CAPTION_TRACK] = false;
        track.removeEventListener?.('cuechange', onCueChange);
        this._refreshSubsCapsButton();
      };
      track.addEventListener?.('cuechange', onCueChange);
      this.safariCaptionWatchCleanups.push(() =>
        track.removeEventListener?.('cuechange', onCueChange)
      );
    };

    for (let i = 0; i < trackList.length; i++) watch(trackList[i]);

    const onAddTrack = (event: { track?: PossiblySafariCaptionTrack }): void => {
      if (event.track) watch(event.track);
      this._refreshSubsCapsButton();
    };
    trackList.addEventListener('addtrack', onAddTrack as EventListener);
    this.safariCaptionWatchCleanups.push(() =>
      trackList.removeEventListener('addtrack', onAddTrack as EventListener)
    );
  }

  /** Re-runs the subs/caps control-bar button's own visibility logic. */
  private _refreshSubsCapsButton(): void {
    const controlBar = this.vjs.getChild('controlBar');
    const button = controlBar?.getChild('subsCapsButton') as unknown as
      | { update?: () => void }
      | undefined;
    button?.update?.();
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  /**
   * Start (or resume) playback. Resolves when playback actually begins; the
   * returned promise rejects if the browser blocks it (e.g. un-muted autoplay).
   */
  play(): Promise<void> {
    return (this.vjs.play() as Promise<void> | undefined) ?? Promise.resolve();
  }

  /** Pause playback. */
  pause(): void {
    this.vjs.pause();
  }

  /** Current playback position, in seconds. Assigning seeks the media. */
  get currentTime(): number {
    return this.vjs.currentTime() ?? 0;
  }

  set currentTime(value: number) {
    this.vjs.currentTime(value);
  }

  /** Total media duration in seconds (0 until metadata has loaded; `Infinity` for live). */
  get duration(): number {
    return this.vjs.duration() ?? 0;
  }

  /** True when playback is paused. */
  get paused(): boolean {
    return this.vjs.paused() ?? true;
  }

  /** The underlying `HTMLMediaElement.readyState` (0–4); 0 when no tech is ready yet. */
  get readyState(): number {
    const tech = this.vjs.tech({ IWillNotUseThisInPlugins: true });
    const el = tech?.el() as HTMLVideoElement | undefined;
    return el?.readyState ?? 0;
  }

  /** True once playback has run to the end of the media. */
  get ended(): boolean {
    return this.vjs.ended() ?? false;
  }

  // ---------------------------------------------------------------------------
  // Volume
  // ---------------------------------------------------------------------------

  /** Playback volume from `0` to `1`. Values assigned outside that range are clamped. */
  get volume(): number {
    return this.vjs.volume() ?? 1;
  }

  set volume(value: number) {
    this.vjs.volume(Math.max(0, Math.min(1, value)));
  }

  /** Mute state. */
  get muted(): boolean {
    return this.vjs.muted() ?? false;
  }

  set muted(value: boolean) {
    this.vjs.muted(value);
    // Not left to the `volumechange` listener alone: that fires off the media
    // element, so a programmatic mute/unmute made before the element is ready
    // (or on a tech that swallows the event) would not reach it, and the stale
    // stored option would win at the next tech reload. See _syncMutedOption().
    this._syncMutedOption();
  }

  /**
   * Pins Video.js's stored `muted` option to the player's current muted state,
   * so a tech reload (`player.reset()`, a tech-changing source swap) restores
   * what the viewer last chose instead of resurrecting the `muted` value the
   * player was constructed with.
   */
  private _syncMutedOption(): void {
    this.vjs.options({ muted: this.vjs.muted() ?? false });
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  /** Whether playback restarts from the beginning when it reaches the end. */
  get loop(): boolean {
    return this.vjs.loop() ?? false;
  }

  set loop(value: boolean) {
    this.vjs.loop(value);
  }

  // ---------------------------------------------------------------------------
  // Playback rate
  // ---------------------------------------------------------------------------

  /** Playback speed multiplier (`1` = normal). Also settable from the settings menu. */
  get playbackRate(): number {
    return this.vjs.playbackRate() ?? 1;
  }

  set playbackRate(value: number) {
    this.vjs.playbackRate(value);
  }

  // ---------------------------------------------------------------------------
  // Source
  // ---------------------------------------------------------------------------

  /**
   * Load a new source. Safe to call at any time, including before the player
   * is `ready` and repeatedly to switch content.
   *
   * Clears bookmark markers and any previously side-loaded text tracks, sets
   * the poster if given, collapses to audio-only chrome when every source is
   * `audio/*`, and emits `sourceset`. Pass `sources: []` for a poster-only
   * state (skips `.src()` instead of raising a "source not supported" error).
   *
   * @param source - The source to load. See {@link SourceDescription}.
   */
  setSource(source: SourceDescription): void {
    this.clearBookmarkMarkers();
    this.currentSource = source;
    // A new source starts with every VHS rendition enabled, i.e. in Auto, so
    // a manual pick made on the previous source must not survive it (it would
    // otherwise mark every rendition as `selected` and tick every menu row).
    this._isAutoQuality = true;
    this._manualQualityLabel = '';
    if (source.poster) this.vjs.poster(source.poster);
    // An empty sources array reaching Video.js's `.src()` raises
    // MEDIA_ERR_SRC_NOT_SUPPORTED ("No compatible source was found for this
    // media") even though nothing was actually asked to load. Consumers that
    // want a poster-only/no-video state pass `sources: []`; skip `.src()`
    // entirely in that case instead of forcing them to special-case it.
    if (source.sources.length > 0) this.vjs.src(source.sources);

    // Audio-only sources otherwise render as a full 16:9 black box (Video.js's
    // `fluid` mode falls back to 16:9 when the media has no picture). If every
    // source is declared `audio/*`, collapse the player to just the control bar
    // now; when the source types are ambiguous, the `loadedmetadata` handler
    // does the same check against the decoded dimensions as a fallback.
    const audioOnly = this._isAudioOnlySource(source);
    this._audioOnlyResolvedFromType = audioOnly !== undefined;
    if (audioOnly !== undefined) this._setAudioOnlyMode(audioOnly);

    // `source.textTracks` is validated, not trusted. Consumers wire it from
    // upstream source-formatting layers that have shipped, in the field, a bare
    // string (the VTT URL) in place of the array, and entries with no usable
    // `kind`. A string is iterable, so a naive `for..of` added one broken
    // remote track per character; a missing/unknown `kind` makes Video.js
    // silently coerce the track to `'subtitles'`, lighting up the CC button
    // over tracks that never load. `_normalizeTextTracks` drops anything that
    // isn't a well-formed WebVTT track descriptor before it reaches
    // `addRemoteTextTrack()` (which uses `manualCleanup: false`, so Video.js
    // clears these on the next `.src()` and stale tracks don't leak forward).
    for (const track of this._normalizeTextTracks(source.textTracks)) {
      this._addRemoteTextTrack(track);
    }

    this._thumbnailTiles = [];
    this._hideThumbnailPreview();
    this._thumbnailFetchToken++;
    const dashSource = source.sources.find((s) => s.type === 'application/dash+xml');
    const hlsSource = source.sources.find((s) => s.type === 'application/x-mpegURL');
    const thumbnailSource = dashSource ?? hlsSource;
    this._thumbnailManifestKind = dashSource ? 'dash' : hlsSource ? 'hls' : null;
    this._thumbnailManifestUrl =
      this._thumbnailsEnabled && thumbnailSource ? thumbnailSource.src : null;

    this.emitter.emit('sourceset', { source });
  }

  /** The source description most recently passed to {@link EvePlayer.setSource}, if any. */
  getSource(): SourceDescription | undefined {
    return this.currentSource;
  }

  /**
   * Tears the playback engine back to a clean, sourceless state without
   * disposing the player, so the next {@link EvePlayer.setSource} loads as a
   * fresh start instead of a swap on top of the media already playing.
   *
   * Needed between two genuinely different sources (a pre-live placeholder
   * handing over to the live stream, a switch that changes container): Safari
   * keeps a single playback engine across an in-place source swap, and its
   * native-to-VHS hand-off can race the segment loaders, leaving the player
   * frozen on the last frame of the previous source.
   *
   * The viewer's audio state is carried across. Video.js's own reset puts the
   * volume back to 100% and re-applies the `muted` option the player was
   * constructed with (typically `true`, to get autoplay past the browser
   * policy); neither is something the viewer asked for, so both are restored.
   */
  reset(): void {
    const volume = this.volume;
    const muted = this.muted;
    this.vjs.reset();
    this.vjs.volume(volume);
    this.vjs.muted(muted);
  }

  /**
   * Whether every source in `source` is an audio-only container (`audio/*`
   * MIME type). Returns `undefined` when it can't be told from the declared
   * types alone (a source with no `type`), leaving the decision to the
   * `loadedmetadata` dimension check.
   */
  private _isAudioOnlySource(source: SourceDescription): boolean | undefined {
    if (source.sources.length === 0) return undefined;
    let sawAudio = false;
    for (const s of source.sources) {
      if (!s.type) return undefined;
      if (!s.type.toLowerCase().startsWith('audio/')) return false;
      sawAudio = true;
    }
    return sawAudio;
  }

  /**
   * Toggle Video.js's `audioOnlyMode` (collapses the player to just the control
   * bar, bypassing `fluid`'s 16:9 fallback). No-ops when already in the target
   * state (each real toggle relayouts the player).
   */
  private _setAudioOnlyMode(enabled: boolean): void {
    if (this._audioOnly === enabled) return;
    this._audioOnly = enabled;
    // `setSource()` is typically called right after the constructor, before
    // Video.js has fired `ready`; `audioOnlyMode()` needs the control bar laid
    // out to measure its height, so defer to `ready()` (fires synchronously if
    // already ready). Returns a Promise; nothing here needs to await it.
    this.vjs.ready(() => {
      void this.vjs.audioOnlyMode(enabled);
    });
  }

  /**
   * Sanitises `setSource()`'s `textTracks` into a list of well-formed
   * {@link SourceTextTrack}s safe to hand to `addRemoteTextTrack()`. It never
   * trusts the input shape:
   *
   * - a non-array value (e.g. a bare VTT URL string, which is iterable) → `[]`;
   * - an entry that isn't a plain object, or whose `src` isn't a non-empty
   *   string → dropped;
   * - an entry whose `kind` isn't a valid {@link TextTrackKind} → dropped
   *   (Video.js would coerce an unknown/missing `kind` to `'subtitles'` and put
   *   a phantom entry in the CC menu).
   *
   * Surviving entries are rebuilt field by field (unknown properties stripped,
   * `srclang` / `label` / `default` kept only when correctly typed), so a
   * malformed-but-objecty input can't smuggle anything through. Each drop is
   * reported with `console.warn`; the non-array case warns once, not once per
   * character.
   */
  private _normalizeTextTracks(textTracks: unknown): SourceTextTrack[] {
    if (textTracks == null) return [];

    if (!Array.isArray(textTracks)) {
      console.warn(
        '[EvePlayer] setSource: `textTracks` must be an array of track descriptors; ignoring',
        textTracks
      );
      return [];
    }

    const normalized: SourceTextTrack[] = [];
    for (const entry of textTracks as unknown[]) {
      if (entry == null || typeof entry !== 'object') {
        console.warn('[EvePlayer] setSource: ignoring malformed text track', entry);
        continue;
      }

      const record = entry as Record<string, unknown>;
      const { src, kind, srclang, label, default: isDefault } = record;

      if (typeof src !== 'string' || src.trim() === '') {
        console.warn('[EvePlayer] setSource: ignoring text track with no usable `src`', entry);
        continue;
      }
      if (typeof kind !== 'string' || !VALID_TEXT_TRACK_KINDS.has(kind)) {
        console.warn(
          `[EvePlayer] setSource: ignoring text track with invalid \`kind\` (${JSON.stringify(
            kind
          )}); expected one of ${[...VALID_TEXT_TRACK_KINDS].join(', ')}`,
          entry
        );
        continue;
      }

      normalized.push({
        kind: kind as TextTrackKind,
        src,
        srclang: typeof srclang === 'string' ? srclang : undefined,
        label: typeof label === 'string' ? label : undefined,
        default: typeof isDefault === 'boolean' ? isDefault : undefined,
      });
    }
    return normalized;
  }

  /**
   * Side-loads a single text track (e.g. a 'chapters' WebVTT file not embedded
   * in the HLS/DASH manifest itself). Only ever called with entries already
   * vetted by {@link _normalizeTextTracks}. For 'chapters' tracks, also
   * re-scans for cue listeners once the VTT finishes loading (the track's cues
   * aren't available synchronously), so a chapters track added after
   * loadedmetadata would otherwise never get its 'enter' listeners bound.
   */
  private _addRemoteTextTrack(track: SourceTextTrack): void {
    const trackEl = this.vjs.addRemoteTextTrack(
      { kind: track.kind, src: track.src, srclang: track.srclang, label: track.label, default: track.default },
      false
    ) as unknown as HTMLTrackElement;
    if (track.kind === 'chapters') {
      trackEl.addEventListener('load', () => this._bindChapterCueListeners());
    }
  }

  // ---------------------------------------------------------------------------
  // Tracks: audio
  // ---------------------------------------------------------------------------

  /**
   * video.js's `audioTracks()` / `textTracks()` return list objects that
   * `@types/video.js` types too loosely to index. Narrow one to a plain
   * length-bearing, indexable view of whatever track shape the caller needs.
   */
  private _trackList<T>(raw: unknown): ArrayLike<T> {
    return raw as ArrayLike<T>;
  }

  /** The audio tracks exposed by the current source (empty for single-audio media). */
  getAudioTracks(): AudioTrack[] {
    const tracks = this._trackList<{
      id: string;
      label: string;
      language: string;
      enabled: boolean;
    }>(this.vjs.audioTracks());
    const result: AudioTrack[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      result.push({ id: t.id, label: t.label, language: t.language, enabled: t.enabled });
    }
    return result;
  }

  /**
   * Switch the active audio track: enables the track whose `id` matches and
   * disables every other. No-op if no track has that id.
   *
   * @param id - Target track id, from {@link EvePlayer.getAudioTracks}.
   */
  setAudioTrack(id: string): void {
    const tracks = this._trackList<{ id: string; enabled: boolean }>(this.vjs.audioTracks());
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = tracks[i].id === id;
    }
  }

  // ---------------------------------------------------------------------------
  // Tracks: text / subtitles
  // ---------------------------------------------------------------------------

  /**
   * The subtitle/caption tracks for the current source. `metadata` and
   * `chapters` tracks are excluded; use {@link EvePlayer.getChapterCues}
   * for chapters.
   */
  getTextTracks(): TextTrack[] {
    const tracks = this._trackList<{
      id: string;
      label: string;
      language: string;
      kind: string;
      mode: string;
    }>(this.vjs.textTracks());
    const result: TextTrack[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.kind === 'metadata' || t.kind === 'chapters') continue;
      result.push({
        id: t.id, label: t.label, language: t.language, kind: t.kind,
        mode: t.mode as TextTrack['mode'],
      });
    }
    return result;
  }

  /**
   * Set a text track's display mode. To show one subtitle track exclusively,
   * set the others to `disabled` yourself (this does not touch other tracks).
   *
   * @param id - Target track id, from {@link EvePlayer.getTextTracks}.
   * @param mode - `disabled`, `hidden`, or `showing`.
   */
  setTextTrack(id: string, mode: TextTrack['mode']): void {
    const tracks = this._trackList<{ id: string; mode: string }>(this.vjs.textTracks());
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.id === id) t.mode = mode;
    }
  }

  // ---------------------------------------------------------------------------
  // Tracks: chapters
  //
  // Kept deliberately separate from getTextTracks()/setTextTrack(): chapter
  // cues aren't a language/subtitle choice, and mixing them into that API
  // would leak a 'chapters' entry into a subtitle picker built on top of it.
  // ---------------------------------------------------------------------------

  /** Returns every cue from any 'chapters'-kind text track (usually just one). */
  getChapterCues(): ChapterCue[] {
    const tracks = this._trackList<{
      kind: string;
      cues?: ArrayLike<{ id: string; startTime: number; endTime: number; text: string }>;
    }>(this.vjs.textTracks());
    const result: ChapterCue[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.kind !== 'chapters' || !t.cues) continue;
      for (let j = 0; j < t.cues.length; j++) {
        const cue = t.cues[j];
        result.push({ id: cue.id, startTime: cue.startTime, endTime: cue.endTime, text: cue.text });
      }
    }
    return result;
  }

  /**
   * Scans 'chapters'-kind text tracks and attaches a native cue 'enter'
   * listener to any cue that doesn't have one yet, emitting 'chapterentercue'
   * when playback crosses it. Safe to call repeatedly (e.g. on every
   * loadedmetadata / text track list change); already-bound cues are
   * skipped via `boundChapterCues`.
   */
  private _bindChapterCueListeners(): void {
    const tracks = this._trackList<{
      kind: string;
      cues?: ArrayLike<{
        id: string;
        startTime: number;
        endTime: number;
        text: string;
        addEventListener?: (event: string, handler: () => void) => void;
      }>;
    }>(this.vjs.textTracks());
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.kind !== 'chapters' || !t.cues) continue;
      for (let j = 0; j < t.cues.length; j++) {
        const cue = t.cues[j];
        if (!cue.addEventListener || this.boundChapterCues.has(cue)) continue;
        this.boundChapterCues.add(cue);
        cue.addEventListener('enter', () => {
          this.emitter.emit('chapterentercue', {
            cue: { id: cue.id, startTime: cue.startTime, endTime: cue.endTime, text: cue.text },
          });
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Bookmarks
  // ---------------------------------------------------------------------------

  /**
   * Replace the bookmark markers drawn on the progress bar. Markers are
   * positioned by {@link Bookmark.offset} against the current duration and are
   * re-rendered on `loadedmetadata`. Pass `[]` to clear them.
   *
   * @param bookmarks - The bookmarks to show.
   */
  setBookmarks(bookmarks: Bookmark[]): void {
    this.bookmarks = bookmarks;
    this.clearBookmarkMarkers();
    if (bookmarks.length > 0) this.renderBookmarks();
  }

  private clearBookmarkMarkers(): void {
    const holder = this.container.querySelector('.vjs-progress-holder');
    if (!holder) return;
    holder.querySelectorAll('.vjsp-bookmark-marker').forEach((el) => el.remove());
  }

  private renderBookmarks(): void {
    if (this.bookmarks.length === 0) return;
    const duration = this.duration;
    if (!duration || duration <= 0) return;
    const holder = this.container.querySelector('.vjs-progress-holder');
    if (!holder) return;

    for (const bm of this.bookmarks) {
      const pct = Math.max(0, Math.min(100, (bm.offset / duration) * 100));
      const btn = document.createElement('button');
      btn.className = 'vjsp-bookmark-marker';
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', bm.content);
      btn.setAttribute('data-bookmark-id', String(bm.id));
      btn.style.left = `${pct}%`;

      const tooltip = document.createElement('span');
      tooltip.className = 'vjsp-bookmark-tooltip';
      tooltip.textContent = bm.content;
      btn.appendChild(tooltip);
      holder.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------------------
  // Thumbnail-tile hover preview (DASH-IF thumbnail_tile convention)
  // ---------------------------------------------------------------------------

  /**
   * Fetches and parses the DASH manifest independently of VHS (which only
   * parses audio/video AdaptationSets) to pull out the thumbnail-tile sprite
   * track, if the manifest has one. No-op if disabled, no DASH source is set,
   * duration isn't known yet, or tiles are already loaded. Failures (network,
   * no thumbnail track present) are swallowed (a DASH source without a
   * thumbnail track is a normal case, not an error).
   */
  private _loadThumbnailTrack(): void {
    const url = this._thumbnailManifestUrl;
    const kind = this._thumbnailManifestKind;
    if (!url || !kind || this._thumbnailTiles.length > 0) return;
    const duration = this.duration;
    if (!duration) return;
    const token = this._thumbnailFetchToken;
    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        if (token !== this._thumbnailFetchToken || this.disposed) return [];
        return kind === 'dash'
          ? parseDashThumbnailTiles(text, url, this.duration)
          : parseHlsThumbnailTiles(text, url, this.duration);
      })
      .then((tiles) => {
        if (token !== this._thumbnailFetchToken || this.disposed) return;
        this._thumbnailTiles = tiles;
      })
      .catch(() => {
        // No thumbnail track available; the hover preview simply stays inactive.
      });
  }

  /** Binds progress-bar hover listeners once the native holder element exists. Safe to call repeatedly. */
  private _bindThumbnailHover(): void {
    if (!this._thumbnailsEnabled || this._thumbnailHoverBound) return;
    const holder = this.container.querySelector<HTMLElement>('.vjs-progress-holder');
    if (!holder) return;
    this._thumbnailHoverBound = true;

    const preview = document.createElement('div');
    preview.className = 'vjsp-thumbnail-preview';
    holder.appendChild(preview);
    this._thumbnailPreviewEl = preview;

    const onMove = (e: MouseEvent) => this._onThumbnailHoverMove(e, holder);
    const onLeave = () => this._hideThumbnailPreview();
    holder.addEventListener('mousemove', onMove);
    holder.addEventListener('mouseleave', onLeave);
    this._thumbnailHoverCleanup = () => {
      holder.removeEventListener('mousemove', onMove);
      holder.removeEventListener('mouseleave', onLeave);
      preview.remove();
    };
  }

  private _onThumbnailHoverMove(e: MouseEvent, holder: HTMLElement): void {
    if (this._thumbnailTiles.length === 0 || !this._thumbnailPreviewEl) return;
    const rect = holder.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const tile = findThumbnailTile(this._thumbnailTiles, pct * this.duration);
    if (!tile) {
      this._hideThumbnailPreview();
      return;
    }
    const scale = thumbnailPreviewScale(tile.width);
    const width = tile.width * scale;
    const height = tile.height * scale;
    const left = Math.max(0, Math.min(rect.width - width, pct * rect.width - width / 2));
    const el = this._thumbnailPreviewEl;
    el.style.backgroundImage = `url(${tile.imageUrl})`;
    el.style.backgroundSize = `${tile.sheetWidth * scale}px ${tile.sheetHeight * scale}px`;
    el.style.backgroundPosition = `-${tile.x * scale}px -${tile.y * scale}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.left = `${left}px`;
    el.classList.add('vjsp-thumbnail-preview--visible');
  }

  private _hideThumbnailPreview(): void {
    this._thumbnailPreviewEl?.classList.remove('vjsp-thumbnail-preview--visible');
  }

  // ---------------------------------------------------------------------------
  // Poster
  // ---------------------------------------------------------------------------

  /** Update the poster image shown before playback (and while paused at position 0). */
  setPoster(url: string): void {
    this.vjs.poster(url);
  }

  // ---------------------------------------------------------------------------
  // Visibility
  // ---------------------------------------------------------------------------

  /**
   * Show or hide the player without unmounting it (toggles a `vjsp-hidden`
   * class on the container). Playback state is untouched.
   */
  setVisible(visible: boolean): void {
    this.container.classList.toggle('vjsp-hidden', !visible);
  }

  // ---------------------------------------------------------------------------
  // Fullscreen
  // ---------------------------------------------------------------------------

  /** True when the player is in browser fullscreen. */
  get isFullscreen(): boolean {
    return this.vjs.isFullscreen() ?? false;
  }

  /** Request browser fullscreen for the player. Must be called from a user gesture. */
  requestFullscreen(): void {
    void this.vjs.requestFullscreen();
  }

  /** Exit browser fullscreen. */
  exitFullscreen(): void {
    void this.vjs.exitFullscreen();
  }

  // ---------------------------------------------------------------------------
  // Picture-in-Picture (CSS-based floating overlay)
  // ---------------------------------------------------------------------------

  /** True when the CSS floating PiP overlay is active. */
  get isPip(): boolean {
    return this.container.classList.contains('vjsp-pip-active');
  }

  /**
   * Activates the CSS floating PiP window.
   * The player container becomes `position: fixed` in the bottom-right corner,
   * draggable by the user. No native browser PiP API is used.
   */
  requestPip(): void {
    if (this.isPip) return;
    this._activatePip();
  }

  /** Deactivates the CSS floating PiP window and restores the player in-flow. */
  exitPip(): void {
    if (!this.isPip) return;
    this._deactivatePip();
  }

  private _activatePip(): void {
    // Drop a same-size placeholder into the flow first, while the container is
    // still laid out normally, so the page doesn't collapse when it goes fixed.
    this._insertPipPlaceholder();

    this.container.classList.add('vjsp-pip-active');
    this._updatePipButtonState(true);

    // Inject the restore button inside the floating window
    const btn = document.createElement('button');
    btn.className = 'vjsp-pip-restore';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Restore player');
    btn.title = 'Restore';
    btn.innerHTML = PIP_RESTORE_ICON_SVG;
    btn.addEventListener('click', () => this.exitPip());
    this.container.appendChild(btn);
    this._pipRestoreBtn = btn;

    this._setupPipDrag();
    this.emitter.emit('pipchange', { isPip: true });
  }

  private _deactivatePip(): void {
    this._teardownPipDrag();
    this._pipRestoreBtn?.remove();
    this._pipRestoreBtn = null;

    // Remove inline position overrides set during drag
    this.container.style.removeProperty('right');
    this.container.style.removeProperty('bottom');
    this.container.classList.remove('vjsp-pip-active');
    this._removePipPlaceholder();
    this._updatePipButtonState(false);
    this.emitter.emit('pipchange', { isPip: false });
  }

  /**
   * Insert an in-flow placeholder the same size as the player, right where the
   * player currently sits, so surrounding content keeps its position while the
   * container floats away as the PiP window.
   */
  private _insertPipPlaceholder(): void {
    const parent = this.container.parentElement;
    if (!parent || this._pipPlaceholder) return;

    const rect = this.container.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.className = 'vjsp-pip-placeholder';
    placeholder.style.width = `${Math.round(rect.width)}px`;
    placeholder.style.height = `${Math.round(rect.height)}px`;
    if (this._pipPlaceholderText) {
      const label = document.createElement('span');
      label.className = 'vjsp-pip-placeholder-text';
      label.textContent = this._pipPlaceholderText;
      placeholder.appendChild(label);
    }

    parent.insertBefore(placeholder, this.container);
    this._pipPlaceholder = placeholder;
  }

  private _removePipPlaceholder(): void {
    this._pipPlaceholder?.remove();
    this._pipPlaceholder = null;
  }

  private _updatePipButtonState(active: boolean): void {
    const controlBar = this.vjs.getChild('controlBar');
    const btn = controlBar?.getChild('VjspPipButton') as { toggleClass?: (c: string, v: boolean) => void } | null;
    btn?.toggleClass?.('vjsp-pip-is-active', active);
  }

  /**
   * Attach pointer-based drag to the floating PiP container.
   * Dragging anywhere on the window (except the control bar) repositions it.
   */
  private _setupPipDrag(): void {
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.vjs-control-bar, .vjsp-pip-restore')) return;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.container.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      this.container.setPointerCapture(e.pointerId);
      this.container.classList.add('vjsp-pip-dragging');
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.container.hasPointerCapture(e.pointerId)) return;
      const right = Math.max(8, startRight - (e.clientX - startX));
      const bottom = Math.max(8, startBottom - (e.clientY - startY));
      this.container.style.right = `${right}px`;
      this.container.style.bottom = `${bottom}px`;
    };

    const onPointerUp = (e: PointerEvent) => {
      this.container.releasePointerCapture(e.pointerId);
      this.container.classList.remove('vjsp-pip-dragging');
    };

    this.container.addEventListener('pointerdown', onPointerDown);
    this.container.addEventListener('pointermove', onPointerMove);
    this.container.addEventListener('pointerup', onPointerUp);

    this._pipDragCleanup = () => {
      this.container.removeEventListener('pointerdown', onPointerDown);
      this.container.removeEventListener('pointermove', onPointerMove);
      this.container.removeEventListener('pointerup', onPointerUp);
    };
  }

  private _teardownPipDrag(): void {
    this._pipDragCleanup?.();
    this._pipDragCleanup = null;
  }

  // ---------------------------------------------------------------------------
  // Settings menu (gear): quality + playback-speed flyout
  //
  // A stacked, drill-down menu: the root lists a row per section
  // ("Playback speed", "Quality") showing the current value; clicking a row
  // drills into that section's sub-panel (back arrow returns to root). The
  // menu is re-rendered from scratch on every level change and on every
  // external quality/rate change while it's open (_syncSettingsMenu).
  // ---------------------------------------------------------------------------

  private _getVhsRepresentations(): VhsRepresentation[] {
    // `tech().vhs` is `@videojs/http-streaming` internals, not covered by
    // `@types/video.js`; model just the one call we make.
    const tech = this.vjs.tech({ IWillNotUseThisInPlugins: true }) as unknown as {
      vhs?: { representations?: () => unknown };
    };
    const reps = tech.vhs?.representations?.();
    if (!Array.isArray(reps)) return [];
    return reps as VhsRepresentation[];
  }

  private _setupSettingsMenu(): void {
    const playerEl = this.vjs.el() as unknown as HTMLElement | undefined;
    if (!playerEl) return;
    const menu = document.createElement('div');
    menu.className = 'vjsp-settings-menu vjsp-settings-menu--hidden';
    menu.setAttribute('role', 'menu');
    playerEl.appendChild(menu);
    this._settingsMenu = menu;
  }

  /**
   * Re-parents the native audio-track / subs-caps / chapters popup menus from
   * inside their control-bar button to the player root (tagging them
   * `.vjsp-hoisted-menu`), so every popup opens in the same bottom-right spot as
   * the settings flyout and (because the base skin's hover-open rule is a
   * button-descendant selector that then stops matching) becomes click-only.
   * `MenuButton.update()` rebuilds its menu back inside the button whenever the
   * track list (or, for chapters, the cue list) changes, so a per-button
   * MutationObserver re-hoists any freshly inserted `.vjs-menu`. All observers
   * are disconnected in dispose().
   *
   * The chapters menu also gets `.vjsp-hoisted-menu--chapters` so `style.css`
   * can give it a taller scroll area (chapter lists run long where the
   * audio/subs menus are a handful of rows).
   */
  private _hoistNativeMenus(): void {
    if (typeof MutationObserver === 'undefined') return;
    const playerEl = this.vjs.el() as unknown as HTMLElement | undefined;
    if (!playerEl) return;

    const wrappers = playerEl.querySelectorAll<HTMLElement>(
      '.vjs-audio-button, .vjs-subs-caps-button, .vjs-captions-button, .vjs-subtitles-button, .vjs-chapters-button'
    );
    wrappers.forEach((wrapper) => {
      const isChapters = wrapper.classList.contains('vjs-chapters-button');
      const hoist = () => {
        const menu = wrapper.querySelector<HTMLElement>(':scope > .vjs-menu');
        if (!menu || menu.parentElement === playerEl) return;
        menu.classList.add('vjsp-hoisted-menu');
        if (isChapters) menu.classList.add('vjsp-hoisted-menu--chapters');
        playerEl.appendChild(menu);
      };
      hoist();
      const observer = new MutationObserver(hoist);
      observer.observe(wrapper, { childList: true });
      this._nativeMenuObservers.push(observer);
    });
  }

  /** Collapses any open native track menu (audio / subs-caps / …). */
  private _closeNativeMenus(): void {
    const controlBar = this.vjs.getChild('controlBar');
    if (!controlBar) return;
    const names = [
      'audioTrackButton',
      'subsCapsButton',
      'descriptionsButton',
      'captionsButton',
      'subtitlesButton',
      'chaptersButton',
    ];
    for (const name of names) {
      const btn = controlBar.getChild(name) as
        | { buttonPressed_?: boolean; unpressButton?: () => void }
        | undefined;
      if (btn?.buttonPressed_ && typeof btn.unpressButton === 'function') {
        btn.unpressButton();
      }
    }
  }

  /** True when at least one quality section row would be shown. */
  private _hasQualitySection(): boolean {
    return this._qualityEnabled && this._getVhsRepresentations().length >= 2;
  }

  private _getSettingsButtonEl(): HTMLElement | undefined {
    const controlBar = this.vjs.getChild('controlBar');
    const btn = controlBar?.getChild('VjspSettingsButton') as unknown as
      | { el?: () => HTMLElement }
      | undefined;
    return btn?.el?.();
  }

  private _setSettingsButtonOpen(open: boolean): void {
    const controlBar = this.vjs.getChild('controlBar');
    const btn = controlBar?.getChild('VjspSettingsButton') as unknown as
      | { toggleClass?: (cls: string, active: boolean) => void }
      | undefined;
    btn?.toggleClass?.('vjsp-settings-button--open', open);
  }

  /** Show the gear only when there's a section to open; hide it otherwise. */
  private _refreshSettingsVisibility(): void {
    if (!this._settingsMenu) return;
    const show = this._speedEnabled || this._hasQualitySection();
    const btnEl = this._getSettingsButtonEl();
    if (btnEl) btnEl.style.display = show ? '' : 'none';
    // If quality disappeared while the sub-panel was open, fall back to root.
    if (this._settingsLevel === 'quality' && !this._hasQualitySection()) {
      this._settingsLevel = 'root';
    }
    this._syncSettingsMenu();
  }

  private _openSettingsMenu(): void {
    if (!this._settingsMenu) return;
    this._settingsLevel = 'root';
    this._renderSettings();
    this._settingsMenu.classList.remove('vjsp-settings-menu--hidden');
    this._setSettingsButtonOpen(true);

    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (this._settingsMenu?.contains(target)) return;
      // The gear itself toggles via its own handleClick; don't also close here.
      const btnEl = this._getSettingsButtonEl();
      if (btnEl?.contains(target)) return;
      this._closeSettingsMenu();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this._closeSettingsMenu();
    };
    this._onSettingsDocClick = onClickOutside;
    this._onSettingsKeydown = onKeydown;
    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => {
      document.addEventListener('mousedown', onClickOutside);
      document.addEventListener('keydown', onKeydown);
    }, 0);
  }

  private _closeSettingsMenu(): void {
    this._settingsMenu?.classList.add('vjsp-settings-menu--hidden');
    this._setSettingsButtonOpen(false);
    if (this._onSettingsDocClick) {
      document.removeEventListener('mousedown', this._onSettingsDocClick);
      this._onSettingsDocClick = null;
    }
    if (this._onSettingsKeydown) {
      document.removeEventListener('keydown', this._onSettingsKeydown);
      this._onSettingsKeydown = null;
    }
  }

  private _toggleSettingsMenu(): void {
    if (!this._settingsMenu) return;
    const isHidden = this._settingsMenu.classList.contains('vjsp-settings-menu--hidden');
    if (isHidden) this._openSettingsMenu();
    else this._closeSettingsMenu();
  }

  /** Re-render the open menu in place (no-op when closed). */
  private _syncSettingsMenu(): void {
    if (!this._settingsMenu) return;
    if (this._settingsMenu.classList.contains('vjsp-settings-menu--hidden')) return;
    this._renderSettings();
  }

  /** Value text shown on the root "Quality" row. */
  private _settingsQualityValue(): string {
    if (!this._isAutoQuality) return this._manualQualityLabel || 'Auto';
    const height = this.vjs.videoHeight() ?? 0;
    return height > 0 ? `Automatic (${height}p)` : 'Automatic';
  }

  /** Value text shown on the root "Playback speed" row. */
  private _settingsSpeedValue(): string {
    const rate = this.playbackRate;
    return rate === 1 ? 'Normal' : `${rate}×`;
  }

  private _renderSettings(): void {
    const menu = this._settingsMenu;
    if (!menu) return;
    menu.innerHTML = '';

    if (this._settingsLevel === 'quality' && !this._hasQualitySection()) {
      this._settingsLevel = 'root';
    }
    if (this._settingsLevel === 'speed' && !this._speedEnabled) {
      this._settingsLevel = 'root';
    }

    if (this._settingsLevel === 'root') {
      menu.appendChild(this._buildSettingsHeader('Settings', true));
      const body = this._buildSettingsBody();
      if (this._speedEnabled) {
        body.appendChild(
          this._buildSettingsRow('Playback speed', this._settingsSpeedValue(), () => {
            this._settingsLevel = 'speed';
            this._renderSettings();
          })
        );
      }
      if (this._hasQualitySection()) {
        body.appendChild(
          this._buildSettingsRow('Quality', this._settingsQualityValue(), () => {
            this._settingsLevel = 'quality';
            this._renderSettings();
          })
        );
      }
      menu.appendChild(body);
      return;
    }

    if (this._settingsLevel === 'quality') {
      menu.appendChild(this._buildSettingsHeader('Quality', false));
      const body = this._buildSettingsBody();
      body.appendChild(
        this._buildSettingsOption('Auto', this._isAutoQuality, () => {
          this.setAutoQuality();
          this._settingsLevel = 'root';
          this._renderSettings();
        })
      );
      const reps = [...this._getVhsRepresentations()].sort((a, b) => b.height - a.height);
      for (const rep of reps) {
        const label = rep.height > 0 ? `${rep.height}p` : `${Math.round(rep.bandwidth / 1000)}k`;
        const active = !this._isAutoQuality && rep.enabled() === true;
        body.appendChild(
          this._buildSettingsOption(label, active, () => {
            this.setQualityLevel(rep.id);
            this._settingsLevel = 'root';
            this._renderSettings();
          })
        );
      }
      menu.appendChild(body);
      return;
    }

    // speed
    menu.appendChild(this._buildSettingsHeader('Playback speed', false));
    const body = this._buildSettingsBody();
    for (const rate of this._playbackRates) {
      const label = rate === 1 ? 'Normal' : `${rate}×`;
      const active = this.playbackRate === rate;
      body.appendChild(
        this._buildSettingsOption(label, active, () => {
          this.playbackRate = rate;
          this._settingsLevel = 'root';
          this._renderSettings();
        })
      );
    }
    menu.appendChild(body);
  }

  private _buildSettingsBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'vjsp-settings-menu__body';
    return body;
  }

  private _buildSettingsHeader(title: string, isRoot: boolean): HTMLElement {
    const header = document.createElement('div');
    header.className = 'vjsp-settings-menu__header';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'vjsp-settings-menu__back';
    back.setAttribute('aria-label', isRoot ? 'Close settings' : 'Back');
    back.innerHTML = MENU_BACK_ICON_SVG;
    back.addEventListener('click', () => {
      if (isRoot) {
        this._closeSettingsMenu();
      } else {
        this._settingsLevel = 'root';
        this._renderSettings();
      }
    });

    const titleEl = document.createElement('span');
    titleEl.className = 'vjsp-settings-menu__title';
    titleEl.textContent = title;

    header.append(back, titleEl);
    return header;
  }

  private _buildSettingsRow(label: string, value: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vjsp-settings-row';
    btn.setAttribute('role', 'menuitem');

    const labelEl = document.createElement('span');
    labelEl.className = 'vjsp-settings-row__label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'vjsp-settings-row__value';
    valueEl.textContent = value;

    btn.append(labelEl, valueEl);
    btn.addEventListener('click', onClick);
    return btn;
  }

  private _buildSettingsOption(
    label: string,
    active: boolean,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vjsp-settings-option' + (active ? ' vjsp-settings-option--active' : '');
    btn.setAttribute('role', 'menuitemradio');
    btn.setAttribute('aria-checked', active ? 'true' : 'false');

    const check = document.createElement('span');
    check.className = 'vjsp-settings-option__check';
    check.innerHTML = MENU_CHECK_ICON_SVG;

    const labelEl = document.createElement('span');
    labelEl.className = 'vjsp-settings-option__label';
    labelEl.textContent = label;

    btn.append(check, labelEl);
    btn.addEventListener('click', onClick);
    return btn;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _updateLiveBehindLabel(liveTracker: any): void {
    if (!this._liveBehindEl) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const seekToLiveEl = (this.vjs.el() as HTMLElement).querySelector('.vjs-seek-to-live-control');
      if (!seekToLiveEl) return;
      const span = document.createElement('span');
      span.className = 'vjsp-live-behind-time';
      seekToLiveEl.appendChild(span);
      this._liveBehindEl = span;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    if (liveTracker.atLiveEdge?.()) {
      this._liveBehindEl.textContent = '';
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const behind = Math.max(0, Math.round(liveTracker.liveCurrentTime() - this.currentTime));
    if (behind < 1) {
      this._liveBehindEl.textContent = '';
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const formatted = (videojs as any).time.formatTime(behind, behind);
    this._liveBehindEl.textContent = `-${formatted}`;
  }

  /**
   * Reads the adaptive-streaming engine's `stats` object, which only exists
   * where playback goes through Media Source Extensions. Safari playing HLS
   * natively hands the stream to the OS, so nothing here is observable.
   */
  private _getVhsStats(): Record<string, number> | undefined {
    const tech = this.vjs.tech({ IWillNotUseThisInPlugins: true }) as unknown as {
      vhs?: { stats?: Record<string, number> };
    };
    return tech.vhs?.stats;
  }

  /**
   * How many segment loaders are feeding playback: two when the audio is a
   * separate rendition with its own URI (demuxed), one when it rides inside the
   * video segments.
   *
   * This matters because the engine's `mediaSecondsLoaded` adds up BOTH
   * loaders. (Its accessor reads
   * `Math.max(audioSegmentLoader_.mediaSecondsLoaded + mainSegmentLoader_.mediaSecondsLoaded)`,
   * a single-argument `Math.max` that returns the sum rather than the larger of
   * the two.) Left uncorrected, a demuxed stream reports twice the media it
   * really loaded, which halves `contentBitrate` and doubles `fetchRate` --
   * doubling it in the dangerous direction, since the 1x "keeping up" threshold
   * would then be met by a player only managing half real time.
   */
  private _activeMediaLoaderCount(): number {
    const tech = this.vjs.tech({ IWillNotUseThisInPlugins: true }) as unknown as {
      vhs?: {
        playlists?: {
          media?: () => { attributes?: { AUDIO?: string } } | undefined;
          // `main` in current http-streaming, `master` in older builds.
          main?: { mediaGroups?: { AUDIO?: Record<string, Record<string, { uri?: string }>> } };
          master?: { mediaGroups?: { AUDIO?: Record<string, Record<string, { uri?: string }>> } };
        };
      };
    };
    const playlists = tech.vhs?.playlists;
    const groupId = playlists?.media?.()?.attributes?.AUDIO;
    if (!groupId) return 1;
    const group = (playlists?.main ?? playlists?.master)?.mediaGroups?.AUDIO?.[groupId];
    if (!group) return 1;
    // A rendition with its own URI is fetched by the audio loader; one without
    // is muxed into the video segments and costs no extra loader.
    return Object.keys(group).some((label) => !!group[label]?.uri) ? 2 : 1;
  }

  /** Attributes of the rendition currently being played, straight off the manifest. */
  private _getActivePlaylistAttributes(): Record<string, unknown> | undefined {
    const tech = this.vjs.tech({ IWillNotUseThisInPlugins: true }) as unknown as {
      vhs?: { playlists?: { media?: () => { attributes?: Record<string, unknown> } | undefined } };
    };
    return tech.vhs?.playlists?.media?.()?.attributes;
  }

  /**
   * Delivery telemetry for the source currently loaded: how much media has
   * been fetched, how long it took, and what it cost. The counters start from
   * zero on every {@link EvePlayer.setSource}, since each source gets a fresh
   * engine handler. See {@link PlaybackStats} for
   * which of the bitrate figures can be trusted as a yardstick (short version:
   * prefer `fetchRate`, and never compare throughput against `peakBitrate`).
   *
   * Returns `undefined` where the engine is not in play, i.e. Safari's native
   * HLS and progressive `.mp4` sources.
   */
  getPlaybackStats(): PlaybackStats | undefined {
    const stats = this._getVhsStats();
    if (!stats) return undefined;

    const bytesTransferred = stats.mediaBytesTransferred ?? 0;
    const transferDuration = stats.mediaTransferDuration ?? 0;
    // Corrected for demuxed audio: see _activeMediaLoaderCount. Bytes and
    // transfer time are meant to cover every loader, so only the seconds are
    // scaled back.
    const secondsLoaded = (stats.mediaSecondsLoaded ?? 0) / this._activeMediaLoaderCount();
    const attrs = this._getActivePlaylistAttributes();

    // m3u8-parser hands these back as raw strings ('1217413'), not numbers.
    const peak = Number(attrs?.BANDWIDTH);
    const average = Number(attrs?.['AVERAGE-BANDWIDTH']);

    return {
      bytesTransferred,
      transferDuration,
      secondsLoaded,
      requestsErrored: stats.mediaRequestsErrored ?? 0,
      requestsTimedout: stats.mediaRequestsTimedout ?? 0,
      fetchRate:
        transferDuration > 0 && secondsLoaded > 0
          ? secondsLoaded / (transferDuration / 1000)
          : undefined,
      contentBitrate:
        bytesTransferred > 0 && secondsLoaded > 0
          ? (bytesTransferred * 8) / secondsLoaded
          : // Before any segment lands, the manifest's own average beats its peak.
            (Number.isFinite(average) ? average : undefined),
      measuredBandwidth: stats.bandwidth,
      peakBitrate: Number.isFinite(peak) ? peak : undefined,
      averageBitrate: Number.isFinite(average) ? average : undefined,
    };
  }

  /** The quality level matching the rendition currently being played, if any. */
  private _currentRenditionLevel(): QualityLevel | undefined {
    const tech = this.vjs.tech({ IWillNotUseThisInPlugins: true }) as unknown as {
      vhs?: { playlists?: { media?: () => { id?: string } | undefined } };
    };
    const id = tech.vhs?.playlists?.media?.()?.id;
    if (!id) return undefined;
    // Resolved through getQualityLevels() so `selected` keeps its documented
    // meaning: an ABR switch never moves it off Auto.
    return this.getQualityLevels().find((level) => level.id === id);
  }

  private readonly _onMediaChange = (): void => {
    const level = this._currentRenditionLevel();
    if (!level) return;
    const previous = this._lastRendition;
    if (previous?.id === level.id) return;
    this._lastRendition = level;
    this.emitter.emit('renditionchange', { level, previous });
  };

  /**
   * Subscribes to the playlist loader's `mediachange`, which is the only place
   * an automatic ABR switch surfaces: `qualitychange` covers deliberate picks
   * only, so without this a consumer cannot tell that the engine stepped down.
   */
  private _attachRenditionListener(): void {
    this._renditionSource?.off?.('mediachange', this._onMediaChange);
    this._renditionSource = undefined;

    const tech = this.vjs.tech({ IWillNotUseThisInPlugins: true }) as unknown as {
      vhs?: {
        playlists?: {
          on?: (event: string, cb: () => void) => void;
          off?: (event: string, cb: () => void) => void;
        };
      };
    };
    const playlists = tech.vhs?.playlists;
    if (!playlists?.on) return;
    playlists.on('mediachange', this._onMediaChange);
    this._renditionSource = playlists;
  }

  /**
   * The available quality levels for the current source, highest first, with
   * the `Auto` (adaptive) level prepended. Only HLS/DASH sources have levels;
   * returns `[]` for progressive MP4/MP3 or before the manifest has parsed.
   */
  getQualityLevels(): QualityLevel[] {
    const reps = this._getVhsRepresentations();
    if (reps.length === 0) return [];
    const levels: QualityLevel[] = [
      {
        id: 'auto', label: 'Auto', height: 0, bitrate: 0, isAuto: true,
        selected: this._isAutoQuality,
      },
    ];
    const sorted = [...reps].sort((a, b) => b.height - a.height);
    for (const rep of sorted) {
      const label = rep.height > 0 ? `${rep.height}p` : `${Math.round(rep.bandwidth / 1000)}k`;
      levels.push({
        id: rep.id, label, height: rep.height, bitrate: rep.bandwidth, isAuto: false,
        // Same rule the settings menu uses to tick its active row.
        selected: !this._isAutoQuality && rep.enabled() === true,
      });
    }
    return levels;
  }

  /**
   * Pin playback to one quality level, turning off adaptive switching. Forces
   * an immediate (buffer-clearing) switch and emits `qualitychange`. No-op for
   * an unknown id.
   *
   * @param id - A non-`'auto'` level id from {@link EvePlayer.getQualityLevels}.
   */
  setQualityLevel(id: string): void {
    const reps = this._getVhsRepresentations();
    const target = reps.find((r) => r.id === id);
    if (!target) return;
    this._isAutoQuality = false;
    // http-streaming's Representation#enabled(true) only triggers its internal
    // fastQualityChange_ (the buffer-clearing hard switch) on an actual
    // false->true transition - calling it on a representation that's already
    // enabled (e.g. picking a quality for the first time coming from Auto,
    // where nothing has been disabled yet) is a silent no-op. Without a real
    // transition here, the target rendition only takes effect once an
    // unrelated periodic ABR re-check (checkABR_) happens to run and switches
    // to it via the *slow* path, which doesn't evict the already-buffered
    // old-quality content - measured 9-45s of continued old-quality playback
    // before the switch became visible. Disabling the target first (alongside
    // every other rendition) guarantees enabling it afterwards is a genuine
    // transition, so the fast/immediate switch actually fires - measured ~2s.
    for (const rep of reps) rep.enabled(false);
    target.enabled(true);
    const label = target.height > 0 ? `${target.height}p` : `${Math.round(target.bandwidth / 1000)}k`;
    this._manualQualityLabel = label;
    this._syncSettingsMenu();
    this.emitter.emit('qualitychange', {
      level: {
        id, label, height: target.height, bitrate: target.bandwidth, isAuto: false, selected: true,
      },
    });
  }

  /**
   * Re-enable adaptive bitrate: all levels become candidates again and the
   * custom ABR selector resumes choosing. Emits `qualitychange` with the
   * `Auto` level.
   */
  setAutoQuality(): void {
    const reps = this._getVhsRepresentations();
    this._isAutoQuality = true;
    for (const rep of reps) rep.enabled(true);
    this._syncSettingsMenu();
    this.emitter.emit('qualitychange', {
      level: { id: 'auto', label: 'Auto', height: 0, bitrate: 0, isAuto: true, selected: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Events (delegates to internal EventEmitter)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to a player event. The handler's argument type is inferred from
   * {@link PlayerEventMap}.
   *
   * @typeParam K - The event name.
   * @param event - Event name, e.g. `'play'`, `'timeupdate'`, `'qualitychange'`.
   * @param handler - Called on each occurrence. Pass a stable reference so it
   * can be removed with {@link EvePlayer.off}.
   */
  on<K extends keyof PlayerEventMap>(event: K, handler: VjsHandler<PlayerEventMap[K]>): void {
    this.emitter.on(event, handler);
  }

  /**
   * Unsubscribe a handler previously registered with {@link EvePlayer.on}
   * or {@link EvePlayer.once}. Matches by reference.
   */
  off<K extends keyof PlayerEventMap>(event: K, handler: VjsHandler<PlayerEventMap[K]>): void {
    this.emitter.off(event, handler);
  }

  /** Like {@link EvePlayer.on}, but the handler is removed after its first call. */
  once<K extends keyof PlayerEventMap>(event: K, handler: VjsHandler<PlayerEventMap[K]>): void {
    this.emitter.once(event, handler);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Tear the player down: exits PiP, stops timers and observers, emits
   * `dispose`, destroys the Video.js instance and removes the DOM it created,
   * and clears all event listeners. Idempotent (safe to call more than once).
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Exit PiP cleanly before teardown
    if (this.isPip) this._deactivatePip();

    if (this._liveBehindInterval) {
      clearInterval(this._liveBehindInterval);
      this._liveBehindInterval = null;
    }

    this._thumbnailHoverCleanup?.();
    this._thumbnailHoverCleanup = null;

    this._renditionSource?.off?.('mediachange', this._onMediaChange);
    this._renditionSource = undefined;

    // Drop any document-level listeners left by an open settings menu.
    this._closeSettingsMenu();

    for (const observer of this._nativeMenuObservers) observer.disconnect();
    this._nativeMenuObservers.length = 0;

    for (const cleanup of this.safariCaptionWatchCleanups) cleanup();
    this.safariCaptionWatchCleanups.length = 0;

    this.emitter.emit('dispose');

    try {
      (this.vjs.audioTracks() as unknown as EventTarget).removeEventListener(
        'change',
        this.audioTrackChangeHandler
      );
      (this.vjs.textTracks() as unknown as EventTarget).removeEventListener(
        'change',
        this.textTrackChangeHandler
      );
    } catch {
      // Best-effort
    }

    try {
      this.vjs.dispose();
    } catch {
      // Best-effort
    }

    this.emitter.removeAll();
  }
}
