# Build plan

The phases follow the build order in [spec.md](spec.md). Phase 1 is written step by step, phase 2
is an outline, and phases 3–8 are a few lines each. A phase is expanded into steps when it comes
up, because what the earlier phases ship will change it. How steps are run, briefed and reviewed
is in [agent-rules.md](agent-rules.md).

Each step lists:

- **Builds** — what exists when it's done.
- **Tiers** — the [map.md](map.md) tiers it writes to.
- **Tests first** — the tests that prove it, written and seen failing before the code.
- **Records** — decision records that govern it, and the numbers it must write.
- **Parallel** — what may run beside it. At most two builders run at once.

Checks only the owner can do are marked **pending owner check**, with what to listen or look for.
A run logs them and moves on.

## Decision-record numbers

Numbers are reserved in step order. The ones the owner settled while this plan was written exist
already; the rest are written by the step that holds them. A reserved number that turns out to be
unneeded stays unused rather than being given to another step.

| # | Topic | Step | State |
|---|---|---|---|
| 0002 | node-web-audio-api, pinned at 2.2.0 | 1a | [written](decisions/0002-pin-node-web-audio-api.md) |
| 0003 | Seeded randomness: the PRNG and per-voice streams | 1b | reserved |
| 0004 | Pitch: scales, modes and tunings | 1b | reserved |
| 0005 | Genome schema as one descriptor table | 1c | [written](decisions/0005-genome-schema-table.md) |
| 0006 | Macros as bounded offsets | 1c | [written](decisions/0006-macros-bounded-offsets.md) |
| 0007 | Trajectories and the render time base | 1c | reserved |
| 0008 | Loudness and true peak written here | 1d | [written](decisions/0008-loudness-written-here.md) |
| 0009 | Engine version and golden-render hashes | 1e | [written](decisions/0009-engine-version-golden-hashes.md) |
| 0010 | Event scheduling and the cost budget | 1e | reserved |
| 0011 | Normalization and the true-peak limiter | 1f | reserved |
| 0012 | WAV written here, FLAC through the CLI | 1g | [written](decisions/0012-flac-via-cli.md) |
| 0013 | Pad/swell and bell/pluck voice designs | 1h | reserved |
| 0014 | Granular cloud and noise bed voice designs | 1i | reserved |
| 0015 | The export sidecar JSON and re-render check | 1j | reserved |
| 0016 | Render speed measured by a bench script | 1k | [written](decisions/0016-render-speed-bench.md) |
| 0017 | Phase 1 exposes rendering as a CLI | 1k | [written](decisions/0017-phase-1-cli.md) |
| 0018– | Phase 2 records, numbered when phase 2 is expanded | 2 | — |

## Phase 1 — Engine, schema and macros

**Goal:** an example genome renders offline in Node, deterministically, at least 10× faster than
real time, and exports as a loudness-normalized WAV and FLAC with a sidecar JSON that re-renders
it exactly.

**Acceptance, as measurable checks:**

1. `./scripts/render src/engine/genomes/example.json --seed 1 --duration 300 --out <dir>` writes
   a 48 kHz / 24-bit stereo WAV, a FLAC, and a sidecar JSON.
2. `./scripts/bench` on mbp2021 reports a render-only median of at least 10× real time
   ([0016](decisions/0016-render-speed-bench.md)).
3. The export's integrated loudness is within ±0.5 LU of the genome's target and its true peak is
   at or below −1.0 dBTP, by our meter.
4. ffmpeg's `ebur128` filter reads the same export within ±0.2 LU and ±0.3 dB true peak of our
   meter (manual, [0008](decisions/0008-loudness-written-here.md)).
5. `./scripts/render --from <export.json>` reproduces the export's sample hash.
6. The FLAC decodes bit-identical to the WAV.
7. The golden-render test covers every voice type and the master bus, and passes.

**Gate:** `./scripts/check` passes on `main` after the last merge; checks 1–6 run on mbp2021 and
their numbers are written in Result; the pending owner checks below are logged.

**Pending owner checks** (on mbp2015, after 1k):

- Listen to each voice's golden genome rendered for 30 s, and the 300 s example export. Listen
  for clicks where notes start and stop, zipper noise on filter sweeps, a thump at the start or
  end, metallic ringing or flutter in the reverb tail, whistling aliasing on bright bells, and
  sounds that vanish when the stereo is summed to mono.
- Play the WAV and the FLAC in the player you use on mbp2015. Both should open and sound the
  same.
- Play the export next to an ambient track you know, at the same volume setting. At −20 LUFS they
  should sound about equally loud.

**Result:**

### Steps

#### 1a — Toolchain and renderer spike

- **Builds:** `node-web-audio-api@2.2.0` in `dependencies`, exact version. `flac` added to the
  tools `./scripts/setup` checks. A spike, kept as tests, that answers the questions 0002 leaves
  open: two renders of one graph give identical bytes; `OfflineAudioContext` at 48 kHz stereo
  offers every node the spec names (oscillator with `PeriodicWave`, BiquadFilter, Gain, Delay,
  Convolver, StereoPanner, AudioBufferSource, ChannelSplitter/Merger); whether `suspend(t)`
  works for scheduling ahead; and the shortest delay a `DelayNode` allows inside a feedback loop.
- **Tiers:** none (package.json, scripts/setup, test/).
- **Tests first:** `test/server/offline-context.test.js`: render a 1 s graph using every node
  type twice and compare buffers; render with and without `suspend` scheduling and compare;
  measure the feedback-loop delay floor and assert what the spike found, so a library change that
  moves it fails.
- **Records:** governed by [0002](decisions/0002-pin-node-web-audio-api.md). If any answer
  differs from what the plan assumes, the builder amends 0002 and reports it; the orchestrator
  changes 1e and 1h before briefing them.
- **Parallel:** none. Every later step depends on it.

#### 1b — Seeded randomness and pitch

- **Builds:** a seeded PRNG in `src/engine` with named streams, so each voice draws from
  `stream(seed, voiceId)` and adding or removing a voice never changes another voice's random
  choices. Pitch helpers: scales and modes as degree lists, tunings (12-TET, just intonation
  ratio tables, custom cents per degree), and `frequency(key, mode, tuning, degree, octave)`.
- **Tiers:** engine.
- **Tests first:** the PRNG gives a fixed sequence for a fixed seed (literal values in the test);
  two streams with different ids don't share a prefix; streams are independent of the order
  they're created in. Pitch: A4 = 440 Hz in 12-TET; D dorian's degrees; a just fifth is exactly
  3/2; custom cents shift by the stated amount; out-of-range degrees wrap octaves.
- **Records:** writes 0003 (PRNG algorithm and stream derivation) and 0004 (pitch, tuning and
  reference pitch). Both change renders if they change later, under
  [0009](decisions/0009-engine-version-golden-hashes.md).
- **Parallel:** with 1c and 1d.

#### 1c — Genome schema, validator, trajectories and macros

- **Builds:** the descriptor mechanism and the global section of the schema (key, mode, tuning,
  pulse or none, master reverb and delay, stereo width, loudness target, voice list, macros), the
  assembly of voice descriptors, `validateGenome()` returning the normalized genome or every
  error with its path, the derived JSDoc genome type, and `schemaText()` for the LLM. Trajectories
  as breakpoint lists with a curve per segment, and their evaluation at a time. The macro mapping
  table and `effectiveParams(genome, t)`. No voices yet; 1e adds the first.
- **Tiers:** engine.
- **Tests first:** a valid genome passes and comes back with every default written out; each
  descriptor rule has a fixture that fails with a path-specific message; unknown keys fail;
  every error is listed, not just the first; trajectories evaluate exactly at breakpoints and
  between them for each curve; all macros at 0.5 leave effective values equal to raw values;
  a macro at 1 moves each mapped parameter by its depth along its scale and clamps at the range;
  `schemaText()` stays under a stated character budget.
- **Records:** governed by [0005](decisions/0005-genome-schema-table.md) and
  [0006](decisions/0006-macros-bounded-offsets.md). Writes 0007: the trajectory format, whether
  times are seconds or a fraction of a duration, how a genome loops past its last breakpoint,
  and how `render()` renders an excerpt from an offset (pre-roll so reverb tails are present).
- **Parallel:** with 1b and 1d.

#### 1d — Loudness meter

- **Builds:** BS.1770-4 integrated loudness, momentary and short-term blocks, and 4× oversampled
  true peak, as pure functions in `src/domain`.
- **Tiers:** domain.
- **Tests first:** the EBU Tech 3341 signals, synthesized in the test, each within ±0.1 LU; the
  true-peak cases within Tech 3341's tolerances; silence returns −∞ rather than a number; mono
  and stereo inputs follow the standard's channel weights.
- **Records:** governed by [0008](decisions/0008-loudness-written-here.md).
- **Parallel:** with 1b or 1c. It shares no files with them.

#### 1e — Render core, drone voice and golden hashes

- **Builds:** `render(genome, ctx, {seed, duration, offset})` in `src/engine`, the voice
  registry, the master bus (Convolver with an impulse response generated from the seed, feedback
  delay, stereo width), and the first voice, drone (detuned oscillator stacks, slow filter
  sweeps). `ENGINE_VERSION`. A static `cost(genome)` estimate of concurrent nodes over time.
  The golden test, the committed hash file and the script that writes a new version's entry.
  `src/engine/genomes/` with the first golden genome.
- **Tiers:** engine; test/ for the golden harness; scripts/ for the hash writer.
- **Tests first:** `render()` twice with the same inputs gives the same hash; a different seed
  gives a different hash; a different voice's seed stream doesn't change the drone; the golden
  hash for the drone genome and the master bus matches; the hash writer refuses to overwrite an
  existing version's entry; `cost()` of each golden genome is under the budget and a genome
  built to exceed it fails.
- **Records:** governed by [0009](decisions/0009-engine-version-golden-hashes.md), 0003, 0007.
  Writes 0010: whether events are scheduled all up front or in windows with `suspend()` (from
  1a's answer), how the impulse response is generated, the cost units and the budget.
- **Parallel:** with 1f or 1g.

#### 1f — Normalization and true-peak limiter

- **Builds:** `normalize(channels, {target, ceiling})` in `src/domain`: gain to the target, a
  look-ahead true-peak limiter at the ceiling (−1.0 dBTP by default), and a re-measure that
  repeats the gain step until the result is within ±0.5 LU. It throws when the gain needed exceeds
  a cap, so a near-silent render fails loudly instead of being amplified into noise.
- **Tiers:** domain.
- **Tests first:** a sine at −30 LUFS comes out within ±0.5 LU of −20 with true peak ≤ −1.0 dBTP;
  a signal with sharp transients is limited without its true peak crossing the ceiling; the
  limiter adds no gain change to a signal already under the ceiling; the gain cap throws.
- **Records:** governed by [0008](decisions/0008-loudness-written-here.md). Writes 0011: the
  limiter's look-ahead, attack and release, the iteration limit, and the gain cap.
- **Parallel:** with 1e or 1g, after 1d.

#### 1g — WAV and FLAC writers

- **Builds:** a 24-bit PCM WAV encoder and a FLAC encoder that spawns `flac`, in `src/server`.
- **Tiers:** server.
- **Tests first:** a WAV header carries the right sample rate, bit depth, channel count and data
  size; samples at ±1.0 and 0 encode to the expected bytes and out-of-range floats clip;
  `flac -d` of the FLAC gives samples identical to the WAV; a failing `flac` (bad path) throws
  with its stderr.
- **Records:** governed by [0012](decisions/0012-flac-via-cli.md).
- **Parallel:** with 1e or 1f. It depends only on 1a.

#### 1h — Pad/swell and bell/pluck voices

- **Builds:** the pad/swell voice (ADSR on Gain, chords from the mode via 1b's pitch helpers) and
  the bell/pluck voice (FM from oscillator pairs, and Karplus-Strong; probabilistic triggers from
  the voice's seed stream), each with its descriptors, macro mappings and a golden genome.
- **Tiers:** engine.
- **Tests first:** a golden hash for each voice; chord notes are all in the genome's mode; the
  trigger count over a fixed duration matches the seed exactly and its density parameter on
  average; envelopes ramp rather than jump (no sample-to-sample step above a stated size at note
  edges); `cost()` stays in budget at the voice's maximum density.
- **Records:** governed by 0005, 0006, 0009, 0010. Writes 0013. If 1a finds the feedback-loop
  delay floor is one render quantum (128 frames, so a loop can't play above about 375 Hz at
  48 kHz), Karplus-Strong is computed in JS into an `AudioBuffer` from the seed and played by an
  `AudioBufferSource`, and 0013 says so.
- **Parallel:** with 1i. Both add to the voice registry and the golden hash file; the later merge
  adds its lines after the earlier one's.

#### 1i — Granular cloud and noise bed voices

- **Builds:** the granular cloud (density, grain size, pitch spread; one `AudioBufferSource` per
  grain over a source buffer generated from the seed or rendered from another voice) and noise
  beds (white, pink and brown noise computed into buffers from the seed, shaped by modulated
  filters into wind, rain and surf presets), each with descriptors, macro mappings and a golden
  genome. The sample layer waits for phase 2, which gives it a configured folder.
- **Tiers:** engine.
- **Tests first:** a golden hash for each voice; grain count over a duration matches the seed
  exactly and the density on average; no grain starts or ends with a step (each has a window);
  noise spectra slope as named (pink about −3 dB/octave, brown about −6, measured with a test
  FFT); `cost()` stays in budget at maximum density.
- **Records:** governed by 0005, 0006, 0009, 0010. Writes 0014.
- **Parallel:** with 1h.

#### 1j — Export pipeline and sidecar JSON

- **Builds:** `exportRender(genome, {seed, duration, offset, outDir})` in `src/server`: create
  the `OfflineAudioContext`, render, normalize, write WAV and FLAC, and write the sidecar JSON
  (normalized genome, seed, duration, offset, engine version, schema version, sample rate,
  node-web-audio-api version, loudness target and measured values, and the SHA-256 of the PCM).
  `rerender(sidecarPath, outDir)` that fails if the new hash differs, naming both engine versions
  when they don't match.
- **Tiers:** server.
- **Tests first:** an export of a 3 s golden genome writes three files whose JSON names the
  others; the JSON's hash matches the WAV's samples; `rerender` reproduces it; a sidecar with an
  older engine version fails with a message naming both versions; output paths are inside
  `outDir` and the test roots `outDir` in a temp folder.
- **Records:** governed by 0009, 0011, 0012. Writes 0015: the sidecar's fields and file naming.
  Stems wait for phase 6.
- **Parallel:** none. It joins 1e–1i.

#### 1k — CLI, example genome and bench

- **Builds:** `./scripts/render` and its CLI module, `./scripts/bench`, a manual loudness-oracle
  script that compares our meter with ffmpeg's on an export, and `src/engine/genomes/example.json`:
  a few minutes of drone, pad, noise bed and sparse bells in D dorian at −20 LUFS. The CLI module
  joins `knip.json`'s entries.
- **Tiers:** server; scripts/.
- **Tests first:** the CLI's argument parser rejects a missing `--out`, a non-numeric seed and an
  unknown flag, each with a message; a CLI run on a 3 s golden genome into a temp folder writes
  the three files; `--from` on that export succeeds.
- **Records:** governed by [0016](decisions/0016-render-speed-bench.md) and
  [0017](decisions/0017-phase-1-cli.md).
- **Parallel:** none. Then the orchestrator runs the acceptance checks, writes the Result line,
  and logs the pending owner checks.

## Phase 2 — Vibe and session loop (outline)

**Goal:** the owner opens a vibe, asks for candidates, hears them from mbp2015, and rates them.

**Acceptance, as measurable checks:**

1. Over an owner-started evaluation of at least 48 genomes across at least 3 vibes, at least 90%
   validate after at most one repair round. The script reports the rate before and after repair.
2. Every constraint kind in the spec has a linter rule with a passing and a failing fixture.
3. The candidate grid plays from Safari on mbp2015 (pending owner check).
4. Thumbs, A/B choices (ties included) and notes are stored, and read back after a server
   restart.

**Gate:** `./scripts/check`; the evaluation run's numbers in Result; omlx reached only through
the queue, with tests using a fake.

**Outline of steps** (expanded when phase 2 comes up):

- **Config and paths** — the config module, with the omlx model id, the app-data root and the
  field-recording folder; tests and agent runs root everything in a temp folder.
- **Store** — `node:sqlite` in WAL with migrations; `vibes`, `genomes`, `renders`, `ratings`,
  `sketches` as the spec lists them, append-only for the irreplaceable tables.
- **omlx queue** — one request in flight, backoff when the server is busy or slow, short contexts,
  a fake for tests.
- **Constraints and linter** — the vibe's hard constraints as a schema in `src/domain`, and lint
  rules over the genome and over render checks (clipping, near-silence, DC offset, cost budget).
- **Prompt, parse and repair** — the prompt built from brief, constraints, `schemaText()`, notes
  and locks; JSON extraction; one repair round fed the validator's errors.
- **Excerpt renders and audio serving** — 20–30 s excerpts through 1j's functions; HTTP range
  requests, which Safari needs to play `<audio>`; a format Safari 15 plays.
- **Session UI and ratings** — vibe page, candidate grid, thumbs, A/B and notes, keyboard first,
  checked in Safari 15.
- **Sample layer** — the field-recording voice, reading the configured folder.

**Result:**

## Phase 3 — Ears and steering

**Goal:** the LLM hears measured features before the owner does, and the owner can lock, explore
and branch. **Acceptance:** features (loudness, spectral centroid, onset rate, and more) are
computed per excerpt and written as text in the revision prompt; in an evaluation run, the share
of candidates passing the vibe's feature ranges rises after one revision; locks hold through
explore (a test proves locked values are unchanged); every candidate's parents are stored and
the lineage tree shows them. **Gate:** `./scripts/check`; the revision pass rates in Result.
**Result:**

## Phase 4 — Preference model

**Goal:** a per-vibe model of the owner's taste that ranks candidates and asks good questions.
**Acceptance:** the CLAP sidecar embeds excerpts and text; per-vibe Bradley–Terry over CLAP
embeddings, features and macros, with ensemble or bootstrap uncertainty, and a weaker global
prior; held-out pairwise agreement reported per vibe and compared with a features-only baseline;
active learning picks the pairs with the widest uncertainty; a "what you like" summary is
generated from the model. **Gate:** `./scripts/check` including the sidecar's pytest; held-out
agreement in Result. **Result:**

## Phase 5 — Optimizers

**Goal:** search inside the vibe's constraints, not only through the LLM. **Acceptance:**
preference-based BO or CMA-ES over the macros and selected raw parameters never moves a locked
value and never proposes a genome the linter rejects; a MAP-Elites archive on two or three
owner-chosen axes fills its cells and the map view plays a cell on click; breeding makes children
from two sketches by LLM crossover plus mutation; CLAP text directions become sliders and
reference audio becomes a target region. **Gate:** `./scripts/check`; archive coverage and the
optimizer's agreement with the preference model in Result. **Result:**

## Phase 6 — Track builder

**Goal:** sketches arranged into 3–20 minute tracks. **Acceptance:** sections on a timeline,
crossfade and morph transitions (genome interpolation over time), macro automation curves, an
LLM-proposed structure for a target length and arc; a full-track render of 20 minutes stays at
least 10× real time on the bench and inside a stated memory ceiling; per-voice stems sum to the
full mix within a stated error. **Gate:** `./scripts/check`; bench numbers for a 20-minute track
in Result. **Result:**

## Phase 7 — Album builder

**Goal:** tracks ordered into an album with an arc. **Acceptance:** ordering; energy, brightness
and density arcs; key relationships between tracks; a cohesion and variety readout in CLAP and
feature space; gap filling from the MAP-Elites archive and the optimizer; album export with a
manifest of tracks, durations and re-render info, each track re-renderable from it. **Gate:**
`./scripts/check`; one exported album re-rendered from its manifest. **Result:**

## Phase 8 — Fine-tuning

**Goal:** better first drafts from a small model trained on the owner's choices, never touching
omlx. **Acceptance:** mlx-lm LoRA SFT on kept sketches and DPO on pairwise choices, on a separate
small model, started only by the owner; every adapter versioned with its dataset and metrics;
blind A/B evaluation against the baseline, with the win rate and its confidence interval in
Result. **Gate:** `./scripts/check`; the A/B result. **Result:**

## How to run

- **To start:** say "run step 1c" for one step, "run phase 1" for every remaining step of a
  phase in order, or "continue the plan" for the next unfinished step. The session acts as the
  orchestrator in [agent-rules.md](agent-rules.md), with at most two builders at once, pairing
  steps whose Parallel line allows it.
- **A run stops** when a step needs something AGENTS.md reserves for the owner (a new
  dependency, an omlx setting, a secret); when a review fails twice with the same cause; when an
  API can't do what a step assumes and no remaining step is independent of it; when a phase's
  gate fails; or when the owner says stop. Pending owner checks don't stop a run. At a stop, the
  orchestrator writes `tmp/handoff.md` and lists every pending check.
- **A phase ends** with its gate: `./scripts/check` on `main`, the acceptance checks measured and
  written in its Result line, and the next phase expanded into steps before it starts.
- **Progress** is logged below, newest last, one dated entry per merged step or event: the step
  ID and merge sha, the numbers measured, subagent tokens, tool calls and wall time, and owner
  feedback quoted in their words.

## Progress log

- 2026-11-05: plan written. The owner chose a descriptor-table schema with a validator written
  here, an integer engine version checked by golden hashes, macros as bounded offsets, a bench
  script on mbp2021 for render speed, loudness and limiting written here with ffmpeg as a manual
  oracle, FLAC through the `flac` CLI, `node-web-audio-api` pinned at 2.2.0, and a CLI as phase 1's
  surface (records 0002, 0005, 0006, 0008, 0009, 0012, 0016, 0017).
