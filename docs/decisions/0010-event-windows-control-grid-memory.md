# 0010. Events are created in suspend windows, parameters follow a 0.1 s control grid, and a render is one context

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

Step 1f builds `render()`, the master bus and the first voice, the drone. Step 1a's probes
([0002](0002-pin-node-web-audio-api.md)) set the constraints: node-web-audio-api renders on one
thread and processes every node on every 128-frame quantum from its creation, started or not, so
36,000 grain nodes created up front ran slower than real time over 20 minutes, while the same
grains created in 2 s windows, each in a `suspend` 1 s ahead, ran at 14x. A suspend time rounds
up to the next quantum. Oscillators are the main cost: 480 sines with a 12 s convolver ran at
6.1x. [0007](0007-trajectories-time-base-excerpts.md) leaves this record the control-grid step,
and the plan leaves it how the reverb's impulse response is made and how long renders fit in
memory. Step 1g adds the cost unit and budget here.

## Decision

**Event windows.** `render()` splits the rendered span into windows of 2 s of timeline, on
multiples of 2 s from timeline 0. On an `OfflineAudioContext`, a window's nodes are created in a
`suspend` 1 s of context time before the window starts, so the rounded suspend still sits far
more than one quantum before its first event; windows due at or before the context's start are
created at once. A context without `startRendering` and `suspend(time)`, a live one, gets every
window at once, and a test shows that renders the same samples as the windowed path. `render()`
returns a promise that settles when the last window is created; a window that throws still
resumes the context, then rejects the promise, so callers await it together with
`startRendering()`.

A voice type has `build(setup)`, which creates its long-lived nodes into `setup.output` and
returns either nothing or a function `render()` calls once per window with the window's `from`
and `to` in timeline seconds. That function creates nodes only for events that start in
`[from, to)`, indexed on the voice's own grid from timeline 0
([0003](0003-counter-based-prng.md)), and skips events before the render's start, which the
pre-roll covers through the voice type's `longestEvent(voice)`. `render()` applies each voice's
`level` and its `start` and `end` after `setup.output`: `start` and `end` open and close a gate
with 20 ms linear ramps at their exact times, so neither clicks. Voices connect to the bus
sorted by id ([0005](0005-genome-schema-table.md)).

The choice holds for 20 minutes at a granular cloud's density as far as 1a measured it: 1a's
windowed probe, the same shape, rendered 30 grains a second for 20 minutes at 14x with a peak
RSS of 887 MiB. Step 1k sets the grain cap in 0014 and measures again if it is above 30 a
second.

**Control grid.** `CONTROL_RATE` is 10 samples a second; sample k sits at timeline time
`k / 10`. Each automated `AudioParam` (the master fade, the reverb and delay sends, the delay
feedback, each voice's level, the drone's cutoff) gets its value from `effectiveParams` at each
grid time and a linear ramp between, scheduled a window at a time with the events. An excerpt
sets each parameter at its first frame to the value on the ramp between the grid samples either
side, so it plays what a full render plays from there. At 0.1 s, the fastest sweep (a 30 s
period) gets 300 samples a cycle, a fade or a trajectory segment of a second gets ten, and a
900 s render calls `effectiveParams` 9,000 times.

**Master bus.** The voice sum plays dry, through a reverb send into a `ConvolverNode`, and
through a delay send into a `DelayNode` whose output feeds back through a gain (the feedback,
capped at 0.75 by the schema). The three sum into the width stage, which scales the side by
`10^(width / 20)` at every frequency (each output channel takes its own input at `(1 + g) / 2`
and the other at `(1 − g) / 2`), then the master fade gain, then the destination. The bus is
linear and has no limiter; normalization and limiting ([0011](0011-normalize-true-peak-limiter.md))
run on the summed render, so the solo renders of a genome's voices sum to its full render within
a peak of 1e-6, the difference at least 120 dB under the signal (measured: 2.1e-7, 137 dB).

**Fades.** The fade-in rises from 0 at timeline 0 over `fadeIn` along the `smooth` curve of
0007, and the fade-out falls along it to 0 at the last control-grid time before `duration`.
From there to the end the render is exact zeros, 0.1 s when `duration` is a whole tenth. With
`fadeOut` at 0, the gain falls to 0 over that last grid step.

**Impulse response.** Generated in JS from the seed: for each frame and channel, uniform noise
from `draw(seed, "", frame × 2 + channel, GENOME_SLOT.reverb)`, through a one-pole low-pass,
times the envelope `10^(−3t / T)`, which is −60 dB at the decay time T (`reverbDecay`, 1–20 s),
where the response ends. The low-pass cutoff falls as `4000 / sqrt(10^(6t / T) − 1)` Hz, which
makes 4 kHz fall twice as fast as the envelope while frequencies well under the cutoff keep its
decay: the RT60 at 4 kHz is about half that at the low end (test: 4 kHz decays 1.5–2.6 times as
fast as 125 Hz). The two channels are independent noise, scaled together to an energy of 1 per
channel, so `reverbLevel` is about the wet level on steady input at every decay.
`convolver.normalize` is set to `false` before the buffer is assigned, since the default scales
the response by its own energy. A 20 s response takes 55 ms to generate.

**Memory.** A render is one context. Its float output is 384 kB a second of stereo: 115 MB for
300 s, 346 MB for 900 s, 461 MB for 20 minutes. `trimToResult` copies the kept frames out, so
the peak holds the context's buffer and the result together, about twice the output plus the
process. Measured with one drone, an 8 s reverb and the 2 s windows: 60 s rendered at 28.4x
real time with a peak RSS of 187 MiB; 300 s at 28.8x, 343 MiB; 900 s at 28.9x, 791 MiB (under
`nice -n 10` while omlx served). The ceiling the bench (1m) checks is **1.5 GiB peak RSS for a
900 s render**: twice the output and the base process with room for the buffers bells and grains
are computed into (1j, 1k). A single 20-minute context would need about 1.1 GB by the same
arithmetic.

**Drone voice.** Parameters beside the common ones: `root` (33–135 Hz, log, default 55): the
fundamental is the scale note nearest it in 33–135 Hz, found through `tuningFrequencies` for
every tuning; `partials` (4–12, default 8); `slope` (4–8 dB per partial octave, default 6);
`cutoff` (100–2000 Hz, log, default 600, may be a trajectory); `sweep` (0–2 octaves either side
of the cutoff, default 1, may be a trajectory) over `period` (30–300 s, log, default 90), a sine
of timeline time held to 100–2000 Hz; `q` (0.5–4, linear, default 0.7), passed to the node as
`20 log10(q)` dB because Web Audio reads a low-pass Q in dB. Safe ranges keep random drones dark
and low: root 36–75 Hz, 4–8 partials, slope 6–8 dB, cutoff 100–800 Hz, sweep up to 1.5, q up
to 2.

- The stack plays in three copies, detuned by −d, 0 and +d cents with d the common `detune`
  (0–12 cents, default 3), and panned −0.5, 0 and 0.5.
- Each copy plays its harmonic partials from one `PeriodicWave` with
  `disableNormalization: true`; partial n has gain `−slope × log2(n)` dB, scaled so the three
  copies sum to at most 1 before the voice's level. A relative-tuning drone is three
  oscillators.
- In an absolute tuning, a partial within 40 cents of a member of the genome's scale plays the
  nearest member. A `PeriodicWave` holds only harmonics, so each snapped partial is a
  single-sine oscillator of its own in each copy: a Colundi drone runs up to 3 × (1 + snapped)
  oscillators.
- Oscillators start at the voice's `start`, or in an excerpt at the first whole cycle of their
  32-bit-float frequency after the render's start (0007), and stop at `end`. Their phase comes
  from timeline time, so `longestEvent` is 0.
- Macro rows: brightness moves `cutoff` by 0.25 of its range, motion moves `sweep` by 0.25.
- Its schema text is 288 characters, about 30 over the 260 each of the five voices has if they
  share the room equally; the whole text is 1,945 of 3,000.

## Alternatives considered

- **Every event node created up front** — rejected by 1a's probe: 36,000 grains over 20 minutes
  ran slower than real time.
- **Windows driven by `onended` of a silent source, on offline and live contexts alike** —
  rejected because an offline render doesn't wait for event callbacks, so a window could be
  created after its events should have started.
- **A finer grid (0.01 s)** — rejected: ten times the `effectiveParams` calls and automation
  events, for sweeps and trajectories that move over 10 s or more.
- **Copying trajectory breakpoints into Web Audio automation** — rejected in 0007: effective
  values mix trajectories and macros nonlinearly.
- **`convolver.normalize = true`** — rejected because the level would depend on the library's
  normalization formula rather than on code here.
- **A feedback-delay-network reverb from `DelayNode`s** — rejected: a delay in a cycle floors at
  128 frames, and many delay and filter nodes cost render time on every quantum.
- **One oscillator per partial** — rejected: oscillators are the main cost (1a, probe d).
- **Segmented renders** (several contexts joined) — rejected because reverb, delay and filter
  state would change at every join; the measured peak is far under the machine's 64 GB.
- **A per-copy count parameter (2–3 copies)** — rejected to keep the schema text short; three
  copies cost three oscillators.

## Consequences

- 1j and 1k write voices as `build` plus a window function, compute note and grain buffers in
  JS from the seed, and create their `AudioBufferSource`s in the window that holds each event's
  start. A voice whose events last longer than the reverb returns that length from
  `longestEvent`, which lengthens every excerpt's pre-roll.
- A live context gets every window at once, which suits short previews only; a long live
  playback needs windows driven by a clock, which phase 2's preview decides.
- Changing the grid step, the window placement relative to the grid, the impulse-response
  formula or the drone's design changes renders and bumps `ENGINE_VERSION`
  ([0009](0009-engine-version-golden-hashes.md)).
