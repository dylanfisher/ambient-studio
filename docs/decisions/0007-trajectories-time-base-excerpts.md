# 0007. Trajectories are breakpoints in timeline seconds, and an excerpt is a window of the timeline

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

A genome describes one timeline, `duration` seconds long (60–900 s). Some parameters change over
it as trajectories, and the six macros may too ([0006](0006-macros-bounded-offsets.md)). Once
genomes are stored, the trajectory shape is irreplaceable data, so it is settled before any
genome exists. Preference models learn from ratings on short excerpts, and those ratings should
describe the sound a long render plays at that point, not every genome's first 25 s. An excerpt
render has to come close to the same window of a full render, which depends on how the engine
treats time.

## Decision

**Format.** A trajectory is `{"points": [[seconds, value], [seconds, value, curve], ...]}`: 1 to
64 points, times in timeline seconds from 0 to 900, strictly rising, each value in the
parameter's range. Every point after the first names the curve of the segment that arrives at
it; the first point has none, and giving it one is an error. The stored form writes every curve
out, so a later change of the default can't change a stored genome. Times past `duration` are
allowed and never reached.

**Curves.** A curve maps the fraction of a segment's time elapsed, x, to the fraction of its
change made:

| Curve | f(x) | Shape |
|---|---|---|
| `linear` (default) | x | even |
| `smooth` | 3x² − 2x³ | eases out of the start and into the end, with no corner |
| `early` | 2x − x² | most of the change near the start |
| `late` | x² | most of the change near the end |

The move happens along the parameter's scale: on a `log` parameter `linear` is an even move in
octaves, `va × (vb / va)^f`, and on a `linear` one it is `va + (vb − va) × f`. The curves are
polynomials, not `Math.cos`, so the curve itself needs no library function. A log scale still
uses `**` and `Math.log`, whose last bit may differ between JS engines, so renders are promised
bit-identical only on the server's Node ([0002](0002-pin-node-web-audio-api.md),
[0009](0009-engine-version-golden-hashes.md)); a browser plays values close to them.
`valueAt(trajectory, time, scale)` returns each breakpoint's value exactly. An `int` parameter's
value is rounded after evaluation.

**Time base.** Times are seconds on the genome's timeline, the same axis as voice `start` and
`end`, not fractions of `duration`.

**Outside the points.** Before the first point the first value holds; after the last, the last
value holds. Nothing loops: a render never runs past `duration`, where the master fade-out has
ended in silence. Music longer than one genome is phase 6's arrangement of several genomes.

**Effective values.** `effectiveParams(genome, t)` is the one place the engine evaluates
parameters: each trajectory at `t`, then the macro offsets of 0006. A parameter's effective
curve is a nonlinear mix of its own trajectory and the macros' trajectories, so `render()` can't
copy breakpoints into Web Audio automation. It samples `effectiveParams` on a control grid of
absolute timeline times (multiples of one step from 0) and ramps between the samples, so an
excerpt and a full render sample at the same times. Step 1f picks the step in 0010.

**Excerpt offset.** `excerptOffset(genome, seed, length)` returns
`fadeIn + u × (duration − fadeIn − fadeOut − length)`, with `u = draw(seed, "", 0,
GENOME_SLOT.excerpt)` ([0003](0003-counter-based-prng.md)). The whole excerpt lies after the
fade-in and before the fade-out, so the offset is 0 only when the fade-in is 0. It reads
`duration`, `fadeIn` and `fadeOut` only, so voices and their order never move it, and it throws
when the excerpt doesn't fit between the fades or its length isn't positive. The offset is not
rounded; `renderPlan` (1f) converts it to frames.

**Rendering from an offset.** An excerpt renders the timeline from `offset − preRoll` to
`offset + length` and trims the pre-roll (1f's `renderPlan` and `trimToResult`):

- The pre-roll is at least the reverb's decay (`reverbDecay`, an RT60) plus the delay's feedback
  decay, the time the echo loop takes to fall 60 dB: `delayTime × 60 / (−20 log10 feedback)`,
  with the highest effective feedback over the timeline, and 0 when feedback is 0. A voice whose
  events last longer than that (a 30 s pad release) adds its longest event, so every event
  audible in the window starts inside the render. The pre-roll stops at timeline 0.
- Voices index event candidates on their own grid from timeline 0 (0003), so a window holds the
  same events as the full render.
- Oscillator and LFO phases come from absolute time, not from when the render started: an
  oscillator of fixed frequency f that sounds from timeline time t0 is started at the first
  whole cycle, t0 + ⌈(renderStart − t0) × f⌉ / f, on or after the render's start. The master
  fades are functions of timeline time.
- Filter, reverb and delay state only converge during the pre-roll, as does the phase of an
  oscillator whose frequency moves. An excerpt is therefore close to the same window of a full
  render, not identical. Step 1f measures the difference on a golden genome and writes the
  tolerance here.

## Alternatives considered

- **Times as a fraction of `duration`** — rejected because changing `duration` would stretch
  every sweep and move every event, voice `start` and `end` are already seconds, and the LLM
  reasons about a timeline in seconds.
- **One curve per trajectory** — rejected as too coarse: a swell that rises slowly and falls
  fast needs two shapes.
- **A curve on the point a segment leaves** — rejected because the last point's curve would mean
  nothing, and the arriving form matches Web Audio's `rampToValueAtTime(value, time)`.
- **A `step` curve that holds and then jumps** — rejected because a jump in gain or cutoff
  clicks; two points close together give a fast move instead.
- **Trajectories that loop past their last point** — rejected because a render ends at
  `duration` anyway, and a repeat the LLM wants can be written as points.
- **Easing with `Math.cos`** — rejected because a polynomial does the same job with plain
  arithmetic.
- **Excerpts placed only where voices play** (between the earliest `start` and latest `end`) —
  rejected because `start` and `end` don't say a voice is audible (its level trajectory may be at
  −60 dB); the phase 2 linter is the place to flag silent stretches.
- **Excerpts always at offset 0** — rejected because ratings would describe every genome's
  fade-in rather than the sound a long render plays.

## Consequences

- The vector view moves a trajectory's start and end values only; times and curves stay as the
  LLM or a mutation wrote them ([0005](0005-genome-schema-table.md)).
- `delayFeedback` is capped at 0.75 so the pre-roll stays bounded: at 0.9, a 2 s delay needs
  about 131 s to fall 60 dB; at 0.75 it needs about 48 s, so the worst case is about 68 s (with
  20 s of reverb) ahead of a 25 s excerpt. Narrowing the cap after genomes are stored would
  invalidate some of them, so it is set now.
- A new curve name can be added later without a migration. Changing what an existing name
  computes changes renders and bumps the engine version
  ([0009](0009-engine-version-golden-hashes.md)).

## Amendments

- 2026-11-06: from step 1f, as built. Each item is provisional: owner to confirm.
  - **Tolerance.** An excerpt differs from the same window of a full render by a peak of at
    most 1e-5, with the difference's RMS at least 100 dB under the window's RMS.
    `test/engine/render.test.js` holds it on the drone's golden genome, on voices that start and
    end inside the render, on a Colundi drone with snapped partials, and on a test voice with
    events in every window.
  - **Measured** on mbp2021, seed 1, 10 s excerpts against full renders of the golden drone
    genome (`src/engine/genomes/drone.json`) changed to `duration` 900, `reverbDecay` 8,
    `delayTime` 0.75 and `delayFeedback` 0.35 (12.9 s of pre-roll): at offsets 30, 450 and
    860 s a peak of at most 8.3e-7, 120 dB under. The same genome with `duration` 400,
    `reverbDecay` 1 and `delayFeedback` 0, against a 310 s render: at 30, 150 and 300 s at most
    8.3e-7, 122 dB under.
  - **Sources found and removed while measuring.** (1) The library starts an oscillator
    between frames in a way that doesn't give the phase the formula above assumes: an oscillator
    started at the first whole cycle after the render's start differed by a peak of 1.8e-3 at
    some offsets. Oscillators now start on whole frames, the voice's first frame
    `⌈start × 48000⌉` or the render's first frame, and the phase the voice has reached by then
    is rotated into the `PeriodicWave` (real and imaginary parts `g·sin nφ`, `g·cos nφ`).
    (2) With a short reverb, the excerpt's first moments differed by a peak of 1.4e-5: the
    oscillators' late start at the render's beginning reached the offset through the reverb's
    −60 dB tail. Whole-frame starts removed it too (7.8e-7 at 150 s with a 1 s reverb), so the
    pre-roll has no margin added; a 0.5 s margin was tried and isn't needed. (3) A render
    ending on a 2 s window boundary missed its last control-grid sample, so its final 0.1 s
    held instead of ramping; that, not the excerpt, was the 5.2e-4 first reported at 860 s,
    and a test now checks that a render's samples don't depend on where it ends.
  - **Pre-roll.** The highest feedback is sampled on the control grid
    ([0010](0010-event-windows-control-grid-memory.md)) from 0 to the offset. The context
    starts on a whole 128-frame render quantum at or before `offset − preRoll`, so an
    excerpt's quanta line up with a full render's. `renderPlan` throws on a window that runs
    past the genome's `duration`.
  - **Fades** are sampled on the control grid like every other parameter: the fade-in rises
    from 0 at timeline 0, the fade-out falls to 0 at the last grid time before `duration`, both
    along the `smooth` curve, so a render ends in exact zeros.
