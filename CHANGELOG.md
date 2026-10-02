# Changelog

Every notable change to `@admmedia/eveplayer`, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.2]: https://github.com/adm-media/eveplayer/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/adm-media/eveplayer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/adm-media/eveplayer/releases/tag/v1.0.0
