/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
/// <reference types="vite/client" />
import type { Meta, StoryObj } from '@storybook/html-vite';
import { action } from 'storybook/actions';
import { EvePlayer } from '../EvePlayer';
import type {
  LanguageDictionary,
  PlayerEventMap,
  PlayerOptions,
  SourceDescription,
  SourceItem,
  SourceTextTrack,
} from '../types';
import sintelChaptersUrl from './assets/sintel-chapters.vtt?url&no-inline';

// ---------------------------------------------------------------------------
// Sample sources: two public test streams.
// ---------------------------------------------------------------------------

interface Preset {
  label: string;
  sources: SourceItem[];
  poster?: string;
  textTracks?: SourceTextTrack[];
}

const PRESETS = {
  sintel: {
    label: 'Sintel (MP4, with chapters)',
    sources: [{ src: 'https://media.w3.org/2010/05/sintel/trailer.mp4', type: 'video/mp4' }],
    poster: 'https://media.w3.org/2010/05/sintel/poster.png',
    textTracks: [{ kind: 'chapters', src: sintelChaptersUrl, srclang: 'en', label: 'Chapters' }],
  },
  bigBuckBunny: {
    label: 'Big Buck Bunny (HLS, quality levels)',
    sources: [
      { src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'application/x-mpegURL' },
    ],
  },
} satisfies Record<string, Preset>;

type PresetKey = keyof typeof PRESETS;
type SourceChoice = PresetKey | 'custom';

/** MIME type for a URL's extension, or undefined when it does not tell. */
function guessType(url: string): string | undefined {
  const path = url.split(/[?#]/)[0].toLowerCase();
  const types: Record<string, string> = {
    m3u8: 'application/x-mpegURL',
    mpd: 'application/dash+xml',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
  };
  return types[path.slice(path.lastIndexOf('.') + 1)];
}

// ---------------------------------------------------------------------------
// UI languages: the same merge scripts/build-lang.mjs does for dist/lang/.
// ---------------------------------------------------------------------------

const videojsLanguages = import.meta.glob<LanguageDictionary>(
  '../../node_modules/video.js/dist/lang/*.json',
  { import: 'default' }
);
const ownLanguages = import.meta.glob<LanguageDictionary>('../../lang/*.json', {
  import: 'default',
});

const languageCode = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
const byCode = (modules: Record<string, () => Promise<LanguageDictionary>>) =>
  Object.fromEntries(Object.entries(modules).map(([path, load]) => [languageCode(path), load]));
const videojsByCode = byCode(videojsLanguages);
const ownByCode = byCode(ownLanguages);
const LANGUAGE_CODES = [...new Set([...Object.keys(videojsByCode), ...Object.keys(ownByCode)])].sort();

const registeredLanguages = new Set<string>();

async function registerLanguage(code: string): Promise<void> {
  if (!code || registeredLanguages.has(code)) return;
  const [videojsDictionary, ownDictionary] = await Promise.all([
    videojsByCode[code]?.() ?? {},
    ownByCode[code]?.() ?? {},
  ]);
  EvePlayer.addLanguage(code, { ...videojsDictionary, ...ownDictionary });
  registeredLanguages.add(code);
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

type OptionArgs = Required<Omit<PlayerOptions, 'pipPlaceholderText' | 'minBandwidth' | 'maxBandwidth'>> &
  Pick<PlayerOptions, 'pipPlaceholderText' | 'minBandwidth' | 'maxBandwidth'>;

interface PlaygroundArgs extends OptionArgs {
  source: SourceChoice;
  src: string;
  type: string;
}

/**
 * The library's own defaults (see `PlayerOptions`). An arg left at its default
 * is not passed to the constructor, exactly like an app that never sets it, so
 * `background` can still default `autoplay` / `muted` / `loop` to true.
 */
const OPTION_DEFAULTS: OptionArgs = {
  autoplay: false,
  muted: false,
  loop: false,
  widescreen: false,
  fluid: true,
  background: false,
  hideControls: false,
  hidePlayButton: false,
  showProgressDot: false,
  showVolumeDot: false,
  pip: true,
  pipPlaceholderText: undefined,
  settings: true,
  hideSpeed: false,
  playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
  quality: true,
  minBandwidth: undefined,
  maxBandwidth: undefined,
  captionSettings: true,
  chapters: true,
  chapterMarkers: true,
  thumbnails: true,
  language: '',
  labels: {},
};

const OPTION_KEYS = Object.keys(OPTION_DEFAULTS) as (keyof OptionArgs)[];

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function toOptions(args: PlaygroundArgs): PlayerOptions {
  const options: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) {
    const value = args[key];
    if (value === undefined || sameValue(value, OPTION_DEFAULTS[key])) continue;
    options[key] = value;
  }
  return options as PlayerOptions;
}

function toSource(args: PlaygroundArgs): SourceDescription {
  if (args.source === 'custom') {
    const src = (args.src ?? '').trim();
    const type = args.type || guessType(src);
    return { sources: src ? [{ src, ...(type ? { type } : {}) }] : [] };
  }
  // The select's empty "Choose option" entry leaves `source` undefined.
  const { sources, poster, textTracks }: Preset = PRESETS[args.source] ?? PRESETS.sintel;
  return {
    sources,
    ...(poster ? { poster } : {}),
    ...(textTracks ? { textTracks } : {}),
  };
}

// ---------------------------------------------------------------------------
// Code snippet
// ---------------------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A value as a JavaScript literal, in the repository's code style. */
function toJs(value: unknown, indent = ''): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return `[${value.map((item) => toJs(item)).join(', ')}]`;
    }
    const inner = `${indent}  `;
    return `[\n${value.map((item) => `${inner}${toJs(item, inner)},`).join('\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const inner = `${indent}  `;
    const lines = entries.map(
      ([key, item]) => `${inner}${IDENTIFIER.test(key) ? key : toJs(key)}: ${toJs(item, inner)},`
    );
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  return String(value);
}

/** Absolute URL, so a snippet copied out of Storybook still points somewhere. */
const absolute = (url: string) => new URL(url, window.location.href).href;

function toSnippet(options: PlayerOptions, source: SourceDescription): string {
  const shownSource: SourceDescription = {
    ...source,
    ...(source.textTracks
      ? { textTracks: source.textTracks.map((track) => ({ ...track, src: absolute(track.src) })) }
      : {}),
  };
  const lines = [
    `// @admmedia/eveplayer ${EvePlayer.version}`,
    `import { EvePlayer } from '@admmedia/eveplayer';`,
    `import '@admmedia/eveplayer/style.css';`,
  ];
  if (options.language) {
    const name = options.language.replace(/[^A-Za-z0-9]/g, '');
    lines.push(
      `import ${name} from '@admmedia/eveplayer/lang/${options.language}.json';`,
      '',
      `EvePlayer.addLanguage('${options.language}', ${name});`
    );
  }
  lines.push(
    '',
    Object.keys(options).length > 0
      ? `const player = new EvePlayer(document.getElementById('player'), ${toJs(options)});`
      : `const player = new EvePlayer(document.getElementById('player'));`,
    `player.setSource(${toJs(shownSource)});`
  );
  return lines.join('\n');
}

function createCodePanel(code: string): HTMLElement {
  const panel = document.createElement('details');
  panel.style.cssText = 'margin-top:16px;font:13px/1.5 system-ui,sans-serif;';
  panel.open = true;

  const summary = document.createElement('summary');
  summary.textContent = 'Code';
  summary.style.cssText = 'cursor:pointer;font-weight:600;margin-bottom:8px;';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.style.cssText = 'margin-left:12px;font:inherit;font-weight:400;cursor:pointer;';
  copy.addEventListener('click', (event) => {
    event.preventDefault();
    void navigator.clipboard?.writeText(code).then(() => {
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    });
  });
  summary.appendChild(copy);

  const pre = document.createElement('pre');
  pre.style.cssText =
    'margin:0;padding:12px 16px;overflow:auto;background:#f6f6f6;border-radius:6px;' +
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;';
  pre.textContent = code;

  panel.append(summary, pre);
  return panel;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Every event, forwarded to the Actions panel (`timeupdate` left out: it fires 4x a second). */
const LOGGED_EVENTS: (keyof PlayerEventMap)[] = [
  'play',
  'pause',
  'ended',
  'readystatechange',
  'loadedmetadata',
  'audiotrackchange',
  'texttrackchange',
  'error',
  'sourceset',
  'ratechange',
  'volumechange',
  'fullscreenchange',
  'pipchange',
  'qualitychange',
  'renditionchange',
  'chapterentercue',
  'gapskip',
  'stall',
  'dispose',
];

// Players built by earlier renders. Changing a control re-renders the story
// and Storybook swaps in a new root, but the old player would keep playing
// (audio included) in the detached one, so each render disposes those first.
const mounted = new Map<HTMLElement, EvePlayer>();

function disposeDetached(): void {
  for (const [root, player] of mounted) {
    if (!root.isConnected) {
      player.dispose();
      mounted.delete(root);
    }
  }
}

function disposeAll(): void {
  for (const player of mounted.values()) player.dispose();
  mounted.clear();
}

function render(args: PlaygroundArgs): HTMLElement {
  const root = document.createElement('div');
  root.style.maxWidth = '800px';

  const playerContainer = document.createElement('div');
  root.appendChild(playerContainer);

  const options = toOptions(args);
  const source = toSource(args);
  root.appendChild(createCodePanel(toSnippet(options, source)));

  // EvePlayer needs a container already in the document (Safari's MSE wedges
  // on a detached one), and Storybook inserts the returned node only after
  // render() returns, so the player is built on the next frame.
  requestAnimationFrame(() => {
    disposeDetached();
    if (!root.isConnected) return;
    void registerLanguage(args.language).then(() => {
      if (!root.isConnected) return;
      const player = new EvePlayer(playerContainer, options);
      for (const name of LOGGED_EVENTS) player.on(name, action(name));
      player.setSource(source);
      mounted.set(root, player);
    });
  });

  return root;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const categories = {
  source: 'Source',
  playback: 'Playback',
  layout: 'Layout',
  controls: 'Controls',
  pip: 'Picture-in-Picture',
  settings: 'Settings menu',
  quality: 'Quality (adaptive bitrate)',
  tracks: 'Text tracks and chapters',
  labels: 'Labels and translations',
};

const meta: Meta<PlaygroundArgs> = {
  title: 'EvePlayer',
  render,
  beforeEach: () => disposeAll,
  args: {
    source: 'sintel',
    src: '',
    type: '',
    ...OPTION_DEFAULTS,
  },
  argTypes: {
    // Source: what goes into setSource().
    source: {
      name: 'sample source',
      description: 'The stream the options are tried on, or "Custom URL" to use your own.',
      options: [...Object.keys(PRESETS), 'custom'],
      control: {
        type: 'select',
        labels: {
          ...Object.fromEntries(Object.entries(PRESETS).map(([key, preset]) => [key, preset.label])),
          custom: 'Custom URL',
        },
      },
      table: { category: categories.source },
    },
    src: {
      description:
        'URL of the media (`.mp4`, `.mp3`, `.m3u8`, `.mpd`, …). HLS and DASH need a server that allows cross-origin requests.',
      control: 'text',
      if: { arg: 'source', eq: 'custom' },
      table: { category: categories.source },
    },
    type: {
      description: 'MIME type. Left empty, it is guessed from the URL extension.',
      options: ['', 'application/x-mpegURL', 'application/dash+xml', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4'],
      control: { type: 'select', labels: { '': 'Guess from URL' } },
      if: { arg: 'source', eq: 'custom' },
      table: { category: categories.source },
    },

    // Playback
    autoplay: {
      description:
        'Start playback once a source is loaded. Browsers allow it only when muted, so pair it with `muted`.',
      control: 'boolean',
      table: { category: categories.playback },
    },
    muted: {
      description: 'Start muted. The initial state only: once unmuted, the player never re-mutes itself.',
      control: 'boolean',
      table: { category: categories.playback },
    },
    loop: {
      description: 'Loop playback when it reaches the end.',
      control: 'boolean',
      table: { category: categories.playback },
    },
    background: {
      description:
        'Decorative backdrop video: no controls, spinner or error overlay, no context menu, `aria-hidden`. Turns on `autoplay`, `muted` and `loop` unless they are set.',
      control: 'boolean',
      table: { category: categories.playback },
    },

    // Layout
    widescreen: {
      description:
        'Fixed 16:9 frame: media of any other shape is letterboxed or pillarboxed inside it, so the box never changes size.',
      control: 'boolean',
      table: { category: categories.layout },
    },
    fluid: {
      description:
        "Take the container's full width and follow the media's aspect ratio. Off: the player is laid out at the media's pixel size. Ignored for the box size when `widescreen` is on.",
      control: 'boolean',
      table: { category: categories.layout },
    },

    // Controls
    hideControls: {
      description: 'Hide the control bar entirely.',
      control: 'boolean',
      table: { category: categories.controls },
    },
    hidePlayButton: {
      description: 'Hide the large centre play button (the poster stays visible).',
      control: 'boolean',
      table: { category: categories.controls },
    },
    showProgressDot: {
      description: 'Show the scrubber dot at the head of the progress bar.',
      control: 'boolean',
      table: { category: categories.controls },
    },
    showVolumeDot: {
      description: 'Show the handle dot at the head of the volume bar.',
      control: 'boolean',
      table: { category: categories.controls },
    },

    // Picture-in-Picture
    pip: {
      description: 'Show the Picture-in-Picture button in the control bar.',
      control: 'boolean',
      table: { category: categories.pip },
    },
    pipPlaceholderText: {
      description:
        "Text of the placeholder that holds the player's space while it floats in PiP. Unset: a translated default. An empty string leaves the placeholder blank.",
      control: 'text',
      table: { category: categories.pip },
    },

    // Settings menu
    settings: {
      description:
        'Show the settings (gear) menu. It still hides itself when it has nothing to offer (no speed section and fewer than 2 quality levels).',
      control: 'boolean',
      table: { category: categories.settings },
    },
    hideSpeed: {
      description: 'Hide the "Playback speed" section of the settings menu.',
      control: 'boolean',
      table: { category: categories.settings },
    },
    playbackRates: {
      description: 'Playback-speed steps offered in the settings menu.',
      control: 'object',
      table: { category: categories.settings },
    },

    // Quality
    quality: {
      description:
        'Show the "Quality" section of the settings menu (hidden anyway with fewer than 2 quality levels). Try Big Buck Bunny.',
      control: 'boolean',
      table: { category: categories.quality },
    },
    minBandwidth: {
      description:
        'Floor, in bits per second, for the bandwidth estimate "Auto" quality picks a rendition from. Must be > 0 and not above `maxBandwidth`.',
      control: { type: 'number', min: 0, step: 100000 },
      table: { category: categories.quality },
    },
    maxBandwidth: {
      description:
        'Ceiling, in bits per second, for the same estimate, to cap network or CDN usage. Must be > 0.',
      control: { type: 'number', min: 0, step: 100000 },
      table: { category: categories.quality },
    },

    // Text tracks and chapters
    captionSettings: {
      description: 'Show the "captions settings" entry (font, colour, background…) in the subtitles menu.',
      control: 'boolean',
      table: { category: categories.tracks },
    },
    chapters: {
      description:
        'Show the chapters button. It appears only when the source has a chapters track with cues, as Sintel does.',
      control: 'boolean',
      table: { category: categories.tracks },
    },
    chapterMarkers: {
      description:
        'Split the progress bar into one segment per chapter and show the chapter title while hovering it. Only with a chapters track with cues, as Sintel has; not on live streams. Independent of `chapters`.',
      control: 'boolean',
      table: { category: categories.tracks },
    },
    thumbnails: {
      description:
        'Show a thumbnail preview on progress-bar hover when the manifest carries a thumbnail track (neither sample has one, so no visible effect here).',
      control: 'boolean',
      table: { category: categories.tracks },
    },

    // Labels and translations
    language: {
      description:
        "Language of the player's labels, from the dictionaries shipped in `@admmedia/eveplayer/lang/`. Unset: the browser's language, if a dictionary for it is registered.",
      options: ['', ...LANGUAGE_CODES],
      control: { type: 'select', labels: { '': 'Browser language' } },
      table: { category: categories.labels },
    },
    labels: {
      description:
        'Overrides for single labels, keyed by their English text, e.g. `{ "Settings": "Options" }`. They win over any language.',
      control: 'object',
      table: { category: categories.labels },
    },
  },
  parameters: {
    docs: { disable: true },
  },
};

// The library's defaults in the controls table's "Default" column.
const DEFAULT_SUMMARIES: Partial<Record<keyof OptionArgs, string>> = {
  pipPlaceholderText: 'translated default text',
  minBandwidth: 'no floor',
  maxBandwidth: 'no ceiling',
  language: "browser's language",
};
for (const key of OPTION_KEYS) {
  const argType = meta.argTypes?.[key];
  if (!argType) continue;
  argType.table = {
    ...argType.table,
    defaultValue: { summary: DEFAULT_SUMMARIES[key] ?? JSON.stringify(OPTION_DEFAULTS[key]) },
  };
}

export default meta;

type Story = StoryObj<PlaygroundArgs>;

// ---------------------------------------------------------------------------
// The playground: every option is a control.
// ---------------------------------------------------------------------------

/** Every option at its default: change them in the Controls panel. */
export const Playground: Story = {};
