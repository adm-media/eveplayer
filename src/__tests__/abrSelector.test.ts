/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';

// The ABR selector module pulls in EvePlayer.ts, which imports video.js +
// @videojs/http-streaming for their registration side effects. Stub both (this
// suite exercises the pure selector function in isolation, with a hand-built
// `this` shaped like a VHS handler.
vi.mock('video.js', () => {
  const videojs = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (videojs as any).getComponent = vi.fn(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (videojs as any).registerComponent = vi.fn();
  return { default: videojs };
});
vi.mock('@videojs/http-streaming', () => ({}));

import { applyCustomAbrSelector, eveAbrPlaylistSelector } from '../EvePlayer';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface RepInit {
  id: string;
  /** Declared peak bandwidth. */
  bandwidth: number;
  /** AVERAGE-BANDWIDTH manifest attribute, if the manifest carried one. */
  average?: number;
  enabled?: boolean;
}

function makeRep(init: RepInit) {
  const attributes: Record<string, unknown> = { BANDWIDTH: init.bandwidth };
  if (init.average !== undefined) attributes['AVERAGE-BANDWIDTH'] = String(init.average);
  const playlist = { uri: init.id, attributes };
  return {
    id: init.id,
    bandwidth: init.bandwidth,
    playlist,
    enabled: vi.fn(() => init.enabled ?? true),
  };
}

interface HandlerInit {
  reps: ReturnType<typeof makeRep>[];
  measured?: number;
  optionsBandwidth?: number;
  ewma?: number;
  bufferAhead?: number;
  bufferThrows?: boolean;
  currentBandwidth?: number;
}

function makeHandler(init: HandlerInit) {
  const handler: Record<string, unknown> = {
    representations: () => init.reps,
    playlistController_: {
      mainSegmentLoader_: { bandwidth: init.measured ?? 0 },
    },
    options_: init.optionsBandwidth !== undefined ? { bandwidth: init.optionsBandwidth } : {},
    tech_: {
      buffered: () => {
        if (init.bufferThrows) throw new Error('not ready');
        const ahead = init.bufferAhead ?? 0;
        return ahead > 0 ? { length: 1, end: () => ahead } : { length: 0, end: () => 0 };
      },
      currentTime: () => 0,
    },
    playlists: {
      media: () =>
        init.currentBandwidth !== undefined
          ? { attributes: { BANDWIDTH: init.currentBandwidth } }
          : undefined,
    },
  };
  if (init.ewma !== undefined) handler.__abrEwma = init.ewma;
  return handler;
}

const run = (handler: Record<string, unknown>) =>
  eveAbrPlaylistSelector.call(handler as never);

// A 3-rung ladder with AVERAGE-BANDWIDTH, targets 6M / 3M / 0.6M.
const ladder = () => [
  makeRep({ id: 'high', bandwidth: 8_000_000, average: 6_000_000 }),
  makeRep({ id: 'mid', bandwidth: 4_000_000, average: 3_000_000 }),
  makeRep({ id: 'low', bandwidth: 800_000, average: 600_000 }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('eveAbrPlaylistSelector', () => {
  it('returns null when there are no representations', () => {
    expect(run(makeHandler({ reps: [] }))).toBeNull();
  });

  it('returns null when every representation is disabled', () => {
    const reps = ladder().map((r) => {
      r.enabled = vi.fn(() => false);
      return r;
    });
    expect(run(makeHandler({ reps }))).toBeNull();
  });

  it('picks the highest rung whose AVERAGE-BANDWIDTH target is under the estimate', () => {
    const reps = ladder();
    const pick = run(makeHandler({ reps, measured: 6_500_000 }));
    expect(pick).toBe(reps[0].playlist);
  });

  it('clamps the estimate to maxBandwidth', () => {
    const reps = ladder();
    const handler = makeHandler({ reps, measured: 6_500_000 });
    handler.__eveMaxBandwidth = 1_000_000;
    expect(run(handler)).toBe(reps[2].playlist);
  });

  it('raises the estimate to minBandwidth', () => {
    const reps = ladder();
    const handler = makeHandler({ reps, measured: 700_000 });
    handler.__eveMinBandwidth = 6_500_000;
    expect(run(handler)).toBe(reps[0].playlist);
  });

  it('steps down a rung when the estimate only clears the middle target', () => {
    const reps = ladder();
    const pick = run(makeHandler({ reps, measured: 5_000_000 }));
    expect(pick).toBe(reps[1].playlist);
  });

  it('returns the lowest rung when the estimate is under every target', () => {
    const reps = ladder();
    const pick = run(makeHandler({ reps, measured: 100 }));
    expect(pick).toBe(reps[2].playlist);
  });

  it('falls back to a discounted peak (peak * 0.75) when the manifest has no AVERAGE-BANDWIDTH', () => {
    // peak 4M -> target 3M; peak 800k -> target 600k. Estimate 1M clears only the lower target.
    const reps = [
      makeRep({ id: 'mid', bandwidth: 4_000_000 }),
      makeRep({ id: 'low', bandwidth: 800_000 }),
    ];
    expect(run(makeHandler({ reps, measured: 1_000_000 }))).toBe(reps[1].playlist);
  });

  it('weights a falling bandwidth sample heavily (EWMA down-weight 0.7)', () => {
    const handler = makeHandler({ reps: ladder(), measured: 2_000_000, ewma: 6_000_000 });
    run(handler);
    // 0.7 * 2_000_000 + 0.3 * 6_000_000
    expect(handler.__abrEwma).toBe(3_200_000);
  });

  it('weights a rising bandwidth sample lightly (EWMA up-weight 0.45)', () => {
    const handler = makeHandler({ reps: ladder(), measured: 6_000_000, ewma: 2_000_000 });
    run(handler);
    // 0.45 * 6_000_000 + 0.55 * 2_000_000
    expect(handler.__abrEwma).toBe(3_800_000);
  });

  it('uses options_.bandwidth as the estimate when nothing has been measured yet', () => {
    const reps = ladder();
    const pick = run(makeHandler({ reps, measured: 0, optionsBandwidth: 1_000_000 }));
    // 1M clears only the 600k target
    expect(pick).toBe(reps[2].playlist);
  });

  it('uses the built-in default estimate (~4.19 Mbps) when there is no measurement or option', () => {
    const reps = ladder();
    // DEFAULT_INITIAL_BANDWIDTH = 4194304 -> clears the 3M target, not the 6M one
    expect(run(makeHandler({ reps, measured: 0 }))).toBe(reps[1].playlist);
  });

  it('lets a healthy buffer push the pick up a rung', () => {
    const reps = ladder();
    const pick = run(
      makeHandler({
        reps,
        measured: 4_500_000, // raw pick = mid (3M target)
        bufferAhead: 12, // >= HEALTHY_BUFFER_SECONDS
        currentBandwidth: 4_000_000, // currentTarget 3M; raw pick not a downswitch
      })
    );
    // boosted estimate 4.5M * 1.4 = 6.3M clears the 6M target -> high
    expect(pick).toBe(reps[0].playlist);
  });

  it('leaves the pick unchanged when the buffer boost does not clear a higher rung', () => {
    const reps = ladder();
    const pick = run(
      makeHandler({
        reps,
        measured: 1_000_000, // raw + boosted (1.4M) both land on the lowest rung
        bufferAhead: 20,
        currentBandwidth: 800_000,
      })
    );
    expect(pick).toBe(reps[2].playlist);
  });

  it('does not apply the buffer boost when the raw pick is already a downswitch', () => {
    const reps = ladder();
    const pick = run(
      makeHandler({
        reps,
        measured: 4_500_000,
        bufferAhead: 12,
        currentBandwidth: 8_000_000, // currentTarget 6M > raw pick target 3M -> suppressed
      })
    );
    expect(pick).toBe(reps[1].playlist);
  });

  it('swallows a not-ready buffered() call and still returns a pick', () => {
    const reps = ladder();
    const pick = run(makeHandler({ reps, measured: 6_500_000, bufferThrows: true }));
    expect(pick).toBe(reps[0].playlist);
  });

  it('returns null when the handler exposes no representations() function', () => {
    const handler = makeHandler({ reps: ladder() });
    delete (handler as { representations?: unknown }).representations;
    expect(run(handler)).toBeNull();
  });

  it('returns null when the chosen representation has no backing playlist', () => {
    const reps = ladder();
    (reps[0] as { playlist?: unknown }).playlist = undefined;
    // A huge estimate forces the top rung, whose playlist is now missing.
    expect(run(makeHandler({ reps, measured: 100_000_000 }))).toBeNull();
  });

  it('swallows a throwing playlists.media() while computing the buffer boost', () => {
    const reps = ladder();
    const handler = makeHandler({ reps, measured: 4_500_000, bufferAhead: 12 });
    // No active media playlist yet -> media() throws; currentTarget stays 0,
    // so the boost still applies and pushes the pick up to the top rung.
    (handler.playlists as { media: () => unknown }).media = () => {
      throw new Error('no media playlist');
    };
    expect(run(handler)).toBe(reps[0].playlist);
  });
});

describe('applyCustomAbrSelector', () => {
  it('is a no-op when the tech has no vhs handler', () => {
    expect(() => applyCustomAbrSelector(undefined)).not.toThrow();
    expect(() => applyCustomAbrSelector({})).not.toThrow();
  });

  it('assigns the custom selector onto vhs.selectPlaylist', () => {
    const tech = { vhs: {} as { selectPlaylist?: unknown } };
    applyCustomAbrSelector(tech);
    expect(tech.vhs.selectPlaylist).toBe(eveAbrPlaylistSelector);
  });
});
