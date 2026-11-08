# 0010. Events are created in suspend windows, parameters follow a 0.1 s control grid, and a render is one context

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm; amended by
  [0062](0062-track-render-and-export.md) (a track renders as chunks, each its own context)

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
returns a promise that settles when the last window is created; a window created in a
suspend that throws still resumes the context, then rejects the promise, so callers await it
together with `startRendering()`. A window created at once throws out of `render()`.

A voice type has `build(setup)`, which creates its long-lived nodes into `setup.output` and
returns either nothing or a function `render()` calls once per window with the window's `from`
and `to` in timeline seconds. That function creates nodes only for events that start in
`[from, to)`, never at or after `to`, indexed on the voice's own grid from timeline 0
([0003](0003-counter-based-prng.md)), and skips events before the render's start, which the
pre-roll covers through the voice type's `longestEvent(voice)`. A voice calls `automate` only
inside `build`, since `render()` sets each automated parameter's start value once `build`
returns. `test/support/pulse-voice.js` is the reference for the window path: a burst every
0.5 s from timeline 0, window boundaries included, rendered identically windowed and up front. `render()` applies each voice's
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
grid time and a linear ramp between, scheduled a window at a time with the events. The last
window also takes the first grid sample at or after the render's end, so a render's samples
don't depend on where it ends. An excerpt
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

**Cost unit and budget** (step 1g; provisional, owner to confirm). The gate can't time renders
([0016](0016-render-speed-bench.md)), so `cost(genome)` in `src/engine/cost.js` estimates the
render time from the genome alone. The library processes every node on every quantum from its
creation to its end, so the unit is the **node-second alive per second of timeline**: about how
many nodes are alive on average. It sums:

- 1 for every node that lives through the render: oscillators (each `PeriodicWave` oscillator
  of a drone stack, and each single-sine oscillator of a snapped partial), filters, gains,
  panners, the delay, the splitter and merger, and the destination. The bus has 14; `render()`
  adds a gate and a level gain per voice. A test counts the nodes a render of each golden genome
  creates and checks the count against `cost()`.
- **25 for each second of the reverb's impulse response** (`IR_WEIGHT`), a fixed cost while the
  render runs. Probe (d) over 60 s ran at 7.9x without its 12 s convolver and 6.1x with it, so
  12 s of response cost as much as about 300 other nodes.
- For events created in windows, `eventCost({rate, seconds, nodes})` = rate × nodes × (seconds
  + 6): each node costs the seconds it sounds plus **6 node-seconds** (`EVENT_OVERHEAD`). It
  waits up to 3 s from its window's creation, and probe (b)'s windowed grains, 30 a second of 3
  nodes each at 14x, cost about 3 s more each than that wait and their sound. This is what a
  count of concurrent nodes misses: at 30 grains a second, a few nodes sound at once, while
  about 560 node-seconds a second are alive.

Each voice type gives its own cost through `cost(voice, genome)` in the registry
(`src/engine/voice-registry.js`): its nodes at its densest setting, counting the highest value
a trajectory or a macro can reach, so the sum bounds every window. `cost()` adds the bus and
counts every voice as if all played at once. Oscillators weigh the same as other nodes: 1a's
probes don't separate an oscillator from the gain it played through.

Calibration: the seconds of render time one node-second costs, from each measurement:

| Measurement | Cost | Speed | Seconds per node-second |
|---|---|---|---|
| Probe (d): 1,021 nodes, 12 s response, 720 s | 1,321 | 6.1x | 1.24e-4 |
| Probe (a): 40 oscillators and filters, 200 sources, 6 s response, 60 s | about 432 | 15.8x | 1.47e-4 |
| Probe (b), windowed: 30 grains/s of 3 nodes, 20 min | about 560 | 14x | 1.28e-4 (sets the overhead) |
| 1f's drone, 8 s response, 900 s | 223 | 28.9x | 1.55e-4 |

The **budget is 560** node-seconds a second (`COST_BUDGET`). At the slowest rate measured (the
drone's, 1.55e-4) a genome at the budget renders at 11.5x real time, and at probe (d)'s rate at
14.4x, against phase 1's target of 10x. It admits:

- every valid master bus with a voice: the longest response (20 s) costs 514 with the bus's
  nodes, so a 20 s reverb leaves room for little more than one drone or one bell voice;
- the densest bell setting 1j builds over 900 s or any length (the cost is a rate, so it doesn't
  grow with the duration): 40 notes a minute, each note computed into a buffer and played by one
  buffer source and its gain for a 15 s ring, costs 2/3 × 2 × (15 + 6) = 28, and 544 with the
  longest response (a test checks it);
- the golden genomes: the drone 73, the master bus 101. Random genomes without a cap cost 48 to
  538 over 200 seeds.

It does not admit probe (b)'s grain cloud, about 560 on its own: 1k's grain design (0014) must
cost less per grain or cap the rate lower. `randomGenome(seed, {costCap})` draws until a genome
costs at most the cap (the budget by default, `Infinity` for none), continuing the seed's draw
sequence so the result stays fixed by the seed, and throws after 100 draws over the cap.

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
- Oscillators start on a whole frame: the voice's first frame, `⌈start × 48000⌉`, or in an
  excerpt the render's first frame, with the phase reached by then (from the 32-bit-float
  frequency the node holds) rotated into the `PeriodicWave`. Starting at a fractional time
  left the phase to the library and differed by up to 1.8e-3 between an excerpt and a full
  render (0007). They stop at `end`. Their phase comes from timeline time, so `longestEvent`
  is 0.
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
- Every voice type gives a `cost`, and 1j and 1k test it at their maximum density. The weights
  are fitted to four measurements and miss each by up to 25%; the bench (1m) re-measures, and
  its numbers can move the weights or the budget.

## Amendments

- 2026-11-06: step 1g adds the cost unit, its weights and the budget of 560, calibrated on 1a's
  probes and 1f's drone measurement, and the cost cap on `randomGenome`. Provisional: owner to
  confirm.
- 2026-11-06: under a full test run, about half the runs failed with `InvalidStateError: Error
  in async function` from `OfflineAudioContext.suspend`. The crate registers a suspend when its
  future is first polled and refuses it once `start_rendering` has taken the renderer, and the
  binding polls the two on a runtime, so `startRendering()` can win although `render()` called
  `suspend()` first ([0002](0002-pin-node-web-audio-api.md)). Awaiting a macrotask between them
  did not remove it (4 of 8 full runs still failed, against 3 of 4 before). The offline
  sequence therefore retries on exactly that error, on a fresh context, at most 3 attempts,
  reporting each retry and throwing the original error after the last. A failed attempt never
  yields samples, so a retry renders the same bytes and `ENGINE_VERSION` stays 1. The sequence
  is `renderOffline`, in `src/server/render-offline.js` since step 1l, which the export and the
  tests both call. Provisional: owner to confirm.
- 2026-11-06: the retry above ran out in 1 of 3 gate runs (all 3 attempts refused in the
  export re-render test), and the retries ran back to back. Step 1g now waits in real time
  between scheduling a render and starting it: 10 ms on the first attempt, then 50, 200, 500,
  1000 and 2000 ms, with 6 attempts. The wait gives the library's runtime time to register the
  queued suspends, and a retry that lands in the same stall as the refusal fails again, so the
  waits grow. Nothing can stop a refused attempt's render, because the crate has no abort: it
  renders on to the end. A stress harness of 16 worker threads, each running 4 concurrent
  10 s renders of `example.json` (64 renders a run), while `vitest run` looped at `nice -n 10`,
  measured refused attempts and renders that failed. In one process, even 48 concurrent 30 s
  renders under the same load never refused a suspend (about 4,000 renders), so the race needs
  many threads. Before: 40 refused attempts in 256 renders, and 2 renders failed after 3
  attempts. With 20 ms and 50 ms retry waits, the second attempt was refused in about 4 of 5
  cases after a refused first. After: in 384 renders, 25 refused first attempts, 10 refused
  second and 4 refused third attempts, and no render failed. A fixed 300 ms wait before every start cut first-attempt refusals to 0 and 3 in 64,
  but costs 300 ms a render, so the first wait stays short. Refusals do not vanish; the retries
  absorb them. Residual risk: a machine slower than the harness's load could refuse 6 times in a
  row, and the original error is then thrown after the last attempt. Samples are unchanged,
  so `ENGINE_VERSION` stays 1. Provisional: owner to confirm.
- 2026-11-06: from step 1j, provisional: owner to confirm. The densest pad and bell together
  (cost 289) rendered 60 s at 15.7x (FM bells) to 19.7x (plucks) with an 8 s reverb, and 900 s
  of additive bells at 18.6x with a peak RSS of 923 MiB, under the 1.5 GiB ceiling. Bell notes
  are computed in JS (9–29 ms per 15 s note), time the cost unit doesn't count: the densest
  FM bell adds about 0.019 s of JS per second of timeline, which would bring a genome filled to
  the budget from 11.5x to about 9.4x. The bench (1m) checks it
  ([0013](0013-pad-and-bell-voices.md)).
- 2026-11-06: from step 1k, provisional: owner to confirm. `render.js` exports `WINDOW` (2 s),
  for voices whose cost counts a buffer a window ([0014](0014-granular-cloud-noise-bed.md)).
  Measured over 120 s renders with an 8 s reverb, a voice whose `BiquadFilter` frequency is
  automated on the control grid takes about 2.5 ms more a timeline second than its node count
  says, about 20 node-seconds: the drone (2.9 ms beside the bus) and the noise bed both show
  it. `SWEPT_FILTER_WEIGHT` in `cost-unit.js` (21, the node included) counts such a filter
  for both voices, which raises the drone's cost by 20 (the drone golden 73 to 93, the bus
  golden 101 to 121); renders don't change.
- 2026-11-06: **renders don't depend on garbage collection** (step 1m, provisional: owner to
  confirm). The library sums a node's inputs in an order that changes when V8 collects a node
  and its id is reused ([0002](0002-pin-node-web-audio-api.md)'s amendment of this date), so
  re-rendering a 300 s export of `example.json` changed its PCM hash. Two rules fix it:
  - `render()` keeps every node created before rendering starts (the bus, the gates and levels,
    every node a voice's `build` makes, and the windows created at once) referenced until the
    last window is created; it wraps the context's `create…` methods to collect them. These
    nodes then keep the lowest ids and the same ids every run. The crate's depth-first sort
    reverses its post-order (`graph.rs`), so higher ids, the event nodes, are processed before
    the held ones. That doesn't matter: no node has both held and event inputs, so the order
    among held nodes is fixed by their ids and the order among event nodes never meets a held
    one.
  - Event nodes created in windows may be summed in any order, so at most two of them may be
    nonzero into one long-lived node at any frame. The bell connects each note through one of
    eight slot gains created in `build` (`eventSlots` in `src/engine/event-slots.js`), the first
    free from the note's first frame; the cap keeps eight sounding at most. The pad's envelope
    moves from a gain per note to long-lived gains in groups: chord c uses group c mod G, where
    G is 3 × ⌈⌈(hold + release) / hold⌉ / 3⌉ (3 for every valid pad), so a group carries one
    chord at a time, and in a group notes j and j + 3 share a gain when ⌊j / 3⌋ is even, which
    keeps the `(j + c) mod 3` panning. A pad note is now its oscillator alone. A granular
    window's buffer runs at most 0.5 s past its 2 s window, and noise buffers abut, so both
    already meet the rule.
  - The rule for future voices: no node may receive event (transient) inputs together with
    long-lived inputs, and at most two event inputs may be nonzero at once at any node. The
    crate sums a node's inputs as `((i1 + i2) + i3)` in processing order, and floating-point
    addition commutes for two terms only, so a third nonzero event input would make the sum
    depend on which node got which id.

  Costs: the bell gains 8 (its densest 36, 552 beside the longest reverb); the pad gains its
  envelope gains (3 to 4 a group) and loses a gain a note (its densest 43.2 to 37.6, 551.6
  beside the longest reverb); `example.json` costs 320.4. Renders change, so `ENGINE_VERSION`
  is 2: the bell, Colundi, example and pad goldens moved; drone, master bus, granular cloud and
  noise bed did not.

  Checked on mbp2021 under `nice -n 10`: the test renders a genome with dense bells, a
  seven-note pad and a drone that stops at 3 s, once keeping every node and once forcing a
  collection at every suspend, and requires the same samples; it failed before the change
  (peak difference 2.2e-8), failed with the slots but without keeping (1.5e-8), and a 30 s bell
  at 40 notes a minute and 15 s ring failed with the keeping but without slots (694,686
  samples, up to 4.5e-8). A 300 s export of `example.json` with seed 1 and its `--from`
  re-render give the same PCM SHA-256 (`8e2309d3…`), two 300 s renders of `colundi.json` in
  separate processes too (`70a99e56…`). The bench at 300 s: render alone 23.1x median, peak RSS
  575 MiB; with the export 19.0x, 672 MiB. Only the nodes created before rendering are kept,
  a few dozen, so memory doesn't grow with length.

  Rejected: **releasing event nodes at window boundaries and forcing a collection there**
  (`--expose-gc`, then waiting for N-API finalizers before `resume()`). It relies on one forced
  collection reaching every released node and on finalizer timing, neither of which V8 or Node
  promises; a node it missed would still be freed at a time V8 picks. Every process that renders
  would need the flag, and the hook would do nothing in a browser. **Keeping every node for the
  whole render**: two 300 s renders matched, but it cost about 14.4 s against 13 s, and the
  densest bell's buffers over 900 s would need about 3.4 GB, over the 1.5 GiB ceiling.
- 2026-11-07: from step 6c ([0062](0062-track-render-and-export.md)). A track, up to 20 minutes, renders each section's
  window as 120 s chunks, each its own context with its own pre-roll, and joins them; the
  rejection of segmented renders above stands for one genome's render, which stays one context.
  The joins differ from one render of the window within 0007's tolerance, which the chunk test
  holds at every seam, and the chunk length is in each track's manifest. A track's peak RSS on
  the bench is about 600 MiB at 20 minutes, under phase 6's 1 GiB ceiling for a track; 0010's
  1.5 GiB ceiling for one 900 s genome is unchanged.
