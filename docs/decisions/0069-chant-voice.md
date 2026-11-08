# 0069. The chant voice sums harmonics shaped by vowel resonances in JS, a buffer a window

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm. Amends
  [0013](0013-pad-and-bell-voices.md) (the drone's root snapping is shared) and
  [0014](0014-granular-cloud-noise-bed.md) (a second JS-mixed voice).

## Context

Step CV.1 adds a sung low drone. The drone's partials only fall going up, so its fundamental is
always its loudest partial; the target sound has a fundamental of 55–80 Hz about 19 dB under its
strongest partial, the 5th about half the time and the 7th about a quarter, switching as the
vowel changes, nearly all its energy at 200–800 Hz and about 20 dB less above 800 Hz, and a level
swell about every 2.6 s. The plan asks for one singer mixed in JS into a buffer per 2 s window,
its partials computed without a `Math.sin` per partial per sample, its phase from timeline time,
and a shape CV.2 can copy into 1–12 detuned, panned singers.

## Decision

**Source.** Harmonics 1 to ⌊3000 / root⌋ of the snapped root (22 at 135 Hz, 45 at 65 Hz, 81 at
33 Hz), sine phase 0 at timeline 0, falling `tilt` dB per harmonic octave. A frame takes one
`Math.sin` and one `Math.cos` of the fundamental's phase θ; harmonic n's sine comes from
sin((n+1)θ) = 2cos θ sin(nθ) − sin((n−1)θ).

**Resonances.** Each partial's amplitude is the source level times the sum of three band-pass
power responses, 1 / (1 + Q²(f/F − F/f)²), which fall 12 dB an octave away from their center:

| Vowel | Lower | Upper (−10 dB) |
|---|---|---|
| 0, a dark "oo" | 300 Hz, 160 Hz wide | 650 Hz, 200 Hz wide |
| 0.5, "oh" | 460 Hz, 180 wide | 780 Hz, 220 wide |
| 1, an open "ah" | 650 Hz, 200 wide | 1000 Hz, 240 wide |

Between targets, centers and widths move geometrically. The third resonance, at 100 Hz, 140 Hz
wide and −25 dB, is the same for every vowel; it sets the fundamental's level. `focus` dB lifts
the harmonic nearest the upper resonance, shared linearly between the two either side of it by
distance, so the lift slides as the vowel moves instead of jumping. Amplitudes are scaled so the
sum of sines has an RMS of 0.9, whatever the vowel: a default chant measures 0.3 LU under a
default drone at the same level (seed 1, 1 s reverb).

Measured on renders at the 65 Hz default root (C2 in A minor), tilt 3, focus 6:

| Vowel | Strongest | Fundamental | Above 800 Hz | Centroid |
|---|---|---|---|---|
| 0 | 4 | −17.2 dB | −22.9 dB | 460 Hz |
| 0.2 (default) | 5 | −18.0 dB | −19.9 dB | 511 Hz |
| 0.5 | 7 | −18.8 dB | −15.0 dB | 605 Hz |
| 1 | 10 | −17.5 dB | −6.5 dB | 784 Hz |

**Pitch.** `root` snaps with the drone's `droneFundamental`, so its range is the drone's
register, 33–135 Hz. `bend` (cents, a trajectory) moves the whole voice from there. The voice's
control values (bent fundamental, vowel, focus, depth) are sampled from `effectiveParams` on the
0.1 s control grid and interpolated linearly between samples. The fundamental's phase at grid
sample k is the sum of each step's mean frequency from timeline 0, added in one order and kept
for the render, so an excerpt that starts late computes the same bits at the cost of one pass
over the grid from 0 (9,000 samples at 900 s). Within a step the phase is the exact integral of
the linear frequency ramp. A test holds a bend from 0 to 100 cents over 120 s to a measured rise
of 100 ± 2 cents.

**Pulse.** The level dips by `12 × depth × (0.5 + 0.5 cos(2π pulse t))` dB, by timeline time.
`pulse` is fixed per genome so its phase needs no integration, as the noise bed's `period`.

**Frames depend only on the frame.** Amplitudes at a frame are interpolated from the grid samples
either side by the frame's place between them, not accumulated, so a window computes the same
samples wherever it starts (tested bit for bit, and excerpts at 0.7, 3.35 and 6.1 s within 0007's
tolerance).

**Singers.** `addSinger(channels, { cents, pan }, track, first)` adds one singer, detuned from the
track's pitch and panned equal-power; the track holds what singers share (the grid samples and
the phase). CV.1 calls it once, undetuned and centered, and the common `detune` parameter does
nothing yet; CV.2 loops over singers. CV.1 draws nothing from the seed, so it numbers no slots.

**Parameters:** `root` 33–135 Hz (log, default 65, safe 50–85), `vowel` 0–1 (default 0.2, a
trajectory), `focus` 0–18 dB (default 6, a trajectory, safe 0–12), `tilt` 0–12 dB (default 3,
safe 2–6), `bend` ±200 cents (default 0, a trajectory, safe ±100), `pulse` 0.1–1.5 Hz (log,
default 0.38, safe 0.2–0.8), `depth` 0–1 (default 0.5, a trajectory). Macro rows: brightness
moves `vowel` by 0.25, motion moves `depth` by 0.25. `longestEvent` is 0.

**Cost:** `eventCost` of one buffer source a window (4), plus 23 node-seconds a singer, plus 0.9
a partial: 67.5 at the default root, 99.9 at 33 Hz. Measured on mbp2021 under `nice -n 10`,
120 s renders with the default 8 s reverb, against a default noise bed's known cost of 38 in the
same process: a singer of 22, 45 and 81 partials took 0.94, 3.5 and 7.4 ms a timeline second more
than the bed, 46, 66 and 98 node-seconds at 1.24e-4 s each, fitting 0.11 ms a partial plus
2.9 ms a singer. Timed alone, the JS takes 4.0, 6.4 and 10.5 ms a timeline second.

**Measured render speed,** same conditions: a default chant alone renders 120 s at 24.9x (a
default drone 28.4x, a noise bed 27.4x), at 33 Hz 22.7x, at 135 Hz 26.7x. A 600 s chant with
its vowel and bend as trajectories renders at 25.3x (535 MiB resident), and a 10 s excerpt at
590 s takes 1.0 s, its phase sum over the 5,900 grid samples before it included.

## Alternatives considered

- **Oscillators through `BiquadFilter` formants** — rejected: three swept filters cost 63
  node-seconds before the source, and a filter's skirt can't hold the fundamental 19 dB down
  without also thinning the partials the vowel lifts.
- **A `PeriodicWave` per singer** — rejected: its harmonic levels are fixed when it is made, so
  the vowel couldn't move them.
- **One `Math.sin` per partial per frame** — rejected by the plan; the recurrence is one
  multiply-add.
- **Band-pass magnitude (6 dB an octave) resonances** — rejected: measured, tilt then traded the
  fundamental against the energy above 800 Hz, and no tilt gave both (a −19 dB fundamental came
  with energy only 9 dB down above 800 Hz).
- **An all-pole cascade (the usual vocal-tract model)** — rejected: it is flat below the first
  resonance, so the fundamental is about as loud as the lifted partial.
- **Phase accumulated window by window** — rejected: an excerpt's first window would start from
  a different phase than a full render's.
- **Focus on the one nearest partial** — rejected: the lift would jump from one harmonic to the
  next as the vowel moved.
- **`pulse` as a trajectory** — rejected for now: its phase would need the same integration as the
  pitch, for a rate the plan asks to hold.

## Consequences

- The schema text grows by about 345 characters to 3,341, over the 3,000 its test holds; CV.4
  owns that budget.
- The default chant with the longest (20 s) reverb costs 583, over the budget; it fits with a
  19 s reverb, and the 33 Hz chant with 17.9 s. `randomGenome` redraws over-budget genomes.
- Twelve singers at 45 partials, priced as one singer twelve times, would cost about 770; CV.2
  needs to share work between singers (the grid samples already are) or sing fewer partials per
  singer to meet acceptance 6.
- Registering the voice changes what `randomGenome` returns for existing seeds (0003's
  amendment accepts this). No stored genome renders differently, so `ENGINE_VERSION` stays 2;
  every existing golden hash is unchanged and `chant.json` is new at v2.
- Changing the resonances, the source's RMS, the partial count, the swell or the phase sum
  changes renders and bumps `ENGINE_VERSION` ([0009](0009-engine-version-golden-hashes.md)).
