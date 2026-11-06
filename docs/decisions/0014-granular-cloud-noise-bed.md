# 0014. Grains and noise are computed in JS into one buffer a window, with grains capped at 30 a second

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

Step 1k builds the granular cloud and the noise bed. Both play many short or continuous sounds,
and node-web-audio-api processes every node on every quantum from its creation, started or not
([0002](0002-pin-node-web-audio-api.md)). Step 1a's windowed probe rendered 30 grains a second,
each an `AudioBufferSource`, a gain envelope and a panner, for 20 minutes at 14x with a peak RSS
of 887 MiB. Under 0010's cost unit that probe costs about 560 node-seconds a second, the whole
budget, so a node-per-grain cloud is over budget once any reverb is added
([0010](0010-event-windows-control-grid-memory.md)). Step 1r asks for the noise bed's default
level at least 30 dB under the drone's, and for grain pitches on a tuned source to snap to the
scale (within 30 cents of a member in an absolute tuning).

## Decision

**Grains are mixed in JS, one stereo buffer per 2 s event window,** played by one
`AudioBufferSource`. The buffer starts on the window's first timeline frame and runs to the end
of its last grain, so windows overlap by at most one grain and sum in the graph. Grains start on
whole frames (`⌈t × 48000⌉`), and a buffer holds only grains that start in its window, so a
window's buffer is the same samples in an excerpt as in a full render.

- **Cost, per grain design,** in node-seconds a second at the densest setting:

  | Design | 30 grains/s, 0.5 s each |
  |---|---|
  | source + gain + panner per grain (probe b) | 30 × 3 × (0.5 + 6) = 585 |
  | one source per grain, envelope and pan baked into its buffer | 30 × 1 × 6.5 = 195 |
  | **one source per window, grains mixed in JS** | 0.5 × (2.5 + 6) + 3 × 15 = **49.25** |

  The last line's second term is the JS mixing: 0.36 ms per grain-second (one grain sounding one
  second), measured on mbp2021, is about 3 node-seconds at the fastest rate 0010 measured
  (1.24e-4 s each), and 30 grains of 0.5 s are 15 grain-seconds a second. A cloud's cost uses the
  highest density and size its trajectories and macros reach (`highestValue`), so the default
  cloud (8 a second, 0.15 s) costs 7.7.
- **Cap: 30 grains a second,** the density's maximum, with grains up to 0.5 s. That is what 1a
  measured over 20 minutes, so 0010 needs no new long-run measurement. Mixing in JS no longer
  makes the cap a render-cost limit (30 a second of 0.5 s grains renders at 27.7x with an 8 s
  reverb); it is kept because 15 grains overlapping already blur into a continuous texture.
- **Candidates.** Candidate k lies at a seeded time in `[k, k + 1) / 30` s and fires with
  probability density / 30 at that time ([0003](0003-counter-based-prng.md)): over 600 s the grain
  count is exactly the number of candidates whose trigger draw is under that, and within 4
  standard deviations of density × 600 (tested at 2, 8 and 25 a second). A grain's draws are
  slots 1–6 (time, pitch, pan, source phase, detune, gain); the source's are slots 7–9.
- **Grain.** A Hann window over the grain's whole length, from a 4,096-point table read with
  linear interpolation, so the first and last samples are 0 and neither edge steps (tested: the
  step into a grain and out of it is under 1e-4 of its peak, the largest step within the first and
  last 5% under a tenth of the largest anywhere). Each grain is panned equal-power within ±0.7,
  and scaled by 0.5 × (0.5 to 1) / √max(1, density × size) so the power stays about even as grains
  overlap.
- **Source.** One second of a tone at 220 Hz, generated from the seed: 6 harmonics at seeded
  levels falling about 6 dB an octave, each swelling ±25% at 1–3 whole cycles a second, so the
  buffer loops without a seam and a grain reading past its end wraps. A grain reads it at
  `hz / 220` from a seeded phase, with linear interpolation.
- **Pitch.** Each grain draws a pitch `root × 2^(spread × (2u − 1))` and plays the scale note
  nearest it among `tuningFrequencies` from 30 Hz to 3 kHz, in every tuning, then detunes by
  ±`detune` cents (at most 12). Every grain is therefore within 12 cents of a scale member, under
  1r's 30. The 3 kHz ceiling keeps the source's sixth harmonic under 18 kHz.
- **Parameters:** `density` 0.5–30 a second (log, default 8), `size` 0.02–0.5 s (log, default
  0.15), `root` 60–1200 Hz (log, default 220), `spread` 0–2 octaves (default 0.5), all
  trajectories. Safe ranges: density 2–20, size 0.05–0.3, root 80–330, spread 0–1. Macro rows:
  density moves `density` by 0.25, brightness moves `root` by 0.15, motion moves `spread` by
  0.25. `longestEvent` is 0.5 s.

**The noise bed computes its noise in JS, one buffer per window,** into one long-lived filter and
swell gain.

- **Colors.** White noise is one draw per frame and channel, keyed by `frame × 2 + channel`
  (slot 1). Pink is Paul Kellet's filter (six one-pole sections and a direct path), brown a leaky
  integrator with pole 0.998 (corner about 15 Hz); each is scaled to white's RMS, 1/√3. Pink and
  brown start each stretch from silence 0.5 s early, by when the slowest pole, 0.99886, has fallen to
  1.3e-12, so a frame's value doesn't depend on which window computes it (tested: under 1e-6
  apart, and buffers of adjacent windows join to 1e-7). Measured slopes from 100 Hz to 12.8 kHz,
  seeds 1–6 over 2^19 samples: white −0.01 to 0.03, pink −3.02 to −2.97, brown −5.95 to −5.90 dB
  an octave; the test allows ±0.25 around 0, −3 and −6.
- **Presets.** Each names a filter, a sweep and a swell, all on the 0.1 s control grid from
  timeline time with period `period`:

  | Preset | Filter | Center | Sweep at depth 1 | Swell at depth 1 | Shape |
  |---|---|---|---|---|---|
  | wind | bandpass, Q 1.2 | 500 Hz | ±1.5 oct | 12 dB | two sines a golden ratio apart |
  | rain | highpass, −3 dB Q | 1.2 kHz | ±0.3 oct | 4 dB | sine |
  | surf | lowpass, −3 dB Q | 350 Hz | ±2 oct | 18 dB | rises in a quarter cycle, falls in the rest |

  Rain adds drops to the noise in JS: 60 candidates a second, 60% falling, each a decaying sine
  of 1–4 kHz (8 ms decay, 1 ms linear attack, 40 ms long) at a seeded pan and level, computed
  from its start in every window so a drop crossing a window boundary is continuous.
- **Level.** Each preset has its own gain, so at its defaults every preset and color plays at
  least 30 dB under a default drone at the same `level`. Measured (seed 1, 1 s reverb, 10 s after
  2 s, BS.1770 integrated): wind 38.8, 33.8, 41.0 dB under in white, pink and brown; rain 31.9,
  36.5, 45.3; surf 44.0, 34.6, 36.1. With the default 8 s reverb each is 0.8 to 1.1 dB less.
- **Parameters:** `color` white|pink|brown (default pink), `preset` wind|rain|surf (default
  wind), `tone` −2–2 octaves on the preset's center (default 0, a trajectory, safe −2 to 0.5),
  `depth` 0–1 (default 0.5, a trajectory), `period` 4–60 s (log, default 10). Macro rows:
  brightness moves `tone` by 0.25, motion moves `depth` by 0.25. `longestEvent` is 0.
- **Cost:** 38 node-seconds a second for any preset: the swept filter (`SWEPT_FILTER_WEIGHT`,
  21, shared with the drone), the swell gain (1), a buffer source a window (4) and computing the
  noise in JS (12: 1.0–1.5 ms a timeline second in a render). Over 120 s renders on mbp2021 a
  noise bed added about 4.4 ms a timeline second beside the bus, of which only 1.0–1.5 was in
  its windows; a swept `BiquadFilter` costs far more than one node, and the drone's measures the
  same, so the drone now counts its filter by the same weight (0010's amendment).

**Engine changes this needed.**

- `render.js` exports `WINDOW` (2 s), for voices whose cost counts a buffer a window.
- `drawer(seed, voiceId)` in `prng.js` absorbs the seed and voice id once and returns the same
  values as `draw`; noise draws a value per frame and channel, and this made it about 3 times
  faster.
- The cloud's cost reads its highest density and size through `highestValue` (step 1j).

**Deferred.** A grain source rendered from another voice needs an engine change: a voice would
need another voice's rendered output while the graph is built, which means a nested render
before the main one, and its cost and determinism rules. The sample layer waits for phase 2, as
the plan says.

**Measured render speed** on mbp2021 under `nice -n 10` while omlx served, 120 s renders with
an 8 s reverb: a default cloud and a default noise bed 26.6x (cost 255); the densest cloud and a
brown rain bed 25.1x (cost 296); the bus with an idle voice 32.0x (cost 220). 163 to
402 MiB resident after each run, the runs sharing one process.

**Excerpts** match their window of a full render within 0007's tolerance (peak 1e-5, 100 dB
under), which each voice's tests hold. Measured on the two golden genomes stretched to 120 s,
10 s excerpts at offsets 5.5, 37.3 and 90 s against a 110 s render, seed 1: the cloud at most
3.7e-8 peak and 138 dB under, the noise beds at most 1.1e-8 and 140 dB under. Windowed and
up-front scheduling render identical samples for both.

## Alternatives considered

- **A source, gain and panner per grain** — rejected: 585 node-seconds a second at 30 grains of
  0.5 s, over the budget before any reverb.
- **One source per grain with the envelope and pan baked into its buffer** — rejected: 195
  node-seconds a second at the cap, four times the mixed design, and a buffer per grain to
  compute anyway.
- **Grains created up front** — rejected by 1a's probe (b): slower than real time over 20 minutes.
- **Noise as one long looped buffer** — rejected: a loop of a few seconds of noise is audible
  as a repeat, and one the length of the render costs its whole length in memory.
- **Pink and brown noise carrying filter state from window to window** — rejected: an excerpt
  starts mid-stream, so its first window would differ from a full render's. The 0.5 s warm-up
  costs 25% more draws and makes every frame a function of the seed and its index alone.
- **A grain cap above 30 a second** — not taken: 1a measured 30 over 20 minutes, and denser
  clouds of grains this long sound continuous.
- **A grain source rendered from another voice** — deferred (above).
- **Grain pitch snapped only in absolute tunings** — rejected: a cloud that ignores a relative
  scale clashes with the drone and pad on the same key.

## Consequences

- Grain and noise renders depend on JS arithmetic (`Math.sin`, `Math.cos`, `Math.exp`, `**`),
  which the golden hashes record the Node version for ([0009](0009-engine-version-golden-hashes.md)).
- Registering the two voices changes what `randomGenome` returns for existing seeds, since it
  draws types from `voiceTypeIds()` ([0003](0003-counter-based-prng.md)'s amendment accepts
  this). No stored genome renders differently, so `ENGINE_VERSION` stays 1.
- Changing the candidate grid, the slots, the window, the source tone, the noise filters, the
  presets or their levels changes renders and bumps `ENGINE_VERSION`.
- The densest cloud with the longest (20 s) reverb costs 565, over the budget, so
  `randomGenome` redraws such genomes; with a 19.7 s reverb or shorter it fits. A noise bed fits
  beside the longest reverb (554).
- The cost weights here are fitted to single measurements on mbp2021 under load; the bench (1m)
  re-measures, including `SWEPT_FILTER_WEIGHT`.
- A sampled or resampled source (another voice, the sample layer) can replace the generated tone
  without changing how grains are scheduled or mixed.
