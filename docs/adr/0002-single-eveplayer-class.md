# ADR-0002: A single `EvePlayer` class as the only public surface

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

The player is consumed by a downstream application (where it replaced a
commercial player) and will later be consumed by framework wrappers (React,
Vue). Video.js 8 is the engine, but its API is large, only loosely typed (the
available typings do not cover the audio/text track lists, VHS representations,
or most tech internals this needs), and not stable across majors. Consuming code
had been reaching into player internals directly.

## Decision

Export exactly one class, `EvePlayer` (`src/EvePlayer.ts`), plus the
types in `src/types.ts`. `src/index.ts` re-exports only those, under that one
name and no aliases. The class owns one `videojs()`
`Player` instance (`this.vjs`), created against a `<video class="video-js">` it
builds and appends into the `container` passed to the constructor. Every
capability a consumer needs is re-surfaced as a typed method or event; no
Video.js object appears in the public types. Events go through a small typed
`EventEmitter`, and `PlayerEventMap` in `types.ts` is the single source of truth
for what each event carries.

## Alternatives considered

- **Expose the Video.js `Player` (or a subclass) plus thin helpers.** Rejected:
  leaks an unstable, weakly typed API into every consumer, so a Video.js major
  bump is a breaking change for all of them, and the "never touch Video.js"
  guarantee becomes unenforceable.
- **Drop Video.js for a lighter stack (`hls.js` / `dash.js` + a hand-built
  UI).** Rejected: the Video.js control bar, track handling, and skinnable UI
  are most of the value; rebuilding them is out of scope.
- **Keep it as loose helper functions over a shared player instance.**
  Rejected: no owner for lifecycle (dispose, MutationObservers, drag handlers),
  which had already leaked into the consuming application.

## Consequences

**Good**

- One import, one typed API; consumers are insulated from Video.js version
  churn.
- All teardown is in one `dispose()`.
- The class is the seam the planned framework wrappers and any future engine
  swap build on.

**Costs / watch-outs**

- Every Video.js feature a consumer wants must be explicitly wrapped; there is a
  standing "Known API gaps" list (sidecar text tracks, etc.).
- `PlayerEventMap` is kept in step with the actual `emitter.emit(...)` calls by
  hand; nothing enforces it.
- The whole implementation is one large file on purpose (one place to look, at
  the cost of file size).

## History

The single-class shape has been in place since the first implementation. The
class was renamed twice before this package was extracted (`VideoPlayer` to
`EveVideoPlayer`, then `EveVideoPlayer` to `EvePlayer`). Since the package has
no released consumers, neither old name is exported here: `EvePlayer` is the
only name.
