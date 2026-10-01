/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A single playable rendition of a source (one entry of
 * {@link SourceDescription.sources}).
 */
export interface SourceItem {
  /** Absolute or relative URL of the media (`.mp4`, `.mp3`, `.m3u8`, `.mpd`, …). */
  src: string;
  /**
   * MIME type of the media, e.g. `video/mp4`, `audio/mpeg`,
   * `application/x-mpegURL` (HLS), `application/dash+xml` (DASH). Strongly
   * recommended (it lets the player pick the right tech without sniffing, and
   * an `audio/*` type collapses the player to audio-only chrome immediately).
   */
  type?: string;
}

/**
 * The five W3C `TextTrackKind` values. Video.js coerces any other (or missing)
 * value to `'subtitles'`, which would surface a bogus entry in the CC menu, so
 * {@link EvePlayer.setSource} rejects side-loaded tracks whose `kind` is
 * not one of these.
 */
export type TextTrackKind = 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata';

/**
 * A WebVTT track side-loaded alongside a source via
 * {@link SourceDescription.textTracks} (for subtitles/captions or a
 * `kind: 'chapters'` cue file that is not embedded in the HLS/DASH manifest).
 *
 * `setSource()` validates every entry and silently drops any that isn't a
 * well-formed object with a non-empty `src` and a valid {@link TextTrackKind};
 * it never forwards unchecked data to Video.js's `addRemoteTextTrack()`.
 */
export interface SourceTextTrack {
  /** One of the five W3C {@link TextTrackKind} values. */
  kind: TextTrackKind;
  /** URL of the `.vtt` file. Must be a non-empty string. */
  src: string;
  /**
   * BCP-47 language code (e.g. `en`, `it`). Expected for `subtitles` /
   * `captions` / `descriptions`; irrelevant for `chapters` / `metadata`, so it
   * is optional.
   */
  srclang?: string;
  /** Human-readable label shown in the subtitles/CC menu. */
  label?: string;
  /** Mark this track as the default selection for its kind. */
  default?: boolean;
}

/**
 * Everything needed to load one source into the player, passed to
 * {@link EvePlayer.setSource}.
 */
export interface SourceDescription {
  /**
   * One or more renditions of the same content, in preference order. Pass an
   * empty array for a poster-only / no-video state; `.src()` is skipped
   * instead of raising a "source not supported" error.
   */
  sources: SourceItem[];
  /** Poster image URL shown before playback starts. */
  poster?: string;
  /**
   * Side-loaded text tracks (e.g. a `chapters` WebVTT file) added via
   * `addRemoteTextTrack` on `setSource()`. Cleared automatically on the next
   * `setSource()` call.
   */
  textTracks?: SourceTextTrack[];
}

/**
 * Options for {@link EvePlayer}'s constructor. Every field is optional;
 * the defaults produce a controlled, non-autoplaying, responsive player.
 */
export interface PlayerOptions {
  /** Start playback automatically once a source is loaded. Default: false. */
  autoplay?: boolean;
  /**
   * Start muted. Default: false.
   *
   * This is the *initial* state only, not a standing instruction: once the
   * viewer (or the app) unmutes, the player never re-mutes itself, not even
   * across a source swap or a `reset()` that rebuilds the underlying tech.
   * Typically set to `true` alongside `autoplay` so browsers allow unattended
   * playback, then cleared by an unmute control.
   */
  muted?: boolean;
  /** Loop playback when it reaches the end. Default: false. */
  loop?: boolean;
  /**
   * Give the container a fixed 16:9 frame (`aspect-ratio: 16 / 9; width: 100%`,
   * via the `vjsp-widescreen` class) and make the player fill it. A video of any
   * other aspect ratio is letterboxed or pillarboxed in black inside the frame,
   * so the box never changes size with the media. Useful when the space must be
   * known before the media loads (a server-rendered placeholder carrying the
   * same class, a grid or carousel of equal tiles). To use a different frame,
   * keep this option and override the container's `aspect-ratio` or `height`
   * in your own CSS. Audio-only sources collapse the frame to the control bar.
   * Default: false.
   */
  widescreen?: boolean;
  /** Hide the Video.js control bar entirely. Default: false. */
  hideControls?: boolean;
  /**
   * Hide the large centre play-button overlay (the poster stays visible).
   * Default: false.
   */
  hidePlayButton?: boolean;
  /**
   * Decorative "background video" mode, for using the player as a backdrop
   * behind other UI rather than something a viewer interacts with. Implies
   * `hideControls`; also defaults `autoplay`/`muted`/`loop` to `true` (only
   * for values not explicitly set), hides the loading spinner and error
   * overlay, disables the native right-click context menu, and marks the
   * container `aria-hidden`. Default: false.
   */
  background?: boolean;
  /** Hide the "Playback speed" section from the settings menu. Default: false. */
  hideSpeed?: boolean;
  /** Show the custom CSS Picture-in-Picture button in the control bar. Default: true. */
  pip?: boolean;
  /**
   * Text shown in the in-flow placeholder that holds the player's original
   * space while PiP is active (the player itself floats away as the PiP
   * window). The placeholder matches the player's size at the moment PiP is
   * activated, so surrounding page content doesn't jump. Default:
   * `'Video is playing in picture-in-picture'`. Pass an empty string for a blank
   * placeholder that still reserves the space.
   */
  pipPlaceholderText?: string;
  /**
   * Show the settings (gear) menu in the control bar. Default: true. The gear
   * is hidden automatically per source unless it has something to offer:
   * i.e. at least 2 quality levels, or the "Playback speed" section (see
   * `hideSpeed`). Set to `false` to remove it entirely.
   */
  settings?: boolean;
  /**
   * Show the "Quality" section inside the settings menu. Default: true (the
   * section itself is still hidden when fewer than 2 quality levels exist).
   */
  quality?: boolean;
  /**
   * Show the "captions settings" entry inside the subtitles/CC menu: the
   * native Video.js text-track styling dialog (font, colour, background,
   * edge style…). Default: true. Set to `false` to drop both the menu entry
   * and the dialog (passes `textTrackSettings: false` to Video.js).
   */
  captionSettings?: boolean;
  /**
   * Show the chapters button in the control bar (the list icon, sitting with
   * the audio/subtitles menus). Default: true. The button only appears when the
   * current source actually has a `kind: 'chapters'` text track with cues; set
   * to `false` to remove it even then.
   */
  chapters?: boolean;
  /** Playback-speed steps offered in the settings menu. Default: [0.5, 0.75, 1, 1.25, 1.5, 2]. */
  playbackRates?: number[];
  /** Show the scrubber dot at the head of the played portion of the progress bar. Default: false. */
  showProgressDot?: boolean;
  /** Show the handle dot at the head of the filled portion of the volume bar. Default: false. */
  showVolumeDot?: boolean;
  /** Show a thumbnail-preview popup on progress-bar hover, when the manifest provides a
   *  thumbnail-tile track: DASH (dashif.org "thumbnail_tile" convention) or HLS
   *  (`EXT-X-IMAGE-STREAM-INF`/`EXT-X-TILES`). Default: true. */
  thumbnails?: boolean;
  /**
   * Video.js fluid mode: the player takes the container's full width and
   * derives its height from the media's aspect ratio (16:9 until the media's
   * dimensions are known), so the box follows the video. With `false`, the
   * player is laid out at the media's intrinsic pixel size, and sizing it is up
   * to your CSS (e.g. `.my-player .video-js { width: 100%; height: 100%; }`).
   * Ignored for the box size when `widescreen` is set, since the 16:9 frame
   * wins. Default: true.
   */
  fluid?: boolean;
  /** BCP-47 language code for the player's built-in UI labels (e.g. `it`, `fr`). */
  language?: string;
  /**
   * Floor, in bits per second, for the bandwidth estimate the "Auto" quality
   * selector (see `docs/adr/0001`) uses to pick a rendition — never a hard
   * filter on which renditions exist. Useful to guarantee a minimum quality
   * even if the network estimate dips. Must be a finite number > 0, and
   * `minBandwidth <= maxBandwidth` when both are set; an invalid value is
   * ignored (with a `console.warn`), same as an unset one. Default: unset
   * (no floor).
   */
  minBandwidth?: number;
  /**
   * Ceiling, in bits per second, for the same bandwidth estimate — useful to
   * cap network/CDN usage on kiosk or embedded deployments. Same validation
   * as {@link minBandwidth}. Default: unset (no ceiling).
   */
  maxBandwidth?: number;
}

/** Intrinsic pixel size of the currently loaded media. */
export interface PlayerSize {
  /** Video width in pixels (0 for audio-only media). */
  width: number;
  /** Video height in pixels (0 for audio-only media). */
  height: number;
}

/**
 * Semantic grouping of {@link PlayerError.code}, for consumers that want to
 * branch (e.g. offer a retry for `network`, not for `source-unsupported`)
 * without hardcoding `HTMLMediaElement` error codes. `encrypted` (code 5)
 * means the source needs a decryption key/CDM the player does not have.
 */
export type PlayerErrorCategory =
  | 'aborted'
  | 'network'
  | 'decode'
  | 'source-unsupported'
  | 'encrypted'
  | 'unknown';

/** A playback error, as delivered by the `error` event. */
export interface PlayerError {
  /** `HTMLMediaElement` error code (1–5). */
  code: number;
  /** Human-readable description of the error. */
  message: string;
  /** Semantic category of `code`. */
  category: PlayerErrorCategory;
}

/** An audio track exposed by the current source. */
export interface AudioTrack {
  /** Stable track id, used with {@link EvePlayer.setAudioTrack}. */
  id: string;
  /** Human-readable label (e.g. "English", "Director's commentary"). */
  label: string;
  /** BCP-47 language code. */
  language: string;
  /** Whether this track is the one currently playing. */
  enabled: boolean;
}

/** A subtitle/caption text track exposed by the current source. */
export interface TextTrack {
  /** Stable track id, used with {@link EvePlayer.setTextTrack}. */
  id: string;
  /** Human-readable label shown in the subtitles/CC menu. */
  label: string;
  /** BCP-47 language code. */
  language: string;
  /** Track kind: `subtitles`, `captions`, `descriptions`. */
  kind: string;
  /**
   * Display mode: `disabled` (not rendered), `hidden` (cues processed, not
   * shown), `showing` (rendered on the video).
   */
  mode: 'disabled' | 'hidden' | 'showing';
}

/** A marker rendered on the progress bar by {@link EvePlayer.setBookmarks}. */
export interface Bookmark {
  /** Caller-supplied identifier, echoed back as `data-bookmark-id` on the marker element. */
  id: number | string;
  /** Position of the marker, in seconds from the start of the media. */
  offset: number;
  /** Tooltip text shown on hover / used as the marker's `aria-label`. */
  content: string;
}

/** One cue from a `kind: 'chapters'` text track, from {@link EvePlayer.getChapterCues}. */
export interface ChapterCue {
  /** Cue id (may be empty if the VTT cue had no identifier). */
  id: string;
  /** Chapter start time, in seconds. */
  startTime: number;
  /** Chapter end time, in seconds. */
  endTime: number;
  /** Chapter title (the cue's payload text). */
  text: string;
}

/** One entry of {@link EvePlayer.getQualityLevels}. */
export interface QualityLevel {
  /** Stable level id: `'auto'` for the adaptive level, otherwise the VHS representation id. */
  id: string;
  /** Human-readable label, e.g. "1080p", "720p", "Auto". */
  label: string;
  /** Video height in pixels. 0 for the Auto (ABR) level. */
  height: number;
  /** Bitrate in bits per second. 0 for the Auto (ABR) level. */
  bitrate: number;
  /** True when this entry represents the adaptive (auto) level. */
  isAuto: boolean;
  /**
   * True for the level playback is currently pinned to: the Auto entry while
   * adaptive switching is on (the default, and again after every
   * {@link EvePlayer.setSource}), otherwise the rendition picked via
   * {@link EvePlayer.setQualityLevel}. Exactly one level is selected whenever
   * the list is non-empty.
   */
  selected: boolean;
}

/**
 * The full set of events emitted by {@link EvePlayer}, mapping each event
 * name to its payload type (`void` = no payload). Subscribe with
 * {@link EvePlayer.on}. This map is the single source of truth for event
 * payloads; the future React wrapper forwards these as props/callbacks, so
 * keep it stable.
 */
/**
 * Delivery telemetry for the source currently loaded, from the
 * adaptive-streaming engine. Returned by {@link EvePlayer.getPlaybackStats}.
 *
 * Read the three bitrate figures carefully, because two of them are commonly
 * misused:
 *
 * - `peakBitrate` is the manifest's `BANDWIDTH`, which HLS defines as the PEAK
 *   segment bitrate. It runs above what the stream costs on average, so a
 *   throughput-over-`peakBitrate` ratio invents a shortfall on healthy streams.
 * - `measuredBandwidth` is the engine's estimate from the LAST segment only,
 *   time-to-first-byte included, so it is noisy and understates short segments.
 * - `contentBitrate` is measured from the bytes actually delivered, and is the
 *   one to compare against.
 *
 * Better still, prefer `fetchRate`, which needs no bitrate at all.
 */
export interface PlaybackStats {
  /** Total bytes of media segments downloaded for this source. */
  bytesTransferred: number;
  /** Total time spent inside segment requests, in ms (round trip, so TTFB included). */
  transferDuration: number;
  /**
   * Seconds of media those bytes represent, counted once even when the audio
   * is a separate rendition fetched by its own loader (the engine's own
   * counter adds both up, which would double this).
   */
  secondsLoaded: number;
  /** Segment requests that failed outright. */
  requestsErrored: number;
  /** Segment requests that timed out. */
  requestsTimedout: number;
  /**
   * Seconds of media fetched per second spent downloading. Above 1x the player
   * is gaining on playback, which is all it needs to do.
   *
   * This is the figure to judge a connection by. It ignores the idle gaps a
   * player leaves between segments once its buffer is full, so unlike a
   * throughput-over-bitrate ratio it does not collapse towards 1x on a fast
   * line, and it depends on no declared bitrate. `undefined` before the first
   * segment lands.
   */
  fetchRate: number | undefined;
  /** What the stream really costs, measured from delivered bytes, in bits/s. */
  contentBitrate: number | undefined;
  /** The engine's throughput estimate from the last segment, in bits/s. */
  measuredBandwidth: number | undefined;
  /** `BANDWIDTH` of the active rendition: the declared PEAK, in bits/s. */
  peakBitrate: number | undefined;
  /** `AVERAGE-BANDWIDTH` of the active rendition, in bits/s, when declared. */
  averageBitrate: number | undefined;
}

export interface PlayerEventMap {
  /** Playback started or resumed. */
  play: void;
  /** Playback paused. */
  pause: void;
  /** Playback reached the end of the media. */
  ended: void;
  /** Periodic playback-position update. */
  timeupdate: { currentTime: number };
  /** The underlying `HTMLMediaElement.readyState` changed. */
  readystatechange: { readyState: number };
  /** Media metadata (including intrinsic size) is now available. */
  loadedmetadata: { size: PlayerSize };
  /** The active audio track changed. */
  audiotrackchange: { track: AudioTrack };
  /** A text track's mode changed to `showing`. */
  texttrackchange: { track: TextTrack };
  /** A playback error occurred. */
  error: PlayerError;
  /** A new source was set via {@link EvePlayer.setSource}. */
  sourceset: { source: SourceDescription };
  /** The playback rate changed. */
  ratechange: { playbackRate: number };
  /** The volume or mute state changed. */
  volumechange: { volume: number; muted: boolean };
  /** The fullscreen state changed. */
  fullscreenchange: { isFullscreen: boolean };
  /** Fired when the CSS Picture-in-Picture overlay is toggled. */
  pipchange: { isPip: boolean };
  /** Fired when the active quality level changes. */
  /**
   * Fired when the SELECTION changes: {@link EvePlayer.setQualityLevel} pinned a
   * rendition, or {@link EvePlayer.setAutoQuality} handed control back to ABR.
   * For what is actually being played, listen to `renditionchange` instead.
   */
  qualitychange: { level: QualityLevel };
  /**
   * Fired when the rendition actually being played changes, whichever chose it:
   * an automatic ABR switch, or a manual pick. `previous` is `undefined` for the
   * first rendition of a source, and comparing `level.bitrate` against
   * `previous.bitrate` gives the direction. A step DOWN is the engine reporting
   * that the connection is struggling, which is a far more reliable signal than
   * any throughput figure.
   *
   * `level.selected` keeps its usual meaning and does NOT move here: while ABR
   * is on, the selected level stays Auto however often the rendition changes.
   */
  renditionchange: { level: QualityLevel; previous: QualityLevel | undefined };
  /** Fired when playback crosses into a chapter cue (kind: 'chapters' text track). */
  chapterentercue: { cue: ChapterCue };
  /**
   * Fired when `@videojs/http-streaming` auto-seeks over a detected buffer gap
   * (a manifest discontinuity or a segment missing from the buffer). `from`/`to`
   * are seconds on the media timeline.
   */
  gapskip: { from: number; to: number };
  /**
   * Fired when playback resumes after a mid-playback rebuffer (the player was
   * already playing, then had to wait for data). `duration` is the stall
   * length in seconds. Not fired for the initial buffering wait before the
   * first `playing`; that's normal startup latency, not a stall.
   */
  stall: { duration: number };
  /** The player is being torn down by {@link EvePlayer.dispose}. */
  dispose: void;
}

/**
 * A Video.js UI-string dictionary for one locale, e.g. `{ 'Play': 'Riproduci' }`.
 * Passed to {@link EvePlayer.addLanguage}.
 */
export interface LanguageDictionary {
  [phrase: string]: string;
}
