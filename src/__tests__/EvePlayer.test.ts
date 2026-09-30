/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvePlayer } from '../EvePlayer';

// ---------------------------------------------------------------------------
// Video.js mock
// ---------------------------------------------------------------------------

type AudioTrackList = {
  length: number;
  [index: number]: { id: string; label: string; language: string; enabled: boolean };
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  /** Test hook: run every handler registered for `event`. */
  _emit: (event: string) => void;
};

type TextTrackList = {
  length: number;
  [index: number]: { id: string; label: string; language: string; kind: string; mode: string };
  addEventListener: (event: string, handler: (payload?: unknown) => void) => void;
  removeEventListener: (event: string, handler: (payload?: unknown) => void) => void;
  /** Test hook: run every handler registered for `event`. */
  _emit: (event: string, payload?: unknown) => void;
};

const createMockAudioTrackList = (): AudioTrackList => {
  const listeners: Record<string, (() => void)[]> = {};
  const list: AudioTrackList = {
    length: 0,
    addEventListener: (event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    },
    _emit: (event: string) => (listeners[event] ?? []).forEach((h) => h()),
  };
  return list;
};

const createMockTextTrackList = (): TextTrackList => {
  const listeners: Record<string, ((payload?: unknown) => void)[]> = {};
  const list: TextTrackList = {
    length: 0,
    addEventListener: (event: string, handler: (payload?: unknown) => void) => {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener: (event: string, handler: (payload?: unknown) => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    },
    _emit: (event: string, payload?: unknown) =>
      (listeners[event] ?? []).forEach((h) => h(payload)),
  };
  return list;
};

// Mimics a native TextTrack Safari creates directly on the <video> element,
// distinct from the ones we side-load via addRemoteTextTrack.
type MockNativeTrack = {
  kind: string;
  id: string;
  mode: string;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  trigger: (event: string) => void;
};

const createMockNativeTrack = (opts: { kind: string; id: string; mode?: string }): MockNativeTrack => {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    kind: opts.kind,
    id: opts.id,
    mode: opts.mode ?? 'showing',
    addEventListener: vi.fn((event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    }),
    trigger: (event: string) => (listeners[event] ?? []).forEach((h) => h()),
  };
};

// Mimics a native TextTrackCue closely enough for _bindChapterCueListeners():
// carries id/startTime/endTime/text and supports a single 'enter' listener
// that tests can fire via trigger().
type MockCue = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  trigger: (event: string) => void;
};

const createMockCue = (props: { id: string; startTime: number; endTime: number; text: string }): MockCue => {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    ...props,
    addEventListener: (event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    },
    trigger: (event: string) => {
      (listeners[event] ?? []).forEach((h) => h());
    },
  };
};

// A 'chapters'-kind track with an array-like `cues` list, shaped like the
// subset of TextTrack the implementation actually reads.
const createMockChaptersTrack = (cues: MockCue[]) => ({
  kind: 'chapters',
  cues: Object.assign({ length: cues.length }, cues),
});

// Mimics the HTMLTrackElement returned by Video.js's addRemoteTextTrack():
// an EventTarget-like object whose 'load' event fires once the VTT has been
// fetched and parsed.
type MockTrackElement = {
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  trigger: (event: string) => void;
};

const createMockTrackElement = (): MockTrackElement => {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    }),
    trigger: (event: string) => {
      (listeners[event] ?? []).forEach((h) => h());
    },
  };
};

// mockInstance is populated each time videojs() is called (i.e., each new EvePlayer).
// Typed as `any` to avoid Vitest generic-variance conflicts on vi.fn() reassignments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockInstance: any;

// Minimal Button base class for the custom control-bar component registration.
// Keeps a stable per-instance element and a player ref (exposed via both the
// `player_` field and the public `player()` method, mirroring video.js's
// Component) so the registered VjspPipButton / VjspSettingsButton subclasses
// can be exercised directly.
class MockButton {
  player_: unknown;
  private readonly _el: HTMLButtonElement;
  addClass = vi.fn();
  controlText = vi.fn();
  toggleClass = vi.fn();
  constructor(player: unknown, _options: unknown) {
    this.player_ = player;
    this._el = document.createElement('button');
    this._el.innerHTML = '<span class="vjs-icon-placeholder"></span>';
  }
  el() {
    return this._el;
  }
  player() {
    return this.player_;
  }
}

// Minimal SubsCapsButton base: returns one item per kind:'captions'/'subtitles'
// track on the player, enough to exercise VjspSubsCapsButton's filter.
class MockSubsCapsButtonBase {
  protected player_: { textTracks: () => TextTrackList };
  constructor(player: { textTracks: () => TextTrackList }, _options?: unknown) {
    this.player_ = player;
  }
  createItems(): { track: MockNativeTrack }[] {
    const tracks = this.player_.textTracks();
    const items: { track: MockNativeTrack }[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i] as unknown as MockNativeTrack;
      if (t.kind === 'captions' || t.kind === 'subtitles') items.push({ track: t });
    }
    return items;
  }
}

vi.mock('video.js', () => {
  // Use a closure reference so vi.fn() implementations can read/write state
  // without `this` binding (which breaks Vitest's spy tracking).
  const videojs = vi.fn((_el: unknown, _opts: unknown) => {
    const audioTracks = createMockAudioTrackList();
    const textTracks = createMockTextTrackList();
    // Stable child instance so a test's own getChild('subsCapsButton') sees
    // the same `update` spy the source's internal calls invoke.
    const subsCapsButtonChild = { toggleClass: vi.fn(), update: vi.fn() };

    // Build the state bag first so closures below can reference it
    const state = {
      _handlers: {} as Record<string, ((...args: unknown[]) => void)[]>,
      _audioTracks: audioTracks,
      _textTracks: textTracks,
      _currentTime: 0,
      _duration: 120,
      _volume: 1,
      _muted: false,
      _playbackRate: 1,
      _loop: false,
      _paused: true,
      _ended: false,
      _fullscreen: false,
      _poster: '',
      // Video.js's stored constructor options (`Component#options_`), reachable
      // through `player.options(obj)`; the muted-persistence code writes here.
      _options: { muted: false } as Record<string, unknown>,
      _src: null as unknown,
      _disposed: false,
      _audioOnlyMode: false,
      _controlBar: {
        removeChild: vi.fn(),
        addChild: vi.fn(),
        getChild: vi.fn((name?: string) =>
          name === 'subsCapsButton' ? subsCapsButtonChild : { toggleClass: vi.fn() }
        ),
      },
    };

    // Stable player-root element carrying a `.vjs-seek-to-live-control` node,
    // so _updateLiveBehindLabel() has somewhere to hang its countdown span.
    const rootEl = document.createElement('div');
    rootEl.className = 'video-js';
    const seekToLive = document.createElement('div');
    seekToLive.className = 'vjs-seek-to-live-control';
    rootEl.appendChild(seekToLive);

    mockInstance = {
      ...state,

      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        (state._handlers[event] ??= []).push(handler);
      }),
      off: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      src: vi.fn((s?: unknown) => {
        if (s !== undefined) { state._src = s; }
        return state._src;
      }),
      currentTime: vi.fn((v?: number) => {
        if (v !== undefined) { state._currentTime = v; }
        return state._currentTime;
      }),
      duration: vi.fn(() => state._duration),
      paused: vi.fn(() => state._paused),
      ended: vi.fn(() => state._ended),
      volume: vi.fn((v?: number) => {
        if (v !== undefined) { state._volume = v; }
        return state._volume;
      }),
      muted: vi.fn((v?: boolean) => {
        if (v !== undefined) { state._muted = v; }
        return state._muted;
      }),
      options: vi.fn((obj?: Record<string, unknown>) => {
        if (obj !== undefined) { Object.assign(state._options, obj); }
        return state._options;
      }),
      playbackRate: vi.fn((v?: number) => {
        if (v !== undefined) { state._playbackRate = v; }
        return state._playbackRate;
      }),
      loop: vi.fn((v?: boolean) => {
        if (v !== undefined) { state._loop = v; }
        return state._loop;
      }),
      poster: vi.fn((url?: string) => {
        if (url !== undefined) { state._poster = url; }
        return state._poster;
      }),
      isFullscreen: vi.fn(() => state._fullscreen),
      requestFullscreen: vi.fn(() => Promise.resolve()),
      exitFullscreen: vi.fn(() => Promise.resolve()),
      audioTracks: vi.fn(() => state._audioTracks),
      textTracks: vi.fn(() => state._textTracks),
      addRemoteTextTrack: vi.fn(
        (options: { kind: string; src: string; srclang: string; label?: string; default?: boolean }) => {
          const idx = state._textTracks.length;
          (state._textTracks as unknown as Record<number, unknown>)[idx] = {
            kind: options.kind,
            label: options.label,
            language: options.srclang,
            mode: 'disabled',
            cues: Object.assign({ length: 0 }, []),
          };
          state._textTracks.length = idx + 1;
          return createMockTrackElement();
        }
      ),
      videoWidth: vi.fn(() => 1920),
      videoHeight: vi.fn(() => 1080),
      audioOnlyMode: vi.fn((v?: boolean) => {
        if (v !== undefined) { state._audioOnlyMode = v; }
        return state._audioOnlyMode;
      }),
      error: vi.fn(() => null),
      ready: vi.fn((cb: () => void) => { cb(); }),
      getChild: vi.fn((name?: string) =>
        name === 'controlBar'
          ? state._controlBar
          : { removeChild: vi.fn(), addChild: vi.fn(), getChild: vi.fn(() => ({ toggleClass: vi.fn() })) }
      ),
      tech: vi.fn(() => ({ el: () => ({ readyState: 0 }) })),
      dispose: vi.fn(() => { state._disposed = true; mockInstance._disposed = true; }),
      el: vi.fn(() => rootEl),
      // Populated by the live-behind tests; falsy by default so checkLiveBehind() bails.
      liveTracker: null as unknown,

      trigger(event: string, data?: unknown) {
        const handlers = state._handlers[event] ?? [];
        for (const h of handlers) h(data);
      },
    };

    return mockInstance;
  });

  // Static methods used by ensurePipButtonRegistered() / ensureSubsCapsButtonRegistered()
  (videojs as any).getComponent = vi.fn((name: string) => {
    if (name === 'Button') return MockButton;
    if (name === 'SubsCapsButton') return MockSubsCapsButtonBase;
    return null;
  });
  // Stash every registered component on the mock itself (`vi.clearAllMocks()`
  // in afterEach wipes `.mock.calls`, but the one-time registration happens on
  // the very first player construction, so tests need a durable handle).
  (videojs as any).__registered = {} as Record<string, unknown>;
  (videojs as any).registerComponent = vi.fn((name: string, cls: unknown) => {
    (videojs as any).__registered[name] = cls;
  });
  // Present so ensureVhsBandwidthVarianceTuned() runs its tuning branch.
  (videojs as any).Vhs = { BANDWIDTH_VARIANCE: 1.2 };
  (videojs as any).time = {
    formatTime: (seconds: number) => {
      const s = Math.round(seconds);
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    },
  };

  // Browser flags read in the constructor to decide html5.vhs.overrideNative.
  // jsdom is not Safari/iOS, so the non-mocked runtime values would be false
  // anyway (mirror that).
  (videojs as any).browser = { IS_ANY_SAFARI: false, IS_IOS: false, IS_SAFARI: false };

  return { default: videojs };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLDivElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function makeProgressHolder(container: HTMLElement): HTMLDivElement {
  const holder = document.createElement('div');
  holder.className = 'vjs-progress-holder';
  container.appendChild(holder);
  return holder;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EvePlayer', () => {
  let container: HTMLDivElement;
  let player: EvePlayer;

  beforeEach(() => {
    container = makeContainer();
    player = new EvePlayer(container);
  });

  afterEach(() => {
    player.dispose();
    container.remove();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates a Video.js instance without throwing', () => {
      expect(mockInstance).toBeDefined();
      expect(mockInstance._disposed).toBe(false);
    });

    it('adds vjsp-widescreen class when widescreen option is true', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, { widescreen: true });
      expect(c.classList.contains('vjsp-widescreen')).toBe(true);
      p.dispose();
      c.remove();
    });

    it('adds vjsp-hide-play class when hidePlayButton option is true', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, { hidePlayButton: true });
      expect(c.classList.contains('vjsp-hide-play')).toBe(true);
      p.dispose();
      c.remove();
    });

    it('adds the scrubber/volume dot classes only when their options are set', () => {
      const off = makeContainer();
      const offPlayer = new EvePlayer(off, {});
      expect(off.classList.contains('vjsp-show-progress-dot')).toBe(false);
      expect(off.classList.contains('vjsp-show-volume-dot')).toBe(false);
      offPlayer.dispose();
      off.remove();

      const on = makeContainer();
      const onPlayer = new EvePlayer(on, { showProgressDot: true, showVolumeDot: true });
      expect(on.classList.contains('vjsp-show-progress-dot')).toBe(true);
      expect(on.classList.contains('vjsp-show-volume-dot')).toBe(true);
      onPlayer.dispose();
      on.remove();
    });

    it('adds vjsp-background class and aria-hidden when background option is true', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, { background: true });
      expect(c.classList.contains('vjsp-background')).toBe(true);
      expect(c.getAttribute('aria-hidden')).toBe('true');
      p.dispose();
      c.remove();
    });

    describe('minBandwidth / maxBandwidth', () => {
      const capsOf = (options: { minBandwidth?: number; maxBandwidth?: number }) => {
        const c = makeContainer();
        const p = new EvePlayer(c, options);
        const internals = p as unknown as { _minBandwidth?: number; _maxBandwidth?: number };
        const caps = { min: internals._minBandwidth, max: internals._maxBandwidth };
        p.dispose();
        c.remove();
        return caps;
      };

      it('keeps a valid pair', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(capsOf({ minBandwidth: 1e6, maxBandwidth: 5e6 })).toEqual({ min: 1e6, max: 5e6 });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      });

      it.each([
        ['a non-finite value', { minBandwidth: NaN }],
        ['a value that is not > 0', { maxBandwidth: -1 }],
        ['min greater than max', { minBandwidth: 5e6, maxBandwidth: 1e6 }],
      ])('warns and drops both caps for %s', (_label, options) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(capsOf(options)).toEqual({ min: undefined, max: undefined });
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
      });
    });

    it('does not mark the container aria-hidden when background is not set', () => {
      const c = makeContainer();
      const p = new EvePlayer(c);
      expect(c.hasAttribute('aria-hidden')).toBe(false);
      p.dispose();
      c.remove();
    });

    it('defaults autoplay/muted/loop/controls for background mode, without overriding explicit values', async () => {
      const videojs = vi.mocked((await import('video.js')).default);
      const c = makeContainer();
      const p = new EvePlayer(c, { background: true, loop: false });
      const opts = videojs.mock.calls[videojs.mock.calls.length - 1][1] as Record<string, unknown>;
      expect(opts.autoplay).toBe(true);
      expect(opts.muted).toBe(true);
      expect(opts.loop).toBe(false); // explicit false is respected, not forced to true
      expect(opts.controls).toBe(false);
      p.dispose();
      c.remove();
    });

    it('prevents the native context menu on the video element in background mode', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, { background: true });
      const videoEl = c.querySelector('video') as HTMLVideoElement;
      const event = new MouseEvent('contextmenu', { cancelable: true });
      videoEl.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      p.dispose();
      c.remove();
    });

    it('removes playback rate button when hideSpeed is true', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, { hideSpeed: true });
      // After construction, mockInstance is the new instance.
      // getChild('controlBar') is called during ready(); verify it was called.
      expect(mockInstance.getChild).toHaveBeenCalledWith('controlBar');
      p.dispose();
      c.remove();
    });

    it('does not disable textTrackSettings by default', async () => {
      const videojs = vi.mocked((await import('video.js')).default);
      const opts = videojs.mock.calls[videojs.mock.calls.length - 1][1] as Record<string, unknown>;
      expect(opts.textTrackSettings).toBeUndefined();
    });

    it('passes textTrackSettings: false to Video.js when captionSettings is false', async () => {
      const videojs = vi.mocked((await import('video.js')).default);
      const c = makeContainer();
      const p = new EvePlayer(c, { captionSettings: false });
      const opts = videojs.mock.calls[videojs.mock.calls.length - 1][1] as Record<string, unknown>;
      expect(opts.textTrackSettings).toBe(false);
      p.dispose();
      c.remove();
    });

    it('enables html5.vhs.overrideNative off Safari/iOS (MSE + custom ABR path)', async () => {
      const videojs = vi.mocked((await import('video.js')).default);
      const opts = videojs.mock.calls[videojs.mock.calls.length - 1][1] as {
        html5: { vhs: { overrideNative: boolean } };
      };
      expect(opts.html5.vhs.overrideNative).toBe(true);
    });

    it('disables html5.vhs.overrideNative on Safari/iOS so the native player handles HLS', async () => {
      const videojs = vi.mocked((await import('video.js')).default);
      const browser = (videojs as unknown as { browser: Record<string, boolean> }).browser;
      browser.IS_ANY_SAFARI = true;
      try {
        const c = makeContainer();
        const p = new EvePlayer(c);
        const opts = videojs.mock.calls[videojs.mock.calls.length - 1][1] as {
          html5: { vhs: { overrideNative: boolean } };
        };
        expect(opts.html5.vhs.overrideNative).toBe(false);
        p.dispose();
        c.remove();
      } finally {
        browser.IS_ANY_SAFARI = false;
      }
    });

    it('sets playsinline on the underlying <video> for iOS inline playback', () => {
      const c = makeContainer();
      const p = new EvePlayer(c);
      expect(c.querySelector('video')?.hasAttribute('playsinline')).toBe(true);
      p.dispose();
      c.remove();
    });

    it('keeps the chapters button by default', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, {});
      expect(mockInstance._controlBar.removeChild).not.toHaveBeenCalledWith('chaptersButton');
      p.dispose();
      c.remove();
    });

    it('removes the chapters button when chapters: false', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, { chapters: false });
      expect(mockInstance._controlBar.removeChild).toHaveBeenCalledWith('chaptersButton');
      p.dispose();
      c.remove();
    });
  });

  // -------------------------------------------------------------------------
  // setSource
  // -------------------------------------------------------------------------

  describe('setSource', () => {
    it('calls player.src() on the existing instance and never calls videojs() again', async () => {
      const videojs = vi.mocked((await import('video.js')).default);
      const callCount = videojs.mock.calls.length;

      player.setSource({ sources: [{ src: 'video.mp4', type: 'video/mp4' }] });

      // videojs() should NOT have been called again
      expect(videojs.mock.calls.length).toBe(callCount);
      expect(mockInstance.src).toHaveBeenCalledWith([{ src: 'video.mp4', type: 'video/mp4' }]);
    });

    it('stores the source so getSource() returns it', () => {
      const desc = { sources: [{ src: 'video.mp4' }] };
      player.setSource(desc);
      expect(player.getSource()).toStrictEqual(desc);
    });

    it('clears bookmark markers on setSource', () => {
      makeProgressHolder(container);
      player.setBookmarks([{ id: 1, offset: 10, content: 'A' }]);
      // Add a fake marker to assert it's cleared
      const holder = container.querySelector('.vjs-progress-holder')!;
      const marker = document.createElement('button');
      marker.className = 'vjsp-bookmark-marker';
      holder.appendChild(marker);

      player.setSource({ sources: [{ src: 'new.mp4' }] });
      expect(holder.querySelectorAll('.vjsp-bookmark-marker').length).toBe(0);
    });

    it('does not call player.src() when sources is empty', () => {
      // An empty array reaching vjs.src() raises MEDIA_ERR_SRC_NOT_SUPPORTED;
      // consumers pass `{ sources: [] }` intentionally for a poster-only state.
      player.setSource({ sources: [], poster: 'https://example.com/poster.jpg' });
      expect(mockInstance.src).not.toHaveBeenCalled();
    });

    it('still sets the poster and stores the source when sources is empty', () => {
      const desc = { sources: [], poster: 'https://example.com/poster.jpg' };
      player.setSource(desc);
      expect(mockInstance.poster).toHaveBeenCalledWith('https://example.com/poster.jpg');
      expect(player.getSource()).toStrictEqual(desc);
    });

    it('does not call addRemoteTextTrack when textTracks is omitted', () => {
      player.setSource({ sources: [{ src: 'video.mp4' }] });
      expect(mockInstance.addRemoteTextTrack).not.toHaveBeenCalled();
    });

    it('side-loads each entry of textTracks via addRemoteTextTrack, with manualCleanup false', () => {
      player.setSource({
        sources: [{ src: 'video.mp4' }],
        textTracks: [
          { kind: 'chapters', src: 'chapters.vtt', srclang: 'en', default: true },
          { kind: 'subtitles', src: 'subs-it.vtt', srclang: 'it', label: 'Italiano' },
        ],
      });

      expect(mockInstance.addRemoteTextTrack).toHaveBeenNthCalledWith(
        1,
        { kind: 'chapters', src: 'chapters.vtt', srclang: 'en', label: undefined, default: true },
        false
      );
      expect(mockInstance.addRemoteTextTrack).toHaveBeenNthCalledWith(
        2,
        { kind: 'subtitles', src: 'subs-it.vtt', srclang: 'it', label: 'Italiano', default: undefined },
        false
      );
    });

    it('does not attach a load listener for non-chapters side-loaded tracks', () => {
      player.setSource({
        sources: [{ src: 'video.mp4' }],
        textTracks: [{ kind: 'subtitles', src: 'subs.vtt', srclang: 'en' }],
      });

      const trackEl = mockInstance.addRemoteTextTrack.mock.results[0].value;
      expect(trackEl.addEventListener).not.toHaveBeenCalled();
    });

    it('binds chapter cue listeners once a side-loaded chapters track finishes loading', () => {
      player.setSource({
        sources: [{ src: 'video.mp4' }],
        textTracks: [{ kind: 'chapters', src: 'chapters.vtt', srclang: 'en' }],
      });

      const trackEl = mockInstance.addRemoteTextTrack.mock.results[0].value;

      // The VTT hasn't loaded yet at setSource() time, so the cue isn't bindable
      // until 'load' fires (simulate the fetch completing and populating cues).
      const tracks = mockInstance._textTracks;
      const cue = createMockCue({ id: 'c1', startTime: 0, endTime: 10, text: 'Intro' });
      (tracks as unknown as Record<string, unknown>)[0] = createMockChaptersTrack([cue]);
      tracks.length = 1;

      const handler = vi.fn();
      player.on('chapterentercue', handler);
      trackEl.trigger('load');

      cue.trigger('enter');

      expect(handler).toHaveBeenCalledWith({ cue: { id: 'c1', startTime: 0, endTime: 10, text: 'Intro' } });
    });

    describe('textTracks validation', () => {
      // Suppress + capture the guard's console.warn for the whole block.
      beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      });
      afterEach(() => {
        vi.restoreAllMocks();
      });
      const warnMock = (): ReturnType<typeof vi.fn> =>
        console.warn as unknown as ReturnType<typeof vi.fn>;

      it('ignores a non-array textTracks (a bare VTT URL string) without iterating it', () => {
        const warn = warnMock();
        player.setSource({
          sources: [{ src: 'video.mp4' }],
          // Real-world upstream bug: the VTT url arrives as a string, not an array.
          textTracks: 'https://cdn.example.com/chapters.vtt' as unknown as never,
        });

        expect(mockInstance.addRemoteTextTrack).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
      });

      it('drops an entry with an invalid kind (Video.js would coerce it to subtitles)', () => {
        const warn = warnMock();
        player.setSource({
          sources: [{ src: 'video.mp4' }],
          textTracks: [{ kind: 'bogus', src: 'x.vtt', srclang: 'en' } as unknown as never],
        });

        expect(mockInstance.addRemoteTextTrack).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
      });

      it('drops an entry with a missing kind', () => {
        player.setSource({
          sources: [{ src: 'video.mp4' }],
          textTracks: [{ src: 'x.vtt', srclang: 'en' } as unknown as never],
        });

        expect(mockInstance.addRemoteTextTrack).not.toHaveBeenCalled();
      });

      it('drops entries with no usable src, and null / non-object entries', () => {
        player.setSource({
          sources: [{ src: 'video.mp4' }],
          textTracks: [
            { kind: 'subtitles', src: '   ', srclang: 'en' },
            { kind: 'captions', srclang: 'en' },
            null,
            'nope',
          ] as unknown as never,
        });

        expect(mockInstance.addRemoteTextTrack).not.toHaveBeenCalled();
      });

      it('keeps the well-formed entries and drops the rest from a mixed array', () => {
        player.setSource({
          sources: [{ src: 'video.mp4' }],
          textTracks: [
            { kind: 'bogus', src: 'bad.vtt', srclang: 'en' },
            { kind: 'subtitles', src: 'subs-it.vtt', srclang: 'it', label: 'Italiano' },
          ] as unknown as never,
        });

        expect(mockInstance.addRemoteTextTrack).toHaveBeenCalledTimes(1);
        expect(mockInstance.addRemoteTextTrack).toHaveBeenCalledWith(
          { kind: 'subtitles', src: 'subs-it.vtt', srclang: 'it', label: 'Italiano', default: undefined },
          false
        );
      });

      it('rebuilds each surviving entry field by field, stripping junk and mistyped values', () => {
        player.setSource({
          sources: [{ src: 'video.mp4' }],
          textTracks: [
            {
              kind: 'chapters',
              src: 'chapters.vtt',
              srclang: 123,
              label: { toString: () => 'x' },
              default: 'yes',
              evil: 'dropme',
            },
          ] as unknown as never,
        });

        expect(mockInstance.addRemoteTextTrack).toHaveBeenCalledWith(
          { kind: 'chapters', src: 'chapters.vtt', srclang: undefined, label: undefined, default: undefined },
          false
        );
      });

      it('does not warn when every entry is well-formed', () => {
        const warn = warnMock();
        player.setSource({
          sources: [{ src: 'video.mp4' }],
          textTracks: [{ kind: 'chapters', src: 'chapters.vtt', srclang: 'en', default: true }],
        });

        expect(mockInstance.addRemoteTextTrack).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();
      });
    });

    describe('audio-only mode', () => {
      it('enables audioOnlyMode when every source declares an audio/* type', () => {
        player.setSource({ sources: [{ src: 'song.mp3', type: 'audio/mpeg' }] });
        expect(mockInstance.audioOnlyMode).toHaveBeenLastCalledWith(true);
      });

      it('disables audioOnlyMode when switching to a video source', () => {
        player.setSource({ sources: [{ src: 'song.mp3', type: 'audio/mpeg' }] });
        player.setSource({ sources: [{ src: 'clip.mp4', type: 'video/mp4' }] });
        expect(mockInstance.audioOnlyMode).toHaveBeenLastCalledWith(false);
      });

      it('does not toggle audioOnlyMode when a source type is missing (left to loadedmetadata)', () => {
        player.setSource({ sources: [{ src: 'mystery' }] });
        expect(mockInstance.audioOnlyMode).not.toHaveBeenCalled();
      });

      it('falls back to audioOnlyMode on loadedmetadata when the media has no picture', () => {
        mockInstance.videoWidth.mockReturnValue(0);
        mockInstance.videoHeight.mockReturnValue(0);
        player.setSource({ sources: [{ src: 'mystery' }] });
        mockInstance.trigger('loadedmetadata');
        expect(mockInstance.audioOnlyMode).toHaveBeenCalledWith(true);
      });

      it('does not toggle audioOnlyMode again on loadedmetadata once already set from the type', () => {
        player.setSource({ sources: [{ src: 'song.mp3', type: 'audio/mpeg' }] });
        mockInstance.audioOnlyMode.mockClear();
        mockInstance.trigger('loadedmetadata');
        expect(mockInstance.audioOnlyMode).not.toHaveBeenCalled();
      });

      it('does not fall back to audioOnlyMode on 0x0 dimensions when the type says video (Safari native HLS)', () => {
        mockInstance.videoWidth.mockReturnValue(0);
        mockInstance.videoHeight.mockReturnValue(0);
        player.setSource({ sources: [{ src: 'stream.m3u8', type: 'application/x-mpegURL' }] });
        mockInstance.audioOnlyMode.mockClear();
        mockInstance.trigger('loadedmetadata');
        expect(mockInstance.audioOnlyMode).not.toHaveBeenCalledWith(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Thumbnail-tile hover preview
  // -------------------------------------------------------------------------

  describe('thumbnail hover preview', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const MPD_WITH_THUMBNAILS = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2M">
  <Period start="PT0S" duration="PT2M" id="1">
    <AdaptationSet mimeType="image/jpeg" contentType="image">
      <SegmentTemplate media="Thumbnail_$Number%09d$.jpg" duration="2432430" timescale="90000" startNumber="1"/>
      <Representation bandwidth="24549" id="thumbnails312x176" width="936" height="528">
        <EssentialProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="3x3"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    const MASTER_WITH_IMAGE_STREAM = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5931112,RESOLUTION=1920x1080
video.m3u8
#EXT-X-IMAGE-STREAM-INF:BANDWIDTH=131436,RESOLUTION=936x528,CODECS="jpeg",URI="thumbnails.m3u8"
`;

    const HLS_IMAGE_PLAYLIST = `#EXTM3U
#EXT-X-IMAGES-ONLY
#EXT-X-TILES:RESOLUTION=936x528,LAYOUT=3x3,DURATION=3.003
#EXTINF:27.027,
Thumbnail_000000001.jpg
#EXT-X-ENDLIST
`;

    function stubFetch(xml: string) {
      const fetchMock = vi.fn(() => Promise.resolve({ text: () => Promise.resolve(xml) }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function stubFetchByUrl(responses: Record<string, string>) {
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve({ text: () => Promise.resolve(responses[url] ?? '') })
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('fetches the manifest only for a DASH or HLS source, after loadedmetadata', async () => {
      const fetchMock = stubFetch(MPD_WITH_THUMBNAILS);
      makeProgressHolder(container);

      player.setSource({ sources: [{ src: 'video.mp4', type: 'video/mp4' }] });
      mockInstance.trigger('loadedmetadata');
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();

      player.setSource({ sources: [{ src: 'stream.mpd', type: 'application/dash+xml' }] });
      mockInstance.trigger('loadedmetadata');
      await flush();
      expect(fetchMock).toHaveBeenCalledWith('stream.mpd');
    });

    it('fetches the master then the child image playlist for an HLS source', async () => {
      const fetchMock = stubFetchByUrl({
        'https://cdn.example.com/stream.m3u8': MASTER_WITH_IMAGE_STREAM,
        'https://cdn.example.com/thumbnails.m3u8': HLS_IMAGE_PLAYLIST,
      });
      makeProgressHolder(container);

      player.setSource({
        sources: [{ src: 'https://cdn.example.com/stream.m3u8', type: 'application/x-mpegURL' }],
      });
      mockInstance.trigger('loadedmetadata');
      await flush();

      expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/stream.m3u8');
      expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/thumbnails.m3u8');
    });

    it('shows a positioned, sprite-cropped popup on progress-bar hover from an HLS source', async () => {
      stubFetchByUrl({
        'https://cdn.example.com/stream.m3u8': MASTER_WITH_IMAGE_STREAM,
        'https://cdn.example.com/thumbnails.m3u8': HLS_IMAGE_PLAYLIST,
      });
      const holder = makeProgressHolder(container);
      holder.getBoundingClientRect = () =>
        ({ left: 0, width: 300, top: 0, height: 5, right: 300, bottom: 5, x: 0, y: 0, toJSON() {} }) as DOMRect;

      player.setSource({
        sources: [{ src: 'https://cdn.example.com/stream.m3u8', type: 'application/x-mpegURL' }],
      });
      mockInstance.trigger('loadedmetadata');
      await flush();

      holder.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 }));

      const preview = container.querySelector<HTMLElement>('.vjsp-thumbnail-preview')!;
      expect(preview.classList.contains('vjsp-thumbnail-preview--visible')).toBe(true);
      expect(preview.style.backgroundImage).toContain('Thumbnail_000000001.jpg');
      // A 936x528 sheet on a 3x3 grid gives 312x176 tiles, scaled down to the
      // 160px target rather than blown up by a fixed factor.
      expect(preview.style.width).toBe('160px');
      expect(parseFloat(preview.style.height)).toBeCloseTo(160 * (176 / 312), 3);
      expect(parseFloat(preview.style.backgroundSize)).toBeCloseTo(936 * (160 / 312), 3);
    });

    it('shows a positioned, sprite-cropped popup on progress-bar hover once tiles are loaded', async () => {
      stubFetch(MPD_WITH_THUMBNAILS);
      const holder = makeProgressHolder(container);
      holder.getBoundingClientRect = () =>
        ({ left: 0, width: 300, top: 0, height: 5, right: 300, bottom: 5, x: 0, y: 0, toJSON() {} }) as DOMRect;

      player.setSource({ sources: [{ src: 'https://cdn.example.com/stream.mpd', type: 'application/dash+xml' }] });
      mockInstance.trigger('loadedmetadata');
      await flush();

      holder.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 }));

      const preview = container.querySelector<HTMLElement>('.vjsp-thumbnail-preview')!;
      expect(preview.classList.contains('vjsp-thumbnail-preview--visible')).toBe(true);
      expect(preview.style.backgroundImage).toContain('Thumbnail_000000001.jpg');
      // A 936x528 sheet on a 3x3 grid gives 312x176 tiles, scaled down to the
      // 160px target rather than blown up by a fixed factor.
      expect(preview.style.width).toBe('160px');
      expect(parseFloat(preview.style.height)).toBeCloseTo(160 * (176 / 312), 3);
      expect(parseFloat(preview.style.backgroundSize)).toBeCloseTo(936 * (160 / 312), 3);
    });

    it('hides the popup on mouseleave', async () => {
      stubFetch(MPD_WITH_THUMBNAILS);
      const holder = makeProgressHolder(container);
      holder.getBoundingClientRect = () =>
        ({ left: 0, width: 300, top: 0, height: 5, right: 300, bottom: 5, x: 0, y: 0, toJSON() {} }) as DOMRect;

      player.setSource({ sources: [{ src: 'https://cdn.example.com/stream.mpd', type: 'application/dash+xml' }] });
      mockInstance.trigger('loadedmetadata');
      await flush();

      holder.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 }));
      const preview = container.querySelector<HTMLElement>('.vjsp-thumbnail-preview')!;
      expect(preview.classList.contains('vjsp-thumbnail-preview--visible')).toBe(true);

      holder.dispatchEvent(new MouseEvent('mouseleave'));
      expect(preview.classList.contains('vjsp-thumbnail-preview--visible')).toBe(false);
    });

    it('never fetches or attaches hover listeners when thumbnails: false', async () => {
      const fetchMock = stubFetch(MPD_WITH_THUMBNAILS);
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { thumbnails: false });
      makeProgressHolder(container);

      player.setSource({ sources: [{ src: 'stream.mpd', type: 'application/dash+xml' }] });
      mockInstance.trigger('loadedmetadata');
      await flush();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(container.querySelector('.vjsp-thumbnail-preview')).toBeNull();
    });

    it('removes the popup and stops listening on dispose', async () => {
      stubFetch(MPD_WITH_THUMBNAILS);
      const holder = makeProgressHolder(container);
      holder.getBoundingClientRect = () =>
        ({ left: 0, width: 300, top: 0, height: 5, right: 300, bottom: 5, x: 0, y: 0, toJSON() {} }) as DOMRect;

      player.setSource({ sources: [{ src: 'https://cdn.example.com/stream.mpd', type: 'application/dash+xml' }] });
      mockInstance.trigger('loadedmetadata');
      await flush();
      expect(container.querySelector('.vjsp-thumbnail-preview')).not.toBeNull();

      player.dispose();
      expect(container.querySelector('.vjsp-thumbnail-preview')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  describe('play / pause', () => {
    it('delegates play() to the Video.js instance', async () => {
      await player.play();
      expect(mockInstance.play).toHaveBeenCalled();
    });

    it('delegates pause() to the Video.js instance', () => {
      player.pause();
      expect(mockInstance.pause).toHaveBeenCalled();
    });
  });

  describe('currentTime', () => {
    it('returns 0 before source loads', () => {
      mockInstance._currentTime = 0;
      expect(player.currentTime).toBe(0);
    });

    it('setter calls player.currentTime(value) on Video.js', () => {
      player.currentTime = 42;
      expect(mockInstance.currentTime).toHaveBeenCalledWith(42);
    });
  });

  // -------------------------------------------------------------------------
  // Bookmarks
  // -------------------------------------------------------------------------

  describe('setBookmarks', () => {
    it('inserts the correct number of .vjsp-bookmark-marker elements', () => {
      makeProgressHolder(container);
      // Trigger loadedmetadata so duration is set (already 120 via mock)
      mockInstance.trigger('loadedmetadata');

      player.setBookmarks([
        { id: 1, offset: 10, content: 'First' },
        { id: 2, offset: 30, content: 'Second' },
        { id: 3, offset: 60, content: 'Third' },
      ]);

      const markers = container.querySelectorAll('.vjsp-bookmark-marker');
      expect(markers.length).toBe(3);
    });

    it('removes all markers when called with an empty array', () => {
      makeProgressHolder(container);
      mockInstance.trigger('loadedmetadata');

      player.setBookmarks([
        { id: 1, offset: 10, content: 'A' },
        { id: 2, offset: 20, content: 'B' },
      ]);
      expect(container.querySelectorAll('.vjsp-bookmark-marker').length).toBe(2);

      player.setBookmarks([]);
      expect(container.querySelectorAll('.vjsp-bookmark-marker').length).toBe(0);
    });

    it('positions markers as percentage of duration', () => {
      makeProgressHolder(container);
      mockInstance.trigger('loadedmetadata'); // duration = 120

      player.setBookmarks([{ id: 1, offset: 60, content: 'Middle' }]);
      const marker = container.querySelector<HTMLElement>('.vjsp-bookmark-marker')!;
      expect(marker.style.left).toBe('50%');
    });
  });

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  describe('setVisible', () => {
    it('adds vjsp-hidden when called with false', () => {
      player.setVisible(false);
      expect(container.classList.contains('vjsp-hidden')).toBe(true);
    });

    it('removes vjsp-hidden when called with true', () => {
      container.classList.add('vjsp-hidden');
      player.setVisible(true);
      expect(container.classList.contains('vjsp-hidden')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  describe('dispose', () => {
    it('calls Video.js dispose()', () => {
      player.dispose();
      expect(mockInstance.dispose).toHaveBeenCalled();
    });

    it("emits 'dispose' event before teardown", () => {
      const handler = vi.fn();
      player.on('dispose', handler);
      player.dispose();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not throw when called twice', () => {
      expect(() => {
        player.dispose();
        player.dispose();
      }).not.toThrow();
    });

    it('does not throw when vjs.dispose() itself throws', () => {
      mockInstance.dispose = vi.fn(() => { throw new Error('already disposed'); });
      expect(() => player.dispose()).not.toThrow();
    });

    it('does not throw when audioTracks().removeEventListener throws', () => {
      const badList = {
        length: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(() => { throw new Error('gone'); }),
      };
      mockInstance.audioTracks = vi.fn(() => badList as unknown as ReturnType<typeof mockInstance.audioTracks>);
      expect(() => player.dispose()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // EventEmitter (on / off / once)
  // -------------------------------------------------------------------------

  describe('on / off', () => {
    it('handler fires when event is emitted', () => {
      const handler = vi.fn();
      player.on('play', handler);
      mockInstance.trigger('play');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('handler does not fire after off()', () => {
      const handler = vi.fn();
      player.on('play', handler);
      player.off('play', handler);
      mockInstance.trigger('play');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('handler fires exactly once', () => {
      const handler = vi.fn();
      player.once('play', handler);
      mockInstance.trigger('play');
      mockInstance.trigger('play');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Volume
  // -------------------------------------------------------------------------

  describe('volume', () => {
    it('get returns volume from Video.js', () => {
      expect(player.volume).toBe(1);
    });

    it('set delegates to Video.js', () => {
      player.volume = 0.5;
      expect(mockInstance.volume).toHaveBeenCalledWith(0.5);
    });

    it('clamps set value to 0–1', () => {
      player.volume = 2;
      // The value passed to vjs.volume() should be clamped to 1
      const calls = (mockInstance.volume as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[calls.length - 1][0]).toBe(1);
    });
  });

  describe('muted', () => {
    it('get returns muted state', () => {
      expect(player.muted).toBe(false);
    });

    it('set delegates to Video.js', () => {
      player.muted = true;
      expect(mockInstance.muted).toHaveBeenCalledWith(true);
    });

    it('pins the stored `muted` option on set, so a tech reload cannot undo it', () => {
      // Video.js replays options_.muted onto the media element whenever a tech
      // is (re)loaded (player.reset(), a tech-changing source swap): leaving the
      // constructor value in place there re-mutes the player behind the viewer.
      const muted = new EvePlayer(makeContainer(), { muted: true });
      muted.muted = false;
      expect((mockInstance.options as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ muted: false });
      expect(mockInstance._options.muted).toBe(false);
      muted.dispose();
    });

    it('pins the stored `muted` option when Video.js reports a volume change', () => {
      // The control bar's own mute toggle goes straight to video.js, never
      // through the `muted` setter - the volumechange listener has to catch it.
      mockInstance.muted(false);
      mockInstance.trigger('volumechange');
      expect(mockInstance._options.muted).toBe(false);

      mockInstance.muted(true);
      mockInstance.trigger('volumechange');
      expect(mockInstance._options.muted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Playback rate
  // -------------------------------------------------------------------------

  describe('playbackRate', () => {
    it('get returns playback rate', () => {
      expect(player.playbackRate).toBe(1);
    });

    it('set delegates to Video.js', () => {
      player.playbackRate = 1.5;
      expect(mockInstance.playbackRate).toHaveBeenCalledWith(1.5);
    });
  });

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  describe('loop', () => {
    it('get returns loop state from Video.js', () => {
      expect(player.loop).toBe(false);
    });

    it('set delegates to Video.js', () => {
      player.loop = true;
      expect(mockInstance.loop).toHaveBeenCalledWith(true);
    });
  });

  // -------------------------------------------------------------------------
  // Duration / paused / ended
  // -------------------------------------------------------------------------

  describe('duration', () => {
    it('returns the duration from Video.js', () => {
      expect(player.duration).toBe(120);
    });
  });

  describe('paused', () => {
    it('returns true when paused', () => {
      expect(player.paused).toBe(true);
    });
  });

  describe('ended', () => {
    it('returns false before playback ends', () => {
      expect(player.ended).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // readyState
  // -------------------------------------------------------------------------

  describe('readyState', () => {
    it('returns 0 when no tech is available', () => {
      expect(player.readyState).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Audio tracks
  // -------------------------------------------------------------------------

  describe('getAudioTracks', () => {
    it('returns an empty array when no audio tracks exist', () => {
      expect(player.getAudioTracks()).toEqual([]);
    });
  });

  describe('setAudioTrack', () => {
    it('enables the target track and disables others', () => {
      const tracks = mockInstance._audioTracks;
      // Add two fake tracks
      (tracks as unknown as Record<string, unknown>)[0] = { id: 'a1', label: 'EN', language: 'en', enabled: true };
      (tracks as unknown as Record<string, unknown>)[1] = { id: 'a2', label: 'FR', language: 'fr', enabled: false };
      tracks.length = 2;

      player.setAudioTrack('a2');

      expect((tracks[0] as { enabled: boolean }).enabled).toBe(false);
      expect((tracks[1] as { enabled: boolean }).enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Text tracks
  // -------------------------------------------------------------------------

  describe('getTextTracks', () => {
    it('returns an empty array when no text tracks exist', () => {
      expect(player.getTextTracks()).toEqual([]);
    });

    it('skips metadata and chapters tracks', () => {
      const tracks = mockInstance._textTracks;
      (tracks as unknown as Record<string, unknown>)[0] = {
        id: 'm', label: 'meta', language: '', kind: 'metadata', mode: 'hidden',
      };
      tracks.length = 1;
      expect(player.getTextTracks()).toEqual([]);
    });
  });

  describe('setTextTrack', () => {
    it('sets the mode on the matching track', () => {
      const tracks = mockInstance._textTracks;
      (tracks as unknown as Record<string, unknown>)[0] = {
        id: 'sub1', label: 'English', language: 'en', kind: 'subtitles', mode: 'disabled',
      };
      tracks.length = 1;

      player.setTextTrack('sub1', 'showing');
      expect((tracks[0] as { mode: string }).mode).toBe('showing');
    });
  });

  // -------------------------------------------------------------------------
  // Chapter cues
  // -------------------------------------------------------------------------

  describe('getChapterCues', () => {
    it('returns an empty array when there is no chapters track', () => {
      expect(player.getChapterCues()).toEqual([]);
    });

    it('returns cues from a chapters-kind track', () => {
      const tracks = mockInstance._textTracks;
      const cue = createMockCue({ id: 'c1', startTime: 0, endTime: 10, text: 'Intro' });
      (tracks as unknown as Record<string, unknown>)[0] = createMockChaptersTrack([cue]);
      tracks.length = 1;

      expect(player.getChapterCues()).toEqual([{ id: 'c1', startTime: 0, endTime: 10, text: 'Intro' }]);
    });

    it('ignores tracks that are not kind "chapters"', () => {
      const tracks = mockInstance._textTracks;
      const cue = createMockCue({ id: 'c1', startTime: 0, endTime: 10, text: 'Intro' });
      (tracks as unknown as Record<string, unknown>)[0] = {
        kind: 'subtitles',
        cues: Object.assign({ length: 1 }, [cue]),
      };
      tracks.length = 1;

      expect(player.getChapterCues()).toEqual([]);
    });
  });

  describe('chapterentercue event', () => {
    it('emits when a chapter cue fires its native "enter" event', () => {
      const tracks = mockInstance._textTracks;
      const cue = createMockCue({ id: 'c1', startTime: 0, endTime: 10, text: 'Intro' });
      (tracks as unknown as Record<string, unknown>)[0] = createMockChaptersTrack([cue]);
      tracks.length = 1;

      const handler = vi.fn();
      player.on('chapterentercue', handler);
      mockInstance.trigger('loadedmetadata'); // binds cue listeners

      cue.trigger('enter');

      expect(handler).toHaveBeenCalledWith({ cue: { id: 'c1', startTime: 0, endTime: 10, text: 'Intro' } });
    });

    it('does not double-bind the same cue across repeated loadedmetadata events', () => {
      const tracks = mockInstance._textTracks;
      const cue = createMockCue({ id: 'c1', startTime: 0, endTime: 10, text: 'Intro' });
      (tracks as unknown as Record<string, unknown>)[0] = createMockChaptersTrack([cue]);
      tracks.length = 1;

      const handler = vi.fn();
      player.on('chapterentercue', handler);
      mockInstance.trigger('loadedmetadata');
      mockInstance.trigger('loadedmetadata');

      cue.trigger('enter');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not fire for a subtitles-kind track', () => {
      const tracks = mockInstance._textTracks;
      const cue = createMockCue({ id: 'c1', startTime: 0, endTime: 10, text: 'Intro' });
      (tracks as unknown as Record<string, unknown>)[0] = {
        kind: 'subtitles',
        cues: Object.assign({ length: 1 }, [cue]),
      };
      tracks.length = 1;

      const handler = vi.fn();
      player.on('chapterentercue', handler);
      mockInstance.trigger('loadedmetadata');
      cue.trigger('enter');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Poster
  // -------------------------------------------------------------------------

  describe('setPoster', () => {
    it('delegates to Video.js poster()', () => {
      player.setPoster('https://example.com/poster.jpg');
      expect(mockInstance.poster).toHaveBeenCalledWith('https://example.com/poster.jpg');
    });
  });

  // -------------------------------------------------------------------------
  // Fullscreen
  // -------------------------------------------------------------------------

  describe('fullscreen', () => {
    it('isFullscreen returns false by default', () => {
      expect(player.isFullscreen).toBe(false);
    });

    it('requestFullscreen delegates to Video.js', () => {
      player.requestFullscreen();
      expect(mockInstance.requestFullscreen).toHaveBeenCalled();
    });

    it('exitFullscreen delegates to Video.js', () => {
      player.exitFullscreen();
      expect(mockInstance.exitFullscreen).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error event
  // -------------------------------------------------------------------------

  describe('error event', () => {
    it('emits error with code, message and category when vjs reports an error', () => {
      const handler = vi.fn();
      player.on('error', handler);
      mockInstance.error = vi.fn(() => ({ code: 4, message: 'Source not supported' }));
      mockInstance.trigger('error');
      expect(handler).toHaveBeenCalledWith({
        code: 4,
        message: 'Source not supported',
        category: 'source-unsupported',
      });
    });

    it('uses fallback message when error has no message property', () => {
      const handler = vi.fn();
      player.on('error', handler);
      mockInstance.error = vi.fn(() => ({ code: 2 }));
      mockInstance.trigger('error');
      expect(handler).toHaveBeenCalledWith({
        code: 2,
        message: 'Network error',
        category: 'network',
      });
    });

    it('categorizes an encrypted-source error (no DRM/CDM configured)', () => {
      const handler = vi.fn();
      player.on('error', handler);
      mockInstance.error = vi.fn(() => ({ code: 5, message: 'Encrypted, missing key' }));
      mockInstance.trigger('error');
      expect(handler).toHaveBeenCalledWith({
        code: 5,
        message: 'Encrypted, missing key',
        category: 'encrypted',
      });
    });

    it('falls back to the "unknown" category for an unrecognized code', () => {
      const handler = vi.fn();
      player.on('error', handler);
      mockInstance.error = vi.fn(() => ({ code: 99, message: 'Something else' }));
      mockInstance.trigger('error');
      expect(handler).toHaveBeenCalledWith({
        code: 99,
        message: 'Something else',
        category: 'unknown',
      });
    });

    it('does not emit when vjs.error() returns null', () => {
      const handler = vi.fn();
      player.on('error', handler);
      mockInstance.error = vi.fn(() => null);
      mockInstance.trigger('error');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // gapskip event
  // -------------------------------------------------------------------------

  describe('gapskip event', () => {
    it('emits gapskip with from/to when VHS reports a gap jump', () => {
      const handler = vi.fn();
      player.on('gapskip', handler);
      mockInstance.trigger('gapjumped', { metadata: { gapInfo: { from: 12.5, to: 14.2 } } });
      expect(handler).toHaveBeenCalledWith({ from: 12.5, to: 14.2 });
    });

    it('does not emit when the gapjumped payload has no gapInfo', () => {
      const handler = vi.fn();
      player.on('gapskip', handler);
      mockInstance.trigger('gapjumped', {});
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // stall event
  // -------------------------------------------------------------------------

  describe('stall event', () => {
    it('does not emit for the initial buffering wait before first playback', () => {
      const handler = vi.fn();
      player.on('stall', handler);
      mockInstance.trigger('waiting');
      mockInstance.trigger('playing');
      expect(handler).not.toHaveBeenCalled();
    });

    it('emits the rebuffer duration for a mid-playback stall', () => {
      const nowSpy = vi.spyOn(performance, 'now');
      const handler = vi.fn();
      player.on('stall', handler);

      mockInstance.trigger('playing'); // marks playback as started, no active stall
      nowSpy.mockReturnValueOnce(1000);
      mockInstance.trigger('waiting'); // stall starts
      nowSpy.mockReturnValueOnce(3500);
      mockInstance.trigger('playing'); // stall resolved: 2.5s

      expect(handler).toHaveBeenCalledWith({ duration: 2.5 });
      nowSpy.mockRestore();
    });

    it('does not double-count a stall on repeated waiting events', () => {
      const nowSpy = vi.spyOn(performance, 'now');
      const handler = vi.fn();
      player.on('stall', handler);

      mockInstance.trigger('playing');
      nowSpy.mockReturnValueOnce(1000);
      mockInstance.trigger('waiting');
      mockInstance.trigger('waiting'); // should not reset the clock
      nowSpy.mockReturnValueOnce(4000);
      mockInstance.trigger('playing');

      expect(handler).toHaveBeenCalledWith({ duration: 3 });
      nowSpy.mockRestore();
    });

    it('resets stall tracking on loadstart (new source)', () => {
      const handler = vi.fn();
      player.on('stall', handler);

      mockInstance.trigger('playing');
      mockInstance.trigger('waiting'); // stall in progress
      mockInstance.trigger('loadstart'); // new source: tracking resets
      mockInstance.trigger('playing'); // should not be treated as stall resolution

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Bookmarks edge cases
  // -------------------------------------------------------------------------

  describe('bookmark edge cases', () => {
    it('does not render markers when there is no progress holder', () => {
      // No progress holder in container (should not throw)
      expect(() => {
        player.setBookmarks([{ id: 1, offset: 10, content: 'A' }]);
        mockInstance.trigger('loadedmetadata');
      }).not.toThrow();
    });

    it('does not render markers when duration is 0', () => {
      makeProgressHolder(container);
      // Set duration to 0 via mock
      mockInstance.duration = vi.fn(() => 0);
      mockInstance.trigger('loadedmetadata');
      player.setBookmarks([{ id: 1, offset: 10, content: 'A' }]);
      expect(container.querySelectorAll('.vjsp-bookmark-marker').length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Event bridging (verify bridge fires emitter events)
  // -------------------------------------------------------------------------

  describe('event bridging', () => {
    it('bridges pause event', () => {
      const handler = vi.fn();
      player.on('pause', handler);
      mockInstance.trigger('pause');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('bridges ended event', () => {
      const handler = vi.fn();
      player.on('ended', handler);
      mockInstance.trigger('ended');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('bridges timeupdate event with currentTime', () => {
      const handler = vi.fn();
      player.on('timeupdate', handler);
      mockInstance.trigger('timeupdate');
      expect(handler).toHaveBeenCalledWith({ currentTime: 0 });
    });

    it('bridges ratechange event', () => {
      const handler = vi.fn();
      player.on('ratechange', handler);
      mockInstance.trigger('ratechange');
      expect(handler).toHaveBeenCalledWith({ playbackRate: 1 });
    });

    it('bridges volumechange event', () => {
      const handler = vi.fn();
      player.on('volumechange', handler);
      mockInstance.trigger('volumechange');
      expect(handler).toHaveBeenCalledWith({ volume: 1, muted: false });
    });

    it('bridges fullscreenchange event', () => {
      const handler = vi.fn();
      player.on('fullscreenchange', handler);
      mockInstance.trigger('fullscreenchange');
      expect(handler).toHaveBeenCalledWith({ isFullscreen: false });
    });

    it('bridges loadedmetadata event with size', () => {
      const handler = vi.fn();
      player.on('loadedmetadata', handler);
      mockInstance.trigger('loadedmetadata');
      expect(handler).toHaveBeenCalledWith({ size: { width: 1920, height: 1080 } });
    });

    it('bridges readystatechange from native media events, since Video.js has no such event of its own', () => {
      const handler = vi.fn();
      player.on('readystatechange', handler);
      mockInstance.tech = vi.fn(() => ({ el: () => ({ readyState: 3 }) }));
      mockInstance.trigger('canplay');
      expect(handler).toHaveBeenCalledWith({ readyState: 3 });
    });

    it('does not re-emit readystatechange when the underlying readyState has not changed', () => {
      const handler = vi.fn();
      player.on('readystatechange', handler);
      mockInstance.tech = vi.fn(() => ({ el: () => ({ readyState: 2 }) }));
      mockInstance.trigger('loadeddata');
      mockInstance.trigger('canplay');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('re-emits readystatechange once readyState actually increases', () => {
      const handler = vi.fn();
      player.on('readystatechange', handler);
      mockInstance.tech = vi.fn(() => ({ el: () => ({ readyState: 3 }) }));
      mockInstance.trigger('canplay');
      mockInstance.tech = vi.fn(() => ({ el: () => ({ readyState: 4 }) }));
      mockInstance.trigger('canplaythrough');
      expect(handler).toHaveBeenNthCalledWith(1, { readyState: 3 });
      expect(handler).toHaveBeenNthCalledWith(2, { readyState: 4 });
    });

    it('bridges sourceset event', () => {
      const handler = vi.fn();
      player.on('sourceset', handler);
      const desc = { sources: [{ src: 'v.mp4' }] };
      player.setSource(desc);
      expect(handler).toHaveBeenCalledWith({ source: desc });
    });
  });

  // -------------------------------------------------------------------------
  // Picture-in-Picture
  // -------------------------------------------------------------------------

  describe('Picture-in-Picture', () => {
    // Stub pointer capture API (not fully implemented in jsdom)
    beforeEach(() => {
      container.setPointerCapture = vi.fn();
      container.releasePointerCapture = vi.fn();
      container.hasPointerCapture = vi.fn(() => true);
    });

    it('isPip returns false by default', () => {
      expect(player.isPip).toBe(false);
    });

    it('requestPip() adds vjsp-pip-active class', () => {
      player.requestPip();
      expect(container.classList.contains('vjsp-pip-active')).toBe(true);
    });

    it('requestPip() emits pipchange with isPip: true', () => {
      const handler = vi.fn();
      player.on('pipchange', handler);
      player.requestPip();
      expect(handler).toHaveBeenCalledWith({ isPip: true });
    });

    it('requestPip() injects a restore button into the container', () => {
      player.requestPip();
      expect(container.querySelector('.vjsp-pip-restore')).not.toBeNull();
    });

    it('requestPip() is a no-op when already in PiP', () => {
      player.requestPip();
      const handler = vi.fn();
      player.on('pipchange', handler);
      player.requestPip(); // second call (should not emit)
      expect(handler).not.toHaveBeenCalled();
    });

    it('exitPip() removes vjsp-pip-active class', () => {
      player.requestPip();
      player.exitPip();
      expect(container.classList.contains('vjsp-pip-active')).toBe(false);
    });

    it('exitPip() emits pipchange with isPip: false', () => {
      player.requestPip();
      const handler = vi.fn();
      player.on('pipchange', handler);
      player.exitPip();
      expect(handler).toHaveBeenCalledWith({ isPip: false });
    });

    it('exitPip() removes the restore button', () => {
      player.requestPip();
      player.exitPip();
      expect(container.querySelector('.vjsp-pip-restore')).toBeNull();
    });

    it('requestPip() inserts an in-flow placeholder before the container', () => {
      player.requestPip();
      const placeholder = container.previousElementSibling as HTMLElement | null;
      expect(placeholder?.classList.contains('vjsp-pip-placeholder')).toBe(true);
      expect(placeholder?.textContent).toBe('Video is playing in picture-in-picture');
    });

    it('exitPip() removes the placeholder', () => {
      player.requestPip();
      player.exitPip();
      expect(container.parentElement?.querySelector('.vjsp-pip-placeholder')).toBeNull();
    });

    it('pipPlaceholderText option overrides the placeholder text', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, { pipPlaceholderText: 'Popped out ↘' });
      p.requestPip();
      expect(c.previousElementSibling?.textContent).toBe('Popped out ↘');
      p.dispose();
    });

    it('empty pipPlaceholderText still reserves the space with no text node', () => {
      const c = makeContainer();
      const p = new EvePlayer(c, { pipPlaceholderText: '' });
      p.requestPip();
      const placeholder = c.previousElementSibling as HTMLElement | null;
      expect(placeholder?.classList.contains('vjsp-pip-placeholder')).toBe(true);
      expect(placeholder?.querySelector('.vjsp-pip-placeholder-text')).toBeNull();
      p.dispose();
    });

    it('exitPip() is a no-op when not in PiP', () => {
      const handler = vi.fn();
      player.on('pipchange', handler);
      player.exitPip();
      expect(handler).not.toHaveBeenCalled();
    });

    it('vjsp:pip-toggle event toggles PiP on', () => {
      mockInstance.trigger('vjsp:pip-toggle');
      expect(player.isPip).toBe(true);
    });

    it('vjsp:pip-toggle event toggles PiP off when already active', () => {
      player.requestPip();
      mockInstance.trigger('vjsp:pip-toggle');
      expect(player.isPip).toBe(false);
    });

    it('clicking the restore button calls exitPip()', () => {
      player.requestPip();
      const restoreBtn = container.querySelector<HTMLButtonElement>('.vjsp-pip-restore')!;
      restoreBtn.click();
      expect(player.isPip).toBe(false);
    });

    it('pointerdown sets the dragging class', () => {
      player.requestPip();
      const e = new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true });
      container.dispatchEvent(e);
      expect(container.classList.contains('vjsp-pip-dragging')).toBe(true);
    });

    it('pointermove updates container position when captured', () => {
      player.requestPip();
      // pointerdown first to record start position
      container.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 300, bubbles: true }));
      // move 50px right, 30px down
      container.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 250, clientY: 330, bubbles: true }));
      // inline style should have been updated
      expect(container.style.right).not.toBe('');
      expect(container.style.bottom).not.toBe('');
    });

    it('pointerup releases the dragging class', () => {
      player.requestPip();
      container.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
      container.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
      expect(container.classList.contains('vjsp-pip-dragging')).toBe(false);
    });

    it('dispose() while in PiP cleans up properly', () => {
      player.requestPip();
      expect(() => player.dispose()).not.toThrow();
      expect(container.classList.contains('vjsp-pip-active')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Quality selector
  // -------------------------------------------------------------------------

  describe('quality selector', () => {
    // Mimics http-streaming's Representation: `enabled` is a get/set function
    // (no-arg reads, one-arg writes), starting enabled - which is how VHS
    // reports every rendition before any manual selection has ever disabled one.
    function createMockRepresentation(id: string, height: number, bandwidth: number) {
      let isEnabled = true;
      return {
        id,
        height,
        bandwidth,
        enabled: vi.fn((value?: boolean) => {
          if (value !== undefined) isEnabled = value;
          return isEnabled;
        }),
      };
    }

    function mockRepresentations(reps: ReturnType<typeof createMockRepresentation>[]) {
      mockInstance.tech = vi.fn(() => ({
        el: () => ({ readyState: 0 }),
        vhs: { representations: () => reps },
      }));
    }

    it('getQualityLevels returns Auto plus every rendition, sorted by height descending', () => {
      mockRepresentations([
        createMockRepresentation('low', 360, 800_000),
        createMockRepresentation('high', 1080, 8_000_000),
        createMockRepresentation('mid', 720, 4_000_000),
      ]);
      expect(player.getQualityLevels()).toStrictEqual([
        { id: 'auto', label: 'Auto', height: 0, bitrate: 0, isAuto: true, selected: true },
        { id: 'high', label: '1080p', height: 1080, bitrate: 8_000_000, isAuto: false, selected: false },
        { id: 'mid', label: '720p', height: 720, bitrate: 4_000_000, isAuto: false, selected: false },
        { id: 'low', label: '360p', height: 360, bitrate: 800_000, isAuto: false, selected: false },
      ]);
    });

    it('getQualityLevels marks the manually picked level as selected, and only that one', () => {
      mockRepresentations([
        createMockRepresentation('low', 360, 800_000),
        createMockRepresentation('high', 1080, 8_000_000),
      ]);
      player.setQualityLevel('high');
      expect(player.getQualityLevels().map((l) => [l.id, l.selected])).toStrictEqual([
        ['auto', false],
        ['high', true],
        ['low', false],
      ]);
    });

    it('setSource resets the selection back to Auto', () => {
      mockRepresentations([
        createMockRepresentation('low', 360, 800_000),
        createMockRepresentation('high', 1080, 8_000_000),
      ]);
      player.setQualityLevel('high');
      player.setSource({ sources: [{ src: 'https://example.com/other.m3u8' }] });
      const auto = player.getQualityLevels().find((l) => l.isAuto);
      expect(auto?.selected).toBe(true);
      expect(player.getQualityLevels().filter((l) => l.selected)).toHaveLength(1);
    });

    it('setQualityLevel disables every representation before enabling the target', () => {
      // Regression test: http-streaming only triggers its buffer-clearing fast
      // quality change on an actual false->true transition. Picking a quality
      // for the first time (coming from Auto, where nothing is disabled yet)
      // used to call enabled(true) on a representation that was already
      // enabled - a silent no-op - so the switch only ever took effect once an
      // unrelated periodic ABR re-check happened to run, 9-45s later, without
      // clearing the old-quality buffer first. See EvePlayer.ts setQualityLevel.
      const low = createMockRepresentation('low', 360, 800_000);
      const high = createMockRepresentation('high', 1080, 8_000_000);
      mockRepresentations([low, high]);

      player.setQualityLevel('high');

      expect(low.enabled).toHaveBeenCalledWith(false);
      expect(high.enabled).toHaveBeenCalledWith(false);
      expect(high.enabled).toHaveBeenLastCalledWith(true);
      // The target's disabling call must precede its enabling call, or the
      // enable(true) never sees a real state transition.
      const disableOrder = high.enabled.mock.invocationCallOrder[0];
      const enableOrder = high.enabled.mock.invocationCallOrder[1];
      expect(disableOrder).toBeLessThan(enableOrder);
    });

    it('setQualityLevel is a no-op for an unknown id', () => {
      const low = createMockRepresentation('low', 360, 800_000);
      mockRepresentations([low]);

      player.setQualityLevel('does-not-exist');

      expect(low.enabled).not.toHaveBeenCalled();
    });

    it('setQualityLevel emits qualitychange with the target level', () => {
      mockRepresentations([
        createMockRepresentation('low', 360, 800_000),
        createMockRepresentation('high', 1080, 8_000_000),
      ]);
      const handler = vi.fn();
      player.on('qualitychange', handler);

      player.setQualityLevel('high');

      expect(handler).toHaveBeenCalledWith({
        level: { id: 'high', label: '1080p', height: 1080, bitrate: 8_000_000, isAuto: false, selected: true },
      });
    });

    it('setAutoQuality re-enables every representation and emits the Auto level', () => {
      const low = createMockRepresentation('low', 360, 800_000);
      const high = createMockRepresentation('high', 1080, 8_000_000);
      mockRepresentations([low, high]);
      const handler = vi.fn();
      player.on('qualitychange', handler);

      player.setQualityLevel('high');
      player.setAutoQuality();

      expect(low.enabled).toHaveBeenLastCalledWith(true);
      expect(high.enabled).toHaveBeenLastCalledWith(true);
      expect(handler).toHaveBeenLastCalledWith({
        level: { id: 'auto', label: 'Auto', height: 0, bitrate: 0, isAuto: true, selected: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Delivery telemetry
  // -------------------------------------------------------------------------

  describe('getPlaybackStats', () => {
    /**
     * Mimics the engine's `stats` object plus the active rendition's attributes.
     * `audioGroup` models the master playlist's AUDIO media groups: a rendition
     * carrying a `uri` is demuxed and fetched by a second loader.
     */
    function mockVhs(
      stats: Record<string, number> | undefined,
      attributes?: Record<string, unknown>,
      audioGroup?: Record<string, Record<string, { uri?: string }>>
    ) {
      mockInstance.tech = vi.fn(() => ({
        el: () => ({ readyState: 0 }),
        vhs: stats
          ? {
              stats,
              playlists: {
                media: () => ({ id: 'r1', attributes: attributes ?? {} }),
                main: { mediaGroups: { AUDIO: audioGroup ?? {} } },
              },
            }
          : undefined,
      }));
    }

    it('returns undefined where playback does not go through the streaming engine', () => {
      mockVhs(undefined);
      expect(player.getPlaybackStats()).toBeUndefined();
    });

    it('derives the fetch rate from time spent inside requests, not wall clock', () => {
      // 20s of media pulled in 5s of request time.
      mockVhs({ mediaBytesTransferred: 5_000_000, mediaTransferDuration: 5000, mediaSecondsLoaded: 20 });
      expect(player.getPlaybackStats()?.fetchRate).toBe(4);
    });

    it('measures the content bitrate from delivered bytes rather than the manifest', () => {
      mockVhs(
        { mediaBytesTransferred: 2_500_000, mediaTransferDuration: 4000, mediaSecondsLoaded: 10 },
        // The declared peak is far above what is really being delivered.
        { BANDWIDTH: '5000000', 'AVERAGE-BANDWIDTH': '2100000' }
      );
      const stats = player.getPlaybackStats();
      expect(stats?.contentBitrate).toBe(2_000_000);
      expect(stats?.peakBitrate).toBe(5_000_000);
      expect(stats?.averageBitrate).toBe(2_100_000);
    });

    it('falls back to the declared average, never the peak, before any segment lands', () => {
      mockVhs(
        { mediaBytesTransferred: 0, mediaTransferDuration: 0, mediaSecondsLoaded: 0 },
        { BANDWIDTH: '5000000', 'AVERAGE-BANDWIDTH': '2100000' }
      );
      const stats = player.getPlaybackStats();
      expect(stats?.contentBitrate).toBe(2_100_000);
      expect(stats?.fetchRate).toBeUndefined();
    });

    it('counts media seconds once when the audio is demuxed into its own loader', () => {
      // The engine adds both loaders' seconds together, so 20s of playback with
      // a separate audio rendition arrives here as ~40.
      mockVhs(
        { mediaBytesTransferred: 5_000_000, mediaTransferDuration: 5000, mediaSecondsLoaded: 40 },
        { AUDIO: 'audio_0' },
        { audio_0: { English: { uri: 'index_mono.m3u8' } } }
      );
      const stats = player.getPlaybackStats();
      expect(stats?.secondsLoaded).toBe(20);
      // 20s of media per 5s of request time, not the 8x the raw counter implies.
      expect(stats?.fetchRate).toBe(4);
      expect(stats?.contentBitrate).toBe(2_000_000);
    });

    it('leaves the count alone when the audio rides inside the video segments', () => {
      // An AUDIO group whose renditions carry no uri is muxed: one loader only.
      mockVhs(
        { mediaBytesTransferred: 5_000_000, mediaTransferDuration: 5000, mediaSecondsLoaded: 20 },
        { AUDIO: 'audio_0' },
        { audio_0: { English: {} } }
      );
      expect(player.getPlaybackStats()?.secondsLoaded).toBe(20);
    });

    it('leaves the count alone when the variant references no audio group', () => {
      mockVhs({ mediaBytesTransferred: 5_000_000, mediaTransferDuration: 5000, mediaSecondsLoaded: 20 }, {});
      expect(player.getPlaybackStats()?.secondsLoaded).toBe(20);
    });

    it('reports failed and timed-out segment requests', () => {
      mockVhs({
        mediaBytesTransferred: 1000,
        mediaTransferDuration: 100,
        mediaSecondsLoaded: 1,
        mediaRequestsErrored: 2,
        mediaRequestsTimedout: 1,
      });
      const stats = player.getPlaybackStats();
      expect(stats?.requestsErrored).toBe(2);
      expect(stats?.requestsTimedout).toBe(1);
    });

    it('leaves the bitrate fields undefined when the manifest declares neither', () => {
      mockVhs({ mediaBytesTransferred: 0, mediaTransferDuration: 0, mediaSecondsLoaded: 0 }, {});
      const stats = player.getPlaybackStats();
      expect(stats?.peakBitrate).toBeUndefined();
      expect(stats?.averageBitrate).toBeUndefined();
      expect(stats?.contentBitrate).toBeUndefined();
    });
  });

  describe('renditionchange event', () => {
    /**
     * Mimics the playlist loader: `mediachange` listeners are recorded so a test
     * can fire one, and `media()` reports whichever rendition is active.
     */
    function mockPlaylists(reps: { id: string; height: number; bandwidth: number }[]) {
      const listeners: Record<string, (() => void)[]> = {};
      let activeId = reps[0].id;
      const playlists = {
        media: () => ({ id: activeId }),
        on: (event: string, cb: () => void) => {
          listeners[event] = [...(listeners[event] ?? []), cb];
        },
        off: (event: string, cb: () => void) => {
          listeners[event] = (listeners[event] ?? []).filter((r) => r !== cb);
        },
      };
      mockInstance.tech = vi.fn(() => ({
        el: () => ({ readyState: 0 }),
        vhs: {
          playlists,
          representations: () =>
            reps.map((r) => ({ ...r, enabled: () => true })),
        },
      }));
      return {
        switchTo(id: string) {
          activeId = id;
          for (const cb of listeners['mediachange'] ?? []) cb();
        },
      };
    }

    it('reports an automatic switch, which qualitychange never sees', () => {
      const vhs = mockPlaylists([
        { id: 'high', height: 1080, bandwidth: 8_000_000 },
        { id: 'low', height: 360, bandwidth: 800_000 },
      ]);
      const onRendition = vi.fn();
      const onQuality = vi.fn();
      player.on('renditionchange', onRendition);
      player.on('qualitychange', onQuality);
      mockInstance.trigger('loadstart');

      vhs.switchTo('low');

      expect(onRendition).toHaveBeenCalledTimes(1);
      expect(onQuality).not.toHaveBeenCalled();
    });

    it('carries the previous level so the direction of the switch is derivable', () => {
      const vhs = mockPlaylists([
        { id: 'high', height: 1080, bandwidth: 8_000_000 },
        { id: 'low', height: 360, bandwidth: 800_000 },
      ]);
      const handler = vi.fn();
      player.on('renditionchange', handler);
      mockInstance.trigger('loadstart');

      // First switch establishes the starting rendition, the second steps down.
      vhs.switchTo('high');
      vhs.switchTo('low');

      const last = handler.mock.calls[handler.mock.calls.length - 1][0] as {
        level: { bitrate: number };
        previous?: { bitrate: number };
      };
      expect(last.previous?.bitrate).toBe(8_000_000);
      expect(last.level.bitrate).toBe(800_000);
      expect(last.level.bitrate).toBeLessThan(last.previous!.bitrate);
    });

    it('leaves `previous` undefined for the first rendition of a source', () => {
      const vhs = mockPlaylists([{ id: 'high', height: 1080, bandwidth: 8_000_000 }]);
      const handler = vi.fn();
      player.on('renditionchange', handler);
      mockInstance.trigger('loadstart');

      vhs.switchTo('high');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ previous: undefined })
      );
    });

    it('does not fire when the loader re-reports the rendition already playing', () => {
      const vhs = mockPlaylists([{ id: 'high', height: 1080, bandwidth: 8_000_000 }]);
      const handler = vi.fn();
      player.on('renditionchange', handler);
      mockInstance.trigger('loadstart');

      vhs.switchTo('high');
      vhs.switchTo('high');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('keeps `selected` on Auto: an ABR switch is not a change of selection', () => {
      const vhs = mockPlaylists([
        { id: 'high', height: 1080, bandwidth: 8_000_000 },
        { id: 'low', height: 360, bandwidth: 800_000 },
      ]);
      const handler = vi.fn();
      player.on('renditionchange', handler);
      mockInstance.trigger('loadstart');

      vhs.switchTo('low');

      const payload = handler.mock.calls[handler.mock.calls.length - 1][0] as {
        level: { selected: boolean };
      };
      expect(payload.level.selected).toBe(false);
      expect(player.getQualityLevels().find((l) => l.isAuto)?.selected).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Settings menu (gear): quality + playback speed flyout
  // -------------------------------------------------------------------------

  describe('settings menu', () => {
    function createMockRepresentation(id: string, height: number, bandwidth: number) {
      let isEnabled = true;
      return {
        id,
        height,
        bandwidth,
        enabled: vi.fn((value?: boolean) => {
          if (value !== undefined) isEnabled = value;
          return isEnabled;
        }),
      };
    }

    function mockRepresentations(reps: ReturnType<typeof createMockRepresentation>[]) {
      mockInstance.tech = vi.fn(() => ({
        el: () => ({ readyState: 0 }),
        vhs: { representations: () => reps },
      }));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const menuOf = (p: EvePlayer): HTMLElement => (p as any)._settingsMenu as HTMLElement;
    const open = () => mockInstance.trigger('vjsp:settings-menu-toggle');
    const rowLabels = (menu: HTMLElement) =>
      [...menu.querySelectorAll('.vjsp-settings-row__label')].map((e) => e.textContent);
    const optionLabels = (menu: HTMLElement) =>
      [...menu.querySelectorAll('.vjsp-settings-option__label')].map((e) => e.textContent);

    it('opens on the toggle event and renders a root panel with both sections', () => {
      mockRepresentations([
        createMockRepresentation('high', 1080, 8_000_000),
        createMockRepresentation('low', 360, 800_000),
      ]);
      open();
      const menu = menuOf(player);
      expect(menu.classList.contains('vjsp-settings-menu--hidden')).toBe(false);
      expect(menu.querySelector('.vjsp-settings-menu__title')!.textContent).toBe('Settings');
      expect(rowLabels(menu)).toEqual(['Playback speed', 'Quality']);
    });

    it('shows the current values on the root rows', () => {
      mockRepresentations([
        createMockRepresentation('high', 1080, 8_000_000),
        createMockRepresentation('low', 360, 800_000),
      ]);
      open();
      const values = [...menuOf(player).querySelectorAll('.vjsp-settings-row__value')].map(
        (e) => e.textContent
      );
      // videoHeight() mock returns 1080
      expect(values).toEqual(['Normal', 'Automatic (1080p)']);
    });

    it('drills into the Quality sub-panel: Auto plus every rendition, Auto checked', () => {
      mockRepresentations([
        createMockRepresentation('high', 1080, 8_000_000),
        createMockRepresentation('mid', 720, 4_000_000),
      ]);
      open();
      const menu = menuOf(player);
      const qualityRow = [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-row')].find(
        (b) => b.textContent?.startsWith('Quality')
      )!;
      qualityRow.click();

      expect(menu.querySelector('.vjsp-settings-menu__title')!.textContent).toBe('Quality');
      expect(optionLabels(menu)).toEqual(['Auto', '1080p', '720p']);
      const checked = menu.querySelector('.vjsp-settings-option[aria-checked="true"]');
      expect(checked!.textContent).toContain('Auto');
    });

    it('picking a specific quality locks it, returns to root, and updates the row value', () => {
      const high = createMockRepresentation('high', 1080, 8_000_000);
      const mid = createMockRepresentation('mid', 720, 4_000_000);
      mockRepresentations([high, mid]);
      const handler = vi.fn();
      player.on('qualitychange', handler);

      open();
      const menu = menuOf(player);
      [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-row')]
        .find((b) => b.textContent?.startsWith('Quality'))!
        .click();
      // options: Auto, 1080p, 720p
      menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-option')[2].click();

      // mid is enabled last among the write-calls; a subsequent no-arg read
      // from the menu re-render is expected, so assert on the write, not "last".
      expect(mid.enabled).toHaveBeenCalledWith(true);
      expect(high.enabled).toHaveBeenCalledWith(false);
      expect(handler).toHaveBeenCalledWith({
        level: { id: 'mid', label: '720p', height: 720, bitrate: 4_000_000, isAuto: false, selected: true },
      });
      expect(menu.querySelector('.vjsp-settings-menu__title')!.textContent).toBe('Settings');
      const qualityValue = [...menu.querySelectorAll('.vjsp-settings-row')]
        .find((b) => b.textContent?.startsWith('Quality'))!
        .querySelector('.vjsp-settings-row__value')!.textContent;
      expect(qualityValue).toBe('720p');
    });

    it('drills into Playback speed and applies the picked rate', () => {
      mockRepresentations([]);
      open();
      const menu = menuOf(player);
      [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-row')]
        .find((b) => b.textContent?.startsWith('Playback speed'))!
        .click();

      expect(menu.querySelector('.vjsp-settings-menu__title')!.textContent).toBe('Playback speed');
      expect(optionLabels(menu)).toEqual(['0.5×', '0.75×', 'Normal', '1.25×', '1.5×', '2×']);

      const oneFive = [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-option')].find(
        (b) => b.textContent?.includes('1.5×')
      )!;
      oneFive.click();

      expect(mockInstance.playbackRate).toHaveBeenCalledWith(1.5);
      expect(menu.querySelector('.vjsp-settings-menu__title')!.textContent).toBe('Settings');
    });

    it('honours a custom playbackRates list', () => {
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { playbackRates: [1, 2, 3] });
      mockRepresentations([]);
      open();
      const menu = menuOf(player);
      [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-row')]
        .find((b) => b.textContent?.startsWith('Playback speed'))!
        .click();
      expect(optionLabels(menu)).toEqual(['Normal', '2×', '3×']);
    });

    it('the header back arrow returns from a sub-panel to root', () => {
      mockRepresentations([
        createMockRepresentation('high', 1080, 8_000_000),
        createMockRepresentation('low', 360, 800_000),
      ]);
      open();
      const menu = menuOf(player);
      [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-row')]
        .find((b) => b.textContent?.startsWith('Quality'))!
        .click();
      expect(menu.querySelector('.vjsp-settings-menu__title')!.textContent).toBe('Quality');

      menu.querySelector<HTMLButtonElement>('.vjsp-settings-menu__back')!.click();
      expect(menu.querySelector('.vjsp-settings-menu__title')!.textContent).toBe('Settings');
    });

    it('the header back arrow at root closes the menu', () => {
      mockRepresentations([]);
      open();
      const menu = menuOf(player);
      menu.querySelector<HTMLButtonElement>('.vjsp-settings-menu__back')!.click();
      expect(menu.classList.contains('vjsp-settings-menu--hidden')).toBe(true);
    });

    it('toggling the event twice closes the menu', () => {
      mockRepresentations([]);
      open();
      expect(menuOf(player).classList.contains('vjsp-settings-menu--hidden')).toBe(false);
      open();
      expect(menuOf(player).classList.contains('vjsp-settings-menu--hidden')).toBe(true);
    });

    it('closes when the control bar goes inactive (userinactive)', () => {
      mockRepresentations([]);
      open();
      expect(menuOf(player).classList.contains('vjsp-settings-menu--hidden')).toBe(false);
      mockInstance.trigger('userinactive');
      expect(menuOf(player).classList.contains('vjsp-settings-menu--hidden')).toBe(true);
    });

    it('Escape closes the menu', () => {
      vi.useFakeTimers();
      mockRepresentations([]);
      open();
      vi.runAllTimers(); // flush the deferred document-listener attach
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(menuOf(player).classList.contains('vjsp-settings-menu--hidden')).toBe(true);
      vi.useRealTimers();
    });

    it('hideSpeed drops the Playback speed section, keeping Quality', () => {
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { hideSpeed: true });
      mockRepresentations([
        createMockRepresentation('high', 1080, 8_000_000),
        createMockRepresentation('low', 360, 800_000),
      ]);
      open();
      expect(rowLabels(menuOf(player))).toEqual(['Quality']);
    });

    it('is not created at all when both sections are disabled', () => {
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { quality: false, hideSpeed: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((player as any)._settingsMenu).toBeNull();
    });

    it('is not created when settings: false', () => {
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { settings: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((player as any)._settingsMenu).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Native track menus (hoisted to the player root, click-only, bottom-right)
  // -------------------------------------------------------------------------

  describe('native track menu hoisting', () => {
    function buildPlayerRootWithAudioMenu() {
      const playerRoot = document.createElement('div');
      playerRoot.className = 'video-js';
      const wrapper = document.createElement('div');
      wrapper.className = 'vjs-audio-button vjs-menu-button vjs-menu-button-popup vjs-control';
      const menu = document.createElement('div');
      menu.className = 'vjs-menu';
      wrapper.appendChild(menu);
      playerRoot.appendChild(wrapper);
      return { playerRoot, wrapper, menu };
    }

    it('re-parents a native popup menu to the player root and tags it', () => {
      const { playerRoot, menu } = buildPlayerRootWithAudioMenu();
      mockInstance.el = vi.fn(() => playerRoot);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player as any)._hoistNativeMenus();

      expect(menu.parentElement).toBe(playerRoot);
      expect(menu.classList.contains('vjsp-hoisted-menu')).toBe(true);
    });

    it('re-hoists a menu that video.js rebuilds back inside the button', async () => {
      const { playerRoot, wrapper } = buildPlayerRootWithAudioMenu();
      mockInstance.el = vi.fn(() => playerRoot);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player as any)._hoistNativeMenus();

      // Simulate MenuButton.update() inserting a fresh menu inside the wrapper.
      const rebuilt = document.createElement('div');
      rebuilt.className = 'vjs-menu';
      wrapper.appendChild(rebuilt);
      await new Promise((r) => setTimeout(r, 0)); // let the MutationObserver run

      expect(rebuilt.parentElement).toBe(playerRoot);
      expect(rebuilt.classList.contains('vjsp-hoisted-menu')).toBe(true);
    });

    it('also hoists the chapters menu and tags it for chapter-specific styling', () => {
      const playerRoot = document.createElement('div');
      playerRoot.className = 'video-js';
      const wrapper = document.createElement('div');
      wrapper.className = 'vjs-chapters-button vjs-menu-button vjs-menu-button-popup vjs-control';
      const menu = document.createElement('div');
      menu.className = 'vjs-menu';
      wrapper.appendChild(menu);
      playerRoot.appendChild(wrapper);
      mockInstance.el = vi.fn(() => playerRoot);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player as any)._hoistNativeMenus();

      expect(menu.parentElement).toBe(playerRoot);
      expect(menu.classList.contains('vjsp-hoisted-menu')).toBe(true);
      expect(menu.classList.contains('vjsp-hoisted-menu--chapters')).toBe(true);
    });

    it('disconnects its observers on dispose', async () => {
      const { playerRoot, wrapper } = buildPlayerRootWithAudioMenu();
      mockInstance.el = vi.fn(() => playerRoot);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player as any)._hoistNativeMenus();
      player.dispose();

      const rebuilt = document.createElement('div');
      rebuilt.className = 'vjs-menu';
      wrapper.appendChild(rebuilt);
      await new Promise((r) => setTimeout(r, 0));

      // Observer gone → the freshly inserted menu is left where video.js put it.
      expect(rebuilt.parentElement).toBe(wrapper);
    });
  });

  // -------------------------------------------------------------------------
  // Custom control-bar components (registered once per page load)
  // -------------------------------------------------------------------------

  describe('custom control-bar components', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function videojsMock(): Promise<any> {
      return (await import('video.js')).default;
    }

    it('VjspPipButton injects the PiP icon and toggles PiP on click', async () => {
      const PipButton = (await videojsMock()).__registered.VjspPipButton;
      const fakePlayer = { trigger: vi.fn() };
      const btn = new PipButton(fakePlayer, {});

      expect(btn.addClass).toHaveBeenCalledWith('vjsp-pip-button');
      expect(btn.controlText).toHaveBeenCalledWith('Picture in Picture');
      expect((btn.el() as HTMLElement).querySelector('.vjs-icon-placeholder')!.innerHTML).toContain(
        '<svg'
      );

      btn.handleClick();
      expect(fakePlayer.trigger).toHaveBeenCalledWith('vjsp:pip-toggle');
    });

    it('VjspSettingsButton injects the gear icon, starts hidden, and toggles the menu on click', async () => {
      const SettingsButton = (await videojsMock()).__registered.VjspSettingsButton;
      const fakePlayer = { trigger: vi.fn() };
      const btn = new SettingsButton(fakePlayer, {});

      expect(btn.addClass).toHaveBeenCalledWith('vjsp-settings-button');
      expect((btn.el() as HTMLElement).querySelector('.vjs-icon-placeholder')!.innerHTML).toContain(
        '<svg'
      );
      expect((btn.el() as HTMLElement).style.display).toBe('none');

      btn.handleClick();
      expect(fakePlayer.trigger).toHaveBeenCalledWith('vjsp:settings-menu-toggle');
    });

    it('tunes VHS BANDWIDTH_VARIANCE to 1.0 once a player has been constructed', async () => {
      expect((await videojsMock()).Vhs.BANDWIDTH_VARIANCE).toBe(1);
    });

    it('SubsCapsButton filters a native kind:"captions" track (real device: kind:"captions" id:"0" mode:"showing") until it gets a real cue, leaving subtitles alone', async () => {
      const videojs = vi.mocked((await import('video.js')).default);
      const browser = (videojs as unknown as { browser: Record<string, boolean> }).browser;
      browser.IS_ANY_SAFARI = true;
      try {
        const safariPlayer = new EvePlayer(makeContainer());
        const safariInstance = mockInstance;

        const textTracks = safariInstance._textTracks as TextTrackList;
        const ccTrack = createMockNativeTrack({ kind: 'captions', id: '0', mode: 'showing' });
        const subTrack = createMockNativeTrack({ kind: 'subtitles', id: '1' });
        (textTracks as unknown as Record<number, unknown>)[0] = ccTrack;
        (textTracks as unknown as Record<number, unknown>)[1] = subTrack;
        textTracks.length = 2;
        textTracks._emit('addtrack', { track: ccTrack });
        textTracks._emit('addtrack', { track: subTrack });

        const SubsCapsButtonCtor = (await videojsMock()).__registered.SubsCapsButton;
        const button = new SubsCapsButtonCtor(safariInstance);
        expect(button.createItems().map((i: { track: unknown }) => i.track)).toEqual([subTrack]);

        const subsCapsButtonChild = safariInstance._controlBar.getChild('subsCapsButton');
        ccTrack.trigger('cuechange');

        expect(button.createItems().map((i: { track: unknown }) => i.track)).toEqual([
          ccTrack,
          subTrack,
        ]);
        expect(subsCapsButtonChild.update).toHaveBeenCalled();

        safariPlayer.dispose();
      } finally {
        browser.IS_ANY_SAFARI = false;
      }
    });

    it('SubsCapsButton does nothing outside Safari/iOS', async () => {
      const textTracks = mockInstance._textTracks as TextTrackList;
      const ccTrack = createMockNativeTrack({ kind: 'captions', id: '0', mode: 'showing' });
      (textTracks as unknown as Record<number, unknown>)[0] = ccTrack;
      textTracks.length = 1;
      textTracks._emit('addtrack', { track: ccTrack });

      const SubsCapsButtonCtor = (await videojsMock()).__registered.SubsCapsButton;
      const button = new SubsCapsButtonCtor(mockInstance);
      expect(button.createItems().map((i: { track: unknown }) => i.track)).toEqual([ccTrack]);
    });
  });

  // -------------------------------------------------------------------------
  // Live-edge "-M:SS" drift countdown
  // -------------------------------------------------------------------------

  describe('live-behind countdown', () => {
    const liveBehindEl = () =>
      mockInstance.el().querySelector('.vjsp-live-behind-time') as HTMLElement | null;

    it('writes a -M:SS label when paused behind the live edge', () => {
      mockInstance.liveTracker = {
        isLive: () => true,
        atLiveEdge: () => false,
        liveCurrentTime: () => 95,
      };
      player.currentTime = 20;
      mockInstance.trigger('pause');
      expect(liveBehindEl()!.textContent).toBe('-1:15');
    });

    it('clears the label at the live edge', () => {
      mockInstance.liveTracker = {
        isLive: () => true,
        atLiveEdge: () => true,
        liveCurrentTime: () => 95,
      };
      mockInstance.trigger('timeupdate');
      expect(liveBehindEl()!.textContent).toBe('');
    });

    it('clears the label when less than a second behind', () => {
      mockInstance.liveTracker = {
        isLive: () => true,
        atLiveEdge: () => false,
        liveCurrentTime: () => 10,
      };
      player.currentTime = 10;
      mockInstance.trigger('timeupdate');
      expect(liveBehindEl()!.textContent).toBe('');
    });

    it('does nothing for a non-live source', () => {
      mockInstance.liveTracker = { isLive: () => false };
      mockInstance.trigger('timeupdate');
      expect(liveBehindEl()).toBeNull();
    });

    it('stops the polling interval again when playback resumes', () => {
      mockInstance.liveTracker = {
        isLive: () => true,
        atLiveEdge: () => false,
        liveCurrentTime: () => 95,
      };
      mockInstance.trigger('pause');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((player as any)._liveBehindInterval).not.toBeNull();
      mockInstance.trigger('play');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((player as any)._liveBehindInterval).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getter fallbacks when Video.js returns undefined
  // -------------------------------------------------------------------------

  describe('getter fallbacks', () => {
    it('numeric/boolean getters fall back to their defaults', () => {
      mockInstance.currentTime = vi.fn(() => undefined);
      mockInstance.duration = vi.fn(() => undefined);
      mockInstance.paused = vi.fn(() => undefined);
      mockInstance.ended = vi.fn(() => undefined);
      mockInstance.volume = vi.fn(() => undefined);
      mockInstance.muted = vi.fn(() => undefined);
      mockInstance.loop = vi.fn(() => undefined);
      mockInstance.playbackRate = vi.fn(() => undefined);
      mockInstance.isFullscreen = vi.fn(() => undefined);

      expect(player.currentTime).toBe(0);
      expect(player.duration).toBe(0);
      expect(player.paused).toBe(true);
      expect(player.ended).toBe(false);
      expect(player.volume).toBe(1);
      expect(player.muted).toBe(false);
      expect(player.loop).toBe(false);
      expect(player.playbackRate).toBe(1);
      expect(player.isFullscreen).toBe(false);
    });

    it('readyState is 0 when there is no tech', () => {
      mockInstance.tech = vi.fn(() => undefined);
      expect(player.readyState).toBe(0);
    });

    it('play() resolves even when Video.js returns no promise', async () => {
      mockInstance.play = vi.fn(() => undefined);
      await expect(player.play()).resolves.toBeUndefined();
    });

    it('loadedmetadata reports a zero size when Video.js has no dimensions', () => {
      mockInstance.videoWidth = vi.fn(() => undefined);
      mockInstance.videoHeight = vi.fn(() => undefined);
      const handler = vi.fn();
      player.on('loadedmetadata', handler);
      mockInstance.trigger('loadedmetadata');
      expect(handler).toHaveBeenCalledWith({ size: { width: 0, height: 0 } });
    });
  });

  // -------------------------------------------------------------------------
  // loadstart re-attaches the custom ABR selector
  // -------------------------------------------------------------------------

  describe('custom ABR selector attachment', () => {
    it('assigns vhs.selectPlaylist on every loadstart', () => {
      const vhs: { selectPlaylist?: unknown } = {};
      mockInstance.tech = vi.fn(() => ({ el: () => ({ readyState: 0 }), vhs }));
      mockInstance.trigger('loadstart');
      expect(typeof vhs.selectPlaylist).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Audio / text track change bridging
  // -------------------------------------------------------------------------

  describe('track-change bridging', () => {
    it('emits audiotrackchange with the enabled track when the audio list changes', () => {
      const list = mockInstance._audioTracks;
      (list as unknown as Record<number, unknown>)[0] = {
        id: 'en', label: 'English', language: 'en', enabled: true,
      };
      (list as unknown as Record<number, unknown>)[1] = {
        id: 'fr', label: 'Français', language: 'fr', enabled: false,
      };
      list.length = 2;

      const handler = vi.fn();
      player.on('audiotrackchange', handler);
      list._emit('change');

      expect(handler).toHaveBeenCalledWith({
        track: { id: 'en', label: 'English', language: 'en', enabled: true },
      });
    });

    it('emits texttrackchange for a track whose mode is "showing"', () => {
      const list = mockInstance._textTracks;
      (list as unknown as Record<number, unknown>)[0] = {
        id: 'sub-it', label: 'Italiano', language: 'it', kind: 'subtitles', mode: 'showing',
      };
      list.length = 1;

      const handler = vi.fn();
      player.on('texttrackchange', handler);
      list._emit('change');

      expect(handler).toHaveBeenCalledWith({
        track: { id: 'sub-it', label: 'Italiano', language: 'it', kind: 'subtitles', mode: 'showing' },
      });
    });

    it('getAudioTracks maps the underlying list', () => {
      const list = mockInstance._audioTracks;
      (list as unknown as Record<number, unknown>)[0] = {
        id: 'a', label: 'A', language: 'en', enabled: true,
      };
      list.length = 1;
      expect(player.getAudioTracks()).toEqual([
        { id: 'a', label: 'A', language: 'en', enabled: true },
      ]);
    });

    it('getTextTracks returns subtitle tracks (and drops metadata/chapters)', () => {
      const list = mockInstance._textTracks;
      (list as unknown as Record<number, unknown>)[0] = {
        id: 'sub', label: 'EN', language: 'en', kind: 'subtitles', mode: 'disabled',
      };
      (list as unknown as Record<number, unknown>)[1] = {
        id: 'ch', label: 'Chapters', language: '', kind: 'chapters', mode: 'hidden',
      };
      list.length = 2;
      expect(player.getTextTracks()).toEqual([
        { id: 'sub', label: 'EN', language: 'en', kind: 'subtitles', mode: 'disabled' },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Extra branch coverage
  // -------------------------------------------------------------------------

  describe('thumbnail hover (zero-width progress bar)', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT2M">
  <Period><AdaptationSet mimeType="image/jpeg">
    <SegmentTemplate media="t_$Number%09d$.jpg" duration="2432430" timescale="90000" startNumber="1"/>
    <Representation bandwidth="1" id="t" width="936" height="528">
      <EssentialProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="3x3"/>
    </Representation>
  </AdaptationSet></Period>
</MPD>`;

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('does not show the preview when the progress bar has no width', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ text: () => Promise.resolve(MPD) })));
      const holder = makeProgressHolder(container);
      holder.getBoundingClientRect = () =>
        ({ left: 0, width: 0, top: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;

      player.setSource({ sources: [{ src: 'https://cdn.example.com/x.mpd', type: 'application/dash+xml' }] });
      mockInstance.trigger('loadedmetadata');
      await flush();

      holder.dispatchEvent(new MouseEvent('mousemove', { clientX: 10 }));
      const preview = container.querySelector<HTMLElement>('.vjsp-thumbnail-preview')!;
      expect(preview.classList.contains('vjsp-thumbnail-preview--visible')).toBe(false);
    });

    it('hides the preview when the cursor is past the last tile', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ text: () => Promise.resolve(MPD) })));
      const holder = makeProgressHolder(container);
      holder.getBoundingClientRect = () =>
        ({ left: 0, width: 300, top: 0, height: 5, right: 300, bottom: 5, x: 0, y: 0, toJSON() {} }) as DOMRect;

      player.setSource({ sources: [{ src: 'https://cdn.example.com/x.mpd', type: 'application/dash+xml' }] });
      mockInstance.trigger('loadedmetadata');
      await flush();

      // First a hit near the start to make the preview visible…
      holder.dispatchEvent(new MouseEvent('mousemove', { clientX: 15 }));
      const preview = container.querySelector<HTMLElement>('.vjsp-thumbnail-preview')!;
      expect(preview.classList.contains('vjsp-thumbnail-preview--visible')).toBe(true);

      // …then a hit at the far right edge (time === duration → no covering tile).
      holder.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
      expect(preview.classList.contains('vjsp-thumbnail-preview--visible')).toBe(false);
    });
  });

  describe('settings menu (more edge cases)', () => {
    function mockReps(reps: { id: string; height: number; bandwidth: number }[]) {
      mockInstance.tech = vi.fn(() => ({
        el: () => ({ readyState: 0 }),
        vhs: {
          representations: () =>
            reps.map((r) => ({ ...r, enabled: vi.fn((v?: boolean) => v ?? true) })),
        },
      }));
    }

    it('omits the Quality section entirely when quality: false, even with multiple renditions', () => {
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { quality: false });
      mockReps([
        { id: 'high', height: 1080, bandwidth: 8_000_000 },
        { id: 'low', height: 360, bandwidth: 800_000 },
      ]);
      mockInstance.trigger('vjsp:settings-menu-toggle');
      const menu = (player as unknown as { _settingsMenu: HTMLElement })._settingsMenu;
      const rows = [...menu.querySelectorAll('.vjsp-settings-row__label')].map((e) => e.textContent);
      expect(rows).toEqual(['Playback speed']);
    });

    it('labels a heightless (audio) rendition by bitrate in the Quality sub-panel', () => {
      mockReps([
        { id: 'v', height: 720, bandwidth: 4_000_000 },
        { id: 'a', height: 0, bandwidth: 128_000 },
      ]);
      mockInstance.trigger('vjsp:settings-menu-toggle');
      const menu = (player as unknown as { _settingsMenu: HTMLElement })._settingsMenu;
      [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-row')]
        .find((b) => b.textContent?.startsWith('Quality'))!
        .click();
      const labels = [...menu.querySelectorAll('.vjsp-settings-option__label')].map((e) => e.textContent);
      expect(labels).toEqual(['Auto', '720p', '128k']);
    });

    it('a click outside the open menu closes it', () => {
      vi.useFakeTimers();
      mockReps([]);
      mockInstance.trigger('vjsp:settings-menu-toggle');
      const menu = (player as unknown as { _settingsMenu: HTMLElement })._settingsMenu;
      expect(menu.classList.contains('vjsp-settings-menu--hidden')).toBe(false);
      vi.runAllTimers(); // flush the deferred document-listener attach
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(menu.classList.contains('vjsp-settings-menu--hidden')).toBe(true);
      vi.useRealTimers();
    });

    it('falls back to the root panel if the quality section disappears while its sub-panel is open', () => {
      mockReps([
        { id: 'high', height: 1080, bandwidth: 8_000_000 },
        { id: 'low', height: 360, bandwidth: 800_000 },
      ]);
      mockInstance.trigger('vjsp:settings-menu-toggle');
      const p = player as unknown as {
        _settingsLevel: string;
        _refreshSettingsVisibility: () => void;
      };
      p._settingsLevel = 'quality';
      // Now only one rendition remains → no quality section.
      mockReps([{ id: 'only', height: 720, bandwidth: 4_000_000 }]);
      p._refreshSettingsVisibility();
      expect(p._settingsLevel).toBe('root');
    });

    it('_renderSettings drops an orphaned "speed" level when speed is disabled', () => {
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { hideSpeed: true });
      mockReps([
        { id: 'high', height: 1080, bandwidth: 8_000_000 },
        { id: 'low', height: 360, bandwidth: 800_000 },
      ]);
      const p = player as unknown as {
        _settingsLevel: string;
        _renderSettings: () => void;
        _settingsMenu: HTMLElement;
      };
      p._settingsLevel = 'speed';
      p._renderSettings();
      expect(p._settingsLevel).toBe('root');
    });

    it('_renderSettings drops an orphaned "quality" level when quality is disabled', () => {
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { quality: false });
      mockReps([
        { id: 'high', height: 1080, bandwidth: 8_000_000 },
        { id: 'low', height: 360, bandwidth: 800_000 },
      ]);
      const p = player as unknown as { _settingsLevel: string; _renderSettings: () => void };
      p._settingsLevel = 'quality';
      p._renderSettings();
      expect(p._settingsLevel).toBe('root');
    });

    it('picking "Auto" in the Quality sub-panel restores ABR and returns to root', () => {
      mockReps([
        { id: 'high', height: 1080, bandwidth: 8_000_000 },
        { id: 'low', height: 360, bandwidth: 800_000 },
      ]);
      const onQualityChange = vi.fn();
      player.on('qualitychange', onQualityChange);
      mockInstance.trigger('vjsp:settings-menu-toggle');
      const menu = (player as unknown as { _settingsMenu: HTMLElement })._settingsMenu;
      [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-row')]
        .find((b) => b.textContent?.startsWith('Quality'))!
        .click();
      const autoOption = [...menu.querySelectorAll<HTMLButtonElement>('.vjsp-settings-option')].find(
        (b) => b.textContent?.includes('Auto')
      )!;
      autoOption.click();

      expect(onQualityChange).toHaveBeenCalledWith({
        level: { id: 'auto', label: 'Auto', height: 0, bitrate: 0, isAuto: true, selected: true },
      });
      expect(menu.querySelector('.vjsp-settings-menu__title')!.textContent).toBe('Settings');
    });

    it('unpresses a still-open native track menu when the control bar goes inactive', () => {
      const unpressButton = vi.fn();
      mockInstance.getChild = vi.fn(() => ({
        removeChild: vi.fn(),
        addChild: vi.fn(),
        getChild: vi.fn((name: string) =>
          name === 'subsCapsButton'
            ? { buttonPressed_: true, unpressButton }
            : { toggleClass: vi.fn() }
        ),
      }));
      mockInstance.trigger('userinactive');
      expect(unpressButton).toHaveBeenCalled();
    });

    it('stays open on a click inside the menu and on a key other than Escape', () => {
      vi.useFakeTimers();
      mockReps([]);
      mockInstance.trigger('vjsp:settings-menu-toggle');
      const menu = (player as unknown as { _settingsMenu: HTMLElement })._settingsMenu;
      vi.runAllTimers();
      menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(menu.classList.contains('vjsp-settings-menu--hidden')).toBe(false);
      vi.useRealTimers();
    });

    it('labels the root Quality row "Automatic" before the video height is known', () => {
      mockInstance.videoHeight = vi.fn(() => undefined);
      const p = player as unknown as { _settingsQualityValue: () => string };
      expect(p._settingsQualityValue()).toBe('Automatic');
    });

    it('labels the root Quality row "Auto" for a manual pick that has no label', () => {
      const p = player as unknown as {
        _isAutoQuality: boolean;
        _manualQualityLabel: string;
        _settingsQualityValue: () => string;
      };
      p._isAutoQuality = false;
      p._manualQualityLabel = '';
      expect(p._settingsQualityValue()).toBe('Auto');
    });

    it('every settings-menu entry point is a no-op when the menu was never built', () => {
      player.dispose();
      container.remove();
      container = makeContainer();
      player = new EvePlayer(container, { settings: false });
      const p = player as unknown as {
        _settingsMenu: HTMLElement | null;
        _refreshSettingsVisibility: () => void;
        _openSettingsMenu: () => void;
        _toggleSettingsMenu: () => void;
        _renderSettings: () => void;
      };
      expect(p._settingsMenu).toBeFalsy();
      expect(() => {
        p._refreshSettingsVisibility();
        p._openSettingsMenu();
        p._toggleSettingsMenu();
        p._renderSettings();
      }).not.toThrow();
    });

    describe('with a rendered gear button', () => {
      let gear: HTMLButtonElement;

      const withGear = () => {
        gear = document.createElement('button');
        mockInstance.getChild = vi.fn((name?: string) =>
          name === 'controlBar'
            ? {
                removeChild: vi.fn(),
                addChild: vi.fn(),
                getChild: vi.fn(() => ({ el: () => gear, toggleClass: vi.fn() })),
              }
            : undefined
        );
      };

      type SettingsInternals = {
        _settingsMenu: HTMLElement;
        _refreshSettingsVisibility: () => void;
        _onSettingsDocClick: ((e: { target: Node }) => void) | null;
      };

      it('shows the gear while a section is available and hides it otherwise', () => {
        withGear();
        (player as unknown as SettingsInternals)._refreshSettingsVisibility();
        expect(gear.style.display).toBe('');

        player.dispose();
        container.remove();
        container = makeContainer();
        player = new EvePlayer(container, { hideSpeed: true });
        withGear();
        mockReps([]);
        (player as unknown as SettingsInternals)._refreshSettingsVisibility();
        expect(gear.style.display).toBe('none');
      });

      it('a mousedown on the menu itself or on the gear does not close the menu', () => {
        vi.useFakeTimers();
        withGear();
        mockReps([]);
        mockInstance.trigger('vjsp:settings-menu-toggle');
        vi.runAllTimers();
        const p = player as unknown as SettingsInternals;
        p._onSettingsDocClick!({ target: p._settingsMenu });
        p._onSettingsDocClick!({ target: gear });
        expect(p._settingsMenu.classList.contains('vjsp-settings-menu--hidden')).toBe(false);
        vi.useRealTimers();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Defensive fallbacks
  // -------------------------------------------------------------------------

  describe('defensive fallbacks', () => {
    it('reports code 0 and a generic message for an error with neither code nor message', () => {
      const handler = vi.fn();
      player.on('error', handler);
      mockInstance.error = vi.fn(() => ({}));
      mockInstance.trigger('error');
      expect(handler).toHaveBeenCalledWith({ code: 0, message: 'Unknown error', category: 'unknown' });
    });

    it('pins the stored muted option to false when the engine reports no muted state', () => {
      mockInstance.muted = vi.fn(() => undefined);
      mockInstance.trigger('volumechange');
      expect(mockInstance.options).toHaveBeenLastCalledWith({ muted: false });
    });

    it('does not emit audiotrackchange when no audio track is enabled', () => {
      const handler = vi.fn();
      player.on('audiotrackchange', handler);
      mockInstance._audioTracks._emit('change');
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not emit texttrackchange for a track that is not showing', () => {
      const handler = vi.fn();
      player.on('texttrackchange', handler);
      const list = mockInstance._textTracks;
      list[0] = { id: 't1', label: 'English', language: 'en', kind: 'subtitles', mode: 'disabled' };
      list.length = 1;
      list._emit('change');
      expect(handler).not.toHaveBeenCalled();
    });

    it('setTextTrack leaves tracks with a different id untouched', () => {
      const list = mockInstance._textTracks;
      list[0] = { id: 't1', label: 'English', language: 'en', kind: 'subtitles', mode: 'disabled' };
      list.length = 1;
      player.setTextTrack('other', 'showing');
      expect(list[0].mode).toBe('disabled');
    });

    it('getQualityLevels returns [] when the streaming engine exposes no renditions', () => {
      expect(player.getQualityLevels()).toEqual([]);
    });

    it('labels a heightless rendition by bitrate in getQualityLevels and setQualityLevel', () => {
      const reps = [
        { id: 'v', height: 720, bandwidth: 4_000_000, enabled: vi.fn((v?: boolean) => v ?? true) },
        { id: 'a', height: 0, bandwidth: 128_000, enabled: vi.fn((v?: boolean) => v ?? true) },
      ];
      mockInstance.tech = vi.fn(() => ({
        el: () => ({ readyState: 0 }),
        vhs: { representations: () => reps },
      }));
      expect(player.getQualityLevels().map((l) => l.label)).toEqual(['Auto', '720p', '128k']);
      player.setQualityLevel('a');
      expect((player as unknown as { _manualQualityLabel: string })._manualQualityLabel).toBe('128k');
    });

    it('getPlaybackStats treats missing engine counters as zero', () => {
      mockInstance.tech = vi.fn(() => ({ el: () => ({ readyState: 0 }), vhs: { stats: {} } }));
      const stats = player.getPlaybackStats();
      expect(stats?.bytesTransferred).toBe(0);
      expect(stats?.secondsLoaded).toBe(0);
      expect(stats?.fetchRate).toBeUndefined();
    });

    it('reads the audio groups from `master` on older engines, and ignores an unknown group', () => {
      const withGroups = (audio: Record<string, Record<string, { uri?: string }>>) =>
        vi.fn(() => ({
          el: () => ({ readyState: 0 }),
          vhs: {
            stats: { mediaBytesTransferred: 1000, mediaTransferDuration: 100, mediaSecondsLoaded: 20 },
            playlists: {
              media: () => ({ id: 'r1', attributes: { AUDIO: 'audio_0' } }),
              master: { mediaGroups: { AUDIO: audio } },
            },
          },
        }));
      mockInstance.tech = withGroups({ audio_0: { English: { uri: 'a.m3u8' } } });
      expect(player.getPlaybackStats()?.secondsLoaded).toBe(10);
      mockInstance.tech = withGroups({ other: { English: { uri: 'a.m3u8' } } });
      expect(player.getPlaybackStats()?.secondsLoaded).toBe(20);
    });

    it('ignores a media change while the active rendition has no id', () => {
      const handler = vi.fn();
      player.on('renditionchange', handler);
      mockInstance.tech = vi.fn(() => ({
        el: () => ({ readyState: 0 }),
        vhs: { playlists: { media: () => ({}) } },
      }));
      (player as unknown as { _onMediaChange: () => void })._onMediaChange();
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not insert a PiP placeholder for a container that is not in the document', () => {
      container.remove();
      (player as unknown as { _insertPipPlaceholder: () => void })._insertPipPlaceholder();
      expect((player as unknown as { _pipPlaceholder: unknown })._pipPlaceholder).toBeFalsy();
    });

    it('closing native menus is a no-op without a control bar', () => {
      mockInstance.getChild = vi.fn(() => undefined);
      expect(() =>
        (player as unknown as { _closeNativeMenus: () => void })._closeNativeMenus()
      ).not.toThrow();
    });

    it('a hover move is ignored while no thumbnail tiles are loaded', () => {
      const holder = makeProgressHolder(container);
      const getRect = vi.spyOn(holder, 'getBoundingClientRect');
      (
        player as unknown as { _onThumbnailHoverMove: (e: MouseEvent, h: HTMLElement) => void }
      )._onThumbnailHoverMove(new MouseEvent('mousemove'), holder);
      expect(getRect).not.toHaveBeenCalled();
    });
  });
});

describe('EvePlayer.version', () => {
  it('is a non-empty semver-like string', () => {
    expect(typeof EvePlayer.version).toBe('string');
    expect(EvePlayer.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('falls back to the dev marker outside a tsup build', () => {
    // `__EVE_VERSION__` is only defined by tsup's `define`; vitest has none.
    expect(EvePlayer.version).toBe('0.0.0-dev');
  });
});
