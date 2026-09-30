/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
// Parses HLS image-based trick-play tags — EXT-X-IMAGE-STREAM-INF in the
// master playlist, EXT-X-TILES + EXTINF in the child image playlist it
// references — into the same tile-sprite shape dashThumbnails.ts produces,
// for progress-bar hover previews. @videojs/http-streaming's m3u8 parser
// only surfaces audio/video renditions, so this reads both playlists
// independently, mirroring dashThumbnails.ts's DASH-IF thumbnail_tile
// reader.
//
// Tag shapes follow the "Image Media Playlist" spec (v0.4, Disney/Warner
// Media) that AWS MediaConvert/MediaPackage/MediaLive document themselves
// against: EXT-X-IMAGE-STREAM-INF(BANDWIDTH, RESOLUTION, CODECS, URI) in the
// parent, then EXT-X-TILES(RESOLUTION, LAYOUT, DURATION) + one EXTINF/URI
// pair per tile-sheet JPEG in the child. This has not yet been cross-checked
// against a real MediaConvert-emitted manifest (only against the published
// spec and MediaPackage's documented example) — re-verify tag/attribute
// names against an actual output before relying on it in production.
//
// Scoped to what the spec's tiled case emits: an EXT-X-TILES grid declared
// once (or re-declared) ahead of the segment list. A child playlist with no
// EXT-X-TILES at all (single full-frame image per segment, "1x1") is out of
// scope, same as $Time$-based DASH templates are out of scope in
// dashThumbnails.ts.

import type { ThumbnailTile } from './dashThumbnails';

const IMAGE_STREAM_INF = '#EXT-X-IMAGE-STREAM-INF:';
const TILES_TAG = '#EXT-X-TILES:';
const EXTINF_TAG = '#EXTINF:';

function parseAttributeList(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    attrs[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return attrs;
}

function resolveUrl(ref: string, baseUrl: string): string {
  return new URL(ref, baseUrl).href;
}

function findImagePlaylistUrl(masterText: string, masterUrl: string): string | null {
  for (const line of masterText.split(/\r?\n/)) {
    if (!line.startsWith(IMAGE_STREAM_INF)) continue;
    const attrs = parseAttributeList(line.slice(IMAGE_STREAM_INF.length));
    if (attrs.URI) return resolveUrl(attrs.URI, masterUrl);
  }
  return null;
}

function parseImagePlaylist(
  text: string,
  playlistUrl: string,
  totalDuration: number
): ThumbnailTile[] {
  const tiles: ThumbnailTile[] = [];
  let t = 0;
  let grid: { cols: number; rows: number } | null = null;
  let sheetWidth = 0;
  let sheetHeight = 0;
  let tileDuration = 0;
  let pendingExtinf: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith(TILES_TAG)) {
      const attrs = parseAttributeList(line.slice(TILES_TAG.length));
      const resolution = attrs.RESOLUTION?.match(/^(\d+)x(\d+)$/);
      const layout = attrs.LAYOUT?.match(/^(\d+)x(\d+)$/);
      if (resolution) {
        sheetWidth = Number(resolution[1]);
        sheetHeight = Number(resolution[2]);
      }
      grid = layout ? { cols: Number(layout[1]), rows: Number(layout[2]) } : null;
      tileDuration = attrs.DURATION ? Number(attrs.DURATION) : 0;
      continue;
    }

    if (line.startsWith(EXTINF_TAG)) {
      const value = Number(line.slice(EXTINF_TAG.length).split(',')[0]);
      pendingExtinf = Number.isFinite(value) ? value : null;
      continue;
    }

    if (!line || line.startsWith('#')) continue;

    // Non-comment, non-empty line following EXTINF: the tile-sheet image URI.
    const extinf = pendingExtinf;
    pendingExtinf = null;
    if (!grid || !sheetWidth || !sheetHeight || t >= totalDuration) continue;

    const tileCount = grid.cols * grid.rows;
    const perTileDuration = tileDuration || (extinf ? extinf / tileCount : 0);
    if (!perTileDuration) continue;

    const imageUrl = resolveUrl(line, playlistUrl);
    const tileWidth = sheetWidth / grid.cols;
    const tileHeight = sheetHeight / grid.rows;
    for (let i = 0; i < tileCount && t < totalDuration; i++) {
      const col = i % grid.cols;
      const row = Math.floor(i / grid.cols);
      tiles.push({
        startTime: t,
        endTime: Math.min(t + perTileDuration, totalDuration),
        imageUrl,
        x: col * tileWidth,
        y: row * tileHeight,
        width: tileWidth,
        height: tileHeight,
        sheetWidth,
        sheetHeight,
      });
      t += perTileDuration;
    }
  }

  return tiles;
}

/**
 * Fetches the HLS image (trick-play) child playlist referenced by a master
 * playlist's `EXT-X-IMAGE-STREAM-INF` tag and parses it into thumbnail
 * tiles. Returns `[]` (never rejects on a missing/malformed track — a
 * manifest without an image stream is a normal case) unless the child
 * playlist fetch itself fails, which the caller is expected to catch.
 */
export async function parseHlsThumbnailTiles(
  masterM3u8: string,
  masterUrl: string,
  totalDuration: number
): Promise<ThumbnailTile[]> {
  if (!totalDuration || totalDuration <= 0) return [];
  const imagePlaylistUrl = findImagePlaylistUrl(masterM3u8, masterUrl);
  if (!imagePlaylistUrl) return [];
  const res = await fetch(imagePlaylistUrl);
  const text = await res.text();
  return parseImagePlaylist(text, imagePlaylistUrl, totalDuration);
}
