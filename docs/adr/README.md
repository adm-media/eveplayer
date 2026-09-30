# Architecture Decision Records

One file per decision that had a real trade-off and rejected alternatives worth
remembering. **Not** a record of every change — settled, uncontested choices
live in `docs/architecture.md`.

Convention:

- `NNNN-kebab-title.md`, numbered in order, zero-padded to 4.
- Once merged, an ADR is **immutable**. Minor follow-ups: append a dated
  `## Update` section. A changed approach: write a new ADR that says
  `Supersedes ADR-NNNN` and set the old one's status to `Superseded by NNNN`.
- Status: `Accepted` | `Superseded by NNNN` | `Deprecated`.

Template:

```markdown
# ADR-NNNN: <title>

- **Status:** Accepted
- **Date:** YYYY-MM-DD

## Context
What forced a decision. Constraints, observations, what upstream does.

## Decision
What we chose, stated so someone can act on it.

## Alternatives considered
Each option and why it lost.

## Consequences
What this makes easy, what it makes harder, what to watch for.

## History
Commits / prior attempts, so the reversals are not mistaken for the plan.
```

## Index

- [ADR-0001](0001-custom-abr-auto-quality-selection.md) — Custom ABR / "Auto"
  quality selection instead of VHS's built-in selectors
- [ADR-0002](0002-single-eveplayer-class.md) — A single `EvePlayer` class
  as the only public surface
- [ADR-0003](0003-overridenative-js-playback.md) — `overrideNative`: JS (MSE)
  playback via VHS on Chromium/Firefox, native HLS on Safari/iOS
- [ADR-0004](0004-css-pip-overlay.md) — Picture-in-Picture as a CSS floating
  overlay, not the native API
- [ADR-0005](0005-hand-built-settings-menu-and-menu-hoisting.md) — Hand-built
  settings flyout, and hoisting the native track menus
- [ADR-0006](0006-bundle-vhs-sync-workers.md) — Bundle `@videojs/http-streaming`
  into `dist/`, pinned to the `sync-workers` build
