# 0071. The cymbal and the drum are struck voices on the bell's grid, sharing its code

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm. Amends
  [0020](0020-vibe-constraints-and-linter.md) (two ceiling kinds).

## Context

Step CV.3 adds sparse struck percussion: about 5 hits a minute, 3–24 s apart, in a hall of about
5 s. The plan asks for a bright cymbal (seeded noise through a few inharmonic resonances, a
`decay` up to about 12 s, a shimmer) and a low drum (a membrane whose pitch falls quickly after
the strike, a short `decay`). Both work as the bell does
([0013](0013-pad-and-bell-voices.md)): candidates on a grid from timeline 0, thinned at the
effective density ([0003](0003-counter-based-prng.md)), each hit a buffer computed in JS in the
window that holds its start, a cap on hits sounding at once. Both have a `density` in hits a
minute, about 4 by default and a trajectory, macro rows as the bell has, and a ceiling
constraint as `bellNotes` is.

## Decision

**Shared code.** Three voices now strike, so the bell's note finder, its playback and its cost
move to `src/engine/struck.js` (`strikeFinder`, `buildStrikes`, `strikeCost`, `shapeHit`), and
the parts a voice module reads while it loads (`JITTER_SLOT`, `DENSITY_ROW`, `strikeDensity`) go
in `struck-params.js`; struck.js imports the voice registry back through `effectiveParams`, so a
table built from it at load time would meet it half-loaded. The bell renders the same samples:
its golden hashes are unchanged.

**Grids.** A voice gives a `step`, a `jitter` and a `most`. Candidate k sits at `k × step`,
fires (`fires`, slot 0) with probability `density × step / 60` at the effective density at its
time, and starts `jitter × step × draw` later (slot 1) on the next whole frame. The bell keeps
0.25 s and a whole step. The cymbal's candidates are 2 s apart and start up to 1 s late, so two
cymbal hits are at least 1 s apart; the drum's are 0.5 s apart and start up to 0.25 s late.
Raising the density keeps every hit at the same frame and adds others (tested).

**Caps.** Every hit of a voice rings its `decay`, fixed per genome, so as for the bell a hit is
cut, over 50 ms, where the `most`-th hit after it starts. The cymbal holds six (its densest,
20 a minute at 12 s, averages four sounding), the drum three. Four could never cut a drum: its
1.5 s longest ring holds at most three later candidates.

**Cymbal.** `density` 0.5–20 a minute (log, default 4, safe 0.5–8), `decay` 1–12 s (T60, log,
default 6, safe 3–10), `center` 3.5–11 kHz (log, default 6 kHz, a trajectory, safe 4.5–8 kHz),
`shimmer` 0–1 (default 0.4, a trajectory). A hit is uniform noise drawn one slot a frame
(`drawer`), through six two-pole band-passes at 0.6, 0.74, 0.93, 1.17, 1.41 and 1.72 times
`center`, each moved by a drawn ±3%, a tenth of its frequency wide, plus the noise differenced
(rising 6 dB an octave) at 0.3 for the wash of the strike. The resonances fall 60 dB over
`decay`, the wash over a quarter of it. Each resonance's level is swept between 1 and
1 − `shimmer` by a cosine at a drawn 1–5 Hz and phase. The common `detune` moves all six by a
drawn amount within ±`detune` cents. Attack 2 ms, peak 0.5, velocity drawn 0 to −6 dB, pan
within ±0.5; the bell's `shapeNote` fades the last 20 ms to 0. Macros: density moves `density`
by 0.25, brightness `center` by 0.25, motion `shimmer` by 0.25.

**Drum.** `density` 0.5–40 a minute (log, default 4, safe 0.5–12), `decay` 0.1–1.5 s (T60,
log, default 0.6, safe 0.3–1.2), `root` 33–135 Hz (log, default 55, safe 40–80) snapped with the
drone's `droneFundamental`, so hits sit on the scale under a chant or drone, and `drop` 0–2
octaves (default 1, a trajectory). A hit is the membrane's two lowest modes, the second at 1.594
times the first and 10 dB down, ringing half the decay; their frequency is
`hz (1 + (2^drop − 1) e^(−t / 25 ms))`, integrated exactly, so the pitch reaches the root within
about 0.1 s. Over the first 30 ms, noise through a 400 Hz one-pole low-pass at −14 dB gives the
strike. Attack 1 ms, peak 0.5, velocity 0 to −9 dB, pan within ±0.3. Macros: density moves
`density` by 0.25, brightness `drop` by 0.25.

**Measured** (seed 1, eight hits each): a default cymbal hit keeps 99.3% of its energy above
2 kHz (spectral centroid about 9 kHz), 93% at the lowest `center`; with `shimmer` 0 it falls 30 dB over the middle half of its
decay. A default drum hit keeps 99.2% of its energy below 200 Hz, 92% with `drop` 2; at a
135 Hz root with `drop` 1 it is 68%, and with `drop` 2, 36%, which is why the safe range of
`root` stops at 80 Hz.

**Constraints.** `cymbalHits` and `drumHits` are ceilings on each voice's highest effective
`density`, macro offsets included, read with `highestValue` as `bellNotes` is, in the voice's
`density` range.

**Cost.** `strikeCost`: `most` slot gains, plus
`eventCost({rate: highest density / 60, seconds: decay, nodes: 2})`, plus a weight a second of
ring for the JS that computes it. Timed alone on mbp2021, a second of cymbal ring takes 1.6 ms
(13 node-seconds at 1.24e-4 s each), a second of drum ring 2.4 ms (19). In 120 s renders beside a
default noise bed under `nice -n 10`, the densest cymbal (20 a minute, 12 s) took 8.9 ms a
timeline second more than the bed alone (72 node-seconds) and the densest drum (40 a minute,
1.5 s) 3.4 ms (27); at a 2 s ring, before the range stopped at 1.5 s, it took 5.4 ms (43). The
weights are 15 for the cymbal and 24 for the drum, so each cost bounds what was measured: the
densest cymbal costs 78, the densest drum 37, the defaults 13.6 (measured 8.4) and 4.8 (3.7).
The bell's weight stays 0, as 0013 has it.

**Render speed,** same conditions, each beside the noise bed: 120 s renders at 26.4x with a
default cymbal, 21.9x with the densest, 26.8x with a default drum and 24.9x with the densest,
against 27.2x for the bed alone. A 600 s render takes 22.4 s with a default cymbal and 22.1 s
with a default drum; a 10 s excerpt at 590 s takes 1.2 s and 0.95 s. Speeds depend on the
machine's load, so compare them only within one run.

Beside the longest reverb (20 s, 514 of the budget) the densest drum fits; the densest cymbal
fits with an 18.6 s reverb, and `randomGenome` redraws over-budget genomes, as for the chant.

## Alternatives considered

- **Copying the bell's finder into each voice** — rejected: three copies of the cap logic,
  and the dupes check flags them.
- **The bell's 0.25 s grid with a whole step of jitter** — rejected for these two: hits could
  fall a few milliseconds apart, which a sparse cymbal shouldn't do and the measured target
  (3 s apart at the least) never does.
- **A minimum gap enforced from the previous hit** — rejected: a hit would depend on every hit
  before it, so an excerpt couldn't find its hits locally (0003, 0007).
- **Cymbal resonances as `BiquadFilter` nodes on a noise source** — rejected: a filter chain per
  hit costs more nodes than the buffer, and per-hit seeded ratios and flutter are cheap in JS.
- **An unpitched drum** — rejected: a free root lands between scale notes under a chant or
  drone; snapping it costs nothing.
- **A `pitch` trajectory on the drum** — rejected: the snapped root is fixed per genome as the
  chant's is; `drop` carries the motion.

## Consequences

- Registering two voices moves `randomGenome` draws (0003's amendment accepts this). No
  existing genome renders differently, so `ENGINE_VERSION` stays 2; `cymbal.json` and
  `drum.json` are new goldens at v2.
- The schema text grows by 376 characters to 3,717, past `schema-text.test.js`'s 3,000, and two
  `build-prompt.test.js` budget checks fail: every voice locked whole (4,297 tokens of 4,096)
  and a base with six examples (4,512 of 4,506). Both wait for CV.4, which owns the prompt's
  budget.
- Lone sparse cymbals and drums often play nothing in a genome's first 2 s, so the render test
  of 20 random genomes now asks that at least 15 sound, not more than 15.
- Changing a grid, a cap, a draw slot, the resonance ratios, the membrane model or `shapeHit`
  changes renders and bumps `ENGINE_VERSION` ([0009](0009-engine-version-golden-hashes.md)).
- `decay` is fixed per genome for both, as for the bell, so the latest-`most` cap stays local.
