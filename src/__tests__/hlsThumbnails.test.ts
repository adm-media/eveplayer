/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHlsThumbnailTiles } from '../hlsThumbnails';

const MASTER_URL = 'https://video.isplora.com/job152/356/trailer/master.m3u8';

const MASTER_WITH_IMAGE_STREAM = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5931112,RESOLUTION=1920x1080
video.m3u8
#EXT-X-IMAGE-STREAM-INF:BANDWIDTH=131436,RESOLUTION=936x528,CODECS="jpeg",URI="thumbnails.m3u8"
`;

const MASTER_WITHOUT_IMAGE_STREAM = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5931112,RESOLUTION=1920x1080
video.m3u8
`;

// Trimmed to two tile-sheets (9 tiles each, 3x3 grid) — mirrors the DASH
// fixture's 312x176-per-tile geometry (936/3 x 528/3).
const IMAGE_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:28
#EXT-X-IMAGES-ONLY
#EXT-X-TILES:RESOLUTION=936x528,LAYOUT=3x3,DURATION=3.003
#EXTINF:27.027,
Thumbnail_000000001.jpg
#EXT-X-TILES:RESOLUTION=936x528,LAYOUT=3x3,DURATION=3.003
#EXTINF:27.027,
Thumbnail_000000002.jpg
#EXT-X-ENDLIST
`;

function stubFetch(text: string) {
  const fetchMock = vi.fn(() => Promise.resolve({ text: () => Promise.resolve(text) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('parseHlsThumbnailTiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns [] and never fetches when the master has no EXT-X-IMAGE-STREAM-INF', async () => {
    const fetchMock = stubFetch(IMAGE_PLAYLIST);
    expect(await parseHlsThumbnailTiles(MASTER_WITHOUT_IMAGE_STREAM, MASTER_URL, 54.054)).toEqual(
      []
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] and never fetches when totalDuration is not known yet', async () => {
    const fetchMock = stubFetch(IMAGE_PLAYLIST);
    expect(await parseHlsThumbnailTiles(MASTER_WITH_IMAGE_STREAM, MASTER_URL, 0)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the child image playlist resolved against the master URL', async () => {
    const fetchMock = stubFetch(IMAGE_PLAYLIST);
    await parseHlsThumbnailTiles(MASTER_WITH_IMAGE_STREAM, MASTER_URL, 54.054);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://video.isplora.com/job152/356/trailer/thumbnails.m3u8'
    );
  });

  it('parses the tile grid, timing, and sprite geometry from a real-shaped manifest', async () => {
    stubFetch(IMAGE_PLAYLIST);
    const tiles = await parseHlsThumbnailTiles(MASTER_WITH_IMAGE_STREAM, MASTER_URL, 54.054);

    expect(tiles.length).toBe(18); // 2 sheets x 9 tiles
    expect(tiles[tiles.length - 1].endTime).toBeCloseTo(54.054);

    const first = tiles[0];
    expect(first.startTime).toBe(0);
    expect(first.x).toBe(0);
    expect(first.y).toBe(0);
    expect(first.width).toBeCloseTo(936 / 3);
    expect(first.height).toBeCloseTo(528 / 3);
    expect(first.imageUrl).toBe(
      'https://video.isplora.com/job152/356/trailer/Thumbnail_000000001.jpg'
    );

    // second tile in the grid (col 1, row 0) starts right after the first ends
    const second = tiles[1];
    expect(second.startTime).toBeCloseTo(first.endTime);
    expect(second.x).toBeCloseTo(936 / 3);
    expect(second.y).toBe(0);

    // 4th tile (index 3) is the first of the second row
    const fourth = tiles[3];
    expect(fourth.x).toBe(0);
    expect(fourth.y).toBeCloseTo(528 / 3);

    // second sheet kicks in once the first sheet's 9 tiles are exhausted
    const tenth = tiles[9];
    expect(tenth.imageUrl).toBe(
      'https://video.isplora.com/job152/356/trailer/Thumbnail_000000002.jpg'
    );
  });

  it('truncates the last tile to totalDuration', async () => {
    stubFetch(IMAGE_PLAYLIST);
    const tiles = await parseHlsThumbnailTiles(MASTER_WITH_IMAGE_STREAM, MASTER_URL, 10);

    expect(tiles[tiles.length - 1].endTime).toBe(10);
  });

  it('skips an EXT-X-IMAGE-STREAM-INF without a URI and never fetches', async () => {
    const fetchMock = stubFetch(IMAGE_PLAYLIST);
    const master = `#EXTM3U
#EXT-X-IMAGE-STREAM-INF:BANDWIDTH=131436,RESOLUTION=936x528,CODECS="jpeg"
`;
    expect(await parseHlsThumbnailTiles(master, MASTER_URL, 54.054)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('derives the per-tile duration from EXTINF when EXT-X-TILES has no DURATION', async () => {
    stubFetch(`#EXTM3U
#EXT-X-TILES:RESOLUTION=936x528,LAYOUT=3x3
#EXTINF:27,
Thumbnail_000000001.jpg
`);
    const tiles = await parseHlsThumbnailTiles(MASTER_WITH_IMAGE_STREAM, MASTER_URL, 27);

    expect(tiles.length).toBe(9);
    expect(tiles[0].endTime).toBeCloseTo(3);
  });

  it('emits no tiles when neither DURATION nor a numeric EXTINF gives a tile duration', async () => {
    stubFetch(`#EXTM3U
#EXT-X-TILES:RESOLUTION=936x528,LAYOUT=3x3
#EXTINF:not-a-number,
Thumbnail_000000001.jpg
`);
    expect(await parseHlsThumbnailTiles(MASTER_WITH_IMAGE_STREAM, MASTER_URL, 27)).toEqual([]);
  });

  it('emits no tiles when EXT-X-TILES has neither RESOLUTION nor LAYOUT', async () => {
    stubFetch(`#EXTM3U
#EXT-X-TILES:DURATION=3
#EXTINF:27,
Thumbnail_000000001.jpg
`);
    expect(await parseHlsThumbnailTiles(MASTER_WITH_IMAGE_STREAM, MASTER_URL, 27)).toEqual([]);
  });
});
