/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
// Parses the DASH-IF "thumbnail_tile" convention
// (http://dashif.org/guidelines/thumbnail_tile) out of a raw MPD manifest —
// an image AdaptationSet carrying sprite sheets for progress-bar hover
// previews. @videojs/http-streaming / mpd-parser only parse audio/video
// AdaptationSets, so this data is otherwise invisible to VHS and must be
// read from the manifest independently. Scoped to what real encoders emit:
// Number-based SegmentTemplate + an Essential/SupplementalProperty tile
// grid. $Time$-based templates and HLS sidecar tracks are out of scope.

/** One thumbnail image region: a rectangle inside a sprite sheet covering a time span. */
export interface ThumbnailTile {
  /** Start of the span this tile covers, in seconds. */
  startTime: number;
  /** End of the span this tile covers, in seconds. */
  endTime: number;
  /** Absolute URL of the sprite sheet the tile lives in. */
  imageUrl: string;
  /** X offset of the tile within the sprite sheet, in pixels. */
  x: number;
  /** Y offset of the tile within the sprite sheet, in pixels. */
  y: number;
  /** Tile width in pixels. */
  width: number;
  /** Tile height in pixels. */
  height: number;
  /** Full sprite-sheet pixel dimensions `imageUrl` points at, needed to scale the crop up or down. */
  sheetWidth: number;
  sheetHeight: number;
}

const THUMBNAIL_TILE_SCHEME = 'http://dashif.org/guidelines/thumbnail_tile';

function findTileGrid(...elements: (Element | null)[]): { cols: number; rows: number } | null {
  for (const el of elements) {
    if (!el) continue;
    const props = [
      ...Array.from(el.getElementsByTagName('EssentialProperty')),
      ...Array.from(el.getElementsByTagName('SupplementalProperty')),
    ];
    for (const prop of props) {
      if (prop.getAttribute('schemeIdUri') !== THUMBNAIL_TILE_SCHEME) continue;
      const match = prop.getAttribute('value')?.match(/^(\d+)x(\d+)$/);
      if (match) return { cols: Number(match[1]), rows: Number(match[2]) };
    }
  }
  return null;
}

function resolveMediaTemplate(template: string, number: number): string {
  return template
    .replace(/\$Number%0(\d+)d\$/, (_m, width: string) => String(number).padStart(Number(width), '0'))
    .replace(/\$Number\$/, String(number));
}

/**
 * Extract the DASH-IF `thumbnail_tile` sprite track from a raw MPD manifest and
 * expand it into a flat, time-ordered list of {@link ThumbnailTile}s. Returns
 * `[]` when the manifest has no image `AdaptationSet`, no tile-grid property, an
 * unsupported `SegmentTemplate`, or `totalDuration <= 0`.
 *
 * @param mpdXml - The MPD manifest as text.
 * @param mpdUrl - URL the manifest was fetched from, used to resolve relative sprite URLs.
 * @param totalDuration - Media duration in seconds (tiles are generated up to this).
 */
export function parseDashThumbnailTiles(
  mpdXml: string,
  mpdUrl: string,
  totalDuration: number
): ThumbnailTile[] {
  if (!totalDuration || totalDuration <= 0) return [];

  const doc = new DOMParser().parseFromString(mpdXml, 'application/xml');
  const adaptationSet = Array.from(doc.getElementsByTagName('AdaptationSet')).find((el) =>
    (el.getAttribute('mimeType') ?? '').startsWith('image/')
  );
  if (!adaptationSet) return [];

  const representation = adaptationSet.getElementsByTagName('Representation')[0] ?? null;
  const grid = findTileGrid(representation, adaptationSet);
  if (!grid) return [];

  const segmentTemplate =
    representation?.getElementsByTagName('SegmentTemplate')[0] ??
    adaptationSet.getElementsByTagName('SegmentTemplate')[0];
  if (!segmentTemplate) return [];

  const media = segmentTemplate.getAttribute('media');
  const duration = Number(segmentTemplate.getAttribute('duration'));
  const timescale = Number(segmentTemplate.getAttribute('timescale')) || 1;
  const startNumber = Number(segmentTemplate.getAttribute('startNumber') ?? '1');
  if (!media || !duration) return [];

  const repWidth = Number(representation?.getAttribute('width'));
  const repHeight = Number(representation?.getAttribute('height'));
  if (!repWidth || !repHeight) return [];

  const spriteDurationSec = duration / timescale;
  const tileCount = grid.cols * grid.rows;
  const tileDurationSec = spriteDurationSec / tileCount;
  const tileWidth = repWidth / grid.cols;
  const tileHeight = repHeight / grid.rows;

  const tiles: ThumbnailTile[] = [];
  let spriteIndex = startNumber;
  let t = 0;
  while (t < totalDuration) {
    const imageUrl = new URL(resolveMediaTemplate(media, spriteIndex), mpdUrl).href;
    for (let i = 0; i < tileCount && t < totalDuration; i++) {
      const col = i % grid.cols;
      const row = Math.floor(i / grid.cols);
      tiles.push({
        startTime: t,
        endTime: Math.min(t + tileDurationSec, totalDuration),
        imageUrl,
        x: col * tileWidth,
        y: row * tileHeight,
        width: tileWidth,
        height: tileHeight,
        sheetWidth: repWidth,
        sheetHeight: repHeight,
      });
      t += tileDurationSec;
    }
    spriteIndex++;
  }
  return tiles;
}

/**
 * Binary-search a sorted {@link ThumbnailTile} list for the tile covering
 * `time` (seconds). Returns `null` if `time` falls outside every tile.
 */
export function findThumbnailTile(tiles: ThumbnailTile[], time: number): ThumbnailTile | null {
  let lo = 0;
  let hi = tiles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tile = tiles[mid];
    if (time < tile.startTime) hi = mid - 1;
    else if (time >= tile.endTime) lo = mid + 1;
    else return tile;
  }
  return null;
}
