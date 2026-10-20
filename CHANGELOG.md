# Changelog

Every notable change to `@admmedia/eveplayer`, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Chapters on the timeline: with a `kind: 'chapters'` text track, the progress
  bar is split into one segment per chapter and hovering it shows the chapter
  title above the time. On by default; `chapterMarkers: false` turns it off,
  independently of the chapters button. The gap between segments is the
  `--eve-chapter-gap` CSS variable (default `2px`). Not shown on live streams.

### Fixed

- The thumbnail preview no longer covers the time shown while hovering the
  progress bar: it now sits above it.

## [1.1.0] - 2026-10-12

### Added

- Every label the player shows can now be translated: the settings menu
  ("Quality", "Playback speed", "Normal", "Automatic (1080p)", …) and the PiP
  window go through the same dictionaries as the labels inherited from
  Video.js, which they used to bypass.
- Ready-made dictionaries for 53 languages in `dist/lang/`, importable as
  `@admmedia/eveplayer/lang/<code>.json` and registered with
  `EvePlayer.addLanguage()`. Each one merges the Video.js translation with the
  player's own labels; the player's own are complete in Italian and stay in
  English elsewhere until translated (CONTRIBUTING explains how to add a
  language).
- `labels` option and `setLabels()`, to override single labels on one player
  whatever its language, including the Video.js ones ("Play", "Mute", …).
  `setLabels()` updates the labels already on screen.
- `CHANGELOG.md`, shipped in the package.

### Changed

- The PiP button's tooltip reads "Picture-in-Picture" instead of "Picture in
  Picture", the text Video.js translates.

## [1.0.2] - 2026-10-01

### Fixed

- `widescreen` now fills its 16:9 frame for media of any shape: a non-16:9
  video is letterboxed or pillarboxed inside the frame instead of leaving an
  empty band below it (`fluid`) or overflowing it (`fluid: false`). An
  audio-only source collapses the frame to the control bar.
- `THIRD_PARTY_NOTICES.txt` named the licence of packages that use the legacy
  `licenses` field as "undefined".

## [1.0.1] - 2026-09-30

### Added

- `dist/THIRD_PARTY_NOTICES.txt`, with the copyright notice and licence text of
  every third-party package bundled into `dist/`, as their licences require.
  `NOTICE` lists them and the stylesheet credits the Video.js skin and icon
  font it includes.
- `./package.json` in the exports map, so tools that read the package manifest
  through `require()` can resolve it.

## [1.0.0] - 2026-09-30

First public release.

[1.1.0]: https://github.com/adm-media/eveplayer/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/adm-media/eveplayer/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/adm-media/eveplayer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/adm-media/eveplayer/releases/tag/v1.0.0
