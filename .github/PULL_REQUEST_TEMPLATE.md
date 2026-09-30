<!-- Thanks for contributing! Keep this description short; the detail behind
     each checklist item is in CONTRIBUTING.md. -->

Closes #<!-- number of an issue labelled `accepted`; without one this pull
             request is closed automatically (see CONTRIBUTING.md) -->

## What this changes

<!-- The change and why. Call out any public API change explicitly. -->

## How this was verified

<!-- Unit tests don't count here: they run against a mock. A pull request with
     this section empty or generic is closed without review. For a change with
     no runtime effect, write "N/A" and why. See CONTRIBUTING.md. -->

- **Streams:** <!-- URL if public; otherwise format, live/VOD/DVR, anything unusual -->
- **Browsers / OS / devices:** <!-- include Safari when playback, tracks, captions, fullscreen or autoplay change -->
- **Before:** <!-- what happened without the change -->
- **After:** <!-- what happens with it: console output, events, getPlaybackStats(), screenshot or recording -->
- **Steps to repeat:**

## Checklist

<!-- The CI workflow re-runs lint, typecheck, coverage and build on every PR;
     Prettier formatting is not checked for you. -->

- [ ] I understand every line of this change and can explain it in review
- [ ] It changes only what the linked issue needs
- [ ] `yarn lint` passes
- [ ] `yarn typecheck` passes
- [ ] `yarn coverage` passes — 95% on all four metrics; new code has tests
- [ ] `yarn build` succeeds
- [ ] Code is Prettier-formatted
- [ ] Public API change: JSDoc on every new/changed export, and `README.md` +
      the relevant `docs/` guide updated in this same PR
- [ ] `docs/architecture.md` updated if ABR tuning changed; new ADR only for a
      decision with a real trade-off

<!-- Open the PR against `main`. -->
