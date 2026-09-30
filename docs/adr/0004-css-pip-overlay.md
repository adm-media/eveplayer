# ADR-0004: Picture-in-Picture as a CSS floating overlay, not the native API

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Consumers want a "pop the video out and keep it visible while scrolling"
affordance. The browser Picture-in-Picture API gives an OS-level floating
window, but it cannot be styled or positioned by the page, its open/close UX
differs per browser, Firefox's implementation diverges, it detaches the video
from page layout entirely, and it is unavailable or restricted in several
embedding contexts.

## Decision

Implement PiP entirely in the page. `requestPip()` adds `vjsp-pip-active` to the
container; `style.css` makes it `position: fixed` in the bottom-right. A restore
button is injected into the floating window, and pointer-event handlers make it
draggable (writing inline `right` / `bottom`, clamped to ≥ 8px, ignoring drags
that start on the control bar or restore button). The native path is actively
disabled: the `<video>` carries `disablePictureInPicture` and the native PiP
button is removed from the control bar. `isPip` reads the class; `pipchange`
fires on both transitions; `exitPip()` clears the inline overrides and removes
the injected button.

Because the container goes `position: fixed` and leaves the flow, `requestPip()`
first inserts a same-size in-flow placeholder (`.vjsp-pip-placeholder`, sized in
px from the container's rect at that instant) so surrounding page content keeps
its position. It shows the `pipPlaceholderText` option centred (default
`'Video is playing in picture-in-picture'`; empty string = blank but still
space-reserving). `exitPip()` removes it.

## Alternatives considered

- **Native `requestPictureInPicture()`.** Rejected: no styling or positioning
  control, inconsistent cross-browser UX, breaks in-page layout, restricted in
  some embeds; the floating window would not match the player skin. The design
  calls for an in-page mini-player anchored to the layout, which the native API
  cannot produce.
- **Native with a CSS fallback.** Rejected: two behaviours to build, test, and
  document, and the native one still can't sit where the design wants it.
- **A portal/component in a framework wrapper.** Rejected: PiP has to work for
  the bare library and every framework wrapper, so it belongs in the core.

## Consequences

**Good**

- Full control of size, position, drag, and styling; the floating player is the
  same DOM and skin as inline.
- Identical behaviour on every browser and in embeds where the native API is
  blocked.
- No permission prompts or browser-chrome surprises.

**Costs / watch-outs**

- The overlay lives in the page: it does not survive a tab switch or minimise,
  and the viewport clips it (an OS window would not).
- `position: fixed` is broken by any ancestor with `transform` / `filter` /
  `will-change`; consumers with such wrappers need to know.
- Drag state is inline styles on the container; anything else writing
  `right` / `bottom` on it fights PiP.
- The placeholder is sized once, in px, at activation — it does not track the
  player's responsive size if the viewport is resized while PiP is open.
- No OS integration (no global media-controls PiP button, no system-level move
  between displays).

## History

The `vjsp-pip-active` overlay and pointer drag have been present since the first
implementation, refined through later UI passes.
