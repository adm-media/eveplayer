/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Audio-state persistence across a playback-engine reload, tested against the
 * REAL Video.js (this file deliberately does not mock it, unlike
 * EvePlayer.test.ts).
 *
 * What is being guarded against lives inside Video.js, so a mock cannot catch a
 * regression here: reloading the tech replays the options the player was
 * constructed with (`Html5#createEl` re-applies `loop` / `muted` /
 * `playsinline` / `autoplay` from `options_`), and `player.reset()` also wipes
 * the value cache back to volume 1. A player started `muted: true` for autoplay
 * therefore re-muted itself, and lost the viewer's volume, at exactly the point
 * consumers clear the engine between two sources (a pre-live placeholder
 * handing over to the live stream).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { EvePlayer } from '../EvePlayer';

beforeAll(() => {
  // jsdom has no media pipeline; Video.js calls load() while swapping techs and
  // jsdom answers with a "not implemented" dump on stderr. Nothing here depends
  // on it doing anything.
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

const players: EvePlayer[] = [];

function makePlayer(options: ConstructorParameters<typeof EvePlayer>[1]): EvePlayer {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const player = new EvePlayer(container, options);
  players.push(player);
  return player;
}

/** Video.js's own reset, as an app that reaches past the wrapper would call it. */
function resetUnderlyingPlayer(player: EvePlayer): void {
  (player as unknown as { vjs: { reset: () => void } }).vjs.reset();
}

afterEach(() => {
  while (players.length) players.pop()?.dispose();
  document.body.innerHTML = '';
});

describe('mute state across a playback-engine reload', () => {
  it('stays unmuted after reset(), for a player constructed muted for autoplay', () => {
    const player = makePlayer({ autoplay: true, muted: true });
    player.muted = false;

    player.reset();

    expect(player.muted).toBe(false);
  });

  it('stays unmuted even when the engine is reloaded past the wrapper', () => {
    // The stored option is pinned on every volume change, so the mute state
    // survives a reload this class did not initiate.
    const player = makePlayer({ autoplay: true, muted: true });
    player.muted = false;

    resetUnderlyingPlayer(player);

    expect(player.muted).toBe(false);
  });

  it('stays muted when the viewer never unmuted', () => {
    const player = makePlayer({ autoplay: true, muted: true });

    player.reset();

    expect(player.muted).toBe(true);
  });

  it('re-mutes when the app muted the player again before the reset', () => {
    const player = makePlayer({ muted: true });
    player.muted = false;
    player.muted = true;

    player.reset();

    expect(player.muted).toBe(true);
  });
});

describe('volume across a playback-engine reload', () => {
  it('keeps the volume the viewer chose across reset()', () => {
    const player = makePlayer({ muted: true });
    player.muted = false;
    player.volume = 0.3;

    player.reset();

    expect(player.volume).toBeCloseTo(0.3);
  });

  it('keeps a zeroed volume across reset()', () => {
    const player = makePlayer({ muted: true });
    player.volume = 0;

    player.reset();

    expect(player.volume).toBe(0);
  });
});
