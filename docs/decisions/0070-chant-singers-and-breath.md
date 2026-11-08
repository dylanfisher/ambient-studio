# 0070. Chant singers share one waveform table, breathe on seeded schedules, and never all at once

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm. Amends [0069](0069-chant-voice.md) (the
  singers, the cost, the common `detune`).

## Context

Step CV.2 turns CV.1's single singer into 1–12 singers, each detuned within `spread` cents and
panned within a `pan` width, each singing phrases of about `phrase` seconds between breaths of
about `breath` seconds, on its own schedule from timeline 0 so an excerpt finds the same breaths
(0003, 0007). With one singer every breath must fall at least 20 dB; with six or more, no 50 ms
frame of 60 s may fall 12 dB under the median. Six singers at a `spread` above 0 must give a
side/mid of 0.5 or more. Priced as CV.1's singer twelve times, twelve singers cost about 770,
over `COST_BUDGET` (560) before any reverb, and acceptance 6 asks for a 20-minute genome with a
12-singer chant, a cymbal and a drum at 10x real time. Every chant stored since CV.1, and CV.1's
golden `chant.json`, must render the same samples, or the engine version goes up (0009).

## Decision

**The lead sings as CV.1's singer did.** Singer 0 is undetuned, centered, at phase 0, and sums
its partials by CV.1's recurrence with CV.1's arithmetic, so with one singer and no breaths every
sample is CV.1's, bit for bit: `chant.json`'s golden hashes are unchanged, and a test holds one
breathing singer to the same samples outside its breaths.

**The chorus reads a shared table.** Singers 1 and up use the lead's partial amplitudes (at the
undetuned pitch) through a table: at each 0.1 s grid sample, the harmonic sum is computed once
into 2,048 points of one cycle (half summed by the same recurrence, half its negative). Each
chorus singer reads the tables either side of the frame at its own phase, with linear
interpolation, and blends them by the frame's place between grid samples, the same linear blend
of amplitudes the lead makes. A frame costs a chorus singer one phase and four table reads,
whatever its partials. Interpolating a 2,048-point table is at most (πn/2048)²/2 off for harmonic
n: about −91 dB for harmonic 5 and −52 dB under harmonic 45, itself about 35 dB under the
strongest. The amplitudes don't follow each singer's detune: at 50 cents the resonances sit 3%
off for it, which the blur of the ensemble hides.

**Level and place.** Every singer is scaled by 1/√singers, so the ensemble's power stays about
the lead's alone (one singer is scaled by exactly 1). Singers 1, 3, 5… stand to the right and
2, 4, 6… to the left, each between half the `pan` width and all of it, equal-power. Measured on
the source at the default `pan` of 1, seeds 1–5: side/mid 0.52–0.59 with six singers, 0.58–0.72
with twelve.

**Pitch and phase.** Singer s's detune is `spread × (2u − 1)` cents, fixed for the render, and
its phase a seeded fraction of a cycle added to the fundamental's turns, so the singers don't
start in phase (in phase at timeline 0, twelve would sum 10.8 dB louder for the first moments).

**Draws and slots.** A singer's draws use its index as the event index (0003): slot 1 its
detune, 2 its pan, 3 its phase, 4 its stagger, and from 5 two a phrase: phrase j's length at
5 + 2j and the breath after it at 6 + 2j. The lead draws no detune, pan or phase. A singer's
draws don't depend on how many singers there are.

**Phrase schedule.** From timeline 0, each singer sings a phrase of `phrase × 2^(2u − 1)`
seconds (half to twice `phrase`), then breathes for `breath × (0.75 + 0.5u)`, and so on. Its
first phrase is cut to a seeded fraction (the stagger), so the singers start out of step.
Schedules are computed from 0 as they are asked for and kept, a few hundred breaths a singer
at 20 minutes.

**Never all at once.** Singer s takes a breath only if, during it, fewer than ⌈(s + 1)/2⌉ of the
singers before it are breathing; otherwise it holds its note until one of them has breathed in,
and after `phrase` more seconds of holding it breathes anyway. So of any first n singers at
least ⌊n/2⌋ are singing, except after such a long hold. Each singer depends only on the singers
before it, so raising `singers` adds singers and moves no one's breaths (tested). Measured over
60 s of the source, seeds 1–5, the lowest 50 ms frame against the median:

| phrase, breath | 6 singers | 12 singers |
|---|---|---|
| 8 s, 0.6 s | −6.2 to −7.4 dB | −6.4 to −6.9 dB |
| 5 s, 1 s | −6.1 to −9.6 dB | −6.1 to −8.8 dB |
| 3 s, 2 s | −6.4 to −8.5 dB | −6.4 to −8.1 dB |

Without the rule, six singers at 3 s and 2 s went silent on two seeds of five.

**A breath** fades the singer along a raised cosine to 0 over 80 ms (half the breath, if
shorter), holds at 0, and fades back in over 80 ms, from each frame's timeline time alone. A
test holds the difference a breath makes to steps no larger than the voice's own; a 1 µs fade
fails it.

**Parameters,** none of them trajectories: `singers` 1–12 (an integer, default 1, safe 1–8),
`spread` 0–50 cents (default 12, safe 4–25), `pan` 0–1 (default 1, safe 0.5–1), `phrase` 3–30 s
(log, default 8, safe 5–16), `breath` 0–2 s (default 0, safe 0.3–1). A `breath` of 0 means the
singers never breathe, which is the default so every chant stored before CV.2 renders as it did;
the plan's range started at 0.3, and this one starts at 0 on purpose.
The common `detune` still does nothing for the chant: `spread` is the ensemble's detune, in the
cents the plan names and up to 50, where `detune` stops at 12.

**Cost:** CV.1's 4 + 23 + 0.9 a partial for the lead, plus, with more than one singer, 0.15 a
partial for the tables and 3 a chorus singer: 67.5 for one singer at the default root, 89.3 for
six, 107.3 for twelve, 145.1 for twelve at 33 Hz. Twelve at the default root with a 12 s reverb
cost 423; they fit beside a reverb of up to 17.4 s, at 33 Hz up to 15.9 s. Timed alone under
`nice -n 10` on mbp2021 while omlx served, at the 65 Hz default root, the voice's JS took 8.2,
8.9, 10.0 and 11.9 ms a timeline second at 1, 2, 6 and 12 singers (4.9 to 8.9 at 135 Hz, 11.2 to
16.1 at 33 Hz): about 0.33 ms a chorus singer, and 0.016 ms a partial for the tables.

**Measured render speed,** same conditions, 120 s with the default 8 s reverb and 0.6 s breaths:
one singer 23.4–24.3x, six 21.8–22.3x, twelve 21.2–21.4x. Twelve singers took about 5 ms a
timeline second more than one, against 3.7 ms timed alone; the weights price that at 40
node-seconds (5.0 ms). Twelve singers over 600 s with the vowel and
bend as trajectories render at 21.6x (665 MiB resident), and a 10 s excerpt at 585 s takes 1.3 s.
Compare speeds only within one run (0069).

## Alternatives considered

- **Every singer by the recurrence** — rejected: about 770 node-seconds for twelve, and about
  60 ms a timeline second of JS, under 10x with the bus before any other voice.
- **Chorus singers carrying only the partials around the resonances** — rejected: it saves
  about half, still near 400 for twelve, and the partials above would come from the lead alone,
  so they wouldn't blur, would dip with the lead's breaths, and would sit about 10 dB weaker
  against the rest with twelve singers.
- **A table for the lead too** — rejected: its samples would change, and with them CV.1's
  golden hashes and every stored chant, which would need a new engine version.
- **A table per singer, at its own detuned pitch** — rejected: twelve tables a grid sample for a
  difference of at most 3% in where the resonances fall.
- **Independent schedules** — rejected: measured, six singers at 3 s phrases and 2 s breaths all
  breathed at once on two seeds of five.
- **A limit counting every singer, not only the earlier ones** — rejected: adding a singer would
  move the others' breaths.
- **Breathing by default** — rejected: every chant stored since CV.1 would render differently.
- **`spread`, `phrase` and `breath` as trajectories** — deferred: each singer's detuned phase,
  and the schedules, would need integrating from timeline 0 as the pitch is.
- **`spread` as a multiple of `detune`, as the drone's copies are** — rejected: the plan gives
  `spread` in cents, and `detune`'s 12 cents is narrower than an ensemble's scatter.

## Consequences

- With `singers` above 1 and `spread` 0, the chorus sings the lead's pitch at seeded phases, a
  fixed comb on its partials rather than a moving blur.
- A singer far to one side, breathing, moves the image a little the other way.
- Changing the table, the phrase schedule, the limit, the slots, the pan layout or the 1/√n
  scaling changes renders of any chant with more than one singer or a breath, and bumps
  `ENGINE_VERSION` (0009). `chant-ensemble.json` is the six-singer golden at v2.
- The schema text grows by the five parameters, adding to the two known prompt-budget failures
  CV.4 owns (0069).
