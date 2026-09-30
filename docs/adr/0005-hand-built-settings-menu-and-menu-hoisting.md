# ADR-0005: Hand-built settings flyout, and hoisting the native track menus

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

The player needs a settings menu (quality, playback speed) and restyled
audio-track / subs-caps menus that all match one design: a stacked flyout
anchored to the player's bottom-right, dark translucent panel, drill-in
sub-panels with a back arrow (the pattern established by YouTube and other
mature players).

Video.js gives menus only as `MenuButton` popups that live *inside* their
control-bar button. The base skin opens them on hover via a button-descendant
selector (`.vjs-workinghover .vjs-menu-button-popup.vjs-hover .vjs-menu`), they
inherit button-local positioning, and `MenuButton.update()` rebuilds the menu
from scratch inside the button on every track-list change. The earlier approach
was an inline "Auto"-text quality button (`.vjsp-quality-menu`,
`.vjsp-quality-item`) styled in place, which could not be made to share layout
or behaviour with the native audio/subs menus.

## Decision

**Settings flyout, built by hand** (`_renderSettings`). `.vjsp-settings-menu` is
a sibling of the control bar, anchored by a hardcoded `right: 6px`, re-rendered
from scratch on every level change (`_settingsLevel: 'root' | 'quality' |
'speed'`) and on external quality/rate changes while open (`_syncSettingsMenu`).
The root shows one row per section with its current value; each drills into a
sub-panel. Sections appear conditionally (Quality only with ≥ 2 VHS renditions
and `quality !== false`; Speed unless `hideSpeed`); the gear itself is added
only if a section could show and `settings !== false`. Video.js's native
`playbackRateMenuButton` is always removed.

**Native track menus, hoisted** (`_hoistNativeMenus`, called from `ready()`).
The native audio-track and subs/caps popup menus are re-parented out of their
button to the player root and tagged `.vjsp-hoisted-menu`; `style.css` then
styles them to match the settings flyout (same panel, same `right: 6px` anchor,
left-aligned rows, accent checkmark). A per-button `MutationObserver` re-hoists
the menu whenever `MenuButton.update()` rebuilds it; observers are disconnected
in `dispose()`. Because the base skin's hover-open rule is a button-descendant
selector, moving the menu out makes it **click-only** for free (click toggles
`.vjs-lock-showing` on the menu element directly). Track switching and VTT
rendering stay Video.js's own. `userinactive` closes the flyout and unpresses
open native menus so nothing floats over a chromeless video.

## Alternatives considered

- **Style Video.js's native `MenuButton` popups in place.** Rejected: they
  can't be positioned to a shared bottom-right anchor from inside the button,
  hover-open can't be turned off without fighting the skin selector, and the
  settings menu (quality + speed in one stack) has no native equivalent.
- **A menu component from a library.** Rejected: still has to interoperate with
  Video.js's own audio/subs menus and their `update()` rebuilds; two menu
  systems on screen.
- **Fork the Video.js skin.** Rejected: a standing maintenance cost against
  every Video.js release for what a handful of scoped overrides achieve.
- **Keep the old inline "Auto" quality button.** Rejected: no path to one menu
  system covering quality, speed, audio, and subtitles.

## Consequences

**Good**

- One visual menu system for quality, speed, audio tracks, and subtitles.
- All popups open in the same place and are click-only, so nothing lingers over
  a faded-out player.
- Track switching / rendering is still Video.js's, so no regression there.

**Costs / watch-outs**

- We fight the base skin: every override is `.video-js`-qualified to beat base
  specificity, and a Video.js skin change can shift what needs overriding.
- The `MutationObserver` re-hoist is load-bearing — if `MenuButton.update()`'s
  DOM shape changes, hoisting silently stops and the menu reappears inside the
  button, unstyled and hover-only.
- The `right: 6px` / `bottom` anchors are hardcoded, not measured.
- Consuming apps that hooked CSS/DOM onto the old `.vjsp-quality-menu` /
  `.vjsp-quality-item` class names must migrate.

## History

The first version was an inline quality button. It was later replaced with the
`_renderSettings` flyout and `_hoistNativeMenus`, and the captions-settings
entry (with a `captionSettings` option) was layered on the same flyout
afterwards.
