# 0016. Render speed is measured by a bench script on mbp2021, outside the gate

- **Date:** 2026-11-05
- **Status:** accepted

## Context

Phase 1 requires an offline render at least 10× faster than real time. AGENTS.md bans tests that
depend on real time, and mbp2021 also serves omlx to a live site, so a timing assertion in the
gate would fail whenever the machine is busy.

## Decision

By the owner's choice on 2026-11-05, `./scripts/bench` renders the example genome for 300 s at 48
kHz stereo with seed 1: one warm-up run, then five timed runs. It prints the median and slowest
ratio of audio time to wall time, for render alone and for render plus export (normalize, limit,
WAV, FLAC). It also prints the peak resident memory of the render process. It runs on mbp2021 under
`nice -n 10`, with omlx serving as usual, and prints the load average next to the numbers. The phase
1 target is a render-only median of at least 10×.

The bench is not part of `./scripts/check`. The gate instead checks a static cost budget computed
from the genome, which doesn't depend on time (step 1g). The bench is re-run at the end of every
phase that touches the engine, and after any node-web-audio-api upgrade, and its numbers go in the
phase's Result line.

## Alternatives considered

- **A timing test in the gate** — rejected because it would flake whenever omlx or a builder
  loads the machine.
- **Also requiring 10× on mbp2015** — rejected because mbp2015 only plays server renders, and the
  limit would cap engine complexity well below what mbp2021 can render.

## Consequences

- A speed regression is caught at phase end rather than on the commit that caused it. The cost
  budget narrows that gap, since most slowdowns come from more nodes.

## Amendments

- 2026-11-06: step 1m builds the bench (provisional, owner to confirm).
  - **Processes.** `./scripts/bench` runs `scripts/bench.js` under `nice -n 10`. Each case starts
    two child processes under `/usr/bin/time -l`: one renders alone (`renderOffline`), one
    exports (`exportRender` into a temp folder, removed after each run, outside the timing). A
    child does its warm-up and its timed runs in one process, so the warm-up warms the JIT the
    timed runs use. Peak RSS is the child's maximum resident set size over all its runs.
  - **The 720 s case.** The example genome with its timeline stretched to 720 s, so the fade-out
    lands at the end; one warm-up and two timed runs, not five, so each case runs in under
    5 minutes on mbp2021 (`./scripts/bench --duration 300` or `720`) and a builder can run it
    within the cap on hand-run measurements. With no flag both cases run, about 7 minutes, and
    the render's peak RSS is projected to 900 s on the line through the two cases and compared
    with 0010's 1.5 GiB ceiling. The line, not a scaling from one case, because RSS has a fixed
    part that doesn't grow with the render.
  - **Output.** A heading per case with the genome's `cost()`; per mode the median and slowest
    ratio, the peak RSS and every run's wall seconds, warm-up first; the load average before
    each child and after the last; whether the render-only median meets 10x.
  - **Measured** on mbp2021, 2026-11-06, Node 26.12.1, with omlx serving, the example genome
    (cost 311.4): 300 s render alone median 23.1x, slowest 23.0x, peak RSS 555 MiB; render and
    export median 19.1x, slowest 18.9x, 672 MiB; load average 1.25–1.53 (1 min). 720 s render
    alone 22.9x and 22.9x, 873 MiB; render and export 18.9x and 18.9x, 1183 MiB; load average
    1.34–1.53. The render's RSS projects to about 1009 MiB at 900 s.
