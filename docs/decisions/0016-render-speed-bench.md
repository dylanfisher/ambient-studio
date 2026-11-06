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
