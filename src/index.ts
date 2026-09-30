/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `@admmedia/eveplayer`: public entry point.
 *
 * Exports the {@link EvePlayer} class and the public type surface. Nothing
 * else from the package is considered public API.
 *
 * @packageDocumentation
 */

export { EvePlayer } from './EvePlayer';
export type {
  AudioTrack,
  Bookmark,
  ChapterCue,
  LanguageDictionary,
  PlayerError,
  PlayerErrorCategory,
  PlayerEventMap,
  PlaybackStats,
  PlayerOptions,
  PlayerSize,
  QualityLevel,
  SourceDescription,
  SourceItem,
  SourceTextTrack,
  TextTrack,
  TextTrackKind,
} from './types';
