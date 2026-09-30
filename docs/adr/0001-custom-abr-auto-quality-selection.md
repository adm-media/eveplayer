# ADR-0001: Custom ABR / "Auto" quality selection instead of VHS's built-in selectors

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

The library targets the ABR behaviour of mature commercial players. On the same
stream and connection their "Auto" reaches the top rendition and holds it,
stepping down only on real congestion.

With `@videojs/http-streaming` ("VHS", `overrideNative: true`) and its default
selector `lastBandwidthSelector`, "Auto" instead sat one or two rungs below
that, or froze on the bottom rendition. Reference test asset: a 3-rung DASH
ladder `360p@800k / 720p@4M / 1080p@8M`, no `AVERAGE-BANDWIDTH` in the
manifest.

Root causes found by reading the VHS source and instrumenting playback:

1. **`limitRenditionByPlayerDimensions` defaults to `true`** — Auto is capped
   to the smallest rendition covering the player's rendered CSS pixel size,
   independent of bandwidth. A ~100 Mbps stream stayed on 720p in Auto,
   switched to 1080p on a manual pick, and dropped back the moment Auto
   resumed.

2. **VHS compares against `systemBandwidth`**, defined as
   `1 / (1/bandwidth + 1/throughput)` — a harmonic mean of the network
   estimate and the decrypt/transmux/append rate. It is always below the real
   link speed and, with JS transmux under load, can fall below a
   mid-rendition's bitrate, freezing Auto at the bottom (observed: stuck at
   360p).

3. **VHS gates on declared *peak* `BANDWIDTH` × `BANDWIDTH_VARIANCE` (1.2).**
   DASH `bandwidth` is max-over-window; HLS often omits `AVERAGE-BANDWIDTH`.
   QVBR encodes declare peak 20–40 % over the true average, so the gate
   demands far more headroom than the rendition needs.

4. **`useNetworkInformationApi` defaults to `true`.** The `vhs.bandwidth`
   getter then returns `navigator.connection.downlink * 1e6` instead of the
   measured value whenever `downlink` reads < 10 Mbps (a coarse, bucketed
   browser guess that saturates at 10). Instrumented: real measurement
   60–70 Mbps, `vhs.bandwidth` frozen at `1.5e6`, Auto pinned to the bottom.
   Only affects Chromium (Firefox/Safari expose no `navigator.connection`),
   which is why "Auto" appeared fine in one session and broken in another.

## Decision

Replace `vhs.selectPlaylist` at runtime with a custom selector,
`eveAbrPlaylistSelector`, re-attached on every `loadstart`
(`applyCustomAbrSelector`). It:

- reads the **raw** segment-measured throughput from
  `mainSegmentLoader_.bandwidth` — bypassing both the `systemBandwidth`
  harmonic mean and the `useNetworkInformationApi` getter override;
- smooths it with an **asymmetric per-handler EWMA**: weight 0.7 when the
  newest sample is below the running average (react to congestion within one
  segment), 0.45 when above (climb steadily, no flip-flop);
- compares against `AVERAGE-BANDWIDTH` when present, else against
  `peak × 0.75` as a proxy for the real average;
- adds **buffer-gated optimism**: with ≥ 10 s forward buffer, retry the pick
  with `estimate × 1.4`, but adopt the higher pick only if it exceeds the raw
  pick *and* the raw pick is not a downswitch from the current rendition — so
  the bonus can only push up and never masks a real drop;
- does no player-dimension filtering.

Constructor options set accordingly: `limitRenditionByPlayerDimensions: false`;
`useNetworkInformationApi: true` (left at default — it now only informs VHS's
pre-first-segment guess, which the custom selector overrides thereafter).
`Vhs.BANDWIDTH_VARIANCE` remains globally set to `1.0` for VHS's own
fallback/initial paths; the custom selector does not consult it.

All numeric knobs are named constants at the top of the ABR block in
`src/EvePlayer.ts`.

## Alternatives considered

- **`useNetworkInformationApi: false` and keep the built-in selector.** Tried
  and reverted. Removes cause 4, but 1–3 remain: on the reference line "Auto"
  then froze at 360p because `systemBandwidth` stayed under 4 Mbps.

- **`useNetworkInformationApi: true` and keep the built-in selector.**
  Current-at-the-time behaviour. `downlink` capped `vhs.bandwidth` in the
  4–8 Mbps range: 360p → 720p after ~10 s, never 1080p.

- **`Vhs.movingAverageBandwidthSelector` / `experimentalBufferBasedABR`.**
  Still route through `systemBandwidth` and player-dimension filtering — does
  not address causes 1–3.

- **Lower `BANDWIDTH_VARIANCE` further / raise the initial `bandwidth`
  option.** Shifts the operating point but keeps the harmonic-mean and
  peak-vs-average distortions; no buffer awareness, so still parks one rung
  low.

- **Native playback (`overrideNative: false`) and defer ABR to the browser.**
  Loses DASH on non-Safari, loses the representation API the quality selector
  UI is built on, and Safari's HLS ABR is not configurable anyway.

## Consequences

**Good**

- Auto reaches and holds the top rendition on lines that sustain it, and
  steps down within ~1 segment of real congestion — matching mature commercial
  players on the reference asset.
- Behaviour no longer depends on whether the browser exposes
  `navigator.connection`.
- One tuning surface: five named constants.

**Costs / watch-outs**

- We now own an ABR policy. VHS upgrades that change `selectPlaylist`
  binding, the `representations()` shape, `mainSegmentLoader_`, or
  `playlists.media()` can silently break it — there is no type coverage over
  these internals.
- Buffer-gated optimism can overshoot on a genuinely marginal line and cause
  one rebuffer before the fast-down EWMA corrects; the same trade-off those
  players make. Lower `HEALTHY_BUFFER_ESTIMATE_BONUS` or raise
  `HEALTHY_BUFFER_SECONDS` if that shows up.
- Decision granularity is one segment (~6 s here); no mid-segment switching
  is possible through this hook.
- Not exercised by Vitest/jsdom (no transmux, no buffered ranges). Regressions
  only surface in Storybook / real playback.
- `PEAK_TO_AVERAGE_RATIO` is a heuristic; a stream whose real average is very
  close to declared peak could be picked slightly too eagerly.

## History

Prior attempts, so the reversals are not mistaken for the plan:

- `setQualityLevel` was not triggering a real fast quality change (fixed).
- Earlier quality-selector fixes on the representation-enable path.
- Disabling http-streaming's Network Information API bandwidth override —
  tried, then reverted.
- *(this ADR)* custom `eveAbrPlaylistSelector`: raw-measurement estimate,
  discounted-peak targets, asymmetric EWMA, buffer-gated optimism.
