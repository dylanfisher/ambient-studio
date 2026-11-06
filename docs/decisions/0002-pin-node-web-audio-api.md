# 0002. Render offline with node-web-audio-api, pinned at 2.2.0

- **Date:** 2026-11-05
- **Status:** accepted

## Context

The engine is one Web Audio module that must render offline in Node and preview live in a
browser from the same file ([0001](0001-stack.md)). Node has no Web Audio API of its own.
AGENTS.md requires the owner's approval for each dependency, and renders must be reproducible:
the same genome, seed and engine version give the same samples.

## Decision

Add `node-web-audio-api` at exactly `2.2.0` (no caret) as the first runtime dependency, with the
owner's approval on 2026-11-05. It is a Rust implementation of Web Audio exposed through N-API,
shipped as a prebuilt darwin-arm64 binary. `src/server` creates the `OfflineAudioContext` and
passes it to `render()`; `src/engine` never imports the package.

Upgrading it is a step of its own: re-run the golden-render test
([0009](0009-engine-version-golden-hashes.md)) and bump the engine version if the hashes move.

## Alternatives considered

- **A DSP renderer written here in JS** — rejected because the browser preview would then run
  different code from the offline render, and the engine would have to be written twice.
- **Headless Chromium (Puppeteer or Playwright)** — rejected for its size, its start-up time on
  every render, and because the browser can change its audio code under us on any update.
- **A caret range (`^2.2.0`)** — rejected because a lockfile refresh could change rendered
  samples without anyone choosing to.

## Consequences

- Renders are bit-reproducible only on mbp2021 with this package version. The browser preview
  is close but not identical, which is acceptable because it is optional and never stored.
- Where this package differs from browsers is answered from its README and source in
  `node_modules/node-web-audio-api/` ([reference.md](../reference.md)).
- Step 1a confirms, before any engine code, that two renders of the same graph match byte for
  byte, which native nodes are present, and whether `OfflineAudioContext.suspend()` works. If
  any of these fail, the plan changes before phase 1 goes further.

## Amendments

- 2026-11-06: step 1a's spike answers the open questions, measured on mbp2021 with Node
  26.12.1. The tests in `test/server/offline-context.test.js` pin the first four.
  - **Cross-process determinism: identical.** A 1 s, 48 kHz stereo graph using every node type
    below, with a `PeriodicWave` oscillator and a buffer source starting on frame 4801 (off the
    128-frame quantum), hashes the same in three separate Node processes and in the test's own
    process. No tolerance is needed; golden hashes ([0009](0009-engine-version-golden-hashes.md))
    can work as planned.
  - **Nodes: all present.** `OfflineAudioContext` at 48 kHz stereo creates an oscillator with a
    `PeriodicWave`, BiquadFilter, Gain, Delay, Convolver, StereoPanner, AudioBufferSource,
    ChannelSplitter and ChannelMerger.
  - **`suspend(t)`: works, and nodes created in it start on their exact frame.** A buffer source
    created in a suspend callback at frame 4736 and started at frame 4801 puts its first sample
    on frame 4801, and the full graph renders to the same bytes whether its late source is
    created up front or in a suspend. The crate rounds a suspend time *up* to the next
    128-frame boundary (`calculate_suspend_frame` in web-audio-api-rs 1.7.0,
    `src/context/offline.rs`), so a window's suspend must sit at least one quantum before the
    first event it schedules.
  - **Feedback delay floor: 128 frames.** A `DelayNode` in a cycle asked for 0, 1, 64 or 127
    frames echoes after 128 frames (2.67 ms); 200 frames echoes after 200. This matches the
    spec's one-render-quantum clamp. Per the crate source, a delay once found in a cycle keeps
    the clamp even if the cycle is later broken.
  - **Threads: one.** Offline rendering runs on a single thread: probe (a) used 3.80 s of CPU in
    3.79 s of wall time (ratio 1.00), and the crate's render loop processes every node in
    topological order on one thread per quantum.
  - **Probe (a)**, run once under `nice -n 10`: 60 s with a 6 s stereo Convolver, 40
    `PeriodicWave` oscillators each through a BiquadFilter, and 200 buffer sources (2 s stereo
    buffers) rendered in 3.79 s, **15.8x real time**, peak RSS 129 MiB.
  - **Probe (b)**, run once under `nice -n 10`: 20 minutes at 30 grains per second, every grain
    (AudioBufferSource, Gain envelope, StereoPanner: 36,000 grains, 108,000 nodes) created up
    front. **It did not finish:** stopped after 2,201 s (36.7 min) of wall time, slower than real
    time, with peak RSS 1,454 MiB. The crate processes every node on every 128-frame quantum,
    started or not, so cost grows with the number of nodes waiting to start. The same graph cut
    to 60 s (5,400 nodes) rendered at 3.4x real time and to 120 s at 1.2x: doubling the length
    cost 5.4 times the wall time. **Grains created up front can't be the scheduling for long
    renders**, which changes what 1f and 1k assume.
  - **Probe (b), windowed**, added to give 1f and 1k a measured alternative: the same 36,000
    grains, each 2 s window created in a `suspend` 1 s before it starts, rendered 20 minutes in
    85.6 s, **14x real time**, peak RSS 887 MiB (of which about 460 MB is the stereo float
    output and 230 MB a channel copy the probe makes).
  - **Probe (d)**, run once under `nice -n 10`: 720 s with a 12 s stereo Convolver and 60 notes
    alive the whole time, each 8 sine partials with their own gain and a gain envelope per note
    (480 oscillators, 1,021 nodes), rendered in 119 s, **6.1x real time**, peak RSS 584 MiB.
    It misses phase 1's 10x target. Over 60 s, the same graph without the Convolver ran at 7.9x
    and with it at 6.1x, so the 480 oscillators cost most of the time. A voice budget for
    additive notes belongs in 0010's cost unit.
