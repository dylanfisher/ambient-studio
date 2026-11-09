# 0088. Chant growl adds half-integer harmonics, and rough swings alternate cycles

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm. Amends [0069](0069-chant-voice.md) (the
  source's partials, its RMS rule, the cost) and [0070](0070-chant-singers-and-breath.md) (the
  chorus table's span, the cost).

## Context

Step CG.1. After phase CV the owner said the chant lacks "depth / growl": every partial is a
steady sine at an integer harmonic, so it sounds like an additive organ. The voice stays
additive, in JS, with no airway model. Acceptance 1: `growl` (0–1, a trajectory) adds the
half-integer harmonics under the same tilt and resonances; at 1, with one singer at a 65 Hz root,
the strongest half-integer partial in 200–800 Hz is within 6 dB of the strongest integer one, and
at 0 the voice renders as today. `rough` (0–1) makes alternate cycles differ in strength: at 1,
neighboring cycles' peaks differ by at least 2 dB, at 0 by under 0.1 dB. Every stored genome and
golden must render the same bits, so the engine version stays 2 (0009), and chorus singers must
still cost four table reads a frame (0070).

## Decision

**Half-integer harmonics.** Growl adds harmonics 0.5, 1.5, 2.5 … of the bent fundamental up to
`TOP_HZ` (46 at the 65 Hz default root, 91 at 33 Hz). The level law: half-integer harmonic
m + 0.5 has the amplitude an integer harmonic would have at its frequency, from the same tilt
(−tilt × log2(m + 0.5) dB, so the one at 0.5 sits tilt dB above the fundamental's line) and the
same two vowel resonances and chest resonance, times `growl`, with no `focus` lift. So at growl 1
the half-integer harmonics sit on the integer ones' spectral envelope, and growl 0.5 puts them
6 dB under it. Focus stays on the integer harmonic nearest the upper resonance.

**Phase.** The half-integer harmonics are cosines at odd multiples of α, half the fundamental's
phase, where the integer harmonics are sines at even multiples. So each cycle's waveform is the
last one's negated and reversed in time: at rough 0 the cycles' peaks match (measured under
0.003 dB at growl 1) and growl reads as an undertone an octave down, not as a change from cycle
to cycle. In phase with the sines, the half-integer harmonics would have made the cycles uneven
by themselves, with no control over how much.

**Rough.** The voice's level swings by 1 + 0.5 × rough × cos α: alternate cycles' pulses, which
fall where α is a whole multiple of π, are louder and softer by up to half. That is the same as
adding sine-phase half-integer harmonics of half the swing times each pair of integer neighbors,
so rough acts on its own, without growl: alone it makes a rough voice whose undertones come from
the swing, and with growl it roughens the undertone growl adds. One singer at 65 Hz, depth 0:

| rough | neighboring cycles' peaks |
|---|---|
| 0 | under 0.003 dB apart, at growl 0 or 1 |
| 0.25 | 2.2 dB |
| 0.5 | 4.4 dB |
| 1 | 9.5 dB (growl 0), 9.5 dB (growl 1) |

`rough` is fixed for a render, not a trajectory: the plan gives growl the movement, and a fixed
rough keeps the cost and the table's span simple.

**Level.** Amplitudes are scaled so the voice's RMS stays 0.9 whatever growl and rough: the
half-integer harmonics' power is added to the integer ones', and so is the swing's, summed exactly
from the sidebands it lends each partial (a sine and a cosine at one frequency add in power).
Measured, the source's level moves under 0.03 dB from growl 0 rough 0 to growl 1 rough 1, so
growl thins the integer harmonics by about 3 dB at 1.

**Strongest partials in 200–800 Hz at growl 1,** one singer at 65 Hz, half-integer against
integer: vowel 0, 4.5 against 5, +1.3 dB; vowel 0.2, 5.5 against 5, +0.6 dB; vowel 0.5, 6.5
against 7, −1.0 dB; vowel 1, 9.5 against 10, −0.5 dB. With rough 1 and growl 0, the swing's
undertones sit 6.1 to 7.6 dB under.

**Where the voice repeats every two cycles.** A grid step growls if growl is above 0 at either end
of it; a growling step, or any step of a rough voice, repeats every two cycles. Only there does the
lead compute α's cosine and sum the half-integer harmonics, by the cosine recurrence
cos((k+2)α) = 2cos 2α cos kα − cos((k−2)α), whose 2cos 2α is the integer recurrence's 2cos θ.
Only there do the chorus's tables hold two cycles. Every other step computes the samples it
computed before growl existed, bit for bit: a genome with no growl and no rough renders as it
did, and a genome whose growl trajectory sits at 0 for its first minutes renders those minutes as
a genome without growl. Each step's span depends only on its two grid samples, so an excerpt finds
the same spans as a full render.

**The chorus.** A table of two cycles keeps the 2,048 points and its four reads a frame for each
chorus singer, who reads it at half its turns. At point j, α = 2πj / 2048, it holds the integer
sum at 2α plus the half-integer sum at α, times the swing. Only a quarter of the points is summed:
the integer sum repeats each cycle and is odd about each half cycle, and the half-integer sum is
even and flips each cycle, so the other three quarters follow by sign. It costs what a one-cycle
table costs for the same partials, and with two cycles in 2,048 points, interpolating harmonic n
is at most (πn/1024)²/2 off: about −79 dB for harmonic 5 and −40 dB under harmonic 45, itself about
35 dB under the strongest. When a step's span differs from the step before's, its near table is
filled again at the new span.

**Macros.** None moves growl or rough. Brightness moves the vowel and motion the swell, and
neither maps cleanly onto growl: a darker voice need not growl, and motion is change over time.
Growl's cost is read through `highestValue` with the voice's macro rows, so a row added later is
priced.

**Parameters:** `growl` 0–1 (default 0, a trajectory, "undertones"), `rough` 0–1 (default 0,
"uneven cycles"). Neither has a safe range; `randomGenome` draws them from the whole range.

**Cost.** A voice whose growl rises above 0 anywhere (its `highestValue`) is priced as growling
throughout: 1.1 node-seconds a half-integer harmonic for the lead, and with growl or rough, 4 for
α's cosine and the swing a frame. With more than one singer, the table's 0.15 a partial counts
(integer + half-integer) / 2 partials when the voice repeats every two cycles. Twelve singers at
the default root cost 107.3 plain and 161.9 with growl and rough on; they fit beside a reverb of
up to 15.2 s (17.4 s plain), and twelve at 33 Hz beside up to 12.1 s. One singer at 65 Hz with
both costs 122.1.

**Measured,** on mbp2021 under `nice -n 10` while omlx served, the voice's JS alone over 60 s in
2 s windows (median of 3), ms a timeline second:

| root, singers | plain | growl 1 | rough 1 | both |
|---|---|---|---|---|
| 65 Hz, 1 | 7.5 | 14.3 | 7.9 | 14.3 |
| 65 Hz, 6 | 9.8 | 16.8 | 10.0 | 16.8 |
| 65 Hz, 12 | 12.0 | 19.0 | 12.2 | 19.0 |
| 33 Hz, 12 | 16.4 | 29.4 | 16.3 | 29.3 |
| 135 Hz, 12 | 9.2 | 12.5 | 9.6 | 12.5 |

Growl adds about 0.24 ms plus 0.14 ms a half-integer harmonic (22 at 135 Hz, 91 at 33 Hz); rough
alone about 0.4 ms; the chorus costs about what it did. Rendering 120 s with the default 8 s
reverb and 0.6 s breaths: one singer 24.2x plain and 20.8x with both, twelve 20.3x and 17.8x.
Twelve took 6.9 ms a timeline second more with both, against the 54.6 node-seconds (6.8 ms) the
weights add. Compare speeds only within one run (0069).

## Alternatives considered

- **Half-integer harmonics in sine phase, like the integer ones** — rejected: the cycles then
  differ by themselves (the half-integer sum flips sign each cycle and adds to each pulse), so
  rough 0 couldn't hold the peaks under 0.1 dB at growl 1.
- **Rough as a square swing, each cycle at a fixed level** — rejected: it isn't band-limited, and
  a cycle's edges, where the level would jump, are not where the waveform is quiet.
- **Rough acting only when growl is above 0** — rejected: the swing makes its own undertones, so
  rough alone is already a rough voice, and tying it to growl would give one control two jobs.
- **Growl adding power on top, the integer harmonics unchanged** — rejected: growl 1 would raise
  the voice about 3 dB, and the level the model sets would mean something else at each growl.
- **The table's span chosen once for the render, from whether growl ever rises above 0** —
  rejected: a growl that starts late would change the samples of the minutes before it. The span
  goes step by step.
- **A table of 4,096 points for two cycles** — rejected: the interpolation error at 2,048 is
  already under the partials' own levels by 40 dB or more, and filling twice the points would
  double the table's cost.
- **Pricing growl only for the windows where it is above 0** — rejected: the cost is a bound on
  the densest window, from the genome alone (0010).
- **Rough as a trajectory** — deferred: nothing asks for it yet.

## Consequences

- Twelve singers at the default root with growl and rough leave about 7 node-seconds under
  `COST_BUDGET` beside a 15 s reverb, acceptance 6's setting, before CG.2 and CG.3 add theirs.
  The half-integer harmonics above the upper resonance are tens of dB down; capping them lower
  than `TOP_HZ` is the first saving if the budget gets tight.
- At the 33 Hz root the lowest half-integer harmonic is at 16.5 Hz, below hearing; it is kept,
  tens of dB down, so the law has no exception, and costs as any other.
- The schema text grows by the two lines, to about 3,960 characters, close to the 4,000 its test
  holds; CG.4 owns that budget.
- Registering the parameters changes what `randomGenome` returns for existing seeds (0003's
  amendment accepts this). No stored genome renders differently, so `ENGINE_VERSION` stays 2;
  every existing golden hash is unchanged, and `chant-growl.json` is new at v2: four singers,
  growl a trajectory from 0.3 to 0.9 to 0.5, rough 0.5, brightness at 0.35.
- Changing the level law, the phase, the swing, the level rule or the span rule changes renders
  of a genome with growl or rough and bumps `ENGINE_VERSION` (0009).
