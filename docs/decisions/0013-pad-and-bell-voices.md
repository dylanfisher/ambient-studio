# 0013. The pad plays oscillator chords on a grid; bell notes are computed into buffers

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

Step 1j adds the pad/swell and bell/pluck voices beside the drone, under the scheduling, control
grid and cost budget of [0010](0010-event-windows-control-grid-memory.md), the PRNG and thinning
of [0003](0003-counter-based-prng.md), and the excerpt rule of
[0007](0007-trajectories-time-base-excerpts.md). The plan sets the ranges: pad chords of 3–7
sine-based notes from 100–500 Hz, attack 2–20 s, release 4–30 s, a 20–90 s swell of 6–20 dB;
bell fundamentals 150–1100 Hz, 4–10 partials falling 3–6 dB each and none above 3 kHz, drawn from
the scale in an absolute tuning and from a ratio table otherwise, a linear 2–10 ms attack, decay
0.3–15 s, 0.5–40 notes a minute with a density trajectory, at most 8 notes at once. Step 1a found
that one oscillator and gain per partial is what made a 480-sine probe miss 10x, and that a
`DelayNode` in a cycle can't be shorter than one 128-frame quantum. The schema text has about
260 characters per voice.

## Decision

**Pad.** A chord starts every `hold` seconds on a grid from timeline 0 (chord k at `k × hold`,
on the next whole frame) and plays until `hold + release` after its start, so each chord
crossfades with the next one's attack.

- **Notes.** Chord k takes `notes` (3–7, default 5) of the scale's frequencies from 100 to
  500 Hz (`tuningFrequencies`): from a root drawn at slot 1, every other scale note (thirds in a
  seven-note scale), or neighbors when the band holds fewer than `2 × notes − 1`. A band with
  fewer than `notes` plays all it has; a band with none throws. Each note is detuned by a drawn
  amount up to ±`detune` cents (slot 2 + note).
- **Timbre.** One oscillator per note, its `PeriodicWave` holding harmonics 1–4 falling `tone`
  dB per octave (3–12, default 9, may be a trajectory, read at the chord's start), sine phase 0
  on the note's first whole frame, where its gain is 0.
- **ADSR** on a gain per note, straight lines: 0 to 1 over `attack` (2–20 s, default 8), down to
  a sustain of 0.7 over half the attack, held to `hold`, 0 after `release` (4–30 s, default 12).
  A chord that ends before its decay does releases from where its gain got to. Each note peaks
  at 1/`notes`.
- **Swell.** A long-lived gain after the notes: 0 dB at timeline 0, down `swing` dB (0–20,
  default 10, may be a trajectory) half a `swell` cycle later (20–90 s, default 45), a raised
  cosine of timeline time sampled on the control grid. `swing` 0 turns it off.
- **Stereo.** Three long-lived panners at −0.5, 0 and 0.5; note j of chord k plays through panner
  `(j + k) mod 3`.
- **Hold** is 20–60 s (default 30). The 20 s floor keeps the densest pad (7 notes, 30 s release)
  at a cost of 43.2, which fits the budget beside the longest reverb (559.2 of 560).
- **Macros:** brightness moves `tone` by −0.25 (brighter, flatter), motion moves `swing` by 0.25.
- **No pre-roll.** A render's first window also plays the chords that started before it and
  still sound: their oscillators start on the render's first frame with the phase reached by
  then rotated into the `PeriodicWave` (`phasedOscillator` in `phased-wave.js`, shared with
  the drone), and their gains start at the envelope's value there, so `longestEvent` is
  0, as for the drone. Every chord's tone, notes and detune come from its own start time.

**Bell.** Note candidates sit every 0.25 s from timeline 0. Candidate k fires (`fires`, slot 0)
with probability `density × 0.25 / 60` at the effective density at `k × 0.25`, starts a drawn
fraction of a step later (slot 1) on the next whole frame, and plays only inside the voice's
`start` and `end`. At 40 a minute a candidate fires one time in six, so notes fall at random,
not on a pulse; clusters come from the density trajectory and the density macro.

- **Cap.** Every note rings for the same `decay`, which is fixed per genome, so the notes
  sounding are always the latest ones. A note is cut where the eighth note after it starts, if
  that is before its ring ends: its gain falls linearly to 0 over the 50 ms before that start,
  so at most eight sound at any moment. The cut depends only on the seed and the genome, so an
  excerpt cuts where a full render does.
- **Buffers.** Each note is computed in JS from the seed into a two-channel `AudioBuffer`
  (equal-power pan drawn within ±0.6, velocity drawn 0 to −9 dB, peak 0.5) and played by one
  `AudioBufferSource` and one gain, created in the window that holds its start. The buffer is
  `decay` long.
- **Pitch.** The fundamental is drawn uniformly from the scale's frequencies in 150–1100 Hz;
  every partial is detuned with it by up to ±`detune` cents, so in an absolute tuning a played
  partial sits within `detune` cents of its scale member.
- **Additive** (default). In an absolute tuning, the fundamental plus up to `partials − 1`
  distinct scale members above it and at most 3 kHz, drawn from the seed. In a relative tuning,
  the fundamental times `ratios`: `bar` (a free bar's modes, 1, 2.756, 5.404, 8.933, 13.344,
  18.64, 24.81, 31.87, 39.81, 48.64) or `harmonic` (1 to 5.5 in halves), the first `partials`
  of them, any over 3 kHz left out. Partial k is `fall` × k dB down (3–6 dB, default 4.5, may be
  a trajectory, read at the note's start); the fundamental rings `decay` seconds (T60, 0.3–15,
  default 6) and the highest half that, those between in geometric steps; each starts at a drawn
  phase. Partials are computed as damped two-term recurrences, a few multiplies per sample.
- **FM.** A carrier at the fundamental phase-modulated by a sine at the second partial's
  frequency (the fundamental's when there is none), index `partials × 10^(−fall/20)` falling
  60 dB in half the decay, lowered where needed so carrier + (index + 1) × modulator stays under
  12 kHz.
- **Pluck.** Karplus-Strong: one period of drawn noise (slots from 26), smoothed by a one-pole
  filter up to 0.9 as `fall` rises, fed into a loop of one fractional period, read by linear
  interpolation and averaged over two samples, its gain set so the fundamental falls 60 dB in
  about `decay` (the interpolation adds some loss). `partials` and `ratios` don't apply.
- **Edges.** A linear attack from 2 ms at `fall` 3 to 10 ms at `fall` 6, so a darker note has a
  softer strike, and a linear fade over the last 20 ms to exactly 0.
- **Macros:** density moves `density` by 0.25, brightness moves `fall` by −0.25.
- **Cost:** `eventCost({rate: highest density / 60, seconds: decay, nodes: 2})`, the highest
  density over the trajectory's points and the macros' reach (`highestValue`); the cap only
  shortens notes. At 40 a minute and a 15 s ring it is 28, as 0010 calibrated.
- `longestEvent` is `decay`.

**Stated tolerances.** A pad note has no sample-to-sample step above 1e-4 within 5 ms of its
start or its end (dry render, one chord). A bell note's first and last samples are exactly 0, it
stays under a straight line from 0 to 0.5 over the 2 ms attack, and no step exceeds 0.025 (5% of
0.5) in its first or last 0.25 ms; a pluck's start is bounded by the line only, because its
strike is white noise that steps from sample to sample. Windowed and up-front renders are
identical for both voices and all three bell models; excerpts match 0007's tolerance.

**Measured** on mbp2021 under `nice -n 10` while omlx served, seed 1:

| Render | Cost | Speed | Peak RSS |
|---|---|---|---|
| 60 s, default pad + default bell, 8 s reverb | 241 | 26.6x | 178 MiB |
| 60 s, densest pad + densest additive bell (40/min, 15 s, 10 partials) | 289 | 18.8x | 283 MiB |
| the same with FM | 289 | 15.7x | 282 MiB |
| the same with pluck | 289 | 19.7x | 306 MiB |
| 300 s, densest additive | 289 | 18.5x | 472 MiB |
| 900 s, densest additive | 289 | 18.6x | 923 MiB |

A 15 s note takes 13 ms of JS to compute additively, 29 ms as FM (two `Math.sin` a sample) and
9 ms as a pluck. Excerpts against their window of a full render: bells cut by the cap at 18 s,
peak 1.9e-8 to 7.5e-8 and 137 dB under the signal for each model, and identical on the bell
golden at 45 s; pads starting mid-chord (one chord in its attack, or one in its release and the
next in its attack), peak 6.0e-8 and 8.9e-8, 129–130 dB under, and 2.8e-8 and 3.7e-8 on the pad
golden at 25 and 45 s, 134–136 dB under.

Schema text: pad 247 characters, bell 268; the whole text is 2,462 of 3,000.

## Alternatives considered

- **Pad chords that sounded before the render skipped, with `hold + release` as the longest
  event** — rejected: up to 90 s of pre-roll on every excerpt, and the pad golden's end window
  rendered about 30 s, which timed out under the test suite's background priority.
- **A low-pass filter on the pad for brightness** — rejected: the four harmonics' slope does the
  same job without a node.
- **FM from oscillator pairs**, as the plan first said — rejected: two oscillators and a gain per
  note, created up to 3 s early, against one buffer source; computing it here also keeps every
  bell model on the same node shape and cost.
- **A separate attack parameter** and **an upper-partial ring parameter** — rejected to keep the
  schema text in its share; the attack follows `fall`, the upper ring is fixed at half.
- **A cluster generator inside the voice** (a slow random density modulation) — rejected: the
  density trajectory and macro already shape it, and "density on average" stays a plain test.
- **Counting concurrent notes by simulating the cap from timeline 0** — rejected: it would make
  an excerpt depend on everything before it; with one ring length the latest-eight rule is local.
- **Notes on the 0.25 s grid without jitter** — rejected as a faint 4 Hz pulse.

## Consequences

- Bell notes cost JS time the cost unit doesn't count: at the densest FM setting, 40 notes a
  minute take about 19 ms of computing per second of timeline. The bench (1m) sees it.
- `decay` is fixed per genome: a trajectory would give notes different ring lengths and break
  the latest-eight rule.
- Changing the grid step, any draw slot, the ratio tables, the envelopes or the synthesis
  changes renders and bumps `ENGINE_VERSION` ([0009](0009-engine-version-golden-hashes.md)).
- The voice registry adds its built-in voices on first use, because a voice that reads
  `effectiveParams` imports the registry back; see the amendment to
  [0005](0005-genome-schema-table.md).
