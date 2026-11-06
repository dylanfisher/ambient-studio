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
   ([0016](decisions/0016-render-speed-bench.md)), and peak memory under the ceiling 0010 sets.
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
  works for scheduling ahead; the shortest delay a `DelayNode` allows inside a feedback loop;
  and a cost probe: a 60 s render with a 6 s stereo Convolver, 40 oscillators and 200 buffer
  sources, timed once by hand so a 10× problem shows up now rather than at 1k.
- **Tiers:** none (package.json, scripts/setup, test/).
- **Tests first:** `test/server/offline-context.test.js`: render a 1 s graph using every node
  type (a `PeriodicWave` oscillator and a buffer source started off a 128-frame boundary
  included) in three fresh Node processes and compare hashes, since two renders in one process
  can match while separate runs differ; render with and without `suspend` scheduling and compare,
  including a node created in a suspend callback that must start on its exact sample; measure the
  feedback-loop delay floor and assert what the spike found, so a library change that moves it
  fails. The spike also reports whether offline rendering uses one thread.
- **Records:** governed by [0002](decisions/0002-pin-node-web-audio-api.md). If any answer
  differs from what the plan assumes, the builder amends 0002 and reports it; the orchestrator
  changes 1e and 1h before briefing them. If renders are not identical across processes, the run
  stops here: golden hashes (0009) can't work, and the owner decides what replaces them.
- **Parallel:** none. Every later step depends on it.

#### 1b — Seeded randomness and pitch

- **Builds:** a counter-based PRNG in `src/engine`: every draw is a hash of
  `(seed, voiceId, eventIndex, slot)`, not the next value of a running stream. Adding or removing
  a voice never changes another voice's choices, and changing one parameter doesn't shift every
  later draw, so the sound under a fixed seed moves smoothly as parameters move, which the
  optimizers (phase 5) and morphing (phase 6) depend on. Probabilistic triggers use thinning:
  one draw per candidate slot, compared with the density at that time. `Math.random` and
  `Date.now` are banned in `src/engine` by a lint rule or an `arch.js` check, planted in its
  self-test. Pitch helpers: scales and modes as degree lists, tunings (12-TET, just intonation
  ratio tables, custom cents per degree), and `frequency(key, mode, tuning, degree, octave)`.
- **Tiers:** engine.
- **Tests first:** the PRNG gives fixed values for fixed keys (literals in the test); draws for
  different voice ids don't share values; a draw doesn't depend on which other draws were made
  first; with thinning, raising density by 10% keeps every original event and adds new ones;
  the ban catches a planted `Math.random`. Pitch: A4 = 440 Hz in 12-TET; D dorian's degrees; a just fifth is exactly
  3/2; custom cents shift by the stated amount; out-of-range degrees wrap octaves.
- **Records:** writes 0003 (the hash, the key layout and thinning) and 0004 (pitch, tuning and
  reference pitch). Both change renders if they change later, under
  [0009](decisions/0009-engine-version-golden-hashes.md).
- **Parallel:** with 1c and 1d.

#### 1c — Genome schema, validator, trajectories and macros

- **Builds:** the descriptor mechanism and the global section of the schema (key, mode, tuning,
  pulse or none, master reverb and delay, stereo width, loudness target, voice list, macros), the
  assembly of voice descriptors, `validateGenome()` returning the normalized genome or every
  error with its path, the derived JSDoc genome type, and `schemaText()` for the LLM. Trajectories
  as breakpoint lists with a curve per segment, and their evaluation at a time. The macro mapping
  table and `effectiveParams(genome, t)`. Voice ids and each voice's `start`, `end` and `level`,
  `genomeHash()`, and the vector view
  (`encode`/`decode` per descriptor, `toVector`/`fromVector`) from 0005's amendment, which
  phases 4 and 5 search and fit over. `randomGenome(schema, seed)`, a generator of valid genomes
  that tests use for property checks and phase 2 uses as a stand-in for the LLM. No voices yet;
  1e adds the first.
- **Tiers:** engine.
- **Tests first:** a valid genome passes and comes back with every default written out; each
  descriptor rule has a fixture that fails with a path-specific message; unknown keys fail;
  every error is listed, not just the first; trajectories evaluate exactly at breakpoints and
  between them for each curve; all macros at 0.5 leave effective values equal to raw values;
  a macro at 1 moves each mapped parameter by its depth along its scale and clamps at the range;
  `schemaText()` stays under 3,000 characters for the full phase 1 schema; validating a
  normalized genome returns it unchanged; `genomeHash` ignores key order and voice order;
  `fromVector(toVector(g))` round-trips within float precision and `toVector` throws on an enum
  path; every `randomGenome` output for
  200 seeds validates.
- **Records:** governed by [0005](decisions/0005-genome-schema-table.md) and
  [0006](decisions/0006-macros-bounded-offsets.md). Writes 0007: the trajectory format, whether
  times are seconds or a fraction of a duration, how a genome loops past its last breakpoint,
  and how `render()` renders an excerpt from an offset (pre-roll so reverb tails are present).
  An excerpt is a window of the same timeline a full render plays, and its offset is chosen by a
  stated rule from the genome and seed and stored with it, so ratings on excerpts describe the
  sound a long render plays rather than every genome's first 25 s. Oscillator and LFO phases are
  computed from absolute time, not accumulated, and the pre-roll is at least the reverb's decay
  plus the delay's feedback decay. Filter and reverb state still only converge, so an excerpt is
  close to the same window of a full render, not identical; 0007 says so and states the
  measured difference on a golden genome.
- **Parallel:** with 1b and 1d.

#### 1d — Loudness meter

- **Builds:** BS.1770-4 integrated loudness, momentary and short-term blocks, and 4× oversampled
  true peak, as pure functions in `src/domain`.
- **Tiers:** domain.
- **Tests first:** the EBU Tech 3341 signals, synthesized in the test, each within ±0.1 LU; the
  true-peak cases within Tech 3341's tolerances (the builder reads the published values; they
  are not restated here); silence returns `-Infinity`; a sample rate other than 48 kHz throws;
  mono and stereo inputs follow the standard's channel weights.
- **Records:** governed by [0008](decisions/0008-loudness-written-here.md).
- **Parallel:** with 1b or 1c. It shares no files with them.

#### 1e — Render core, drone voice and golden hashes

- **Builds:** `render(genome, ctx, {seed, duration, offset, voices})` in `src/engine`, where
  `voices` limits the render to the listed voice ids (phase 6's stems), the voice
  registry, the master bus (Convolver with an impulse response generated from the seed, feedback
  delay, stereo width), and the first voice, drone (detuned oscillator stacks, slow filter
  sweeps). `ENGINE_VERSION`. A static `cost(genome)` estimate of concurrent nodes over time.
  The golden test, the hash files and the script that writes a new version's entries.
  `src/engine/genomes/` with the first golden genome. The `RenderResult` type (per-channel
  `Float32Array`s, sample rate, engine version) that export, features and CLAP all take.
- **Tiers:** engine; test/ for the golden harness; scripts/ for the hash writer.
- **Tests first:** `render()` twice with the same inputs gives the same hash; a different seed
  gives a different hash; adding another voice doesn't change the drone's solo render; the golden
  hash for the drone genome and the master bus matches; the hash writer refuses to overwrite an
  existing version's entry; `cost()` of each golden genome is under the budget and a genome
  built to exceed it fails; 200 `randomGenome` seeds render 2 s each with every sample finite
  (an extreme filter Q or frequency in a feedback path can produce NaN, which would be written
  out as noise).
- **Records:** governed by [0009](decisions/0009-engine-version-golden-hashes.md), 0003, 0007.
  Writes 0010: whether events are scheduled all up front or in windows with `suspend()` (from
  1a's answer), how the impulse response is generated (with `convolver.normalize` set
  explicitly, since its default scales by the IR), the cost unit (node-seconds alive, which
  counts the thousands of short grain nodes that concurrent counts miss) and the budget. It also
  states how long renders fit in memory: a 300 s stereo render is about 115 MB of float output and
  20 min about 460 MB, rendered in one context, with a peak-memory ceiling the bench measures.
  Splitting a render into segments would change reverb and filter state at the joins, so it is
  rejected unless the bench shows the ceiling can't hold. The scheduling choice must hold for a
  20-minute track at a granular cloud's maximum density (tens of thousands of grain events), not
  only for 300 s.
- **Parallel:** with 1f or 1g.

#### 1f — Normalization and true-peak limiter

- **Builds:** `normalize(channels, {target, ceiling})` in `src/domain`: gain to the target, a
  look-ahead true-peak limiter at the ceiling (−1.0 dBTP by default), and a re-measure that
  repeats the gain step until the result is within ±0.5 LU. A limiter lowers loudness, so the
  loop has an iteration limit and throws with the final error when it isn't met. It throws when
  the gain needed exceeds a cap or loudness is `-Infinity`, so a near-silent render fails loudly
  instead of being amplified into noise.
- **Tiers:** domain.
- **Tests first:** a sine at −30 LUFS comes out within ±0.5 LU of −20 with true peak ≤ −1.0 dBTP;
  a signal with sharp transients is limited without its true peak crossing the ceiling; the
  limiter adds no gain change to a signal already under the ceiling; the gain cap throws; a
  signal built so limiting can't reach the target throws naming the final error.
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
  48 kHz), as the Web Audio spec requires, Karplus-Strong is computed in JS into an
  `AudioBuffer` from the seed and played by an `AudioBufferSource`. That is the default either
  way: it doesn't depend on how the library handles cycles.
- **Parallel:** with 1i. Both add a line to the voice registry, and each writes its own golden
  hash files (0009), so their merges don't conflict beyond that line.

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
- **Records:** governed by 0005, 0006, 0009, 0010. Writes 0014, which caps grains per second and
  chooses between one node per grain (scheduled in `suspend` windows if 1a found them exact) and
  grains mixed in JS into buffers from the seed, using 1a's cost probe and the 0010 budget.
- **Parallel:** with 1h.

#### 1j — Export pipeline and sidecar JSON

- **Builds:** `exportRender(genome, {seed, duration, offset, outDir})` in `src/server`: create
  the `OfflineAudioContext`, render, normalize, write WAV and FLAC, and write the sidecar JSON
  (normalized genome, seed, duration, offset, engine version, schema version, sample rate,
  node-web-audio-api version, loudness target and measured values, `genomeHash`, and the SHA-256
  of the interleaved 24-bit PCM as written, after normalization, the same bytes 0009 hashes).
  It throws if any rendered sample is not finite.
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

- **Builds:** `./scripts/render` and its CLI module, `./scripts/bench` (speed and peak memory), a
  manual loudness-oracle
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
  `sketches` as the spec lists them, append-only for the irreplaceable tables, plus `sessions`,
  `generations` and `vibe_revisions` tables. What later phases train and evaluate on has to be captured from the first
  session, because it can't be recovered afterwards:
  - **generations** (irreplaceable): every LLM call's exact prompt, the ids of the examples
    retrieved into it, model id, sampling parameters, raw response, repair round, latency and
    token counts, and a `requestGroup` shared by the candidates of one request. SFT and DPO
    (phase 8) need the exact prompt each completion came from, and DPO pairs are strongest when
    both sides share one.
  - **genomes**: `genomeHash` (0005) unique per vibe, source, parent ids, the locks in force, and
    the operator and its parameters for mutations. Candidates the linter rejected are stored too,
    with the reasons: they are negative examples and the denominator of the valid rate.
  - **ratings** name what was heard by genome id, seed, excerpt offset and duration, and engine
    version, never by a `renders` row: renders are derived data that is discarded and rebuilt.
    Each also stores the left/right order shown, each candidate's rank and score, the model
    version that ranked them, whether either was a wildcard, how long the owner took, and how
    much of each excerpt was played. Pairs shown and skipped are stored as skips. Bradley–Terry
    needs position-bias correction, and evaluating a reranker needs to know what was shown and
    why.
  - **rated audio** is kept: every excerpt the owner rated is stored as FLAC (about 4 MB) under
    the app-data root, as irreplaceable data. After an engine bump the current engine can't
    re-render it (0009), and without the file every feature and CLAP embedding of a rated
    excerpt would be lost when the extractor changes. Ratings also store the gain normalization
    applied to what was heard.
  - **vibe_revisions**: editing a vibe's constraints appends a revision, and each generation,
    lint result and rating names the revision it was made under, because a constraint change
    alters what an earlier pass or rating meant.
  - **directional feedback** ("more like this / less like this" on a macro or parameter) and
    thumbs are typed rows of their own, not encoded as pairs, so phase 4 decides how each enters
    the model.
  - **renders** carry features under the derived-data rule: when the extractor changes, rows are
    discarded and recomputed, with no version field.
- **omlx queue** — one in-process FIFO, and only the server calls omlx (the CLI never does). One
  request in flight, and a minimum gap between requests so the live site's requests interleave;
  one candidate per request, with one prompt shared by the candidates of a `requestGroup` and
  varied sampling, so a timeout loses one candidate and DPO pairs share an exact prompt; a timeout per request through `AbortController`; a hard `max_tokens`; a
  context budget estimated at 3.5 characters per token, since Node has no tokenizer here. Busy
  means HTTP 429 or 503, or time to the first streamed token above a configured threshold (total
  latency mixes our output length with the other site's load); whether omlx accepts a JSON-schema
  `response_format` per request is checked, since that is a request parameter, not a setting; the queue backs off
  exponentially with jitter up to a maximum wait, then fails the request with a message to the
  owner, never retrying silently. Tests use a fake omlx that records the most requests it ever
  had in flight (must be 1) and an injected clock for backoff.
- **Constraints and linter** — the vibe's hard constraints as a schema in `src/domain`, and lint
  rules over the genome and over render checks (clipping, near-silence, DC offset, cost budget).
- **Prompt, parse and repair** — the prompt built from brief, constraints, `schemaText()`, notes
  and locks; examples retrieved by rating and recency until CLAP arrives in phase 4, with the
  retrieval method's name logged in `generations` so the two policies stay apart in the data; JSON extraction; one repair round fed the validator's errors.
- **Excerpt renders and audio serving** — 20–30 s excerpts through 1j's functions, at the offset
  rule from 0007, each with a first feature set (integrated and short-term loudness, true peak,
  spectral centroid, onset rate) as pure functions in `src/domain`, so the first sessions'
  ratings already have features. Excerpts are served as WAV with HTTP range requests, which
  Safari needs to play `<audio>`; 30 s is about 8.6 MB on the LAN, and WAV avoids a lossy
  encoder and a new tool.
- **Session UI and ratings** — vibe page, candidate grid, thumbs, A/B and notes, keyboard first,
  checked in Safari 15. A/B sides are randomized from a logged seed.
- **Evaluation script** — the owner-started run behind acceptance 1, with `randomGenome` as a
  fake-LLM baseline for the pipeline tests.
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
prior; held-out pairwise agreement reported per vibe, split by session (pairs sharing a
candidate across train and test leak), with a bootstrap 95% interval and the pair count, and
"not enough data" below a stated minimum; compared with three baselines (always-left, louder
wins, features only); ties excluded from agreement and counted as half a win in the fit, in a
record; CLAP's 512 dimensions against tens of pairs need strong L2 or a low-rank projection. Candidate
method, decided in phase 4's records: Bayesian logistic Bradley–Terry (Laplace posterior) on
PCA-reduced CLAP plus features and macros, with a left/right bias term; the posterior gives the
uncertainty, an information-gain pair picker and Thompson sampling for phase 5; ties as half a
win or a Davidson model, and thumbs as a pointwise term. Models are keyed by a hash of the
ratings, extractor and hyperparameters that produced them, which satisfies the spec's
"versioned" under the derived-data rule. The CLAP checkpoint (and so its window length, sample
rate and dimension) is named in a record, it runs on CPU so it doesn't compete with omlx for the
GPU, and its packages need the owner's approval. The sidecar is one long-lived child process
started through `uv run`, speaking line-delimited JSON over stdio with the protocol defined once
in a file both sides load; audio and arrays pass as file paths; Node owns every SQLite write;
optimizers use ask/tell, with Python returning points in [0, 1]^d that Node decodes, lints,
renders and embeds. Tests use a fake sidecar on the Node side and a fake server in pytest;
active learning picks the pairs with the widest uncertainty; a "what you like" summary is
generated from the model. **Gate:** `./scripts/check` including the sidecar's pytest; held-out
agreement in Result. **Result:**

## Phase 5 — Optimizers

**Goal:** search inside the vibe's constraints, not only through the LLM. **Acceptance:**
preference-based BO or CMA-ES over the macros and selected raw parameters never moves a locked
value and never proposes a genome the linter rejects; a MAP-Elites archive on two or three
owner-chosen axes fills its cells and the map view plays a cell on click; breeding makes children
from two sketches by LLM crossover plus mutation; CLAP text directions become sliders and
reference audio becomes a target region. Optimizers propose through `fromVector` (0005), and the
archive's descriptors are computed on the same excerpt windows the owner rates. Gains are
measured against the preference model, whose own held-out error bounds the claim, and spot-checked
with owner A/B pairs. Owner-in-the-loop preferential BO (a query budget in the tens) and
model-in-the-loop CMA-ES (hundreds of render-and-embed evaluations, an owner-started job with a
stated budget) are different tools; the phase's records say which the acceptance means.
Linter-rejected points are penalized, and locks remove their paths from the vector. **Gate:** `./scripts/check`; archive coverage and the
optimizer's agreement with the preference model in Result. **Result:**

## Phase 6 — Track builder

**Goal:** sketches arranged into 3–20 minute tracks. **Acceptance:** sections on a timeline,
crossfade and morph transitions (genome interpolation over time), macro automation curves, an
LLM-proposed structure for a target length and arc; morphs interpolate numeric parameters in
encoded space and crossfade two instances of a voice for enums and bools; a full-track render of 20 minutes stays at
least 10× real time on the bench and inside a stated memory ceiling; per-voice stems (solo renders through `voices`) sum to
the full mix before the limiter within a stated error; the limiter is nonlinear, so the stems
are exported unlimited at the mix's gain. **Gate:** `./scripts/check`; bench numbers for a 20-minute track
in Result. **Result:**

## Phase 7 — Album builder

**Goal:** tracks ordered into an album with an arc. **Acceptance:** ordering; energy, brightness
and density arcs; key relationships between tracks; a cohesion and variety readout in CLAP and
feature space; gap filling from the MAP-Elites archive and the optimizer; album export with a
manifest of tracks, durations and re-render info, each track re-renderable from it. **Gate:**
`./scripts/check`; one exported album re-rendered from its manifest. **Result:**

## Phase 8 — Fine-tuning

**Goal:** better first drafts from a small model trained on the owner's choices, never touching
omlx. **Acceptance:** mlx-lm LoRA SFT on kept sketches and DPO on pairwise choices (core mlx-lm
has no DPO; the third-party `mlx-lm-lora` package does, and needs the owner's approval); on a separate
small model, started only by the owner; every adapter versioned with its dataset and metrics;
blind A/B evaluation against the baseline, with the win rate and its confidence interval in
Result. The datasets come from phase 2's `generations` table, DPO pairs from candidates of one
`requestGroup`. The A/B uses at least 40 pairs in randomized order, a pairing fixed before
listening, and a Wilson interval; at 40 pairs a 65% win rate is not yet distinguishable from 50%,
so the plan states the pair count needed for the effect it hopes to see. Training checks free
memory first and caps MLX's memory, refusing to start if it would push omlx's loaded model into
swap. Train and evaluation sets split by vibe, and SFT uses the logged prompts verbatim. **Gate:** `./scripts/check`; the A/B result. **Result:**

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
- 2026-11-05: review round 1 (fresh context, Sonnet: 63.5k tokens, 5 tool calls, 70 s). Taken:
  cross-process determinism and a cost probe in 1a; memory and the grain-scheduling choice
  decided in 0010 and 0014; genome hash, voice ids and the vector view (0005 amended); golden
  hashes one file per genome, covering the normalizer (0009 amended); what phase 2 must log for
  phases 4–8; the omlx queue's terms; evaluation protocols for phases 4, 5 and 8. Changed from
  the review: ratings name what was heard rather than pointing at a `renders` row, which is
  derived data.
- 2026-11-05: review round 2 (fresh context, Sonnet: 66.5k tokens, 8 tool calls, 107 s). Taken: a counter-based PRNG with thinning
  (1b); rated excerpts kept as FLAC so ratings survive engine bumps and extractor changes, and
  `engine-v<N>` tags (0009 amended); excerpts stated as approximate windows; the vector view
  limited to numeric parameters, and voice start/end/level for morphing (0005 amended); solo
  renders for stems; sessions, vibe revisions and typed directional feedback in the phase 2
  store; omlx busy detection by time to first token, one candidate per request; retrieval
  before CLAP; the sidecar interface, preference-model method, optimizer budgets, CLAP and
  `mlx-lm-lora` approvals, and training memory checks as phase 4–8 lines.
