/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { findThumbnailTile, parseDashThumbnailTiles, type ThumbnailTile } from '../dashThumbnails';

const MPD_URL = 'https://video.isplora.com/job152/356/trailer/manifest.mpd';

// Trimmed real-world manifest (DASH-IF thumbnail_tile AdaptationSet plus a
// video AdaptationSet that must be ignored).
const MPD_WITH_THUMBNAILS = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1M2.562S">
  <Period start="PT0S" duration="PT1M2.562S" id="1">
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="1000000" width="1920" height="1080" codecs="avc1.640028"/>
    </AdaptationSet>
    <AdaptationSet mimeType="image/jpeg" contentType="image">
      <SegmentTemplate media="Thumbnail_$Number%09d$.jpg" duration="2432430" timescale="90000" startNumber="1"/>
      <Representation bandwidth="24549" id="thumbnails312x176" width="936" height="528">
        <EssentialProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="3x3"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const MPD_WITHOUT_THUMBNAILS = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1M2.562S">
  <Period start="PT0S" duration="PT1M2.562S" id="1">
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="1000000" width="1920" height="1080" codecs="avc1.640028"/>
    </AdaptationSet>
  </Period>
</MPD>`;

const MPD_WITH_IMAGE_BUT_NO_TILE_GRID = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1M2.562S">
  <Period start="PT0S" duration="PT1M2.562S" id="1">
    <AdaptationSet mimeType="image/jpeg" contentType="image">
      <SegmentTemplate media="Thumbnail_$Number%09d$.jpg" duration="2432430" timescale="90000" startNumber="1"/>
      <Representation bandwidth="24549" id="thumbnails312x176" width="936" height="528"/>
    </AdaptationSet>
  </Period>
</MPD>`;

// Grid property lives on the AdaptationSet (not a Representation), an unrelated
// EssentialProperty precedes it, and there is no <Representation> at all, so
// findTileGrid must skip the null element and the mismatched scheme, and the
// width/height lookup must fail gracefully.
const MPD_GRID_ON_ADAPTATIONSET_NO_REPRESENTATION = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1M">
  <Period>
    <AdaptationSet contentType="text"></AdaptationSet>
    <AdaptationSet mimeType="image/jpeg">
      <EssentialProperty schemeIdUri="urn:something:else" value="nope"/>
      <EssentialProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="3x3"/>
      <SegmentTemplate media="T_$Number%09d$.jpg" duration="2432430" timescale="90000" startNumber="1"/>
    </AdaptationSet>
  </Period>
</MPD>`;

const MPD_IMAGE_WITH_GRID_BUT_NO_SEGMENT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1M">
  <Period><AdaptationSet mimeType="image/jpeg">
    <Representation bandwidth="1" id="t" width="936" height="528">
      <EssentialProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="3x3"/>
    </Representation>
  </AdaptationSet></Period>
</MPD>`;

const MPD_SEGMENT_TEMPLATE_MISSING_MEDIA = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1M">
  <Period><AdaptationSet mimeType="image/jpeg">
    <SegmentTemplate duration="2432430" timescale="90000" startNumber="1"/>
    <Representation bandwidth="1" id="t" width="936" height="528">
      <EssentialProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="3x3"/>
    </Representation>
  </AdaptationSet></Period>
</MPD>`;

const MPD_REPRESENTATION_MISSING_DIMENSIONS = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1M">
  <Period><AdaptationSet mimeType="image/jpeg">
    <SegmentTemplate media="T_$Number%09d$.jpg" duration="2432430" timescale="90000" startNumber="1"/>
    <Representation bandwidth="1" id="t">
      <EssentialProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="3x3"/>
    </Representation>
  </AdaptationSet></Period>
</MPD>`;

// A source that IS parseable, but with a plain `$Number$` template (no zero-pad)
// and the grid on a SupplementalProperty rather than an EssentialProperty.
const MPD_PLAIN_NUMBER_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT30S">
  <Period><AdaptationSet mimeType="image/jpeg">
    <SegmentTemplate media="tile-$Number$.jpg" duration="900000" timescale="90000" startNumber="1"/>
    <Representation bandwidth="1" id="t" width="200" height="100">
      <SupplementalProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="2x1"/>
    </Representation>
  </AdaptationSet></Period>
</MPD>`;

// media + duration present, but timescale and startNumber omitted -> the
// parser must fall back to timescale 1 and startNumber 1.
const MPD_SEGMENT_TEMPLATE_DEFAULTS = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT20S">
  <Period><AdaptationSet mimeType="image/jpeg">
    <SegmentTemplate media="s-$Number$.jpg" duration="10"/>
    <Representation bandwidth="1" id="t" width="100" height="100">
      <EssentialProperty schemeIdUri="http://dashif.org/guidelines/thumbnail_tile" value="1x1"/>
    </Representation>
  </AdaptationSet></Period>
</MPD>`;

describe('parseDashThumbnailTiles', () => {
  it('returns [] when there is no image AdaptationSet', () => {
    expect(parseDashThumbnailTiles(MPD_WITHOUT_THUMBNAILS, MPD_URL, 62.562)).toEqual([]);
  });

  it('returns [] when the image AdaptationSet has no thumbnail_tile grid property', () => {
    expect(parseDashThumbnailTiles(MPD_WITH_IMAGE_BUT_NO_TILE_GRID, MPD_URL, 62.562)).toEqual([]);
  });

  it('returns [] when totalDuration is not known yet', () => {
    expect(parseDashThumbnailTiles(MPD_WITH_THUMBNAILS, MPD_URL, 0)).toEqual([]);
  });

  it('returns [] when totalDuration is negative', () => {
    expect(parseDashThumbnailTiles(MPD_WITH_THUMBNAILS, MPD_URL, -5)).toEqual([]);
  });

  it('reads the grid off the AdaptationSet, skipping a null element and a mismatched scheme, then bails with no Representation dimensions', () => {
    expect(
      parseDashThumbnailTiles(MPD_GRID_ON_ADAPTATIONSET_NO_REPRESENTATION, MPD_URL, 60)
    ).toEqual([]);
  });

  it('returns [] when the image AdaptationSet has a grid but no SegmentTemplate', () => {
    expect(parseDashThumbnailTiles(MPD_IMAGE_WITH_GRID_BUT_NO_SEGMENT_TEMPLATE, MPD_URL, 60)).toEqual(
      []
    );
  });

  it('returns [] when the SegmentTemplate has no media attribute', () => {
    expect(parseDashThumbnailTiles(MPD_SEGMENT_TEMPLATE_MISSING_MEDIA, MPD_URL, 60)).toEqual([]);
  });

  it('returns [] when the Representation has no width/height', () => {
    expect(parseDashThumbnailTiles(MPD_REPRESENTATION_MISSING_DIMENSIONS, MPD_URL, 60)).toEqual([]);
  });

  it('defaults timescale to 1 and startNumber to 1 when the SegmentTemplate omits them', () => {
    const tiles = parseDashThumbnailTiles(MPD_SEGMENT_TEMPLATE_DEFAULTS, MPD_URL, 20);
    expect(tiles.length).toBeGreaterThan(0);
    // 1x1 grid, sprite duration = 10/1 = 10s per tile; first sprite is number 1.
    expect(tiles[0].imageUrl).toMatch(/s-1\.jpg$/);
    expect(tiles[0].startTime).toBe(0);
    expect(tiles[0].endTime).toBe(10);
  });

  it('parses a plain $Number$ template with the grid on a SupplementalProperty', () => {
    const tiles = parseDashThumbnailTiles(MPD_PLAIN_NUMBER_TEMPLATE, MPD_URL, 30);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles[0].imageUrl).toMatch(/tile-1\.jpg$/);
    expect(tiles[0].width).toBeCloseTo(100); // 200 / 2 cols
    expect(tiles[0].height).toBeCloseTo(100); // 100 / 1 row
  });

  it('parses the tile grid, timing, and sprite geometry from a real manifest', () => {
    const tiles = parseDashThumbnailTiles(MPD_WITH_THUMBNAILS, MPD_URL, 62.562);

    // spriteDuration = 2432430/90000 = 27.027s, 9 tiles/sprite => ~3.003s/tile
    // 62.562s of video => 3 sprites (ceil(62.562 / 27.027) = 3), 9 tiles each up to the duration cutoff
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles[tiles.length - 1].endTime).toBe(62.562);

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

    // second sprite image kicks in once the first sprite's 9 tiles are exhausted
    const tenth = tiles[9];
    expect(tenth.imageUrl).toBe(
      'https://video.isplora.com/job152/356/trailer/Thumbnail_000000002.jpg'
    );
  });
});

describe('findThumbnailTile', () => {
  const tiles: ThumbnailTile[] = [
    { startTime: 0, endTime: 3, imageUrl: 'a.jpg', x: 0, y: 0, width: 10, height: 10, sheetWidth: 30, sheetHeight: 10 },
    { startTime: 3, endTime: 6, imageUrl: 'a.jpg', x: 10, y: 0, width: 10, height: 10, sheetWidth: 30, sheetHeight: 10 },
    { startTime: 6, endTime: 9, imageUrl: 'a.jpg', x: 20, y: 0, width: 10, height: 10, sheetWidth: 30, sheetHeight: 10 },
  ];

  it('finds the tile covering a given time', () => {
    expect(findThumbnailTile(tiles, 0)).toBe(tiles[0]);
    expect(findThumbnailTile(tiles, 4)).toBe(tiles[1]);
    expect(findThumbnailTile(tiles, 8.9)).toBe(tiles[2]);
  });

  it('returns null when time is out of range', () => {
    expect(findThumbnailTile(tiles, -1)).toBeNull();
    expect(findThumbnailTile(tiles, 9)).toBeNull();
    expect(findThumbnailTile([], 0)).toBeNull();
  });
});
