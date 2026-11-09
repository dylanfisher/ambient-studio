# 0089. Chant flutter and shimmer wander each singer's pitch and level by a seeded 1/f sum of sinusoids

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm. Amends
  [0070](0070-chant-singers-and-breath.md) (the singers' draws and slots, how a chorus singer
  reads the table, the cost).

## Context

Step CG.2. After phase CV the owner said the chant lacks "the quicker changes that come from
breathing": every singer holds a perfectly steady pitch and level, and nothing in the voice moves
faster than the pulse swell except the breaths. Acceptance 2: `flutter` (0–1) gives each singer
a seeded 1/f pitch wander, at the default on value 2–8 cents RMS with at least 70% of its power
in 1–8 Hz; `shimmer` (0–1) a level wander of 0.3–1.5 dB RMS; two singers' wanders correlate
under 0.2. The plan asks for a sum of a few seeded sinusoids from about 1 to 8 Hz, drawn on
fixed slots (0003) so adding a singer or turning a wander on moves no draw, computed from
timeline time so an excerpt equals its window of a full render, and read by the chorus from the
shared table at its wandering phase so wander costs no partials. Every stored genome and golden
must render the same bits, so the engine version stays 2 (0009). CG.1 left twelve singers with
growl and rough about 7 node-seconds under `COST_BUDGET` beside a 15 s reverb (0088), and CG.3
still needs room.

## Decision

**What 1 means.** `flutter` 1 is a pitch wander of 5 cents RMS and `shimmer` 1 a level wander of
0.7 dB RMS, near the middle of each acceptance range on a log scale; both scale linearly to 0.
1 is the on value: the model turns a wander on with 1 and softens it below.

**Shape.** A wander is a sum of seven sinusoids, part i in the hertz from 1 + i Hz, so the parts
lie from 1 to 7.8 Hz. One part a hertz at an amplitude of 1/√f has a power spectrum falling as
1/f, the 1/f wander the plan names. Each part has a seeded phase, and the amplitudes are scaled
so the sum's RMS over a long time is exactly the target (the parts' a²/2 add). Over 20 s at 1 the
measured RMS is 4.94–5.08 cents and 0.69–0.71 dB across seeds 1–30 and twelve
singers; all of the power lies in 1–8 Hz by construction, and 99.1–99.9% of it measured on the sound.

**Singers apart.** Part i's place in its hertz is one seeded draw for the voice, and singer s
sits s × 0.618… (the golden ratio's fraction) past it, wrapped into [0, 1) and scaled into the
first 0.8 Hz. The golden ratio's fraction keeps any 12 singers' places at least 0.056 apart, and
the unused 0.2 Hz at the top of each hertz keeps one singer's part i from another's part i + 1.
Measured over 20 s, seeds 1–30, all 66 pairs of twelve singers, pitch and level: the largest
correlation is 0.175 (0.158 over 30 s). Over 10 s it reaches 0.52: two sinusoids 0.045 Hz
apart can't part in less than about one beat, so the test measures 30 s.

**Draws and slots.** A singer's draws keep its index as the event index (0003). The wanders'
slots start at 2^31, past any phrase slot a render can reach (a phrase lasts at least 1.5 s, so
900 s holds at most 600): part i's place is the draw at event index 0, slot `flutter + i`, shared
by every singer, and singer s's phase for it is at slot `flutter + 7 + i`; `shimmer` is 14 slots
on. At 0 a wander draws nothing. Adding a singer moves no one's draws (tested with both wanders
on), and turning a wander on moves no detune, pan, phase or breath (tested).

**Pitch.** A singer's frequency is its plain frequency times 1 + c ln 2 / 1200 for a wander of c
cents, within 0.02 cents of 2^(c/1200) at 8 cents. So its phase gains its frequency times the
lag, the wander's integral times ln 2 / 1200, which each part gives exactly from timeline time:
−a cos(2π f t + φ) / (2π f). The product's rate of change differs from the wander by the lag, at
most about 1 ms, times the bend's rate: 0.001 cents for a bend of 100 cents over two minutes,
and a few cents only while a bend sweeps its whole 400 cents within one 0.1 s step. The lag is computed
at 20 points a control-grid step, 200 a second, and the frames between two points take the line
between them; over a segment the phase is then a quadratic in the frame's place in the grid
step, q0 + u (q1 + u q2), whose terms fold in the step's frequency ramp, the singer's detune and
seeded phase and the table's span. The lead sums its partials at that phase, and a chorus singer
reads the shared table at it, so a wander costs no partials and needs no table of its own. Each
part's sine and cosine are taken at the step's start and turned through the 20 segments by a
fixed rotation, so a step costs four `Math.sin` or `Math.cos` a part. Measured on one singer's
sound (harmonic 5's phase, demodulated and differenced at 100 Hz), the pitch wander follows the
voice's own `wanderAt` to an RMS ratio of 0.99 (4.93–4.97 cents against 4.98–5.03, seeds 1–3) and a correlation of 0.9995; a chorus singer,
isolated by subtracting the lead, follows its own the same way.

**Level.** The level wander in dB becomes a gain at the same points and is multiplied into each
singer's samples on the line between them. A singer without shimmer multiplies by 1 + 0 u,
exactly 1, so its bits don't change. Measured on the sound per cycle of f0, the level follows
`wanderAt` to an RMS ratio of 0.99 (0.696–0.699 dB against 0.700–0.702) and a correlation of 0.995.

**Windows.** Every point depends on its grid step and segment alone, and every frame on its
segment's points and its own place, so a window computes the same bits wherever it starts
(tested at three splits and from a track started at 40 s, and excerpts at 0.7, 3.35 and 6.1 s
within 0007's tolerance, with chorus singers breathing).

**At 0.** A singer with neither wander runs the loops it ran before, so a genome without flutter
or shimmer renders as at the commit before this step: every golden hash is unchanged.

**Parameters:** `flutter` 0–1 (default 0, "pitch wander") and `shimmer` 0–1 (default 0, "level
wander"), neither a trajectory and neither with a safe range; no macro moves them. Shimmer is
also a cymbal parameter, with another meaning; the names are the plan's, and a parameter belongs
to its voice type.

**Cost:** per singer, 0.15 node-seconds with shimmer and 0.05 with flutter. Timed alone on
mbp2021 under `nice -n 10` while omlx served, the voice's JS over 30 s in 2 s windows, modes
round-robin, median of 7, ms a timeline second at the 65 Hz root:

| singers | plain | flutter | shimmer | both | growl, rough | all four |
|---|---|---|---|---|---|---|
| 1 | 7.53 | 7.49 | 7.53 | 7.51 | 14.61 | 14.60 |
| 6 | 10.08 | 9.61 | 10.17 | 9.64 | 17.12 | 16.74 |
| 12 | 12.40 | 11.43 | 12.57 | 11.60 | 19.48 | 18.69 |

Shimmer adds about 0.017 ms a singer, its points and a multiply-add a frame. Flutter's points
take about 0.005 ms a singer, and its quadratic phase has no division where the plain phase has
three, so a fluttering singer measured faster than a plain one; the weight prices the points and
doesn't credit the saving, so the cost stays a bound. The plain path, at the commit before this step, measured
7.49, 9.98 and 12.26 ms in the same run: about 0.1 ms slower at twelve singers now, within the
spread of repeated runs. Twelve singers at the default root with growl, rough, flutter and
shimmer cost 164.3 (161.9 without the wanders), and fit beside a reverb of up to 15.19 s.

## Alternatives considered

- **Amplitudes falling as 1/f** — rejected: its power falls as 1/f², the slowest part holds 55%
  of the power, the wander moves more slowly than the owner asked for, and the slow parts made
  singers correlate more (worst pair 0.185 against 0.158 at the same spacing over 30 s).
- **Each singer's frequencies drawn freely in each hertz** — rejected: measured over 60 s, 14 of
  1,320 pairs correlated above 0.2, as two singers' slow parts fell within a hundredth of a hertz.
- **Golden-ratio places across the whole hertz** — rejected: a singer near the top of hertz i
  and another near the bottom of hertz i + 1 correlate (0.22 measured over 20 s).
- **The exact 2^(c/1200)** — rejected: its integral has no closed form, so the phase would need
  summing from timeline 0; the linear form differs by under 0.02 cents.
- **A `Math.sin` a part a frame** — rejected: seven parts, two wanders and twelve singers are
  over 8 million calls a timeline second.
- **The lag and gain as arrays a frame**, interpolated from 400 points a second — rejected after
  measuring: the extra passes cost about 0.17 ms a singer each, about 35 node-seconds for twelve
  singers with both.
- **The points by `Math.sin` each** — rejected after measuring: 147 calls a wander a step made
  shimmer cost about three times what it does by rotation.
- **Phase accumulated sample by sample** — rejected: an excerpt's first window would start from
  another phase (0069).
- **Flutter and shimmer as trajectories** — deferred: the lag times a moving flutter isn't the
  integral of the scaled wander, and nothing asks for movement yet.
- **A per-singer drawer or a voice id of its own for the wanders** — rejected: the plan asks for
  the voice's drawer on fixed slots.

## Consequences

- With twelve singers, growl, rough, flutter and shimmer, the cost leaves 4.7 node-seconds
  under the budget beside a 15 s reverb, for CG.3. 0088's lower top for the half-integer
  partials would take back room, but it changes the samples of every genome with growl,
  `chant-growl.json`'s golden among them, so it needs an engine version or a genome-side switch;
  it isn't taken here.
- The schema text grows by the two lines, 62 characters, which would take it to 4,023, over the
  4,000 `schema-text.test.js` holds (0072). So five of the chant's own descriptions are shorter:
  focus "upper formant boost", spread "detuned ±this", pan "panned ±this", phrase "between
  breaths" and breath "0 = no breaths", 26 characters, and the text is at 3,997. CG.3 and CG.4
  have no schema room left: each new parameter needs room found first, or CG.4 moves the limit.
- Registering the parameters changes what `randomGenome` returns for existing seeds (0003's
  amendment accepts this). No stored genome renders differently, so `ENGINE_VERSION` stays 2;
  every existing golden hash is unchanged, and `chant-flutter.json` is new at v2: five singers
  breathing, growl and rough 0.3, flutter 1, shimmer 0.8, motion at 0.6.
- Changing the parts, their spacing, the RMS at 1, the slots, the segments, the linear pitch
  form or the rotation changes renders of a genome with flutter or shimmer and bumps
  `ENGINE_VERSION` (0009).
