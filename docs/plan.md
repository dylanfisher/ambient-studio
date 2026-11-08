# Build plan

The phases follow the build order in [spec.md](spec.md). Phases 1 and 2 are written step by step,
and phases 3–8 are a few lines each. A phase is expanded into steps when it comes
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

Numbers are reserved by step. The ones the owner settled while this plan was written exist
already; the rest are written by the step that holds them. A reserved number that turns out to be
unneeded stays unused rather than being given to another step.

| # | Topic | Step | State |
|---|---|---|---|
| 0002 | node-web-audio-api, pinned at 2.2.0 | 1a | [written](decisions/0002-pin-node-web-audio-api.md), amended by 1a |
| 0003 | Seeded randomness: the counter-based PRNG and thinning | 1b | [written](decisions/0003-counter-based-prng.md) |
| 0004 | Pitch: tunings (relative and absolute-frequency), scales, Scala import | 1b | [written](decisions/0004-tunings-and-scales.md) |
| 0005 | Genome schema as one descriptor table | 1c | [written](decisions/0005-genome-schema-table.md) |
| 0006 | Macros as bounded offsets | 1d | [written](decisions/0006-macros-bounded-offsets.md) |
| 0007 | Trajectories, the render time base and excerpts | 1d | written, provisional |
| 0008 | Loudness and true peak written here | 1e | [written](decisions/0008-loudness-written-here.md) |
| 0009 | Engine version and golden-render hashes | 1g | [written](decisions/0009-engine-version-golden-hashes.md) |
| 0010 | Event scheduling, memory and the cost budget | 1f (1g adds the cost budget) | written, provisional |
| 0011 | Normalization and the true-peak limiter | 1h | [written](decisions/0011-normalize-true-peak-limiter.md), provisional |
| 0012 | WAV written here, FLAC through the CLI | 1i | [written](decisions/0012-flac-via-cli.md) |
| 0013 | Pad/swell and bell/pluck voice designs | 1j | [written](decisions/0013-pad-and-bell-voices.md), provisional |
| 0014 | Granular cloud and noise bed voice designs | 1k | [written](decisions/0014-granular-cloud-noise-bed.md), provisional |
| 0015 | The export sidecar JSON and re-render check | 1l | [written](decisions/0015-export-sidecar-json.md), provisional |
| 0016 | Render speed measured by a bench script | 1m | [written](decisions/0016-render-speed-bench.md) |
| 0017 | Phase 1 exposes rendering as a CLI | 1m | [written](decisions/0017-phase-1-cli.md) |
| 0018 | Default loudness target −16 LUFS (provisional) | 1r | [written](decisions/0018-default-loudness-target.md) |
| 0019 | Config file, keys and the test guard | 2a | — |
| 0020 | Vibe constraints and the genome linter | 2b (also amends 0018) | — |
| 0021 | Store tables, append-only triggers, migrations, `producer` key, backup | 2c | — |
| 0022 | The omlx queue | 2d | — |
| 0023 | First features and render checks | 2e | — |
| 0024 | Prompt, retrieval, repair and reject reasons | 2f | — |
| 0025 | HTTP server and audio serving | 2g | — |
| 0026 | Job runner and excerpt renders | 2h | — |
| 0027 | Session API and ratings | 2i | — |
| 0028 | Session UI and keys | 2j | — |
| 0029 | Sample layer | 2k | — |
| 0030 | Seed vibes and the evaluation report | 2l | — |
| 0031 | Automatic excerpts, one job per action, progress steps, thinking switch, prompt notation | 2m | — |
| 0032 | Plain-language studio pages, "brief" for vibe | 2n | — |
| 0033 | Phase 3 features: low end, stereo width, flatness | 3a | [written](decisions/0033-low-end-width-flatness.md) |
| 0034 | Feature ranges as soft targets, and their calibration | 3b | [written](decisions/0034-feature-ranges-as-soft-targets.md) |
| 0035 | Locks: paths, storage, enforcement, locks and macros | 3c (settles 0006's open question) | [written](decisions/0035-locks.md) |
| 0036 | The revision pass ("ears") | 3d | [written](decisions/0036-revision-pass.md) |
| 0037 | `sessionId` on candidates, nudge and branch | 3e | [written](decisions/0037-nudge-and-branch.md) |
| 0038 | Explore | 3f | [written](decisions/0038-explore.md) |
| 0039 | Lineage tree and the steering controls | 3g | [written](decisions/0039-lineage-and-steering-controls.md) |
| 0040 | Revision evaluation against a control | 3h | [written](decisions/0040-revision-evaluation.md) |
| 0041 | The sidecar process and protocol | 4a | — |
| 0042 | CLAP packages, checkpoint and embeddings | 4b | [written](decisions/0042-clap-embeddings.md) |
| 0043 | Training sets, ties, folds and the model key | 4c | — |
| 0044 | Bayesian Bradley–Terry with a global prior | 4d | [written](decisions/0044-bayesian-bradley-terry.md), provisional |
| 0045 | Held-out agreement, the minimum and the baselines | 4e | [written](decisions/0045-held-out-agreement.md), provisional |
| 0046 | Ranking, wildcards and the pair picker | 4f | [written](decisions/0046-ranking-wildcards-pair-picker.md), provisional |
| 0047 | The "what you like" summary | 4g | [written](decisions/0047-what-you-like.md) |
| 0048 | Quick A/B, the excerpt player and MP3 playback audio | 4i | [written](decisions/0048-quick-ab-player-mp3.md) |
| 0049 | The session table, hiding and rating marks | 4j | [written](decisions/0049-session-table-hiding-marks.md) |
| 0050 | Reference uploads: formats, files, regions, ffmpeg decoding | 5a | [written](decisions/0050-reference-uploads.md), provisional |
| 0051 | Region analysis and ranges from a region | 5b | — |
| 0052 | References in the prompt | 5c | [written](decisions/0052-references-in-the-prompt.md), provisional |
| 0053 | Search space, proposals, ask/tell and the objective | 5d | [written](decisions/0053-search-space-ask-tell.md), provisional |
| 0054 | Model-in-the-loop CMA-ES, and which optimizer the acceptance means | 5e | — |
| 0055 | Owner-in-the-loop preferential BO | 5f | — |
| 0056 | CLAP directions, sliders and the reference target | 5g | — |
| 0057 | The MAP-Elites archive and the map view | 5h | — |
| 0058 | Breeding | 5i | — |
| 0059 | The optimizer evaluation | 5j | — |
| 0060 | Streaming meters, limiter and WAV writers | 6a | — |
| 0061 | Tracks, the arrangement and the timeline | 6b | — |
| 0062 | Track rendering: chunks, crossfades, previews, export and the bench | 6c | — |
| 0063 | Stems | 6d | — |
| 0064 | Morph transitions | 6e | — |
| 0065 | Macro automation lanes | 6f | — |
| 0066 | Material from phase 5 and the reference arc | 6g | — |
| 0067 | The proposed structure | 6h | — |

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
7. The golden-render test covers every voice type and the master bus, both raw renders (1g) and
   normalized exports (1l), and passes.

**Gate:** `./scripts/check` passes on `main` after the last merge; checks 1–6 run on mbp2021 and
their numbers are written in Result; the pending owner checks below are logged.

**Pending owner checks** (on mbp2015, after 1m):

- Listen to each voice's golden genome rendered for 30 s, and the 300 s example export. Listen
  for clicks where notes start and stop, zipper noise on filter sweeps, a thump at the start or
  end, metallic ringing or flutter in the reverb tail, whistling aliasing on bright bells, and
  sounds that vanish when the stereo is summed to mono.
- Play the WAV and the FLAC in the player you use on mbp2015. Both should open and sound the
  same.
- Play the export next to an ambient track you know, at the same volume setting. At −16 LUFS they
  should sound about equally loud. Listen on headphones or a full-range speaker: most of the
  energy is under 100 Hz, which laptop speakers don't reproduce.

**Result:** met on 2026-11-06 at `1cfb0c0` (engine version 2, tagged `engine-v2`), on mbp2021.

1. `./scripts/render src/engine/genomes/example.json --seed 1 --duration 300 --out <dir>` writes
   a 2-channel, 48 kHz, 24-bit WAV and FLAC (300.000 s by `afinfo`) and the sidecar JSON, in 16 s.
2. `./scripts/bench`, 300 s: render-only median 23.0x (slowest 23.0x), render and export 19.1x
   (18.8x), peak RSS 567 and 600 MiB. 720 s: 22.9x and 18.9x, peak RSS 866 and 1,193 MiB; render
   RSS projected to 900 s is 994 MiB, under 0010's 1,536 MiB ceiling. Cost 320.4 of 560.
3. Our meter: −16.00 LUFS against the −16 target, true peak −2.38 dBTP (gain −1.43 dB).
4. ffmpeg `ebur128`: −16.0 LUFS and −2.4 dBTP, differences 0.00 LU and 0.02 dB.
5. `./scripts/render --from` reproduces PCM SHA-256 `8e2309d3…`; the WAV is byte-identical. Two
   300 s Colundi renders in separate runs gave the same hash (`70a99e56…`).
6. `flac -d` of the FLAC hashes `8e2309d3…`, the same as the WAV's data chunk.
7. Golden hashes cover all five voices and the master bus, raw and normalized, for every genome
   in `src/engine/genomes/`, and pass.

Also: `colundi.json` exports at −16.00 LUFS and −4.15 dBTP (ffmpeg −16.0, −4.2). The 200-seed
sweep rendered 2 s of every `randomGenome` with no non-finite sample (highest peak 0.51); 18 were
silent, all sparse bell or granular genomes whose thinning fired nothing in 2 s.

### Steps

#### 1a — Toolchain and renderer spike

- **Builds:** `node-web-audio-api@2.2.0` in `dependencies`, exact version. `flac` added to the
  tools `./scripts/setup` checks. A spike, kept as tests, that answers the questions 0002 leaves
  open: renders of one graph give identical bytes across processes; `OfflineAudioContext` at
  48 kHz stereo offers every node the spec names (oscillator with `PeriodicWave`, BiquadFilter,
  Gain, Delay, Convolver, StereoPanner, AudioBufferSource, ChannelSplitter/Merger); whether
  `suspend(t)` works for scheduling ahead; the shortest delay a `DelayNode` allows inside a
  feedback loop; and whether offline rendering uses one thread. Two cost probes, timed and
  measured once by hand so a speed or memory problem shows up now: a 60 s render with a 6 s
  stereo Convolver, 40 oscillators and 200 buffer sources; and a 20-minute render at 30 grains
  per second with every grain node created up front, reporting peak resident memory.
- **Tiers:** none (package.json, scripts/setup, test/).
- **Tests first:** `test/server/offline-context.test.js`: render a 1 s graph using every node
  type (a `PeriodicWave` oscillator and a buffer source started off a 128-frame boundary
  included) in three fresh Node processes and compare hashes, since two renders in one process
  can match while separate runs differ; render with and without `suspend` scheduling and compare,
  including a node created in a suspend callback that must start on its exact sample; measure the
  feedback-loop delay floor and assert what the spike found, so a library change that moves it
  fails.
- **Records:** governed by [0002](decisions/0002-pin-node-web-audio-api.md). If any answer
  differs from what the plan assumes, the builder amends 0002 and reports it; the orchestrator
  changes 1f, 1j and 1k before briefing them. If renders are not identical across processes, the
  run stops here: golden hashes (0009) can't work, and the owner decides what replaces them.
- **Parallel:** with 1r only. Every other later step depends on it.

#### 1r — Reference review

- **Builds:** nothing in git. A review of two local sources, which are the first examples of what
  the generator should be able to make:
  - The reference recordings in `~/Downloads/ambiance-inspiration/` (four folders of FLAC and
    M4A files). Measure each track with ffmpeg: integrated loudness and true peak, duration,
    stereo width, spectral peaks over time, how often new notes start, and how long tails ring.
    Then describe what the tracks share: which voices they would need, how dense and how slow
    they are, and what timbres they use.
  - The tuning research in `tmp/research/`: `colundi.md`, the interviews in `interviews/`, and
    the Scala files in `data/`. The recordings use the Colundi sequence, a microtonal tuning of
    128 absolute frequencies with no octave and no root. Check the recordings' spectral peaks
    against the 128 values to confirm it, and note which subsets the tracks seem to use.
- **Writes:** `tmp/research/review.md` (untracked): the measured numbers per track, the shared
  qualities, and a list of what phase 1 must change, step by step. The orchestrator folds that
  list into 1b–1m before it briefs them, written as engine requirements in plain technical
  terms.
- **Tests first:** none; it ships no code.
- **Records:** none. What it finds lands in the records of the steps it changes, 0004 first.
- **Pending owner check:** read `review.md` against your own listening and correct anything it
  got wrong before 1b starts.
- **Parallel:** with 1a. It must finish before 1b is briefed.

#### 1b — Seeded randomness and pitch

- **Builds:** a counter-based PRNG in `src/engine`: every draw is a hash of
  `(seed, voiceId, eventIndex, slot)`, not the next value of a running stream. Adding or removing
  a voice never changes another voice's choices, and changing one parameter doesn't shift every
  later draw, so the sound under a fixed seed moves smoothly as parameters move, which the
  optimizers (phase 5) and morphing (phase 6) depend on. Probabilistic triggers use thinning:
  one draw per candidate slot, compared with the density at that time. `Math.random` and
  `Date.now` are banned in `src/engine` by a lint rule or an `arch.js` check, planted in its
  self-test. Pitch, built so a new tuning or scale is a data file rather than code:
  - Two kinds of tuning. A **relative** tuning has a period (an octave or any other interval,
    so non-octave tunings work) and degrees given as cents or ratios: 12-TET and any other equal
    division, just intonation ratio tables, custom cents per degree. An **absolute** tuning is a
    sorted list of frequencies in Hz with no period and no root, so key and transposition don't
    apply to it.
  - A scale is a subset of a tuning's degrees. Modes are named scales of a relative tuning.
  - Tunings live as files in `src/engine/tunings/`, one per tuning, read through one loader. The
    loader also reads Scala `.scl` files (cents and ratio lines, comments, any period), the
    format most published tunings come in, so trying a new tuning is dropping in a file.
  - The Colundi sequence ships as an absolute tuning file with all 128 frequencies, from
    10.8 Hz to 12 kHz, along with the 38-value subset as a named scale of it.
  - `frequency(pitch, degree, octave)` takes a resolved pitch setting (tuning, scale, and key for
    relative tunings). Octave wraps for relative tunings; an absolute tuning has no octave and
    an out-of-range degree throws.
  - `tuningFrequencies(pitch, loHz, hiHz)` lists every frequency the scale allows in a band, so
    voices can draw partials from the same set as their notes (1j).
- **Tiers:** engine.
- **Tests first:** the PRNG gives fixed values for fixed keys (literals in the test); draws for
  different voice ids don't share values; a draw doesn't depend on which other draws were made
  first; with thinning, raising density by 10% keeps every original event and adds new ones;
  the ban catches a planted `Math.random`. Pitch: A4 = 440 Hz in 12-TET; D dorian's degrees; a
  just fifth is exactly 3/2; custom cents shift by the stated amount; out-of-range degrees wrap
  octaves. Tunings: every Colundi degree returns its listed Hz exactly, and a scale picked from it
  returns only member frequencies; key or octave on an absolute tuning throws; a 19-EDO tuning
  and a non-octave equal division (13 steps over 3/1) give the expected frequencies; a `.scl`
  file with cents lines, ratio lines and comments loads to the same tuning as the equivalent
  JSON file; every file in `src/engine/tunings/` loads and validates; `tuningFrequencies` returns
  only scale members inside the band.
- **Records:** writes 0003 (the hash, the key layout and thinning) and 0004 (the two tuning
  kinds, the file format and Scala import, scales as subsets, and reference pitch). Both change renders if they change later, under
  [0009](decisions/0009-engine-version-golden-hashes.md).
- **From 1r:**
  - The Colundi file holds the 128 exact decimal Hz values (10.8 … 12000), not values recomputed
    from cents.
  - The `.scl` loader reads a file as an absolute tuning when given a base frequency: each line is
    cents above the base, the base (1/1) is degree 0 and isn't written in the file, so there are
    count + 1 degrees. Colundi's Scala files use base 10.8 Hz. Test: a 127-line Colundi `.scl` at
    base 10.8 gives degree 78 = 440 Hz within 0.001 Hz, and every degree of the 37-line file is a
    degree of the 127-line one within 0.001 cents.
  - Named scales of the Colundi tuning: `subset38` (the 38-value list), `core36` (70, 80, 105, 120,
    126.22, 140.25, 147, 160, 172.06, 183.58, 187.61, 197, 210.42, 211.44, 221.23, 250, 264, 285,
    293, 320, 345, 360, 384, 396, 402, 420.82, 440, 480, 492.8, 526, 528, 586, 630, 639, 685, 880)
    and `core18` (105, 126.22, 140.25, 160, 172.06, 197, 221.23, 250, 264, 293, 320, 345, 360, 384,
    402, 528, 639, 685).
  - In an absolute tuning a voice picks notes only through `tuningFrequencies` over a register band
    in Hz: drone 33–135, pad 100–500, bell/pluck 150–1100.
- **Parallel:** with 1c or 1e.

#### 1c — Genome schema and validator

- **Builds:** the descriptor mechanism and the global section of the schema (tuning, scale, key
  only for relative tunings,
  pulse or none, master reverb and delay, stereo width, loudness target, voice list, macro
  values), the assembly of voice descriptors, voice ids and each voice's `start`, `end` and
  `level`, `validateGenome()` returning the normalized genome or every error with its path, the
  derived JSDoc genome type, `schemaText()` for the LLM, and `canonicalGenome()` (the canonical
  JSON that `src/server` hashes, per 0005's amendments). The voice registry is one file with one
  import line per voice; the schema, the macro table and `randomGenome` read their voices from
  it. No voices yet; 1f adds the first.
- **Tiers:** engine; test/support/ for a fixture voice that 1c and 1d test against.
- **Tests first:** a valid genome passes and comes back with every default written out; each
  descriptor rule has a fixture that fails with a path-specific message; unknown keys fail;
  every error is listed, not just the first; validating a normalized genome returns it
  unchanged; a genome naming a key with an absolute tuning fails, as does a scale not defined in
  its tuning; `canonicalGenome` ignores key order and voice order; `schemaText()` stays under 3,000
  characters for the full phase 1 schema (the test reads the assembled schema, so later voices
  are held to it too).
- **Records:** governed by [0005](decisions/0005-genome-schema-table.md).
- **From 1r**, global descriptors (min–max, default): loudness target −30 to −9 LUFS, default −16
  (provisional, record 0018); true-peak ceiling −3.0 to −0.3 dBTP, default −1.0; stereo width as a
  side/mid energy ratio, −12 to 0 dB, default −3, applied across the whole spectrum; master fade-in
  0–60 s, default 4, and fade-out 0–90 s, default 20, ending in digital silence; reverb decay
  (RT60) 1–20 s, default 8, and wet level −30 to −6 dB, default −12; pulse defaults to none; a
  `duration` for the genome's timeline, 60–900 s, default 300, which fades and `excerptOffset`
  read. Each voice has a `detune` in cents, 0–12, default 3, drawn per note in ±detune.
- **Parallel:** with 1b or 1e.

#### 1d — Trajectories, macros, vector view and random genomes

- **Builds:** trajectories as breakpoint lists with a curve per segment, and their evaluation at
  a time. The macro mapping table and `effectiveParams(genome, t)`. The vector view (`encode` and
  `decode` per descriptor, `toVector` and `fromVector`) from 0005's amendments, which phases 4
  and 5 fit and search over. `excerptOffset(genome, seed, length)`, the one place the excerpt
  rule lives. `randomGenome(seed, {costCap})`, a generator of valid genomes that tests use for
  property checks and phase 2 uses as a stand-in for the LLM; it takes a cost cap once 1g's
  `cost()` exists, and until then draws from ranges the descriptors mark as safe. Tests use the
  fixture voice from `test/support/`; each voice step (1f, 1j, 1k) adds its own macro rows and
  is covered by `randomGenome` through the registry.
- **Tiers:** engine.
- **Tests first:** trajectories evaluate exactly at breakpoints and between them for each curve;
  all macros at 0.5 leave effective values equal to raw values; a macro at 1 moves each mapped
  parameter by its depth along its scale and clamps at the range; `fromVector(toVector(g))`
  round-trips within float precision, `toVector` throws on an enum path, and moving a
  trajectory's start and end keeps its interior breakpoints' relative shape; `excerptOffset` is
  pure and unchanged by voice order; every `randomGenome` output for 200 seeds validates.
- **Records:** governed by [0005](decisions/0005-genome-schema-table.md) and
  [0006](decisions/0006-macros-bounded-offsets.md). Writes 0007: the trajectory format, whether
  times are seconds or a fraction of a duration, how a genome loops past its last breakpoint,
  and how `render()` renders an excerpt from an offset. An excerpt is a window of the same
  timeline a full render plays, at the offset `excerptOffset` picks, so ratings on excerpts
  describe the sound a long render plays rather than every genome's first 25 s. Oscillator and
  LFO phases are computed from absolute time, not accumulated, and the pre-roll is at least the
  reverb's decay plus the delay's feedback decay. Filter and reverb state still only converge,
  so an excerpt is close to the same window of a full render, not identical; 0007 says so, and
  1f measures the difference on a golden genome and adds it.
- **From 1r:** `randomGenome` draws trajectory breakpoint gaps of 20–120 s, never under 10 s, and
  a dark, bass-heavy sound by default (ranges from 1c, 1f, 1j, 1k). `excerptOffset` places the
  whole excerpt after the fade-in and before the fade-out, and uses offset 0 only when the fade-in
  is 0. Macro rows as the voices add them: density moves bell notes per minute within 0.5–40,
  brightness moves filter cutoffs within 200 Hz–3 kHz, depth/space moves reverb decay and level.
- **Parallel:** with 1e. After 1c.

#### 1e — Loudness meter

- **Builds:** BS.1770-4 integrated loudness, momentary and short-term blocks, and 4× oversampled
  true peak, as pure functions in `src/domain`.
- **Tiers:** domain.
- **Tests first:** the EBU Tech 3341 signals, synthesized in the test, each within ±0.1 LU; the
  true-peak cases within Tech 3341's tolerances (the builder reads the published values; they
  are not restated here); silence returns `-Infinity`; a sample rate other than 48 kHz throws;
  mono and stereo inputs follow the standard's channel weights.
- **Records:** governed by [0008](decisions/0008-loudness-written-here.md).
- **Parallel:** with any of 1b–1d. It shares no files with them.

#### 1f — Render core, master bus and drone voice

- **Builds:** `render(genome, ctx, {seed, duration, offset, voices})` in `src/engine`, where
  `voices` limits the render to the listed voice ids (phase 6's stems); the voice registry; the
  master bus (Convolver with an impulse response generated from the seed, feedback delay, stereo
  width); the first voice, drone (detuned oscillator stacks, slow filter sweeps);
  `ENGINE_VERSION`; and the `RenderResult` type (per-channel `Float32Array`s, sample rate, engine
  version) that export, features and CLAP all take. An offline context has a fixed length, and
  the pre-roll that sets it is engine knowledge, so the engine owns it:
  `renderPlan(genome, {duration, offset})` returns the context length and the frames to trim;
  the caller builds the context from the plan, calls `render()` (which only schedules, so the
  same call works on a live `AudioContext`), runs `startRendering()`, and passes the buffer to
  the engine's `trimToResult(buffer, plan)`. `src/engine/genomes/` with the drone's golden
  genome, which uses a trajectory and a non-neutral macro.
- **Tiers:** engine.
- **Tests first:** `render()` twice with the same inputs gives identical samples; an excerpt built
  from `renderPlan` has exactly the requested length and starts at the offset; a different seed
  gives different samples; adding another voice doesn't change the drone's solo render; the sum of
  the solo renders of a two-voice genome matches the full render within a stated tolerance (not bit
  for bit: summing order differs); 20 `randomGenome` seeds render 2 s each with every sample finite,
  since an extreme filter Q or frequency in a feedback path can produce NaN, which would be written
  out as noise (a manual sweep of 200 seeds runs at phase end and goes in Result, to keep the gate
  light on a machine serving omlx); an excerpt matches the same window of a longer render within
  the tolerance 0007 states.
- **Records:** governed by 0003, 0005, 0006, 0007. Writes 0010: whether events are scheduled
  all up front or in windows with `suspend()` (from 1a's answers, including the 20-minute
  probe), how the impulse response is generated (with `convolver.normalize` set explicitly,
  since its default scales by the IR), and how long renders fit in memory: a 300 s stereo
  render is about 115 MB of float output and 20 min about 460 MB, rendered in one context, with
  a peak-memory ceiling the bench measures. Splitting a render into segments would change reverb
  and filter state at the joins, so it is rejected unless the bench shows the ceiling can't
  hold. The scheduling choice must hold for a 20-minute track at a granular cloud's maximum
  density, not only for 300 s. The master bus is linear; normalization and limiting run only
  after voices are summed, so stems sum to the mix within a tolerance before the limiter.
- **From 1r:** drone fundamentals 33–135 Hz (octaves 1–2 in relative tunings); a sine-only stack
  of 4–12 partials falling −4 to −8 dB per partial octave (default −6), 2–3 copies per partial
  detuned 0–12 cents (default 4); in an absolute tuning partials may snap to tuning members within
  40 cents of n × fundamental; a low-pass sweep with cutoff 100 Hz–2 kHz (default 600), period
  30–300 s, Q at most 4. The reverb IR is 1–20 s (default 8) and dark: its 4 kHz decay about half
  the low-frequency decay. The master bus applies the side/mid width and the fades (after the voice
  sum, before normalization, inside the golden hashes). `renderPlan` accepts up to 900 s.
- **From 1a** ([0002](decisions/0002-pin-node-web-audio-api.md) amendment): renders are
  identical across processes and offline rendering is single-threaded. Every node is processed on
  every quantum whether it has started or not, so creating all event nodes up front fails on long
  renders (36,000 grains over 20 min ran slower than real time); scheduling in `suspend` windows
  (2 s windows created 1 s ahead) rendered the same 20 min at 14x. 0010 chooses windows. A suspend
  time rounds up to the next 128-frame boundary, so a window's suspend sits at least one quantum
  before its first event. Oscillators are the main cost (480 sines with a 12 s convolver ran at
  6.1x), so the drone puts its partials in one `PeriodicWave` per detuned copy rather than one
  oscillator per partial.
- **Parallel:** with 1h or 1i.

#### 1g — Golden hashes and the cost budget

- **Builds:** the golden test over raw renders quantized to 24-bit (1l adds the normalized exports),
  the per-genome hash files with their coarse summaries, and the script that writes a new version's
  entries ([0009](decisions/0009-engine-version-golden-hashes.md)). A static `cost(genome)` in
  node-seconds alive, which counts the thousands of short grain nodes that a count of concurrent
  nodes misses. `randomGenome` gains its cost cap.
- **Tiers:** engine; test/ for the golden harness; scripts/ for the hash writer.
- **Tests first:** the drone's and the master bus's golden hashes match; a changed sample fails
  with a message that prints the summaries and says to bump `ENGINE_VERSION`; the hash writer
  refuses to overwrite an existing version's entry; a missing platform entry fails naming the
  platform; `cost()` of each golden genome is under the budget and a genome built to exceed it
  fails; every `randomGenome` with a cost cap stays under it.
- **Records:** governed by [0009](decisions/0009-engine-version-golden-hashes.md). Adds the cost
  unit and budget to 0010, calibrated against 1a's probes.
- **From 1r:** the budget admits the densest bell setting in 1j (40 notes a minute, 10 partials,
  15 s ring: about 100 sine oscillators alive) over a 900 s render; the cost unit counts partials.
- **Parallel:** with 1h or 1i. After 1f.

#### 1h — Normalization and true-peak limiter

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
- **From 1r:** reaches any target from −30 to −9 LUFS at −1.0 dBTP within ±0.5 LU; a test at
  −12 LUFS with a bass-heavy tonal signal (80% of its energy under 100 Hz); the gain cap allows
  at least +35 dB.
- **From 1e:** `truePeak` reads up to 0.31 dB under the true peak on Tech 3341's cases (within
  the standard's tolerance), so the limiter keeps that margin under the ceiling, or a −1.0 dBTP
  reading can sit 0.3 dB over the real ceiling.
- **Parallel:** with 1f or 1g, after 1e.

#### 1i — WAV and FLAC writers

- **Builds:** a 24-bit PCM WAV encoder and a FLAC encoder that spawns `flac`, in `src/server`.
- **Tiers:** server.
- **Tests first:** a WAV header carries the right sample rate, bit depth, channel count and data
  size; samples at ±1.0 and 0 encode to the expected bytes and out-of-range floats clip;
  `flac -d` of the FLAC gives samples identical to the WAV; a failing `flac` (bad path) throws
  with its stderr.
- **Records:** governed by [0012](decisions/0012-flac-via-cli.md).
- **Parallel:** with any step from 1b on. It depends only on 1a.

#### 1j — Pad/swell and bell/pluck voices

- **Builds:** the pad/swell voice (ADSR on Gain, chords from the mode via 1b's pitch helpers) and
  the bell/pluck voice (FM from oscillator pairs, Karplus-Strong, and additive sines whose
  partials can be drawn from the tuning through `tuningFrequencies`, for struck-object timbres
  that fit non-octave tunings; probabilistic triggers by thinning), each with its descriptors,
  macro mappings and a golden genome that uses a trajectory and a non-neutral macro. The
  bell/pluck golden genome uses the Colundi tuning with tuning-drawn partials.
- **Tiers:** engine.
- **Tests first:** a golden hash for each voice; chord notes are all in the genome's scale;
  tuning-drawn partials are all members of the scale's frequency set; the
  trigger count over a fixed duration matches the seed exactly and its density parameter on
  average; envelopes ramp rather than jump (no sample-to-sample step above a stated size at note
  edges); `cost()` stays in budget at the voice's maximum density.
- **Records:** governed by 0003, 0005, 0006, 0009, 0010. Writes 0013. Karplus-Strong is computed
  in JS into an `AudioBuffer` from the seed and played by an `AudioBufferSource`: the Web Audio
  spec holds a `DelayNode` in a cycle to at least one render quantum (128 frames, so a loop
  can't play above about 375 Hz at 48 kHz), and a buffer doesn't depend on how the library
  handles cycles.
- **From 1r:** pad: 3–7 sine-based notes from the scale in 100–500 Hz (default 5), attack 2–20 s
  (default 8), release 4–30 s (default 12), a swell cycle of 20–90 s swinging 6–20 dB. Bell:
  additive is the primary model, fundamentals 150–1100 Hz, 4–10 partials falling 3–6 dB each, none
  above 3 kHz, drawn from `tuningFrequencies` in an absolute tuning and otherwise from an
  inharmonic ratio table (bar: 1, 2.76, 5.40, 8.93, 13.34; sparse harmonic: 1, 1.5, 2, 2.5, 3);
  linear attack 2–10 ms; decay (T60 of the fundamental) 0.3–15 s, default 6, higher partials at
  0.3–0.7 of it (default 0.5). Density 0.5–40 notes a minute, default 8, with a density trajectory
  so notes cluster rather than fall evenly; no steady pulse. At most 8 bell notes sound at once;
  older ones fade at the cap. FM and Karplus-Strong stay as secondary models. The bell golden
  genome uses the Colundi tuning's `core18` scale.
- **From 1a:** a bell note's partials decay at different rates, which one `PeriodicWave` can't
  do, and one oscillator plus gain per partial is what made 1a's 480-sine probe miss 10x. So
  additive bell notes are computed in JS into an `AudioBuffer` from the seed, like Karplus-Strong,
  and played by one `AudioBufferSource` each, created in 0010's `suspend` windows. The pad keeps
  oscillators (at most 7 notes) with partials in a `PeriodicWave`.
- **Parallel:** with 1k, after 1g (both test against `cost()` and its budget). Each adds one
  import line to the registry and writes its own voice file, macro rows and golden hash files,
  so their merges conflict at most on that line and the macro table's rows.

#### 1k — Granular cloud and noise bed voices

- **Builds:** the granular cloud (density, grain size, pitch spread, over a source buffer
  generated from the seed or rendered from another voice) and noise beds (white, pink and brown
  noise computed into buffers from the seed, shaped by modulated filters into wind, rain and surf
  presets), each with descriptors, macro mappings and a golden genome that uses a trajectory and
  a non-neutral macro. The sample layer waits for phase 2, which gives it a configured folder.
- **Tiers:** engine.
- **Tests first:** a golden hash for each voice; grain count over a duration matches the seed
  exactly and the density on average; no grain starts or ends with a step (each has a window);
  noise spectra slope as named (pink about −3 dB/octave, brown about −6, measured with a test
  FFT); `cost()` stays in budget at maximum density.
- **Records:** governed by 0003, 0005, 0006, 0009, 0010. Writes 0014, which caps grains per
  second and chooses between one `AudioBufferSource` per grain (scheduled in `suspend` windows if
  1a found them exact) and grains mixed in JS into buffers from the seed, using 1a's probes and
  the 0010 budget.
- **From 1r:** the noise bed's default level is at least 30 dB under the drone's; the granular
  cloud's grain pitches on a tuned source snap to the scale (nearest tuning member within 30 cents
  in an absolute tuning). Neither is required in the example genomes beyond the noise bed in
  `example.json`.
- **From 1a:** grains are scheduled in 0010's `suspend` windows, never all up front; 30 grains
  a second over 20 min rendered at 14x that way.
- **Parallel:** with 1j, after 1g.

#### 1l — Export pipeline and sidecar JSON

- **Builds:** `exportRender(genome, {seed, duration, offset, target, outDir})` in `src/server`:
  create the `OfflineAudioContext` from `renderPlan`, render, normalize to the explicit
  `target`, write WAV and FLAC, and write the sidecar JSON
  (normalized genome, seed, duration, offset, engine version, schema version, sample rate,
  node-web-audio-api and Node versions, loudness target and measured values, `genomeHash`, and
  the SHA-256 of the interleaved 24-bit PCM as written, after normalization, the same bytes 0009
  hashes), computed with `genomeHash()` here in `src/server`. It throws if any rendered sample is
  not finite. A golden test per voice genome through `exportRender` adds the normalized hashes
  0009 requires, so a limiter change fails a test and forces a version bump. The CLI passes the
  genome's loudness field as `target`; from phase 2 the vibe's target is passed instead, and
  the genome's field is only the default when there is no vibe. `rerender(sidecarPath, outDir)` that
  fails if the new hash differs, naming both engine versions when they don't match.
- **Tiers:** server.
- **Tests first:** an export of a 3 s golden genome writes three files whose JSON names the
  others; the JSON's hash matches the WAV's samples; `rerender` reproduces it; a sidecar with an
  older engine version fails with a message naming both versions; a render containing NaN
  throws; output paths are inside `outDir` and the test roots `outDir` in a temp folder.
- **Records:** governed by 0009, 0011, 0012. Writes 0015: the sidecar's fields and file naming.
  Stems wait for phase 6.
- **Parallel:** none. It joins 1f–1k.

#### 1m — CLI, example genome and bench

- **Builds:** `./scripts/render` and its CLI module, `./scripts/bench` (speed and peak memory), a
  manual loudness-oracle script that compares our meter with ffmpeg's on an export, and
  `src/engine/genomes/example.json`: a few minutes of drone, pad, noise bed and sparse bells in
  D dorian at −16 LUFS, and `src/engine/genomes/colundi.json`, the same voices in a Colundi
  scale chosen from 1r's review. The CLI module joins `knip.json`'s entries.
- **From 1r:** `example.json` targets −16 LUFS (record 0018), width −3 dB, fade-in 4 s, fade-out
  20 s, reverb decay 8 s; the drone at 36–75 Hz is the loudest voice, the noise bed at least 30 dB
  under it, bells at 8 a minute. `colundi.json` uses `core18` for pad and bell, drone fundamentals
  from the tuning's 55–120 Hz values, bell partials from all 128. `./scripts/bench` adds a 720 s
  case beside the 300 s one.
- **Tiers:** server; scripts/.
- **Tests first:** the CLI's argument parser rejects a missing `--out`, a non-numeric seed and an
  unknown flag, each with a message; a CLI run on a 3 s golden genome into a temp folder writes
  the three files; `--from` on that export succeeds.
- **Records:** governed by [0016](decisions/0016-render-speed-bench.md) and
  [0017](decisions/0017-phase-1-cli.md).
- **Parallel:** none. Then the orchestrator runs the acceptance checks, writes the Result line,
  and logs the pending owner checks.

## Phase 2 — Vibe and session loop

**Goal:** the owner opens a vibe, asks for candidates, hears them from mbp2015, and rates them.

**Acceptance, as measurable checks:**

1. Over an owner-started evaluation of at least 48 genomes across at least 3 vibes, at least 90%
   validate after at most one repair round. "Validate" means the schema and the vibe's linter
   both pass; the report gives the schema-only rate beside it. The run is a server job using the
   server's omlx queue and reports the rate before and after repair, per vibe, with a 95% Wilson
   interval (about ±8 points at 48), and counts truncated responses as their own reject reason.
2. Every constraint kind in the spec has a linter rule with a passing and a failing fixture.
3. The candidate grid plays from Safari on mbp2015 (pending owner check).
4. Thumbs, A/B choices (ties included) and notes are stored, and read back after a server
   restart.

**Gate:** `./scripts/check`; the evaluation run's numbers in Result; omlx reached only through
the queue, with tests using a fake. Generation runs only when the owner starts it, so acceptance 1
waits on the owner starting the evaluation job (2l); the phase is done when its numbers are in
Result.

**Pending owner checks** (after 2j, on mbp2015 and mbp2026):

- Open the studio by its LAN URL in Safari 17.6 on mbp2015 and in your browser on mbp2026. Create a
  vibe, ask for 8 candidates, and play every excerpt: each should start within a second of
  pressing play, seek when you click the scrubber, and not cut out.
- Rate with the keyboard alone: thumbs, an A/B choice and a tie, a note, a "more like this" on
  one macro, and keep one candidate as a sketch. Stop and start the server and check every rating
  is still listed.
- Play two A/B excerpts back to back: at the vibe's target they should sound equally loud.

**Settled by the owner on 2026-11-06, when phase 2 was expanded:**

- Derived rows carry an opaque `producer` key (engine version plus a hash of the extractor's
  source). It is a cache key, not a schema version, and AGENTS.md's derived-data rule allows it.
- The genome's loudness range tops out at −10 LUFS, not −9: the drone golden can't be normalized
  to −9 (it stops at −9.82), and the loudest reference track in 1r measured −11.9 (2b, amending
  0018).
- Phase 2 ships three seed vibes, written by the plan's builder for the owner to edit or replace,
  and the evaluation runs over them (2l).
- The sample layer is built in phase 2 and reads WAV, FLAC and AIFF from the configured folder
  (2k).

**Shared helpers and their owners** (orchestrator rule 4): `test/support/temp-root.js` (a temp
data root and config, and the guard that refuses the owner's real folders) is 2a's;
`EXCERPT_SECONDS` and the lint result type are 2b's; `test/support/temp-store.js` and every store
function signature for vibes, revisions and notes are 2c's, and later steps add their own store
functions beside them; `test/support/fake-omlx.js` and `test/support/fake-clock.js` are 2d's; the
FFT, promoted from `test/support/golden.js` to `src/domain`, is 2e's; `src/server/main.js`, the
route table and `test/support/http-client.js` are 2g's; the `producer` string is composed by 2h
and the store takes it as an opaque argument; the `samples` plumbing through render, export and
the prompt's list of recordings is 2k's, and no other step touches it. `scripts/arch.js` and
`scripts/arch-test` gain rules in 2a (environment) and 2d (network clients), which never run
side by side.

### Steps

Order: 2a ‖ 2b, then 2c ‖ 2d, then 2e ‖ 2f, then 2g ‖ 2h, then 2i ‖ 2k, then 2j, then 2l.

#### 2a — Config and paths

- **Builds:** `src/config/config.js`, the one module that reads the config file and the
  environment, and `src/config/paths.js` for the folders under the app-data root (database,
  render cache, rated audio, backups). The config file is JSON, at `$AMBIENT_STUDIO_CONFIG` when
  set, else `~/.config/ambient-studio/config.json`. Keys, every one required: the omlx base URL
  and model id; the queue's numbers (request timeout, first-token threshold, minimum gap, backoff
  base and maximum wait, `max_tokens`, context budget, whether to send `response_format`); the
  app-data root; the field-recording folder, `null` until the owner sets one; and the server's
  host and port. A missing or mistyped key throws with its name and the file path; there are no
  defaults in code. `src/config/example.json` is the template the owner copies, with the app-data
  root set to `~/Library/Application Support/Ambient Studio/`. `test/support/temp-root.js` makes a
  temp root with a config pointing into it, and the config module refuses to load, while Vitest is
  running, any path under the owner's two real folders.
- **Tiers:** config; test/support; scripts/arch.js.
- **Tests first:** a complete file loads and every value reads back; each missing key, each wrong
  type and an unparseable file throws with the key's name and the file's path;
  `$AMBIENT_STUDIO_CONFIG` wins over the default path; under Vitest, a config naming
  `~/.config/ambient-studio/` or `~/Library/Application Support/Ambient Studio/` throws; `paths()`
  puts every folder under the root; `arch-test` plants a `process.env` read outside src/config.
- **Records:** writes 0019: the config file's location and keys, why every key is required
  (principle 5), the example file, the test guard, and that nothing outside src/config reads
  `process.env` (an `arch.js` rule).
- **Parallel:** with 2b.

#### 2b — Vibe constraints and the genome linter

- **Builds:** the vibe's hard constraints as a schema in `src/domain` (the descriptor style of
  0005, with its own validator and `constraintsText()` for the prompt): key or mode, tuning (and
  scale), pulse or none, duration range, loudness target, voice types allowed and banned, density
  ceilings (bell notes a minute, grains a second, pad chord rate), brightness range (the
  `brightness` macro's effective value over the timeline), and the cost budget.
  `lintGenome(genome, constraints)` returns every violation with its path, the constraint it
  breaks and a message the repair prompt can quote, plus the spec's floors: no near-silent genome
  (every voice level at its floor), no lone static drone (one drone and no trajectory or motion),
  and a duration long enough for the excerpt (`duration − fadeIn − fadeOut ≥ EXCERPT_SECONDS`,
  since `excerptOffset` throws otherwise). `EXCERPT_SECONDS` (20–30 s, the builder picks) is
  defined here. Render checks come in 2e and return the same result type, which 2b defines. First
  commit: the genome's loudness range tops out at −10 LUFS (0018 amended), with the validator and
  normalize tests updated.
- **Tiers:** domain; engine (the loudness range only).
- **Tests first:** for every constraint kind, a fixture genome that passes and one that fails with
  the expected path and constraint, in one table-driven file so acceptance 2 is one test's
  coverage; a constraint set that fails its own validator (an unknown voice type, a range with min
  above max) is refused; `constraintsText()` names every kind and stays under a stated character
  budget; a genome at −9 LUFS fails validation; a genome too short for the excerpt fails lint.
- **Records:** governed by 0005, 0006, 0007, 0018. Writes 0020: the constraint kinds and how each
  maps onto genome fields, which constraints the prompt states as fixed values and which as
  ranges, that the linter reports and never rewrites a genome (a value the vibe fixes, like the
  loudness target, is checked, not silently overwritten), and the floors' thresholds. Amends 0018
  with the −10 cap. The cap changes no existing render, so the engine version stays 2; it does
  change what `randomGenome` draws for a seed, which no golden covers.
- **Parallel:** with 2a.

#### 2c — Store

- **Builds:** `src/server/store.js` over `node:sqlite` in WAL mode with foreign keys on, and
  numbered migrations in `src/server/migrations/` applied in order at open, each in a transaction,
  recorded in a `migrations` table. Irreplaceable tables are append-only, enforced by triggers:
  `BEFORE DELETE` raises, and `BEFORE UPDATE` raises unless the only change is setting
  `removedAt` and `removedReason` once. Derived tables carry the `producer` key, taken as an
  opaque string, and are deleted and rebuilt on a mismatch. The store's functions take and return
  plain objects with JSDoc types; SQL lives only in the store and its migrations.
  `./scripts/backup` writes `VACUUM INTO` a dated file under the backups folder and copies the
  `rated_audio` folder beside it; `checkRatedAudio()` fails loudly on a missing file or a PCM hash
  that differs. `test/support/temp-store.js` opens a store in a temp root.
- **Tables** (review rounds 1–4 and phase 2's review settled what they hold):
  - **vibes** and **vibe_revisions**: a vibe row, and a revision appended for every edit of its
    brief, constraints or soft targets. Every generation, lint result and rating names the
    revision it was made under.
  - **notes** (irreplaceable): the owner's notes on a vibe, which feed the prompt.
  - **session_events** (irreplaceable): a session's start and stop as two rows, since an
    append-only session row can't record its end.
  - **generations** (irreplaceable): every LLM call's exact prompt, the ids of the examples
    retrieved into it and the retrieval method's name, model id, sampling parameters, raw
    response, `finish_reason` (so a response cut off by `max_tokens` is told apart from invalid
    JSON), repair round and the generation it repairs, latency, time to first token and token
    counts, and a `requestGroup` shared by the candidates of one request. Phase 8's SFT and DPO
    need the exact prompt each completion came from.
  - **genomes** hold content only: the canonical genome and `genomeHash` (0005), unique per vibe,
    one row however often it is reached. **candidates** hold provenance, one row per time a genome
    was produced: genome id (null when the output never parsed), the seed (drawn from a logged
    stream when the candidate is made, since renders and `excerptOffset` need it), source, parent
    ids, the locks in force, the operator and its parameters, the generation that made it, the
    vibe revision, the model's one-line intent, and the lint result with every reason. Rejected
    candidates are stored: they are negative examples and the denominator of the valid rate.
  - **rated_audio** (irreplaceable): one row per heard excerpt, unique on genome, seed, offset,
    duration, engine version and loudness target, with its FLAC path under the app-data root,
    the SHA-256 of its PCM and the gain applied.
  - **ratings** (irreplaceable, A/B): both sides named by genome id, seed, excerpt offset and
    duration, and engine version, never by a `renders` row, and each side's `rated_audio` id. Each
    stores the left/right order shown and the seed it came from, the winner, a tie or a skip, how
    long the owner took, how much of each excerpt was played, and the rank, score, model version
    and wildcard flag of each side, null in phase 2. Phase 4 writes its rankings as new rows and
    never updates these.
  - **feedback** (irreplaceable): thumbs and "more like this / less like this" as typed rows with
    the same heard-identity and measurement block as a rating (rated-audio id, played fraction,
    time taken); a macro row adds the macro's name, the direction and the macro's effective value
    over the heard window.
  - **sketches** (irreplaceable): a candidate kept as a sketch, with notes and tags.
  - **renders** (derived): genome, seed, offset, duration, loudness target and `producer` as the
    cache key, the file path, raw and heard features, and check results.
  - **evaluations** (irreplaceable): an evaluation job's parameters and report.
- **Tiers:** server; scripts/.
- **Tests first:** migrations build an empty database and a second open applies nothing; a
  `DELETE` on each irreplaceable table and an `UPDATE` of any other column raise; marking a row
  removed works once and a second time raises; a rating, thumbs, a note and directional feedback
  written, the store closed and reopened, read back equal (acceptance 4's store half); two
  candidates reaching one genome share its row; a `renders` row with another `producer` or
  target is not returned and is replaced; a backup opens as a database with the same rows while
  a writer holds the WAL; `checkRatedAudio()` fails on a missing file and on a changed byte.
- **Records:** writes 0021: tables and the append-only triggers, the migration scheme, the
  `producer` cache key as the owner settled it, and the backup command. Every later shape change
  to an irreplaceable table ships as a migration with a test that runs it over the previous shape.
- **Parallel:** with 2d. Review: yes (a new stored data shape).

#### 2d — omlx queue and client

- **Builds:** `src/server/omlx-queue.js`, one in-process FIFO and the only code that calls omlx;
  the CLI never does. One request in flight, and a minimum gap after each so the live site's
  requests interleave. Streaming chat completions to `{baseUrl}/v1/chat/completions` with the
  config's model id, one candidate per request, a hard `max_tokens`, a request timeout through
  `AbortController`, and a context budget estimated at 3.5 characters per token that refuses an
  over-budget prompt before sending it. `max_tokens` is set from the largest genome `randomGenome`
  makes under the cost cap plus headroom for a reasoning model's thinking, stated in the record.
  Busy is HTTP 429 or 503, or time to the first streamed token above the configured threshold;
  busy backs off exponentially with jitter up to the maximum wait, then fails the request with a
  message for the owner, never retrying silently. The queue takes an injected clock (`now`,
  `setTimeout`, `clearTimeout`) for its gap, backoff and timeout. The result carries the text,
  `finish_reason`, latency, time to first token and token counts, for 2f to store. Whether omlx
  accepts a JSON-schema `response_format` is a request parameter, not a setting: the client sends
  it when the config says to, and a 400 naming it fails loudly with that hint, so the evaluation
  run (2l) settles it. A cancel function drops queued requests and aborts the one in flight, for a
  session stop. `test/support/fake-omlx.js` is a `node:http` server that streams scripted
  responses, can answer 429 or hold a stream open until the test releases it, and records the
  most requests it ever had in flight; `test/support/fake-clock.js` is the injected clock.
- **Tiers:** server; test/support; scripts/arch.js.
- **Tests first:** 20 requests queued at once never put more than 1 in flight at the fake, and
  successive requests start at least the minimum gap apart on the fake clock; a 429 and a slow
  first token each back off and retry on the fake clock, and past the maximum wait the request
  fails with the owner's message; a held stream is aborted when the fake clock passes the
  timeout; a response cut at `max_tokens` returns `finish_reason: "length"`; an over-budget prompt
  is refused unsent; cancel rejects queued requests and aborts the one in flight; the model id
  sent is the config's; `example.json` as a response fits in `max_tokens` with the stated
  headroom. No test opens a socket to port 8000, and `arch.js` refuses `fetch` and `node:http`
  clients outside the queue module.
- **Records:** writes 0022: the queue's terms and numbers, busy detection, the streaming parse,
  `max_tokens`, and the `response_format` handling.
- **Parallel:** with 2c. Review: yes (the omlx boundary, concurrency).

#### 2e — First features and render checks

- **Builds:** pure functions in `src/domain` over a `RenderResult`. First commit: promote the
  radix-2 FFT in `test/support/golden.js` to `src/domain`, with golden.js importing it. Then:
  integrated loudness, maximum and range of short-term loudness, true peak (1e's), spectral
  centroid (mean and spread over frames), onset rate (onsets a second from spectral flux with an
  adaptive threshold), and `extractFeatures` returning them as one object, with
  `FEATURE_EXTRACTOR` naming its source files for the `producer` hash. Features are measured twice
  per excerpt: raw (before normalize, so loudness and true peak mean something, with the gain
  normalize applied) and heard (the normalized audio the owner hears, for centroid and onset
  rate). Render checks on the raw render: clipping (sample peak at or above 0 dBFS),
  near-silence (integrated loudness below a floor, or none measurable), DC offset (mean per
  channel above a threshold), and the cost budget; they return 2b's lint result type.
  `featuresText()` writes them as one line of text for phase 3's revision prompt.
- **Tiers:** domain; test/support (the promotion).
- **Tests first:** a 1 kHz sine's centroid is 1 kHz within a stated tolerance and white noise's
  is near a quarter of the sample rate; clicks at a known rate give that onset rate within 10%,
  and a sustained drone gives under 0.1 a second; a DC-shifted signal, a clipped one and a silent
  one each fail their check and a clean golden passes all four; `extractFeatures` on the same
  samples twice is identical; every golden still matches after the promotion. Feature cost on a
  30 s excerpt is measured by `./scripts/bench`, not asserted in a test.
- **Records:** writes 0023: the features, frame sizes and thresholds, raw against heard, the
  check thresholds, and how `FEATURE_EXTRACTOR` feeds the `producer` key.
- **Parallel:** with 2f.

#### 2f — Prompt, parse, repair and generation

- **Builds:** in `src/domain`, `buildPrompt(vibe, revision, {notes, locks, examples})` from the
  brief, `constraintsText()` (2b), `schemaText()` (0005), notes, locks and retrieved examples, as
  system and user messages under the context budget, trimming examples first and failing when the
  rest doesn't fit. The model answers `{intent, genome}`: the genome schema has no description
  field, and adding one would change `genomeHash`, so the one-line intent lives on the candidate.
  `extractGenome(text)` finds one such object in a response (fenced or not) and reports why when
  it can't; `buildRepairPrompt(previous, errors)` quotes the validator's and linter's errors.
  Examples are retrieved by rating and recency (CLAP arrives in phase 4) and the method's name is
  logged. In `src/server`, `generateCandidates(vibeId, n, store, queue)`: one `requestGroup`, n
  requests sharing one prompt with sampling varied per candidate (seeded and logged), each
  response parsed, validated (0005) and linted (2b), one repair round for any that parsed into
  something with errors to quote, and every generation and candidate stored, rejected ones with
  their reasons. Reject reasons are typed: truncated (`finish_reason: "length"`), no JSON,
  invalid JSON, schema errors, lint errors. A truncated response gets no repair round: there are
  no errors to quote, only a cut-off text.
- **Tiers:** domain, server.
- **Tests first:** the prompt contains the schema text, every constraint and each lock, and stays
  under the budget with examples trimmed first; `extractGenome` takes fenced, bare and
  prose-wrapped JSON and refuses two objects or none, each with its reason; against the fake
  omlx, a script of one valid, one repairable and one truncated response stores 3 generations
  plus 1 repair, 3 candidates with the right reasons, and genome rows only for the valid two;
  every request of a group carries the identical prompt; a repaired candidate names the
  generation it repaired; generation never runs without a call from the owner's route or job (no
  timer, no start-up hook).
- **Records:** writes 0024: the prompt layout and budget, the `{intent, genome}` answer, example
  retrieval before CLAP, sampling per candidate, the repair round, and the reject reasons.
- **Parallel:** with 2e. Needs 2b, 2c, 2d.

#### 2g — HTTP server and audio serving

- **Builds:** `src/server/main.js` (the `./scripts/dev` entry): a `node:http` server on the
  configured host and port, a route table with JSON bodies and errors that later steps add
  routes to, static serving of `src/web/` and of the browser-loadable `src/engine` and
  `src/domain` modules, and a stop that leaves no open handles. `GET /audio/:renderId` serves a
  render-cache WAV with HTTP range requests (Safari needs them for `<audio>`) and never a path
  outside the cache folder. An index page in `src/web`. `test/support/http-client.js` drives the
  real server on an ephemeral port.
- **Tiers:** server; web (an index page only); test/support.
- **Tests first:** a range request returns 206 with the exact bytes and `Content-Range`; an open
  range, a suffix range and a range past the end behave as RFC 9110 says; an unknown id, a
  traversal attempt and a static path outside the served folders are 404; a malformed JSON body
  is a 400 with a message; the server stops with no open handles.
- **Records:** writes 0025: no framework, the route table, static serving, LAN binding and why
  there is no auth (a LAN app with no secrets), range handling.
- **Parallel:** with 2h. Review: yes, with a security pass (it opens the network, parses input
  and reads files).

#### 2h — Job runner and excerpt renders

- **Builds:** an in-process job runner: one job at a time, a queue with status the UI polls,
  cancellation, and no job that starts on its own. Because it runs one job at a time, a
  generation's omlx requests never overlap rendering, so normalize and feature extraction on the
  event loop can't inflate the queue's time-to-first-token reading. Excerpt renders call
  `renderOffline` and `normalize` directly (not `exportRender`, which writes export files),
  exporting the `requireGenome` and `requireFinite` checks from `export-render.js` rather than
  copying them; at the candidate's seed and `excerptOffset` (0007), `EXCERPT_SECONDS` long,
  normalized to the vibe's loudness target so an A/B choice isn't won by the louder side; 2e's
  checks and both feature sets; cached as WAV under the render-cache folder with a `renders` row
  keyed as 2c says. This step composes the `producer` string (engine version plus a hash of
  `FEATURE_EXTRACTOR`'s files). `normalize` throws on silence and on gain above its cap; either
  becomes a failed near-silence check on the candidate, not a failed job.
  `captureRatedAudio(renderId)` writes the heard excerpt as FLAC into `rated_audio` (one row per
  heard identity, reused when it exists) with its PCM hash and gain.
- **Tiers:** server.
- **Tests first:** two jobs queued run one at a time; a cancelled job stops before its next
  render; an excerpt's integrated loudness is within ±0.5 LU of the target; a cached excerpt is
  reused, and one whose `producer` or target differs is rendered again; a silent genome gives a
  failed near-silence check and the job continues; `captureRatedAudio` writes a FLAC whose
  decoded PCM matches the stored hash, and a second call for the same excerpt reuses the row; one
  30 s excerpt rendered twice in one process with forced collection between is identical (with
  `--expose-gc` set as `test/engine/render.test.js` does).
- **Records:** writes 0026: the job runner and why one job at a time, excerpt length and
  normalization, the render-cache layout and key, the `producer` string, and failed renders as
  checks.
- **Parallel:** with 2g. Review: yes, with a performance pass (the render path).

#### 2i — Session API and ratings

- **Builds:** routes over 2c–2h: vibes (create, list, read, edit as a revision, notes), session
  start and stop, "ask for N candidates" (default 8) as a job that runs 2f then 2h's excerpts,
  job status, candidates with their excerpt URLs, features, lint result and intent; ratings:
  thumbs with an optional note, A/B (winner, tie or skip) with sides from an exported
  `abOrder(seed)` that the route uses, "more like this / less like this" on a macro, and keep as
  sketch. Every rating stores what 2c's rows need and calls `captureRatedAudio`. Stopping a
  session cancels its job and its queued omlx requests.
- **Tiers:** server; domain (`abOrder`).
- **Tests first:** through the HTTP client: a vibe created, a session started, a generation job
  against the fake omlx producing candidates with playable excerpt URLs; each rating kind posted,
  the server stopped and started on the same temp root, and every rating read back (acceptance
  4); the A/B route stores the order `abOrder` gives for its logged seed, and over 200 seeds the
  left side is first between 40% and 60% of the time; a rating writes one `rated_audio` row whose
  file exists; stopping a session cancels its job and its queued requests at the fake.
- **Records:** writes 0027: the routes, A/B randomization, what played fraction and time taken
  measure, and the job's status shape.
- **Parallel:** with 2k. Review: yes (a diff across tiers).

#### 2j — Session UI

- **Builds:** pages over 2i's routes: vibe list (with the seed vibes once 2l lands) and vibe
  page (brief, a constraints form over 2b's schema, notes), the session view's candidate grid (an
  `<audio>` player per candidate, the features readout, the lint result, the intent, rating
  controls), the A/B view, and keep as sketch. Keyboard first: every action has a key, listed on
  the page. The page reports played fraction and time taken. Plain HTML, CSS and ES modules, no
  build step, written for Safari 17.6 (mbp2015) and the browser on mbp2026.
- **Tiers:** web.
- **Tests first:** the keyboard map and the played-fraction tracker are DOM-free modules with
  tests; web modules import only relative paths (`arch.js`); a page load through the HTTP client
  returns every module it imports.
- **Records:** writes 0028: the pages and keys, and the polling interval.
- **Parallel:** none. Then the orchestrator logs the pending owner checks above.

#### 2k — Sample layer

- **Builds:** a field-recording voice in `src/engine`: one or more recordings looped or excerpted
  with fades, a level, a filter, playback rate and pan, with trajectories, and a `cost()`. The
  engine does no I/O: a genome names each recording by the SHA-256 of its file, and the server
  decodes WAV, FLAC and AIFF through `decodeAudioData` and passes the buffers into `render()` as
  `samples`, keyed by hash. `render`, `renderOffline`, `exportRender`, `rerender`, the CLI's
  `--from`, and 2h's excerpt renders all carry `samples`; a missing or changed file fails with the
  file's name. A server index of the folder (path, hash, duration, channels, sample rate) feeds a
  list of available recordings into 2f's prompt. `randomGenome` never draws the voice, since it
  has no recordings to name. Renders of every existing genome are unchanged, so the engine version
  stays 2 unless the goldens move.
- **Tiers:** engine, server, domain (the prompt's list).
- **Tests first:** a genome with the voice renders deterministically from a fixture WAV, FLAC and
  AIFF in `test/fixtures/`; whether `decodeAudioData` reads AIFF and how it resamples a 44.1 kHz
  file to 48 kHz, checked deterministic across two decodes; a hash that matches no buffer fails
  with the file's name; an export with the voice re-renders through `--from`; the index lists a
  temp folder's files with their hashes; every existing golden still matches; the voice's golden
  genome joins the goldens.
- **Records:** governed by 0005, 0009, 0010, 0015. Writes 0029: naming recordings by hash,
  decoding and resampling, looping and fades, what happens when the folder changes, and that the
  voice's schema text changes what `randomGenome` and the prompt see but no golden.
- **Parallel:** with 2i.

#### 2l — Seed vibes and the evaluation job

- **Builds:** three seed vibes as fixtures in `src/domain/vibes/` that the owner can load from
  the vibe list: a cold, slow D dorian drone and pad vibe; a Colundi bell field; and a warm, tidal
  noise-bed vibe. Each has a brief, constraints that exercise different kinds, and a −16 LUFS
  target. The evaluation job: a route taking vibe ids and a count, run by 2h's job runner so it
  shares the one omlx queue, generating through 2f, and storing its report in `evaluations`,
  shown on a page: the valid rate (schema and lint) and the schema-only rate, before and after
  repair, per vibe and overall, with 95% Wilson intervals; reject reasons counted by type with
  truncation apart; latency and time-to-first-token percentiles; whether `response_format` was
  accepted. `randomGenome` as a fake-LLM baseline through the same pipeline, for tests.
- **Tiers:** domain, server, web.
- **Tests first:** each seed vibe passes 2b's validator; the Wilson interval matches published
  values (for example 45 of 48); against a fake omlx scripted with 40 valid, 5 repairable and 3
  truncated responses (repairs scripted valid), the report reads 40/48 before repair, 45/48
  after, 3 truncated; a `randomGenome` baseline run passes the schema at 100%; the job starts only
  from its route.
- **Records:** writes 0030: the seed vibes and why each constraint was chosen, the report's
  contents, and that an evaluation is started only by the owner.
- **Parallel:** none. Then the orchestrator stops: the owner starts the evaluation (48 genomes,
  16 a vibe, on omlx), and its numbers go in Result.

**Result:**

#### 2m — Fewer waits after the first evaluation

- **Builds:** a candidates job renders each valid candidate's excerpt itself, so nothing is
  queued by hand. A job identical to one queued or running is refused with 409 naming that
  job. Job status carries a plain-language step ("asking the model for candidate 3 of 8").
  `queue.thinking` decides whether requests ask the model to think first. The prompt's mark
  for macro parameters stops being copied into key names.
- **Why:** in the first evaluation, 14 of 16 first answers failed only because the model wrote
  keys like `cutoff~`. Each request spent about 5,000 tokens and 55 s thinking for a
  400-character answer. The owner queued excerpts by hand and could queue the same one twice.
- **Records:** 0031; amends 0022, 0024 and 0026.

#### 2n — Plain-language pages

- **Builds:** pages with ordinary navigation and buttons instead of single-key commands. Every
  control gets a title that says what it does. Pages also get:
  - a short muted line on each page saying how to use it;
  - a dashboard card explaining the whole loop;
  - progress shown from 2m's steps;
  - controls that send a job once while it is pending;
  - smaller type in a neutral card style.

  The pages say "brief" where they said "vibe". Code, routes and stored names stay as they are.
- **Records:** 0032; amends 0028 and 0030.

## Phase 3 — Ears and steering

**Goal:** the model hears measured features of each excerpt and revises once before the owner
listens, and the owner can lock values, explore around a candidate and branch from any earlier
one.

**Acceptance, as measurable checks:**

1. Every excerpt's features (2e's loudness, centroid and onset rate, plus 3a's low-end share,
   stereo width and tonality) are measured and stored, and every revision prompt carries the
   revised candidate's features as text beside each range it misses.
2. Revising with the measurements beats revising without them. In an owner-started evaluation
   over the three seed vibes, every valid first try that misses one of its vibe's feature ranges
   is revised twice from the same first try: once with its measured features and misses (the
   treatment), once with the same ranges but no measurements (the control). The primary test is
   an exact one-sided McNemar test on the pairs, treatment inside every range against control
   inside every range; it passes when p < 0.05 overall over at least 20 revised first tries.
   Below 20 the report says "inconclusive" and gives no p. Beside it the report gives, per vibe
   and overall, the share inside every range before revision, after the treatment and after the
   control, each with a 95% Wilson interval. When the treatment beats the first tries but not
   the control, the report says the gain comes from asking again, the acceptance fails, and the
   owner decides whether to keep the revision pass.
3. Locks hold: across LLM answers, explore and nudge, every locked value in every stored child
   equals the locked value, proven by a test over scripted answers that change locked values and
   over 1,000 seeded nudges.
4. Every candidate stores its parents and the operator that made it (null for a root, a first
   try from a plain request), and the lineage page shows the vibe's session candidates as a tree
   with every node playable and "explore from here" on each.

**Gate:** `./scripts/check`; the evaluation's numbers in Result; omlx reached only through the
queue, with tests using a fake. Acceptance 2 waits on the owner starting the evaluation (3h).

**Pending owner checks** (after 3g, on mbp2015 and mbp2026):

- Ask for 8 candidates on a seed vibe. Cards that were revised say so, with the first try one
  click away; listen to a few pairs and say whether the revision moved toward the brief.
- Lock a voice and the macros that move it on one card, explore from it, and listen: the locked
  voice should sound the same across the children while the rest changes. A voice locked
  without its macros still moves with them, as the owner settled.
- Nudge at each step size and say whether small, medium and large sound like their names.
- Open the lineage page after two rounds of exploring, play a node from the first round, and
  explore from it.
- Read each seed vibe's feature ranges (3b) against what you'd want, and edit them on the brief
  page.

**Settled by the owner on 2026-11-06, when phase 3 was expanded:**

- **A locked raw value still follows the macros.** The lock fixes the raw value, the macros
  still offset it, and the lock control offers to lock the macros that move it too. A lock that
  pinned the effective value would need a genome field the engine reads, which changes
  `genomeHash` and the schema text. Recorded in 0035 (0006 left it to phase 3).
- **The owner writes a new vibe's feature ranges**, on the brief page, each range optional and
  blank meaning none. A button that asks the model for ranges from the brief can be added after
  3b without changing the shape.
- **After a revision, the grid shows the card that misses fewer ranges**, the revision on a
  tie, with the other one click away. Always showing the revision would hide the cases where it
  got worse.
- **Nudge, without the model, is in phase 3** beside the model's explore: it costs no omlx time
  and proves locks most directly. Phase 5's optimizers build on its draws.
- **The evaluation tests treatment against control** (2026-11-07, after the plan review): a
  test against the first tries alone can't fail, since only candidates that missed are revised
  and any second try lands inside the ranges some of the time.

**What the code holds today** (read when this phase was expanded, at 9cb1c87):

- `candidates` already has `parentIds`, `locks`, `operator` and `operatorParams`; every row
  written so far has `[]`, `[]` and null. It has no `sessionId`: `listSessionCandidates` finds a
  session's candidates by joining `generations` (`src/server/generation-store.js:171`), so a
  candidate made without a model request can't be found. A lock is `{path, value}` with the
  vector view's paths (0024), and `buildPrompt` writes them under "Locked by the owner". Both
  jobs pass `locks: []`.
- `genomes` is unique on `(vibeId, genomeHash)`, so two candidates that reach one genome share
  its row.
- `generateCandidates` holds `ask`, `judge`'s caller, `keep` and `failedVerdict` as closures
  inside it, and refuses a request group that already exists.
- `buildRepairPrompt` is the first prompt, the parsed answer as an assistant turn, and one user
  turn (0024).
- `softTargets` is a free JSON object on each vibe revision, stored, shown under "Advanced" on
  the brief page, and checked by nothing. Every seed vibe has `{}`.
- `featuresText()` (2e) writes raw and heard features as one line and is shown on each card; no
  prompt uses it yet.
- The evaluation job generates only; it renders nothing, and its count goes up to 64 a vibe
  (`EVALUATION_COUNT`). The candidates job renders each valid candidate's excerpt between model
  requests (0031).
- The owner's config has `queue.thinking` false: a request takes about 7 s, and omlx's prefix
  cache already reused about half of the first prompt in the model tests. A follow-up turn sent
  with its first prompt's turns byte for byte gives the cache the chance to reuse them; whether
  it does, with the live site's requests in between, shows only in the owner's run, which logs
  first-token times.

**Shared helpers and their owners** (orchestrator rule 4):

- 3a: `FEATURE_NAMES` and each feature's unit and rounding, read by `featuresText`, the range
  table and the pages.
- 3b: the range table, `targetsText()` and `checkTargets()`.
- 3c: the lock shape, `applyLocks()`, `lockedPaths()`, `macrosMoving()`, the `locks` store
  functions, and migration 0004.
- 3d: the first commit moves `ask`, `keep` and `failedVerdict` out of `generateCandidates` into
  functions every operator calls, with no change in behavior; 3e and 3f build on it. Also
  `followUp()` in `src/domain`, the one function that adds an assistant turn and an ask to a
  first prompt, which `buildRepairPrompt` and the revision both call; the candidates job's flow
  (generate, render, revise, render); and the shown-card rule and the `pair` field.
- 3e: migration 0005 (`candidates.sessionId`) and the job-conflict rules for explore and nudge
  in 0031's table, which 3f adds its row to.
- Each step adds its own `JOB_STEP` sentences.
- 3g: the lineage route. 3h: the control arm and the McNemar test.
- A step that finds it needs another migration stops and asks the orchestrator for the number.

### Steps

Order: 3a ‖ 3c, then 3b, then 3d ‖ 3e, then 3f, then 3g, then 3h. 3e is built on 3d's first
commit (the moved helpers), named in its brief by sha.

#### 3a — More features

- **Builds:** three heard features in `src/domain`, added to `extractFeatures`:
  - low-end share: the fraction of spectral power below 150 Hz over the whole excerpt;
  - stereo width: side power over mid plus side power, from 0 (mono) to 1 (all side), with
    independent channels near 0.5;
  - tonality: mean spectral flatness over frames, 0 for pure tones and near 1 for white noise.

  Each is finite or null like 2e's. `FEATURE_NAMES` lists every feature the ranges and the
  prompt may name, raw and heard, with its unit and the rounding `featuresText` uses;
  `featuresText` reads it. Integrated loudness is left out of `FEATURE_NAMES`, since every heard
  excerpt is normalized to the vibe's target. The new files join `FEATURE_EXTRACTOR`, so
  `PRODUCER` changes and every cached excerpt renders again when next asked for (derived data).
- **Tiers:** domain.
- **Tests first:** a 60 Hz sine reads a low-end share near 1 and a 1 kHz sine near 0; identical
  channels read a stereo width of 0, independent noise in each channel within 0.05 of 0.5, and
  opposite channels 1; a sine's tonality is under 0.05 and white noise's over 0.8;
  `featuresText` names every entry of `FEATURE_NAMES`; `extractFeatures` twice on the same
  samples is identical; the feature-extractor closure test passes with the new files.
- **Records:** writes 0033: the three features, why these (an excerpt's bass weight, width and
  noisiness are what a brief describes and 2e doesn't measure), cutoffs and frames, width as a
  share so mono is a measured 0, and why loudness is left out. Amends 0023.
- **Parallel:** with 3c. Review: yes.

#### 3b — Feature ranges as soft targets

- **Builds:** in `src/domain`, a range table in the descriptor style of 0020: one optional
  `[low, high]` per entry of `FEATURE_NAMES`, either end open (`null`). Ranges live at
  `softTargets.features`, validated on every revision save. Other keys of `softTargets` are
  kept as the owner saved them and ignored, since revisions are irreplaceable and phase 5's CLAP
  directions will sit beside the ranges; `{}` stays valid and means no ranges, so no migration
  is needed. `targetsText()` writes the ranges for the prompt; from this step on, every first
  prompt carries them (0024 left soft targets out until now), so the first tries already know
  the ranges and the revision adds only the measurements. `checkTargets(features, ranges)`
  returns 2b's lint result type, one finding per miss with path `features.<name>`, rule
  `target`, and a message naming the value and the range; an unmeasurable value is a miss. The
  brief page replaces the soft-targets JSON field with a form built from the table, like the
  rules form, and lists any other saved keys read-only.
- **Seed ranges, calibrated before they're fixed.** Before writing them, the builder measures the
  features of genomes that pass each seed vibe's linter: the goldens 2l adapted to each vibe and
  200 `randomGenome` draws filtered by the vibe's lint, rendered as excerpts in a temp root. The
  spread goes in 0034, and each range is written from the brief and that spread, so that a
  stated share of the draws (about half) misses at least one range. This calibrates how often a
  first try misses; it says nothing about whether revisions fix them, so it can't bias 3h. The
  ranges are committed here, and 3h's builder may not change them.
- **Tiers:** domain, server (validation on save), web.
- **Tests first:** a valid range set passes and each malformed one (low above high, an unknown
  feature, a non-number) fails with its path; `{}` passes, and a `softTargets` with another key
  saves and keeps it; `checkTargets` on a fixture's features finds exactly the misses scripted
  into its ranges, and a null value is a miss; saving a revision with bad ranges is a 400 that
  names the feature; each seed vibe's ranges validate; a first prompt holds `targetsText`'s
  lines; the form module, DOM-free, turns the table into fields and back.
- **Records:** writes 0034: the shape, open ends, a null value as a miss, kept keys, the ranges
  in the first prompt, why integrated loudness has no range, the calibration and its numbers,
  and the rule against tuning seed ranges to the evaluation. Amends 0024 (soft targets enter the
  prompt) and 0030 (the seed vibes).
- **Parallel:** none (it needs 3a's names, and 3d to 3h need it).

#### 3c — Locks

- **Builds:** the lock shape widened (0024 allowed it): `{path, value}` where the path names a
  global parameter, a macro, a voice parameter of any kind (number, int, choice, flag, or a whole
  trajectory), or a whole voice by id (`voices.pad`), with `value` the canonical JSON taken from
  the candidate it was locked on. In `src/domain`:
  - `validateLock` against the schema.
  - `applyLocks(genome, locks)` writes every locked value into a parsed answer after it has been
    filled out to canonical form, so a parameter the model left out is filled from the lock and
    counted as omitted, not changed. It inserts a locked voice the genome dropped. A lock on a
    parameter of a voice the answer lacks, or whose type changed, is a lint finding with rule
    `lock`, which goes to the repair round. It returns the genome and the paths it changed and
    filled.
  - `lockedPaths(locks, genome)` gives the vector paths the locks cover: a whole trajectory
    covers its `.start` and `.end`, a number lock on a parameter the genome holds as a
    trajectory covers the one path it becomes once applied, and a whole voice covers every
    numeric path of that voice. Choices and flags have no vector path and are covered by
    `applyLocks` alone.
  - `macrosMoving(path)` lists the macros whose rows move a parameter (0006), for the lock
    control's offer.

  Locks belong to a vibe and stay until the owner removes them: a `locks` table (irreplaceable;
  removing one marks it removed), with migration 0004 and a test over the previous shape.
  Locking a path that is live marks the old row removed as "replaced"; locking a whole voice
  marks the live locks inside it removed as "covered"; locking a path inside a locked voice is
  refused. Routes: lock a path from a candidate, unlock, list. `generateCandidates` keeps `locks`
  as an explicit argument: the session's candidates job passes the vibe's live locks and the
  evaluation passes none, so a lock the owner set on a seed vibe never reaches an evaluation.
  The candidate stores the locks in force and, in `operatorParams`, the paths changed and
  filled. Settles 0006's question as the owner chose: a locked raw value still follows the
  macros.
- **Tiers:** domain, server.
- **Tests first:** each path kind round-trips through `validateLock`, and an unknown parameter, a
  voice id the candidate lacks and a value outside its descriptor are refused; `applyLocks` on a
  genome that changed every locked value restores each one and lists them as changed, one that
  left a locked parameter out lists it as filled, and a dropped voice is put back; a lock on a
  parameter of a missing or retyped voice gives a `lock` finding; `lockedPaths` for a whole
  trajectory, a number over a trajectory and a whole voice; `macrosMoving` against the macro
  table; against the fake omlx, an answer that changes two locked values is stored with both
  restored and both paths listed; a whole-voice lock keeps the first prompt under the budget; a
  lock removed is gone from the next prompt and its row is still there; replacing and covering
  mark the old rows; the evaluation's prompt has no locks while the vibe has some.
- **Records:** writes 0035: lock paths and values, locks per vibe, applying rather than rejecting
  (a rejected answer costs a request and the model's other ideas), changed against filled,
  overlapping locks, and locks and macros. Amends 0005 (lock paths beyond the vector view),
  0006, 0021 and 0024.
- **Parallel:** with 3a. Review: yes (a new irreplaceable table and a migration).

#### 3d — The revision pass

- **Builds:** first commit: `ask`, `keep` and `failedVerdict` move out of `generateCandidates`
  into functions any operator calls, behavior unchanged and every existing test passing. Then
  `followUp(messages, answer, ask)` in `src/domain`, which `buildRepairPrompt` is rewritten to
  call. In the candidates job, after a valid candidate's excerpt renders, its features are checked
  with `checkTargets` and its render checks read. A candidate with a miss or a failed check gets
  one revision request:
  - **Prompt.** The candidate's first prompt (its round-0 generation's messages, never a repair
    round's), then its genome after locks as the assistant turn, as `JSON.stringify` like the
    repair, then one ask. The ask restates the vibe's current locks, then gives `featuresText`,
    the misses and failed checks, and asks for one revision or the genome unchanged if it fits
    the vibe as it is. A revision is never revised again. A follow-up over the context budget
    isn't trimmed, since its earlier turns must match the first prompt; it is skipped and noted
    on the candidate as `revisionOverBudget`, like `repairOverBudget`.
  - **Requests.** The revisions of one job form their own request group, named from the first
    tries' group, and use each first try's sampling.
  - **Result.** The answer goes through the same parse, lock, validate and lint path, with one
    repair round, and becomes its own candidate with `parentIds` naming the first try and operator
    `revise`. It gets its own seed from the job's stream, so its excerpt and ratings never share a
    heard identity with the first try. Its excerpt renders and its features are checked. An
    answer that returns the genome unchanged is stored as a `revise` candidate with
    `operatorParams.unchanged` true, on the same genome row and the first try's seed, and is
    neither rendered nor shown.
  - **Shown card.** The candidates route gives each first try that has a revision a `pair` field
    (first try, revision, which is shown), chosen by the owner's rule: fewer misses, the revision
    on a tie. The session page shows the chosen card and links the other. A card whose excerpt is
    playing isn't replaced until it stops.

  The step sentence says "measuring candidate 3 of 8" and "revising candidate 3 of 8".
- **Tiers:** domain (`followUp`, the ask), server, web (the shown card only; 3g adds the rest).
- **Tests first:**
  - The moved helpers pass every existing generation test unchanged.
  - Against the fake omlx, a candidate inside every range gets no revision. One outside a range
    gets one request whose last user turn holds `featuresText`'s line, the miss and the current
    locks, and whose earlier turns equal its round-0 request byte for byte, a repaired first try
    included.
  - The revision is stored with its parent, operator and its own seed, and its excerpt renders;
    the `pair` field follows the rule on a fewer-misses, a more-misses and a tied fixture.
  - An unchanged answer is stored and neither rendered nor shown.
  - A revision that fails to parse gets a repair round and, failing that, leaves the first try
    shown.
  - A follow-up over the budget is skipped with its note.
  - A cancel between the render and the revision stops the job with every row stored.
  - `buildRepairPrompt`'s existing tests pass through `followUp`.
  - The page module that swaps cards waits while the card's audio plays.
- **Records:** writes 0036: when a candidate is revised, the follow-up turn and what it replays,
  no trimming, the request group, seeds, which card is shown, unchanged answers, and why one
  round. Amends 0024, 0026 and 0031.
- **Parallel:** with 3e, once its first commit is on its branch. Review: yes.

#### 3e — Nudge and branch

- **Builds:** migration 0005 adds `sessionId` to `candidates` (null for evaluation candidates),
  filled for existing rows from their generation's session, and `listSessionCandidates` reads it,
  so a candidate made without a model request is still found; a test runs it over 0004's shape.
  Nudge (operator `nudge`, no omlx): N children (default 8) of a base candidate by seeded moves in
  the vector view (0005) over the paths `lockedPaths` leaves free and the macros, at a step size of
  small, medium or large (a normal step of 0.05, 0.12 or 0.25 in [0, 1], clipped), decoded by
  `fromVector`, then `applyLocks` and lint.
  - **Failed draws.** A draw that fails lint, or lands on the base's or a sibling's genome (an
    int rounding back, a clipped step), is stored as a rejected candidate and drawn again, at most
    4 times a child, so no unlinted or repeated genome is ever rendered or shown.
  - **Children.** They keep the base's seed, so a child differs from its base only in its genome.
    Their excerpts render and their features are checked and shown, but they aren't revised: they
    have no conversation to follow up.
  - **Branching** is nudging or exploring (3f) from any node, in any session of the vibe, so the
    owner returns to an old branch by working from it.
  - **Jobs.** The children store the base in `parentIds` and the step size and seed in
    `operatorParams`. Nudge is a job. 0031's conflict table gains its rule: a nudge identical to
    one queued or running (same base, step size and count) is a 409. A different base, or a nudge
    while a candidates job runs, queues behind it.
- **Tiers:** domain (the nudge), server.
- **Tests first:** migration 0005 over a 0004 database with session and evaluation candidates
  fills `sessionId` from their generations and leaves the evaluation's null; 1,000 seeded nudges
  with three locks (a macro, a voice parameter, a whole voice) leave every locked value equal to
  its lock, and no locked path moves in the vector (acceptance 3, with 3c's scripted answers); a
  nudge is the same for the same seed; a draw that fails lint, and one equal to its base, is
  stored rejected and redrawn, and a child that fails four times is reported, not shown; nudge
  children appear in their session's candidate list; nudging from a candidate of an earlier
  session works; a second identical nudge while one runs is a 409, and one on another base
  queues.
- **Records:** writes 0037: `sessionId` on candidates, branching as working from any node, the
  nudge, step sizes, failed draws, seeds, no revision for nudges, and why nudge is in phase 3.
  Amends 0021, 0027 and 0031.
- **Parallel:** with 3d, built on 3d's first commit. Review: yes (a migration).

#### 3f — Explore

- **Builds:** explore (operator `explore`): N children (default 4) of a base candidate by the
  model. Each is a fresh first prompt, `buildPrompt` with one more section holding the base's
  genome and the ask for a variation that keeps the locks and changes the rest, with an optional
  one-line direction from the owner ("slower", "less bell"). It's never a follow-up turn, so
  exploring from a revision, a nudge child or an explore child never chains turns, and the prompt
  carries the vibe's current brief, notes and locks rather than the base's. Children go through
  3d's helpers (parse, locks, validate, lint, one repair round), each with its own seed, then the
  revision pass like any first try. They store the base in `parentIds` and the direction in
  `operatorParams`. 0031's conflict table gains explore's row, on the same terms as nudge's.
- **Tiers:** domain (the prompt section), server.
- **Tests first:** against the fake omlx, explore sends N requests whose prompts hold the base's
  genome and the direction, stores children with the base as parent, and restores answers'
  changes to locked values; exploring from a nudge child and from a revision sends a first prompt
  with no earlier turns; the base section is trimmed after the examples and before failing the
  budget; children are revised when they miss a range; a second identical explore while one runs
  is a 409.
- **Records:** writes 0038: explore as a fresh prompt, the base section, directions, and
  revision of explore children. Amends 0024 and 0031.
- **Parallel:** none (it needs 3d and 3e merged). Review: yes.

#### 3g — Lineage and the steering controls

- **Builds:** `GET /api/vibes/:id/lineage`: every session candidate of the vibe (evaluation and
  control-arm candidates left out, unchanged revisions folded into their first try) with its
  parents, operator (null for a root), session, `pair` status, rating marks and sketch flag,
  valid ones only by default. A lineage page drawing the tree as nested lists (keyboard and
  screen-reader friendly, no canvas), each node with its intent, operator, a player for its
  excerpt and "explore from here" and "nudge from here"; rejected candidates hidden behind a
  switch. On the session page's cards:
  - the features against the vibe's ranges, each miss marked;
  - lock controls (a voice, a macro, or a parameter picked from a list), which offer to lock the
    macros `macrosMoving` names too;
  - the vibe's current locks, with unlock;
  - explore and nudge buttons, with the direction field and step size.

  Plain words and titles on every control (0032); written for Safari 17.6.
- **Tiers:** server (the route), web.
- **Tests first:** the route over a scripted tree of three generations, with an evaluation
  candidate, a control-arm candidate and an unchanged revision mixed in, returns every session
  node with its parents and leaves the other three out; a node made in an earlier session sits
  under its parent; the tree builder, the ranges readout and the macro offer are DOM-free modules
  with tests; a lineage page load through the HTTP client returns every module it imports; a lock
  posted from the card's control, with its macros, reads back in the list.
- **Records:** writes 0039: the lineage route and page, nested lists over a drawn graph, and the
  card controls. Amends 0032.
- **Parallel:** none. Then the orchestrator logs the pending owner checks above.

#### 3h — The revision evaluation

- **Builds:** the evaluation job gains a revision mode. For each vibe it:
  1. generates `count` first tries as before, with no locks;
  2. renders each valid one and checks its ranges;
  3. revises every first try with a miss twice: once through 3d's revision (the treatment), and
     once in the control arm, the same follow-up turn with the ranges restated but the measured
     features, misses and failed checks taken out, asking for a better fit to the brief;
  4. renders and checks both revisions.

  Control-arm candidates are stored with operator `revise-control` and never shown in a session.
  The report adds, per vibe and overall:
  - the share of valid first tries inside every range, and of revised pairs inside after the
    treatment and after the control, each with a Wilson interval;
  - the paired counts: both inside, treatment only, control only, neither;
  - the exact one-sided McNemar p on treatment only against control only, or "inconclusive"
    below 20 revised first tries;
  - the share of first tries inside after the treatment, against before;
  - how many revisions in each arm came back unchanged;
  - the vibe revision ids and the ranges the run used, so a later edit to a vibe's ranges is
    visible against it.

  The page's count field suggests 32 a vibe in revision mode, enough for about 20 revised first
  tries if half miss, as 3b's calibration aims for. Reports stored before 3h, without these
  fields, still display.
- **Tiers:** domain (the report, the exact McNemar test), server, web.
- **Tests first:**
  - The exact McNemar p matches hand-worked values: 9 against 1 gives p = 11/1024.
  - Against a fake omlx scripted with 24 first tries, 12 of which miss, the report reads those
    counts and p. In the script the treatment fixes 10 and the control 2, one of them also fixed
    by the treatment, so treatment only is 9 and control only 1.
  - A run with 10 revised first tries reads "inconclusive".
  - The control's prompt holds the ranges and no feature text, and the treatment's holds both.
  - The evaluation passes no locks while the seed vibe has some.
  - A report stored before 3h still renders.
  - The job starts only from its route.
- **Records:** writes 0040: the revision mode, the control arm and why it's the comparison, the
  paired test, the minimum, the suggested count, and that ranges were fixed before the run.
  Amends 0030.
- **Parallel:** none. Then the orchestrator stops: the owner starts the evaluation (the three
  seed vibes, 32 candidates each, on omlx), and its numbers go in Result.

**Result:** closed on 2026-11-07 at `05370bf` with acceptance 2 inconclusive; 1, 3 and 4 pass.
The owner asked to record it and move on to phase 4.

1. Acceptance 2, the owner's evaluation 4 (2026-11-07; seed vibes 2–4, 32 each, revision test
   on, thinking off, `Qwen3.6-35B-A3B-oQ4e-mtp`): 10 revised first tries, under the 20 the
   verdict needs, so the report says "inconclusive" and gives no p. Treatment put 8 of 10 inside
   every range (80%, Wilson 49–94%), the control 4 of 10 (40%, 17–69%). Of the 6 discordant
   pairs, treatment won 5; the exact one-sided p on those counts would be 7/64 = 0.11. Before
   revision 51 of 61 measured first tries were inside every range (84%, 72–91%), 59 of 61 after
   the treatment. No revision went over budget or was rejected; two control revisions came back
   unchanged.

   | Vibe | Valid after repair | First tries in range | Revised | Treatment | Control | T only / C only |
   |---|---|---|---|---|---|---|
   | cold-dorian | 31/32 | 30/31 | 1 | 1/1 | 1/1 | 0 / 0 |
   | bell-field | 30/32 | 21/30 | 9 | 7/9 | 3/9 | 5 / 1 |
   | tidal-noise | 0/32 | — | 0 | — | — | — |

   Tidal-noise answered all 32, but 27 failed lint after repair, so it gave no revisions. Its
   cost ceiling is 300 and the master bus alone costs 214 at the default 8 s reverb; neither the
   prompt nor the finding named the reverb. `05370bf` names it in both (amends 0020). The
   report counts lint failures without naming the rule, so the cause is the likely one, not a
   confirmed one.
2. First tries took 6.3 s at the median (p90 8.1 s), repairs 3.7 s, each revision arm 3.7–3.9 s;
   first token 179 ms on first tries and about 1 s on follow-ups. No answer was truncated and no
   request failed. The run took about 15 minutes, against the confirm's 27–40.
3. The revision pass stays on: nothing in the run argues against it, and a pass needs about 20
   revised first tries. Since first tries already land in range 84% of the time, that means about
   twice this run's count, or a vibe whose first tries miss more. Rerunning with tidal-noise
   repaired, at 64 a vibe, is the owner's to start.

## Phase 4 — Preference model

**Goal:** a per-vibe model of the owner's taste that ranks candidates and asks good questions.
**Acceptance:** the CLAP sidecar embeds excerpts and text; per-vibe Bradley–Terry over CLAP
embeddings, features and macros, with ensemble or bootstrap uncertainty, and a weaker global prior;
held-out pairwise agreement reported per vibe, split by session (pairs sharing a candidate across
train and test leak), with a bootstrap 95% interval and the pair count, and "not enough data" below
a stated minimum; compared with three baselines (always-left, louder wins, features only); ties
excluded from agreement and counted as half a win in the fit, in a record; CLAP's 512 dimensions
against tens of pairs need strong L2 or a low-rank projection. Candidate method, decided in phase
4's records: Bayesian logistic Bradley–Terry (Laplace posterior) on PCA-reduced CLAP plus features
and macros, with a left/right bias term; the posterior gives the uncertainty, an information-gain
pair picker and Thompson sampling for phase 5; ties as half a win or a Davidson model, and thumbs as
a pointwise term. Models are keyed by a hash of the ratings, extractor and hyperparameters that
produced them, which satisfies the spec's "versioned" under the derived-data rule. The CLAP
checkpoint (and so its window length, sample rate and dimension) is named in a record, it runs on
CPU so it doesn't compete with omlx for the GPU, and its packages need the owner's approval. The
sidecar is one long-lived child process started through `uv run`, speaking line-delimited JSON over
stdio with the protocol defined once in a file both sides load; audio and arrays pass as file paths;
Node owns every SQLite write; optimizers use ask/tell, with Python returning points in [0, 1]^d that
Node decodes, lints, renders and embeds. Each request has a timeout; a crashed or hung sidecar is
restarted and the failed request reported to the owner, never retried silently, and a session stop
cancels what is in flight. Tests use a fake sidecar on the Node side and a fake server in pytest;
active learning picks the pairs with the widest uncertainty; a "what you like" summary is generated
from the model. **Gate:** `./scripts/check` including the sidecar's pytest; held-out agreement in
Result.

**Waiting on the owner before 4b** (AGENTS.md reserves both):

- **The CLAP packages and checkpoint.** The sidecar has no runtime dependencies today. CLAP needs
  PyTorch (CPU build) and a CLAP implementation; the two candidates are `transformers`'s
  `ClapModel` with the `laion/larger_clap_music` checkpoint, and LAION's own `laion-clap` package
  with its music checkpoint. Recommended: `transformers` + `torch` + `numpy`, since `transformers`
  is maintained and pins cleanly under uv, and the music checkpoint was trained on music rather
  than general sound. The checkpoint downloads once (about 0.8 GB) to a cache folder the config
  names. 4b's builder confirms the window length, sample rate and dimension from the checkpoint's
  own config and writes them in 0042. 4d also needs `numpy`; nothing else (PCA and the Laplace fit
  are a few lines of linear algebra, so no `scikit-learn`).
- **Ratings to learn from.** Read through the API on 2026-11-07: 0 A/B ratings, 8 thumbs and 3
  sketches, all on vibe 1. Every number in this phase's Result needs A/B pairs spread over
  sessions, since agreement is measured one held-out session at a time. The minimum 4e states
  is provisional: **40 rated pairs (not skips) over at least 3 sessions, per vibe.** The A/B view
  from phase 2 records them now, before any of this phase is built, so rating can start in
  parallel. Pick one or two vibes to rate deeply rather than all four thinly.

**What the code holds today** (read at `05370bf`):

- `ratings` rows store both sides' genome, seed, offset, duration, engine version, the rated
  audio as heard, played fraction, `leftSide`, `orderSeed`, outcome (`a`, `b`, `tie`, `skip`) and
  time taken, plus `aRank`, `aScore`, `aModelVersion`, `aWildcard` and the `b` equivalents, which
  2c added for this phase and every row so far leaves null. `feedback` holds thumbs and "more /
  less like this" on a macro with its effective value over the heard window.
- `rated_audio` keeps each excerpt as the owner heard it, so an embedding of what was rated
  survives an engine change; `renders` holds each excerpt's features and checks as derived data,
  keyed by `producer`.
- Example retrieval is `rating-recency` (0024), logged as `retrievalMethod`; the spec's CLAP
  retrieval waits for embeddings.
- `sidecar/` is an empty package with ruff, strict pyright and one wiring test; `./scripts/check`
  already runs its pytest. Nothing in `src/server` starts it.
- Excerpts are normalized to the vibe's loudness target, so integrated loudness is the same for
  every heard excerpt; "louder wins" has to read another measure (4e).

**Shared helpers and their owners** (orchestrator rule 4):

- 4a: the protocol file both sides load, the Node client (`sidecar-client.js`) with its timeout,
  restart and cancel, the fake sidecar in `test/support/`, and the Python request loop.
- 4b: the `embeddings` table and its migration (derived, keyed by rated audio or render and the
  checkpoint's producer), and the embed job.
- 4c: the training-set builder and `modelKey()`, the hash every model, report and rank names.
- 4d: the fit and predict methods in the sidecar.
- 4e: the evaluation report and its minimum. 4f: the pair picker and the ranking fields.
- A step that finds it needs another migration asks the orchestrator for the number.

### Steps

Order: 4a ‖ 4c, then 4b ‖ 4i, then 4j, then 4d, then 4e ‖ 4g, then 4f, then 4h. 4i and 4j were
added on 2026-11-07 at the owner's request, to rate faster before the model needs the data.

#### 4a — The sidecar process

- **Builds:** one long-lived child process the server starts through `uv run --frozen` inside
  `sidecar/`, the first time a job needs it and never at start-up. Line-delimited JSON over
  stdio: each request `{id, method, params}`, each answer `{id, result}` or `{id, error}`, with
  the methods and their params defined once in a protocol file both sides load. Audio and arrays
  pass as file paths under the data root. The client gives every request a timeout from config;
  a crash or a hang ends the process, reports the failed request to the job and the owner, and
  starts a fresh process on the next request, never retrying on its own. A session stop or a job
  cancel cancels what is in flight. Node owns every SQLite write. The first methods are `ping`
  and `version` (the package version and Python's).
- **Tiers:** server, sidecar, config (the timeout key).
- **Tests first:** the client against a fake sidecar: an answer arrives under its id; two
  requests in flight are answered out of order; a timeout kills the process and fails the
  request with a message naming the method; a crash mid-request does the same and the next
  request starts a new process; cancel ends the request; a line that isn't JSON is an error,
  not a hang. In pytest, the loop answers `ping`, rejects an unknown method with an error answer
  and keeps reading, and rejects a request missing `id`. A protocol test loads the one file from
  both sides.
- **Records:** writes 0041: the process model, protocol file location, framing, timeouts,
  restart and cancel, why not HTTP, and why it starts on first use.
- **Parallel:** with 4c. Review: yes (new subsystem, the sidecar boundary).

#### 4b — CLAP embeddings

- **Builds:** `embed_audio(paths)` and `embed_text(texts)` in the sidecar with the checkpoint the
  owner approved, on CPU with a capped thread count so it leaves omlx the GPU. An excerpt longer
  than CLAP's window is embedded as the mean of its windows, unit-normalized. A derived
  `embeddings` table holds one row per rated audio or render and producer (the checkpoint's id and
  hash), dropped and rebuilt when the producer changes. An owner-started "embed" job embeds every
  rated audio and kept render that lacks a row, with progress steps; the candidates job embeds
  each new excerpt after its features when the sidecar is set up, and skips that step, saying so,
  when it isn't.
- **Tiers:** sidecar, server, config (the checkpoint cache folder).
- **Tests first:** pytest with a tiny fake model in place of CLAP: shapes, window averaging,
  normalization, a missing file as an error answer. In Node, against the fake sidecar: the job
  embeds only what lacks a row, a producer change rebuilds, a sidecar failure fails the job
  with the file named and keeps the rows already written. One pytest marked to run only when
  the checkpoint is cached checks that the same file embeds identically twice and that a text
  embeds near an excerpt it describes better than one it doesn't.
- **Bench (capped at five minutes):** seconds per 30 s excerpt on mbp2021 on CPU, in 0042.
- **Records:** writes 0042: packages and versions, checkpoint, window, sample rate, dimension,
  windowing, threads, the cache folder, and the derived-data shape.
- **Parallel:** none.

#### 4c — Training sets and the model key

- **Builds:** in `src/domain`, pure and testable without a sidecar: from a vibe's ratings and
  feedback, a training set of pairs (winner, loser; a tie as half a win each way; skips dropped)
  and pointwise thumbs, each side described by its embedding id, its heard features
  (`FEATURE_NAMES`) and its macros' effective values over the heard window, plus which side was
  on the left. Removed rows are left out. Folds split by session, leave one session out, and a
  pair whose candidate also appears in another session's pairs is dropped from that test fold
  so nothing leaks. `modelKey()` hashes the rating ids, the feature extractor's and embedding's
  producers and the hyperparameters.
- **Tiers:** domain.
- **Tests first:** a tie becomes two half-weighted pairs; a skip and a removed rating are left
  out; each fold's test pairs share no candidate with its training pairs; one more rating
  changes the key and reordering the rows doesn't; a pair with a missing embedding is reported,
  not dropped silently.
- **Records:** writes 0043: ties as half a win in the fit and excluded from agreement, thumbs as
  a pointwise term, the fold rule, and the key.
- **Parallel:** with 4a.

#### 4d — The preference model

- **Builds:** in the sidecar, `fit(train_set_path)` and `predict(model_path, items)`: Bayesian
  logistic Bradley–Terry with a Laplace posterior over PCA-reduced CLAP (dimension chosen in the
  record, about 8–16 against tens of pairs) plus standardized features and macros, with a
  left/right bias term and the thumbs as a pointwise term. Each vibe's weights have a Gaussian
  prior centered on a global fit over every vibe, weaker than the vibe's own data once it has
  some. `predict` returns each item's mean score and variance, and the variance of any pair's
  difference. Models are files under the data root named by `modelKey()`, derived data, rebuilt
  when the key changes.
- **Tiers:** sidecar, server (the fit job and storage).
- **Tests first:** on synthetic pairs from known weights, the fit recovers the weights' signs
  and ranks held-out items with agreement over 0.8; variance falls as pairs are added; a vibe
  with no pairs predicts from the global prior; a left bias planted in the data is learned by
  the bias term, not the weights; the same set fits identically twice.
- **Records:** writes 0044: the model, the PCA dimension and prior strengths, the global prior,
  and why Laplace rather than an ensemble.
- **Parallel:** none. Review: yes.

#### 4e — Held-out agreement and the baselines

- **Builds:** an owner-started "Model test" for preferences: for each vibe, fit on all sessions
  but one and score the held-out session's pairs, then report agreement with a bootstrap 95%
  interval and the pair count, against always-left, louder wins and a features-only model.
  "Louder wins" reads the excerpt's momentary loudness range or peak, since integrated loudness
  is normalized; the record says which. Below the minimum (provisionally 40 pairs over 3
  sessions) the vibe reads "not enough data" with how many more pairs it needs. The report is
  stored like the generation evaluations and shown on the Model test page.
- **Tiers:** server, web.
- **Tests first:** on a scripted training set through the fake sidecar: agreement and its
  interval match a hand count; always-left scores the share of left wins; a vibe under the
  minimum reads "not enough data" and names the shortfall; ties are left out of agreement.
- **Records:** writes 0045: the minimum and why, the bootstrap, the loudness measure, and the
  report's shape.
- **Parallel:** with 4g.

#### 4f — Ranking and better pairs

- **Builds:** when a vibe has a fitted model, the candidates job ranks its new candidates by
  posterior mean, the grid shows them in that order with the score, and one slot in every eight
  goes to a wildcard drawn from outside the top half. The A/B view offers the pair with the
  widest uncertainty in its difference among the session's candidates, with the old choice when
  there is no model. Every rating fills `aRank`, `aScore`, `aModelVersion` (the model key) and
  `aWildcard`, and the `b` equivalents.
- **Tiers:** server, web.
- **Tests first:** with a scripted model, the order follows the scores; a wildcard comes from the
  bottom half; the offered pair is the one with the widest difference variance; a rating stores
  the rank, score, key and wildcard flag it was shown with; with no model, nothing changes from
  today.
- **Records:** writes 0046: the ranking, the wildcard share, the pair rule, and what the grid
  shows.
- **Parallel:** none. Review: yes (session page in Safari: name `card-hold.js` in the brief and
  say what holds a card, as phase 3's retrospective asks).

#### 4g — "What you like"

- **Builds:** a short plain-language summary on the vibe's brief page from the model's feature
  and macro weights whose 95% interval excludes zero ("prefers less density, a longer reverb"),
  with the pair count it rests on, and "not enough data" under 4e's minimum. Written from the
  weights by a template, not by the model, so it costs no omlx time and says only what the fit
  supports.
- **Tiers:** domain (the text), server, web.
- **Tests first:** weights with known signs give the matching phrases; a weight whose interval
  crosses zero is left out; under the minimum the text says so.
- **Records:** writes 0047: the template, the interval rule, why not the LLM.
- **Parallel:** with 4e.

#### 4i — Quick A/B, the excerpt player and MP3 playback audio

- **Builds:** a quick A/B page started from a session page, over that session's candidates less
  the hidden ones (none hidden until 4j). By default the chosen side stays as champion against
  the next challenger until every candidate has had a turn; a switch draws random pairs instead,
  never a pair twice. Keys, owner's choice: ← and → play left and right, switching at the same
  point in the excerpt; A chooses left, D chooses right, S is about the same, W skips, Space
  pauses, Z undoes. The buttons stay beside the keys, which amends 0032 for this page only.
  Ratings go through the existing rating route with the session's id, so 4c's folds read them
  unchanged. A minimal excerpt player, a play button, the time and a full-width seek bar, replaces
  the native `<audio>` controls on every page, keeping the played tracker. Playback audio is MP3
  at 320 kbps through the `lame` CLI (owner-approved; a system tool like `flac`); the one file
  kept per rated excerpt stays FLAC with its PCM hash, made from the exact normalized PCM.
- **Tiers:** server, web.
- **Tests first:** the champion stays after a choice and a fresh challenger comes next; random
  mode never repeats a pair; every key does what it names and does nothing while a field has
  focus; a rating from the page stores the session id and the shown order; the excerpt route
  serves MP3 and seeks by byte range; rated audio is still FLAC whose PCM hash checks.
- **Records:** writes 0048, amends 0026 (the cache format) and 0032 (keys on this page).
- **Parallel:** 4b. Review: yes (keys and the player in Safari; name `card-hold.js`).

#### 4j — The session table, hiding and rating marks

- **Builds:** the session page lists candidates as a compact table, revised and branched
  candidates nested under their parent so lineage shows at a glance. Each row shows a mark per
  A/B win and per loss, and whether it has been A/B rated at all. A row can be hidden, after
  rating or not, into a hidden panel that opens to show and unhide it; hidden candidates leave
  quick A/B. Hiding is the owner's choice, so it is irreplaceable data: a migration, and unhiding
  appends rather than deletes. Going to A/B and back restores the session page's scroll.
- **Tiers:** server, web.
- **Tests first:** children nest under their parent at any depth; the marks count live A/B wins
  and losses, not ties, skips or undone ratings; hide and unhide round-trip and keep history;
  quick A/B leaves hidden candidates out; the scroll is restored after a return.
- **Records:** writes 0049, amends 0028.
- **Parallel:** none. Review: yes (the table in Safari).

#### 4h — Examples retrieved by similarity

- **Builds:** when embeddings exist, the generation prompt's liked and disliked examples are the
  rated genomes nearest the vibe's brief in CLAP text-to-audio similarity, instead of the newest,
  logged as `retrievalMethod: "clap-similarity"`; with no embeddings it stays `rating-recency`.
- **Tiers:** server.
- **Tests first:** with scripted embeddings, the nearest liked and disliked come first and the
  method is logged; with none, the old order and method.
- **Records:** amends 0024.
- **Parallel:** none.

**Result:** built on 2026-11-07 at `97d951f`; held-out agreement is inconclusive, waiting on data. The
owner asked to move on to phase 5.

1. Every step, 4a–4j, is merged, and the gate passes (1,580 tests, the sidecar's pytest 54 passed
   and 1 skipped). The sidecar, CLAP embeddings (`laion/clap-htsat-unfused`, 0042), the per-vibe
   Bradley–Terry model with its Laplace posterior and cross-vibe prior, the taste test against
   three baselines, the ranking with wildcards, the best-question picker, the "What you like"
   summary, quick A/B, the session table and examples by sound are all in place.
2. Held-out agreement: no number yet. On 2026-11-07 the studio held 0 A/B ratings, under 4e's
   provisional minimum of 40 pairs over 3 sessions per vibe, so the taste test reports "not
   enough data" for every vibe. The model, the ranking and the picker have only been run on
   scripted data in tests.
3. For the owner: run Analyze the sound, then Fit the taste model, on the Model test page; rate
   with quick A/B ("Best questions" once a session is ranked); then run the taste test. Phase 5's
   acceptance 4 reads its lower bound.

## Phase 5 — Optimizers

**Goal:** search inside the vibe's constraints, not only through the LLM, and let the owner aim
generation and search at parts of a reference recording.

**Acceptance, as measurable checks:**

1. **References.** A file in each accepted format uploads and decodes; a region marked on it has
   features equal to `extractFeatures` on the same decoded samples, and a CLAP embedding. Uploads
   and regions are append-only, with a migration tested over the previous shape.
2. **A region sets targets and guides generation.** Ranges proposed from a region validate and
   contain its median for every feature they name. A first prompt with two regions attached holds
   each one's numbers and words, under the budget with 0038's seed-sized vibe, a base and six
   examples.
3. **No locked value moves and no linter-rejected genome is shown.** Over 1,000 seeded asks each
   of CMA-ES, preferential BO, the archive's emitter and breeding's mutation, under three locks (a
   macro, a voice parameter, a whole voice): every stored child keeps its locked values, no locked
   path is in a search vector, and no genome failing lint is rendered, offered in A/B or shown.
4. **The model-in-the-loop optimizer beats an equal budget of nudges.** Per vibe, CMA-ES's best is
   compared with the best of a control: as many nudges from the same base, scored the same way.
   - By the model: the share of runs CMA-ES wins and the mean score difference with a bootstrap
     95% interval. It counts only when 4e's held-out agreement for the vibe has a lower bound above
     0.5; otherwise "inconclusive: the model doesn't yet beat chance on held-out pairs".
   - By the owner: blind A/B pairs of the two bests. An exact one-sided binomial test on decided
     pairs passes at p < 0.05 over at least 12 (10 of 12 gives p = 0.019); below 12, "inconclusive,
     waiting on data".
5. **The archive fills and plays.** On two or three owner-chosen axes, a fill job reports coverage
   (filled cells over cells) beside the coverage of the same budget of nudges from the same
   starts. Every filled cell plays its elite on click or Enter, and descriptors are read from the
   excerpt windows the owner rates.
6. **Breeding** makes children of two sketches by LLM crossover plus mutation; each stores both
   parents, its operator and source.
7. **Sliders.** A typed direction becomes a slider, each card shows its position on it, and a steer
   job toward either end moves its shown children's mean position that way (tested with a scripted
   embedder, logged in the owner's run).

**Gate:** `./scripts/check` with the sidecar's pytest; coverage and the optimizer evaluation in
Result. omlx only through the queue, the sidecar only through its client, fakes for both in
tests. Acceptance 4 waits on ratings and on the owner starting 5j; "inconclusive, waiting on
data" is an allowed result.

**The acceptance means model-in-the-loop CMA-ES (5e)**, recorded in 0054, because:

- the preference model (4d) scores each point, so a run of a hundred evaluations costs CPU
  minutes, not listening hours, and never reaches omlx;
- its gain can be tested against a control on equal terms, an equal budget of 3e's nudges, by
  the model and then by a dozen owner pairs;
- preferential BO (5f) spends tens of owner ratings to reach one point per run, too few to test.
  It is built as a tool whose every query is also an A/B rating for 4d, which phase 4 lacks; its
  acceptance is check 3 alone.

**Settled by the owner on 2026-11-07, when phase 5 was expanded:**

- **Reference uploads are in phase 5.** The owner uploads a file, marks regions, and each region is
  analysed with the existing features plus a CLAP embedding.
- **A region has three uses:** (a) set a brief's targets from its features (0034's ranges); (b)
  guide generation, described in the prompt as numbers and words; (c) steer by sound, its
  embedding a target that search and sliders move toward.
- **Non-goal: uploaded audio never plays in a render.** The recording voice (0029) plays only the
  configured recordings folder, and nothing copies an upload there. Also out: stems from a
  reference, matching its melody or harmony, and sending its audio to omlx.
- **Uploads and regions are irreplaceable**: a migration, append-only rows, files in backups.

**Settled by the owner on 2026-11-07:** `cma` is approved for 5e. A brief's attached regions,
directions and axes live in their own append-only table keyed by vibe, not in `softTargets`, so
changing them makes no new brief revision; each generation still records which ones it read.
Where a step below says `softTargets.references`, `.directions` or `.axes`, read that table.
5c is the step that adds it, and asks the orchestrator for its migration number.

**Waiting on the owner before 5e and 5f** (AGENTS.md reserves both):

- **CMA-ES (5e).** Recommended: `cma` (pycma), Hansen's reference implementation, pure Python on
  the `numpy` already installed, with box bounds built in; pinned at approval. Alternative: about
  120 lines of numpy after Hansen's `purecma`, no dependency, but the step-size and covariance
  updates and their tests are then ours.
- **Preferential BO (5f).** Recommended: no package; a Gaussian process with a pairwise probit
  likelihood and Laplace posterior is 4d's linear algebra again, in numpy. Alternative:
  `botorch`'s `PairwiseGP` with EUBO, which brings `gpytorch`, `linear_operator`, `scipy` and
  `pyro-ppl`.
- **MAP-Elites (5h)** needs none: the grid lives in `src/domain` and its emitter is the nudge.
- **Ratings.** Acceptance 4 needs 4e's minimum (provisionally 40 pairs over 3 sessions, per vibe)
  and 12 spot-check pairs. On 2026-11-07: 0 A/B ratings, some thumbs, sessions on all three
  briefs. Quick A/B (4i) and 5f both add pairs; rating one vibe deeply gets there first.
- **The first map's axes**, chosen on the brief page once 5h lands (dark to bright by static to
  evolving reads as centroid by loudness range).

**What the code holds today** (read at `bf0f64d`; phase 4 as planned, since 4b and 4i are being
built and 4d–4h follow):

- **Vector view** (`src/engine/vector-view.js`): `vectorPaths`, `toVector`, `fromVector` and
  `fromVectorUnchecked` over number and int paths only (0005, 0037). Voices, types, choices and
  recordings have no path, so a search moves numbers inside one base's structure; structure
  changes come from the model.
- **The nudge is the nearest thing to an ask** (`nudge` in `src/domain/nudge.js`): free paths are
  `vectorPaths` less `lockedPaths` and `fixedByVibe`, and each draw runs `fromVectorUnchecked`,
  `validateGenome`, `applyLocks`, a repeat check on `canonicalGenome`, then `lintGenome`, at most
  `NUDGE_DRAWS` (4) a child, rejected draws stored. The chain lives inside `nudge`.
- **Jobs**: `createJobRunner` runs one job at a time, started only by a route. `nudgeJob` (source
  `mutation`) and `candidateJob` (which explore reuses) store `parentIds`, `locks`, `operator` and
  `operatorParams`. `OPERATOR` (`src/domain/operator.js`) holds `revise`, `revise-control`,
  `nudge` and `explore`; the spec's sources `crossover`, `optimizer` and `breeding` are unused.
- **Prompt** (`buildPrompt`): brief, constraints, `targetsText`, locks, notes, examples, then the
  ask or explore's base; trimming drops examples, then the base. A seed-sized prompt with a base
  is about 4,300 of 8,192 tokens (0038).
- **Soft targets**: `validateTargets` checks `softTargets.features` and keeps other keys (0034),
  which 3b left for phase 5's directions. References, directions and axes go there with no
  migration, versioned by the brief's revisions.
- **Features**: `extractFeatures(raw, heard)` on 48 kHz audio (`requireMeterSampleRate`) and
  `normalize`'s result; nine `FEATURE_NAMES`, the two raw levels taking no range; excerpts are
  `EXCERPT_SECONDS` (25), cached in `renders` by window, target and `PRODUCER`.
- **Decoding**: `decodeRecording` (`src/server/load-samples.js`) reads WAV, FLAC and AIFF through
  node-web-audio-api for the `fieldRecordings` folder (0029). ffmpeg 9.0.2 is installed and called
  only by `scripts/loudness-oracle.js` and test fixtures; `readFlacPcm` is the neighbor for a CLI
  read with `execFile`.
- **HTTP**: `readJson` takes `application/json` up to `MAX_BODY_BYTES` (1 MiB); no route takes a
  file. **Data root** (`src/config/paths.js`): `studio.db`, `renders/`, `rated_audio/`,
  `backups/`; `backup.js` copies the database and rated audio.
- **Sidecar** (0041): protocol params are `string`, `number` or `boolean`, so vectors and scores
  pass as files under the data root; `ping` and `version` today.
- **Stored reports**: `evaluations` (`params`, `report`), used by the generation evaluations and
  4e. **Sketches**: rows naming a candidate, notes and tags.
- **Phase 4 as planned**: 4b's `embed_audio`, `embed_text` and derived `embeddings`; 4d's `fit`
  and `predict` (mean and variance per item, variance of a pair's difference); 4e's agreement and
  minimum; 4i's quick A/B, excerpt player and MP3 playback through `lame`; 4j's session table and
  hiding. 0043 leaves "more / less like this" for phase 5; this phase doesn't read it (0053).

**Shared helpers and their owners** (orchestrator rule 4):

- 5a: the reference tables and migration, `paths().references`, `decodeWithFfmpeg`, the upload
  route, the backup's new folder.
- 5b: the region analysis rows and `rangesFromRegion`.
- 5c: validation of the steering keys of `softTargets`, which 5g and 5h extend; `referencesText`.
- 5d: first commit, behavior unchanged, moves nudge's chain into `proposeGenome` and the free-path
  rule into `searchPaths`, which every optimizer and the emitter call. Then the ask/tell methods,
  the file format, and `searchScore`, the one objective.
- 5e: the search job's shape (budget, cost estimate, progress, cancel, control arm), reused by 5g's
  steer job, 5h's fill job and 5j.
- 5g: direction vectors and projections. 5h: `buildArchive` and its route.
- Each step that adds a job adds its operator and its row in 0031's table.
- 5a needs a migration; phase 4 holds 0006–0008, so it asks the orchestrator for the number, as
  does any step that finds it needs one.

### Steps

Order: 5a ‖ 5d, then 5b ‖ 5e, then 5c ‖ 5f, then 5g, then 5h ‖ 5i, then 5j. References come first
so uses (a) and (b) reach the owner after 5b and 5c, before any optimizer. 5d's first commit (the
moved chain) is on main before 5e starts, and 5e builds on 5d's merge.

#### 5a — Reference uploads and regions

- **Builds:** a References page, linked from the dashboard and each brief.
  - **Upload.** `POST /api/references` streams an `application/octet-stream` body (the file name
    in a header) to a temp file under the data root, hashing as it goes, at most 1 GiB. `ffprobe`
    then reads it. Accepted: WAV, AIFF, FLAC, MP3, AAC or ALAC in M4A, Ogg Vorbis and Opus, 10 s to
    60 min, 1 or 2 channels. Anything else is a 400 naming the reason, with the temp file removed.
    A kept file becomes `<dataRoot>/references/<sha256>.<ext>`; the same bytes twice give one file
    and one row.
  - **Tables** (irreplaceable, one migration): `reference_files` (hash, the owner's file name,
    format, duration, channels, rate, size) and `reference_regions` (file, start and end seconds,
    label, note), both with removed marks. Changing a region marks it "replaced" and adds its
    successor; removing a file keeps its bytes.
  - **Decoding** by `decodeWithFfmpeg(path, start, end)`: `execFile` with `-ss` and `-t` after
    `-i`, `-f f32le -ac 2 -ar 48000` to stdout, so a region is 48 kHz stereo as the meter needs,
    and a mono file plays in both channels as 0029's voice does.
  - **The page**: a peak strip from a derived peaks file, start and end fields (drag on the strip
    as a shortcut, never the only way), play through 4i's player with MP3 playback audio made from
    the decode, a label and note. Plain words (0032); Safari 17.6.
  - **Backups** copy `references/`.
- **Tiers:** config, server, web.
- **Tests first:** fixtures are made by ffmpeg from seeded noise and sines, as 0029's are; nothing
  committed is a real recording. Each accepted format uploads and decodes; a text file, a 5 s file
  and a 4-channel file are 400s that leave nothing behind; an oversize body is a 413; the same
  bytes twice give one row; a region decodes to the frames its bounds name, the same twice;
  replacing and removing keep the old rows; the migration runs over phase 4's last shape; a
  backup holds the folder; the region form is a DOM-free module.
- **Records:** writes 0050: formats, limits, location and naming, the tables, ffmpeg as the one
  decoder (0029 measured `decodeAudioData` on WAV, FLAC and AIFF only), the route, and the
  non-goal. Amends 0019, 0021 and 0025.
- **Parallel:** with 5d. Review: yes (an irreplaceable table, a migration, a Safari page), with a
  security pass on the upload: paths, size, the CLI's arguments.

#### 5b — Region analysis and ranges from a region (use a)

- **Builds:** an owner-started Analyse job per region.
  - **Features** on `EXCERPT_SECONDS` windows hopped by half a window, so a region is read as an
    excerpt is; one shorter than a window is read whole. Each window is normalized to the asking
    brief's target (0018's −16 LUFS on the References page), then `extractFeatures`.
  - **Embedding**: the windows go to 4b's `embed_audio` as a 48 kHz WAV under the data root, and
    the region's embedding is their unit-normalized mean, 4b's rule for long excerpts.
  - **Storage**: derived rows keyed by region, target and producers, rebuilt when one changes,
    like `renders`; whether they join 4b's `embeddings` table follows 0042's shape.
  - **Ranges**: `rangesFromRegion(windows)` in `src/domain` proposes the 10th to 90th percentile
    per feature, widened to a stated minimum width and clamped to 0034's bounds, never for the two
    raw levels (a mastered level says nothing a genome can match). "Set ranges from a region" on
    the brief page fills the form beside the current ranges; nothing changes until the owner saves.
- **Tiers:** domain, server, web.
- **Tests first:** stored features equal `extractFeatures` on the decoded, normalized window; a
  60 s region gives three or more windows and a 15 s one gives one; the proposal holds each
  window's median, is never under the minimum width, validates, and never names a raw level;
  with the fake sidecar the embedding is the normalized mean, and a sidecar failure fails the job
  naming the region and keeps the features; the form fills without saving.
- **Records:** writes 0051: windows, target, raw levels, percentiles and widths, derived rows.
  Amends 0034.
- **Parallel:** with 5e. Review: yes (the sidecar boundary).

#### 5c — A region in the prompt (use b)

- **Builds:** the owner attaches up to two analysed regions to a brief, saved as
  `softTargets.references` in a new revision, so each generation records what it read. An
  unknown or removed region is a 400 naming it. `referencesText` writes a section after the
  ranges: per region, the label and note quoted as JSON (0038's rule for owner text), its median
  features as `featuresText` writes them, and up to five words from a fixed vocabulary in
  `src/domain` (about 60 plain words, "dark", "airy", "pulsing"), the nearest by CLAP text-to-audio
  similarity, so the words are measured. The section says to aim at the measurements, not copy
  the recording. Trimming drops examples, then references, then the base; explore, breeding and
  revisions read it as part of the first prompt.
- **Tiers:** domain, server (validation, cached vocabulary embeddings), web.
- **Tests first:** acceptance 2's prompt and budget; a note with a quote and a line break can't
  end its line; examples go before references; words come out in similarity order with a scripted
  embedder; a revision without references prompts byte for byte as today.
- **Records:** writes 0052: attaching, the section, the vocabulary, trimming, token cost. Amends
  0024 and 0034.
- **Parallel:** with 5f; no shared files. 5i builds on this section; its brief names it.

#### 5d — Search space, proposals and ask/tell

- **Builds:**
  - **First commit**, behavior unchanged: `proposeGenome(start, paths, vector, {locks,
    constraints, seen})` and `searchPaths(genome, locks, constraints, chosen)` move out of `nudge`,
    which calls both.
  - **Search space**: the macros, plus raw paths the owner picks from `searchPaths` on the job
    form (none by default), at most 24 dimensions; locked and vibe-fixed paths are never offered.
  - **Protocol**: `optimizer_start(spec_path)`, `optimizer_ask(run_id, count, out_path)` and
    `optimizer_tell(run_id, points_path, scores_path)`, arrays as JSON files under
    `<dataRoot>/search/<run>/`. Python returns points in [0, 1]^d; Node decodes, lints, renders,
    embeds and scores. State is written after each tell, so a run continues after a sidecar
    restart; a failure fails the job and is reported, never retried.
  - **Rejected points** are stored as rejected candidates, never rendered, and told the
    generation's worst valid score minus one standard deviation (−1 when none is valid).
  - **Objective** (`searchScore` in `src/domain`): 4d's posterior mean minus κ standard deviations
    (κ = 1), a lower bound that keeps the search where the model has evidence. 5g adds terms.
- **Tiers:** domain, server, sidecar.
- **Tests first:** every nudge test passes on the first commit; `searchPaths` drops a locked
  macro, a locked voice and a fixed `key`; pytest round-trips start, ask and tell on a scripted
  optimizer, and a restarted sidecar continues from the state file; a rejected point is stored,
  unrendered and penalized; acceptance 3's 1,000 asks with the fake sidecar; `searchScore` orders
  scripted means and variances by the bound.
- **Records:** writes 0053: the space, the moved chain, the protocol, state files, the penalty, the
  objective, and why macro feedback isn't read (one excerpt's wish about one macro is too sparse to
  steer a search). Amends 0037 and 0041.
- **Parallel:** with 5a. Review: yes (a new subsystem, the sidecar boundary).

#### 5e — Model-in-the-loop CMA-ES

- **Builds:** an owner-started Search from a candidate (operator `optimize`, source `optimizer`):
  CMA-ES from the base's vector, starting step 0.12 (nudge's medium), population about
  4 + 3 ln d, budget in evaluations (default 96, at most 400). An evaluation is a proposal, an
  excerpt, features, an embedding and a `predict`.
  - **Cost first**: the confirm gives evaluations × (render + embed seconds) from the last run's
    medians, or 4b's bench before any, and says it uses no omlx. Progress per generation; cancel
    keeps every row.
  - **Shown**: every evaluated point is a session candidate with run, generation and point in
    `operatorParams`; the session shows the best 4, no two nearer than a stated CLAP distance, the
    rest folded under them in 4j's table.
  - **Control arm** (a switch): the same budget of medium nudges from the base, scored the same
    way, operator `optimize-control`, never shown.
  - A vibe with no fitted model is refused with the reason. An identical search queued or running
    is a 409.
- **Tiers:** server, sidecar, web.
- **Tests first:** pytest: on a quadratic in [0, 1]^8 the best score after 200 evaluations is
  within 0.05 of the optimum's, and the best point within 0.1 of it (0054), and one seed gives
  one run. Node, scripted scorer: the job stops at budget; the
  shown 4 follow score and distance; the control runs as many nudges; cancel keeps rows; the
  estimate is the formula on scripted timings; no model is a 409; locks hold.
- **Records:** writes 0054: settings, budget and estimate, what is shown, the control arm, and
  which optimizer the acceptance means. Amends 0031.
- **Parallel:** with 5b. Review: yes (new subsystem, the sidecar boundary, renders and embeds in
  one job).

#### 5f — Owner-in-the-loop preferential BO

- **Builds:** "Search by ear" from a candidate (operator `optimize-ear`, source `optimizer`), over
  at most 12 dimensions (the macros by default), in quick A/B's champion mode (4i). Each query
  pits the run's best against one new point, the best of 1,000 seeded draws near it by expected
  improvement under a pairwise-probit GP with a Laplace posterior. The next excerpt renders while
  the owner listens. Budget in queries (default 20), stop any time; the best is shown in the
  session. Each answer is an ordinary rating with the session's id, so it trains 4d too; a skip
  tells nothing, a tie is a tie (0043); a rejected point is told as a loss and never shown.
- **Tiers:** sidecar, server, web (4i's page in BO mode).
- **Tests first:** pytest: with simulated choices on a known utility in [0, 1]^4, the best after
  30 queries is nearer the optimum than the start in at least 9 of 10 seeds; a hand-worked
  two-point posterior. Node: a page rating is stored as quick A/B's and told; a skip isn't; a
  rejected point never reaches the page; the next excerpt is ready before it's asked for; locks
  hold.
- **Records:** writes 0055: the GP, kernel, likelihood, acquisition, budget, ties and skips, and
  why its acceptance is check 3. Amends 0048.
- **Parallel:** with 5c. Review: yes (sidecar boundary; the A/B page in Safari: name
  `card-hold.js` and what holds a card, as phase 3's retrospective asks).

#### 5g — CLAP directions, sliders and the reference target (use c)

- **Builds:**
  - **Directions** typed on the brief page as two ends ("dry" to "underwater"), saved as
    `vibe_attachments` rows of kind `direction` (the owner's 2026-11-07 settlement); the far end
    alone runs from the brief's own description as text, or a neutral phrase for an empty one,
    so both ends are text and CLAP's text-to-audio offset cancels (0056). A direction is the unit
    difference of the ends' `embed_text`.
  - **Position**: each card shows its projection on each direction, scaled so 0 is the vibe's
    least excerpt and 1 its most.
  - **Sliders**: a card's slider from less to more, and Steer starts 5e's job at a small budget
    (default 32) scoring the projection toward the setting, plus a small weight on 4d's score when
    a model exists. A vibe with no ratings can still steer.
  - **Reference target**: an attached region can be a `searchScore` term, similarity to its
    embedding with a weight, offered as "toward this region" beside the sliders.
  - Directions, projections and region terms are pure functions in `src/domain` over stored
    embeddings, so phase 6 can read them for sections and automation.
- **Tiers:** domain, server, web.
- **Tests first:** a direction is the normalized difference; projections order cards; steering
  toward "more" raises the shown children's mean projection over the base's and toward "less"
  lowers it; a region term pulls the scripted best toward the region; no model still steers; a
  revision without directions scores as before.
- **Records:** writes 0056: directions, the default far end, the scale, the steer job, the region
  term, phase 6's use. Amends 0034 and 0053.
- **Parallel:** none (changes 5d's objective and 5e's job, and the brief and session pages).
  Review: yes (session page in Safari: name `card-hold.js`).

#### 5h — The MAP-Elites archive and the map view

- **Builds:**
  - **Axes**, two or three in `softTargets.axes`: a ranged feature, a macro's mean over the
    window, a direction's projection or similarity to an attached region; each with ends and bins
    (8 a side for two axes, 6 for three, at most 256 cells). Ends default to the vibe's range, or
    the 10th and 90th percentile of its excerpts.
  - **The archive** (`buildArchive`, derived, rebuilt on each read of `GET
    /api/vibes/:id/archive`): every live valid candidate with a current excerpt lands in the cell
    its excerpt's descriptors name; the elite is the best by `searchScore`, or with no model the
    fewest range misses, then the newest. Phase 6 and phase 7's gap filling read the same route.
  - **Fill job** (operator `elite`, budget default 200, 5e's estimate): each step nudges, at the
    medium step through `proposeGenome`, an elite next to an empty cell. An optional share of steps
    (0 by default) asks the model through explore with a direction toward the empty side, and the
    confirm then states the omlx requests. The control: the same budget of nudges from the same
    starts.
  - **The map view**: an HTML table of cell buttons with each elite's intent and score, arrow keys
    between cells, click or Enter plays through 4i's player, and explore, nudge and keep as sketch
    on the open cell. Plain words; Safari 17.6.
- **Tiers:** domain, server, web.
- **Tests first:** scripted candidates land in their cells and the elite follows the rule with and
  without a model; removed and invalid ones are left out; axis ends from ranges and percentiles;
  the fill job stops at budget, starts only from elites beside empty cells, and keeps locks; both
  coverages count from the cells; the grid module is DOM-free and arrows move one cell; a cell
  plays its elite.
- **Records:** writes 0057: axes, the derived archive, elites, the emitter and explore share,
  coverage and control, the map view. Amends 0031 and 0032.
- **Parallel:** with 5i. Both add to `src/domain/operator.js`, `src/server/session-routes.js` and
  0031's table; the second to merge rebases those. Review: yes (the map page in Safari).

#### 5i — Breeding

- **Builds:** pick two sketches on the brief page and Breed (operator `breed`, source `breeding`):
  by default 4 children by LLM crossover, each then mutated once.
  - **Crossover** is a fresh first prompt like explore's (0038) with "Parent A" and "Parent B"
    sections, each a canonical genome with the live locks applied, asking for one child taking
    parts of both; then `requestCandidate`, one repair and the revision pass, both parents in
    `parentIds`. Trimming drops examples, references, parent B, then parent A.
  - **Mutation**: one small-step nudge of each valid child through `proposeGenome`.
  - The confirm states the omlx requests and their time from recent request times.
- **Tiers:** domain (the parents section), server, web.
- **Tests first:** against the fake omlx the prompt holds both parents after locks, under budget
  with 0038's seed-sized vibe; children store both parents, operator and source; a parent that
  can't take the locks is a 409; mutations keep locks over 1,000 seeded draws; B is trimmed before
  A; a removed sketch can't be picked.
- **Records:** writes 0058: two-parent prompts, mutation after crossover, defaults, trimming, and
  why no voice-wise programmatic crossover (two genomes rarely share voice ids, so swaps mostly
  fail lint). Amends 0024 and 0038.
- **Parallel:** with 5h (shared files named there). Review: yes.

#### 5j — The optimizer evaluation

- **Builds:** an owner-started Optimizer test: per chosen vibe with a model, 3 runs of 5e with its
  control from bases the owner picks or the vibe's top-ranked. Stored in `evaluations`, per vibe:
  4e's agreement and acceptance 4's verdict rule; each run's two bests, the share CMA-ES wins and
  the mean difference with a bootstrap interval; blind spot-check pairs (sides by seed) queued in
  quick A/B, then wins and the binomial p or "inconclusive, waiting on data"; archive coverage
  against its control from the last fill jobs; timings against the estimate.
- **Tiers:** domain (the report), server, web.
- **Tests first:** the win share and interval match a hand count; a lower agreement bound at or
  under 0.5 gives the inconclusive verdict whatever the scores; 10 of 12 gives p = 0.019 and 11
  pairs read "inconclusive"; spot-check ratings store session and sides; a vibe with no model is
  left out with the reason.
- **Records:** writes 0059: runs, control, verdicts, why 12 pairs, the report. Amends 0045.
- **Parallel:** none. Then the orchestrator stops: the owner starts the test once one vibe meets
  4e's minimum and rates the pairs, and the numbers go in Result.

**Pending owner checks** (after 5c, 5g and 5h, on mbp2015 and mbp2026):

- Upload a reference recording, mark two regions, play them, and read their features against what
  you hear; set ranges from one and say whether the proposal is the right width.
- Attach a region, ask for 8 candidates, and say whether they move toward it; read the stored
  prompt's reference section.
- Type two directions, move each slider both ways, and listen to the steered children.
- Choose two axes, fill the map, click through it: neighboring cells should differ the way their
  axes say.
- Breed two sketches and say whether the children sound like both.

**Result:** built on 2026-11-07 at `4f936b2`; the optimizer evaluation is inconclusive, waiting on
data. The orchestrator moved on to phase 6, as 5j says.

1. Every step, 5a–5j, is merged, and the gate passes (1,896 tests, the sidecar's pytest 95 passed
   and 1 skipped). Acceptances 1, 2, 3, 6 and 7 are met by tests over fakes for omlx and the
   sidecar; their owner runs are in the checks above.
2. Acceptance 4 has no number yet: the studio holds 0 A/B ratings, so no vibe meets 4e's minimum,
   no model has held-out agreement above chance, and the optimizer test has not been started. The
   owner starts it from the Model test page and rates its spot-check pairs.
3. Acceptance 5's coverage beside the nudges' waits on the owner choosing axes and starting a fill.

## Phase 6 — Track builder

**Goal:** get closer to putting together songs. Sketches are arranged into 3–20 minute tracks
that play in the studio and export as files.

**Acceptance, as measurable checks:**

1. **A hand-made track plays and exports.** At least three sketches placed by hand with
   crossfades render as an owner-started job, preview as MP3 (4i's format), and export as WAV
   and FLAC (0012) with a manifest. Rendering again from the manifest alone gives the same PCM
   hash. Tracks and their revisions are append-only, with a migration tested over the previous
   shape.
2. **Chunks are seamless.** A section rendered in chunks matches one render of the same window
   within 0007's excerpt tolerance (peak 1e-5, the difference's RMS at least 100 dB under), at
   every seam.
3. **Streaming changes nothing already heard.** The streaming loudness meter, true-peak meter and
   limiter give the same bits as today's whole-array functions on every existing test input, so
   no excerpt, feature or rated audio changes. A track normalizes to its target within 0.1 LU,
   under its ceiling.
4. **Speed and memory.** `./scripts/bench --track` renders a 20-minute track (five sections, four
   transitions including a morph, two macro lanes) at a render-only median of at least 10× real
   time on mbp2021, with a peak RSS under **1 GiB**, and a 10-minute track's peak RSS within
   10% of the 20-minute one's, so memory doesn't grow with length.
5. **Stems.** One stem per voice id sums to the mix before the limiter, at the mix's gain, within
   a peak of 1e-5, at least 100 dB under the mix; stems export unlimited as 32-bit float WAV.
6. **Morphs.** Across a morph, every numeric parameter that both sketches hold moves along its
   encoded scale by the transition's curve (checked at the start, middle and end); a voice whose
   type, choices or flags differ plays as two instances crossfaded; the render before the morph
   starts equals the outgoing section's within 0007's tolerance.
7. **Macro lanes.** Under a lane, each section's effective macro equals its own value plus the
   lane's offset at every breakpoint, clamped to 0–1.
8. **Proposal, then edit.** Given a length and an arc, the model's proposal validates, after at
   most one repair round, and lands within 5% of the length; it opens in the timeline, where
   reordering, resizing and retiming save new revisions and leave the proposal as it was. In the
   owner's run, the share of proposals valid after repair is logged over at least 5 requests.

**Gate:** `./scripts/check`; `./scripts/bench --track` numbers in Result; omlx only through the
queue, with a fake in tests. Acceptance 8's share waits on the owner's run.

**Settled by the owner on 2026-11-07, when phase 6 was expanded:**

- **"Proposal, then edit."** The owner gives a length and an arc; the model proposes sections from
  the owner's sketches; the owner reorders, resizes and retimes them on the timeline before
  rendering. Nothing renders until the owner starts it.
- **A playable track first.** A crossfade-only track from hand-placed sketches comes before
  morphs, automation and the proposal (6a–6c), so the owner can put songs together while the rest
  is built.
- **Previews are MP3** as 4i's playback audio; **exports are WAV and FLAC** (0012).

**Waiting on the owner** (none blocks a step; each builder takes the recommendation and the
record says so, so the owner can overrule):

- **No packages.** Rendering, mixing and encoding use what is installed: node-web-audio-api, the
  `flac` CLI (0012) and `lame` (4i).
- **One brief per track** (recommended): a track's sections come from one vibe's sketches, so it
  has one loudness target, one set of constraints and one brief for the proposal. Alternative:
  any sketches, with the owner setting the track's target. Phase 7's albums cross briefs either
  way.
- **A section longer than its sketch** (recommended: extend). A sketch's genome is 3–15 minutes
  (`MAX_DURATION` 900). Extending makes a derived genome with `duration` raised to the section's
  length, the fade-out and every voice end at the old duration moved with it, and trajectories
  holding past their last point as 0007 already says. Alternative: refuse sections longer than the
  sketch.
- **Stems as 32-bit float WAV** (recommended): unlimited at the mix's gain they can pass 0 dBFS,
  which 24-bit integer clips and FLAC can't hold as float. Alternative: 24-bit with one stated
  headroom gain for every stem, written in the manifest.
- **The memory ceiling, 1 GiB** for any track up to 20 minutes, against 0010's 1.5 GiB for one
  900 s genome.

**What the code holds today** (read at `05f2ffc`; phases 4 and 5 as planned):

- **One context per render.** `renderOffline` (`src/server/render-offline.js`) builds one
  `OfflineAudioContext` from `renderPlan` for the whole window, retries the suspend race
  (`retryOnSuspendRace`), and `trimToResult` copies the kept frames out, so the peak holds the
  buffer twice: 0010 measured 791 MiB for 900 s, and the bench projects about 1,009 MiB. A
  20-minute context would need about 1.1 GB of output alone.
- **Windows already render exactly.** `render(genome, ctx, {seed, duration, offset, voices})`
  schedules any window of a timeline with `preRoll` (reverb decay, echo tail, longest event), and
  an excerpt matches the same window of a full render within 0007's tolerance; `voices` limits a
  render to some voices, and the bus is linear, so 0010 measured solo voices summing to the mix
  within 2.1e-7 (`STEM_PEAK` 1e-6 in `test/engine/render.test.js`).
- **Limits**: `MAX_DURATION` 900 s a genome (`src/engine/timeline.js`), so a 20-minute track is
  several genomes, as 0007 left to this phase; `MAX_POINTS` 64 a trajectory; `MAX_VOICES` 16 and
  `VOICE_ID` `^[a-z][a-z0-9-]{0,15}$`, which is part of every PRNG key (0003), so renaming a voice
  changes its events; `COST_BUDGET` 560 node-seconds a second (`src/engine/cost.js`).
- **Non-numeric globals**: `tuning`, `scale`, `key` and `pulse` are choices; `reverbDecay` sets
  the impulse response and `delayTime` the delay, so neither can follow a trajectory (0006).
- **Normalizing holds everything.** `normalize` (`src/domain/normalize.js`) runs up to 8 passes
  of `limitTruePeak` and `integratedLoudness` over whole arrays; the limiter already works in
  4,096-frame blocks internally, and the meter is K-weighting then 400 ms block powers
  (`windowPowers`), both state that can carry across chunks.
- **Export holds the PCM.** `exportRender` (`src/server/export-render.js`) renders, normalizes,
  encodes all of it with `encodePcm24`, `writeWav` writes it whole, and `writeFlac` streams the
  WAV to flac's stdin. The sidecar JSON (0015) names one genome, seed and window with
  `pcmSha256`; no export route exists, only `src/server/render-cli.js`.
- **The bench** (`scripts/bench.js`, 0016) times the example genome at 300 s and 720 s in child
  processes under `/usr/bin/time -l` and projects peak RSS to 900 s.
- **Store**: `sketches` rows name a candidate, notes and tags; no `tracks` or `exports` tables.
  The job runner runs one job at a time, started only by a route.
- **Phase 5 as planned**: `GET /api/vibes/:id/archive` (5h), direction vectors and projections as
  pure functions (5g), each region's per-window features and embedding (5b), and 5e's job shape
  with a cost estimate.

**What has to change in the engine:** nothing in `render()`, `renderPlan`, the master bus or the
voices. A section is a window of one genome, and a long window renders as chunks through the
existing `offset` and `duration`, each with its own pre-roll. The changes are around the engine:

- **Chunks** (6c): `renderChunks` in `src/server` renders a window in fixed chunks of a stated
  length (about 120 s, chosen in 6c from the bench: a longer chunk spends less on pre-roll, which
  is up to about 45 s with a 20 s reverb, and holds more), each through `renderOffline`, and yields
  them in order. Chunk boundaries sit on multiples of the chunk length on the section's own
  timeline, so a section always splits the same way.
- **Streaming in the domain** (6a): stateful forms of the K-weighted meter, the true-peak meter
  and the limiter that take one chunk at a time; today's whole-array functions call them, with
  the same bits.
- **Streaming files** (6a, 6c): a WAV writer that writes its header for a known frame count and
  then appends chunks; a 32-bit float WAV for stems; the mix kept as a raw float file under the
  data root between passes (461 MB on disk for 20 minutes); FLAC and MP3 encoded from a stream.
- **Cost** (6c): `trackCost` in `src/domain`, the highest summed cost of the sections sounding at
  once (two during a transition, as a crossfade renders both), and an estimate of render time.
- **Reproducibility.** No stored genome and seed renders differently, so the engine version
  doesn't move. A track's audio also depends on the chunk length, the crossfade law and the morph
  and lane rules; they are constants in `src/engine` named in the manifest, and changing one
  bumps the engine version like any other change to rendered audio (0009).

**Shared helpers and their owners** (orchestrator rule 4):

- 6a: the streaming meters and limiter, the streaming and float WAV writers.
- 6b: the track tables and migration, `validateArrangement` and the arrangement's JSON shape,
  the timeline page's modules (`track.html`, `track.js`, `timeline-view.js`), and the track
  routes.
- 6c: `sectionGenome` (a sketch's genome fitted to its section), `renderChunks`, the track render
  job, the manifest, previews and `trackCost`; every later step's audio goes through them.
- 6e adds `morphGenome` and 6f `applyLanes`, each in its own file, both called from
  `sectionGenome`.
- 6g owns the material panel; 6h the proposal prompt and parse.
- 6b needs a migration, numbered by the orchestrator, as is any later step that finds it needs
  one.

### Steps

Order: 6a ‖ 6b, then 6c, then 6d ‖ 6e, then 6f ‖ 6g, then 6h. The owner has a playable,
exported crossfade track after 6c.

#### 6a — Streaming meters, limiter and writers

- **Builds:** in `src/domain`, `createLoudnessMeter`, `createTruePeakMeter` and
  `createLimiter(gain, threshold, sampleRate)`, each taking chunks of any length and keeping its
  filter, block and look-ahead state between them; `integratedLoudness`, `truePeak` and
  `limitTruePeak` become one-chunk calls of them, with the same bits. A streaming `normalize` over
  a source that can be read again from the start (the passes need it), returning the gain, the
  loudness and the peak as today. In `src/server`, a WAV writer that writes the header for a
  stated frame count and appends interleaved chunks, refusing a mismatched total, and the same
  for 32-bit float WAV.
- **Tiers:** domain, server.
- **Tests first:** every existing meter, limiter and normalize test passes unchanged; on the
  golden excerpts and 3341's signals, the streaming forms fed in chunks of 1, 127, 4,096 and
  48,000 frames give bits equal to the whole-array forms; a limiter whose look-ahead spans a chunk
  edge reduces the peak as the whole-array one does; streaming normalize of a 30 s signal equals
  `normalize`; the WAV writer's file equals `writeWav`'s for the same PCM, and a short total throws;
  the float WAV reads back exactly.
- **Records:** writes 0060: the streaming forms, equality as the rule, the float WAV. Amends
  0008, 0011 and 0012.
- **Parallel:** with 6b. Review: yes (it sits under every excerpt's features; the reviewer checks
  that no rated or cached audio changes).

#### 6b — Tracks and a hand-made timeline

- **Builds:**
  - **Tables** (irreplaceable, one migration): `tracks` (vibe, name, removed marks) and
    `track_revisions` (track, arrangement JSON, a note, createdAt), append-only like vibe
    revisions, and `track_exports` (revision, kind, folder, manifest hash, createdAt), a log of
    what was exported.
  - **The arrangement** (`validateArrangement` in `src/domain`, in 0020's descriptor style):
    `length` and `arc` the owner gave (both optional for a hand-made track), `sections` in order,
    each a live sketch of the track's vibe, the `offset` on its sketch's timeline, and `seconds`;
    `transitions` between neighbors, each `crossfade` with `seconds` (default 8, at most half the
    shorter section); `lanes` (empty until 6f); and `proposal`, the generation id it came from or
    null. The track's length follows from the sections less the overlaps. A section may run past
    its sketch's duration only as the owner's choice above (extend) allows, up to 900 s.
  - **The timeline page** (`track.html`): sections as a row of blocks scaled to time, each with
    its sketch's intent and a player for its own window; add a sketch from the vibe's list; move
    a section left or right; set its seconds and offset by fields and by dragging an edge; set a
    transition's length; Save makes a revision. Keyboard: every action has a key and a button, no
    drag needed. Earlier revisions are listed and can be opened and saved as the newest. Plain
    words (0032); Safari 17.6.
- **Tiers:** domain, server, web.
- **Tests first:** a valid arrangement passes and each malformed one (an unknown or removed
  sketch, a sketch of another vibe, a transition longer than half a section, an offset past the
  sketch's end) fails with its path; the length is the sum less the overlaps; saving twice keeps
  both revisions; a removed track keeps its rows; the migration runs over phase 5's last shape;
  the timeline's layout and its key actions are DOM-free modules with tests.
- **Records:** writes 0061: the tables, the arrangement shape, one vibe per track, extending a
  section, and the page. Amends 0021 and 0032.
- **Parallel:** with 6a. Review: yes (an irreplaceable table, a migration, a Safari page).

#### 6c — Rendering and exporting a track

- **Builds:**
  - **Section genomes**: `sectionGenome(arrangement, index, genomes)` gives each section the
    sketch's genome, extended when the section needs it; the first section keeps its fade-in and
    the last its fade-out, and the rest play no master fade inside the track.
  - **Render**: an owner-started job (`track-render`) that renders each section's window plus its
    transitions' overlaps through `renderChunks`, mixes neighbors with an equal-power crossfade,
    writes the raw mix to a temp float file, and normalizes it to the vibe's loudness target under
    the ceiling with 6a's streaming forms. Progress counts chunks ("rendering section 2 of 5,
    chunk 3 of 6"); cancel stops at the next chunk and removes the temp files. The confirm states
    the estimate from `trackCost` and the last run's speed.
  - **Preview**: the normalized mix as MP3 (4i's `lame` path), derived and cached by the
    revision's hash, played on the timeline with the current position marked. A **seam preview**
    renders 30 s around one transition, so an edit can be heard without a full render.
  - **Export**: WAV and FLAC (0012) and a manifest in a folder named for the track and revision
    under the data root's `exports/`: every section's canonical genome, seed, window and
    transitions, the chunk length, the crossfade law, the loudness, the engine version, and
    `pcmSha256`, built like 0015's sidecar. `rerenderTrack(manifest)` renders it again and checks
    the hash.
  - **Bench**: `./scripts/bench --track` renders a 20-minute track of the golden genomes, render
    alone and with export, and a 10-minute one, under `/usr/bin/time -l`, against the 1 GiB
    ceiling. Each case stays under 5 minutes (agent rule 9).
- **Tiers:** engine (the crossfade and chunk constants), domain (`sectionGenome`, `trackCost`),
  server, web.
- **Tests first:** chunk seams match a single render within 0007's tolerance (acceptance 2), and a
  section splits the same way each time; a two-section track's overlap is the equal-power sum
  of the two windows; a track renders, exports, and re-renders from its manifest to the same
  hash; cancel removes the temp files and keeps the revision; the export refuses a folder that
  exists, as 0015 does; the job starts only from its route; the seam preview equals that span of
  the full render before normalizing. Tests render short sections (seconds, not minutes), per
  agent rule 11.
- **Records:** writes 0062: chunks and their length, section genomes, the crossfade law, the
  temp file, previews, the export folder and manifest, the estimate, and the bench's numbers and
  ceiling. Amends 0010, 0015 and 0016.
- **Parallel:** none (6d to 6h build on it). Review: yes (the render path and its memory, with a
  performance pass; a file-writing route, with a security pass).

#### 6d — Stems

- **Builds:** an export option: one stem per voice id across the track, each rendered as the
  track is with `voices` limited to that id in every section (and its morph instances, once 6e
  lands), mixed with the same crossfades, scaled by the mix's normalize gain and never limited,
  written as 32-bit float WAV beside the mix, and listed in the manifest. The confirm gives the
  extra time, about one track render per stem.
- **Tiers:** server.
- **Tests first:** on a short two-section track the stems sum to the mix before the limiter within
  a peak of 1e-5, at least 100 dB under (acceptance 5); a voice id in only one section is silent
  elsewhere; a stem sample over 1.0 is kept, not clipped; the manifest lists each stem's hash.
- **Records:** writes 0063: stems by voice id, the gain, float WAV, the error bound. Amends 0062.
- **Parallel:** with 6e; 6e adds its morph instances to the stem grouping after both merge, named
  in its brief. Review: no (reads 6c's path; the orchestrator reads the diff).

#### 6e — Morph transitions

- **Builds:** `morphGenome(outgoing, incoming, seconds, curve)` in `src/domain`, chosen per
  transition in place of a crossfade. The outgoing section's genome is extended across the
  transition and becomes the morph, on its own timeline, so it plays exactly the outgoing section
  until the morph starts:
  - each numeric parameter both hold (globals, macros, and matched voices' parameters, a voice
    matched by id and type) becomes a trajectory from its value at the morph's start to the
    incoming value, along its scale, which is the vector view's encoded space (0005), with the
    transition's curve;
  - a voice whose type, choices or flags differ, or that only one side has, plays as two
    instances: the outgoing one's level falls to the floor across the transition, and the incoming
    one (renamed with a suffix when its id is taken) rises from it;
  - `reverbDecay` and `delayTime` stay at the outgoing values, and the incoming section takes
    over through a short crossfade (4 s) at the morph's end, which also hands its voices' events
    from the morph's seed to the incoming section's own;
  - a morph that would change `tuning`, `scale`, `key` or `pulse`, exceed `MAX_VOICES`, or pass a
    trajectory's 64 points falls back to a crossfade, and the timeline says why.

  A morph's cost is both sections', like a crossfade's; `trackCost` reads it.
- **Tiers:** domain, web (the transition's kind and curve).
- **Tests first:** acceptance 6's three checks on scripted pairs; a parameter already a
  trajectory keeps its points before the morph; a renamed instance keeps the 16-character id limit;
  each fallback gives its reason; the morph genome validates and lints under the vibe.
- **Records:** writes 0064: morph as the outgoing genome extended, encoded-space interpolation,
  two instances, the end crossfade, fallbacks. Amends 0062.
- **Parallel:** with 6d (see 6d). Review: yes.

#### 6f — Macro automation lanes

- **Builds:** a lane per macro across the track: breakpoints in track seconds with 0007's curves,
  each an offset from −0.5 to 0.5 (0 is no change). `applyLanes` writes each section's macros as
  its own value plus the lane's offset, as a trajectory sampled at the union of both breakpoints
  and every 10 s, clamped to 0–1, within 64 points. Lanes are drawn under the timeline, edited by
  fields and dragging, and saved in the arrangement.
- **Tiers:** domain, web.
- **Tests first:** acceptance 7; a lane across a seam gives both sections the same offset there; a
  lane with no points changes no genome; a dense lane is capped at 64 points and still matches at
  its breakpoints; the lane editor is a DOM-free module.
- **Records:** writes 0065: offsets rather than replacement (the sketch's own macro motion is
  kept), sampling, the point cap. Amends 0006 and 0061.
- **Parallel:** with 6g. Both edit `track.js`'s wiring and the arrangement's validation, each
  adding its own module and key; the second to merge rebases those. Review: yes (Safari).

#### 6g — Material from phase 5 and the reference arc

- **Builds:** the timeline's material panel lists the vibe's sketches, the archive's elites by
  cell (5h's route, with the cell's axis words), and each sketch's position on the brief's
  directions (5g). Placing an elite keeps it as a sketch first, since sections name sketches; a
  section can be steered along a direction with 5g's job and the result swapped in, as a new
  revision. An attached reference region (5c) can be the arc target: its per-window features
  (5b) stretched to the track's length, drawn under the timeline beside each section's measured
  features.
- **Tiers:** server (reads only), web.
- **Tests first:** an elite placed becomes a sketch and a section; positions match 5g's
  projections; the stretched arc has the region's windows at the right track times; with no
  archive, directions or regions the panel lists sketches alone.
- **Records:** writes 0066: what the panel lists, elites as sketches, the arc target. Amends 0057.
- **Parallel:** with 6f (see 6f). Review: yes (Safari).

#### 6h — The proposed structure

- **Builds:** "Propose" on a new track: the owner gives a length (3–20 minutes) and an arc in
  words ("10 min: emerge, plateau, dissolve"), and one model request (operator `arrange`, through
  the queue) gets the brief, the arc, the reference arc's numbers when one is set, and a line per
  sketch (id, intent, notes, tags, duration, features, macros) and per archive elite, at most 24,
  without genomes, so the context stays short. It answers sections, transitions (crossfade or
  morph) and lanes as an arrangement; one repair round on validation errors. The proposal is
  stored as the track's first revision with its generation id, opens in the timeline, and nothing
  renders until the owner starts it. The confirm states the request and its time.
- **Tiers:** domain (the prompt and parse), server, web.
- **Tests first:** against the fake omlx, the prompt holds every listed sketch and the arc and
  stays under a stated token count; a valid answer becomes a revision with its generation; an
  invalid one gets one repair with the errors; a proposal off the length by more than 5% is a
  finding the repair names; editing saves new revisions and leaves the proposal's; nothing is
  rendered by proposing.
- **Records:** writes 0067: the prompt, the answer shape, repair, the length rule, and storing a
  proposal as a revision. Amends 0024.
- **Parallel:** none. Then the orchestrator logs the pending owner checks.

**Pending owner checks** (after 6c and after 6h, on mbp2015 and mbp2026):

- Place three sketches by hand, render, play the preview through, and listen at each crossfade;
  export and open the FLAC elsewhere.
- Try a morph between two sketches that share voices and between two that don't, and say whether
  each sounds like one piece changing.
- Draw a brightness lane over a whole track and listen for it.
- Ask for a 10-minute proposal with an arc, then reorder, resize and retime it, and say how much
  editing it needed.

**Result:**

## Phase 7 — Album builder

**Goal:** tracks ordered into an album with an arc. **Acceptance:** ordering; energy, brightness
and density arcs; key relationships between tracks; a cohesion and variety readout in CLAP and
feature space; gap filling from the MAP-Elites archive and the optimizer; album export with a
manifest of tracks, durations and re-render info, each track re-renderable from it. **Gate:**
`./scripts/check`; one exported album re-rendered from its manifest. **Result:**

## Phase 8 — Fine-tuning

**Goal:** better first drafts from a small model trained on the owner's choices, never touching
omlx. **Acceptance:** mlx-lm LoRA SFT on kept sketches and DPO on pairwise choices (core mlx-lm has
no DPO; the third-party `mlx-lm-lora` package does, and needs the owner's approval); on a separate
small model, started only by the owner; every adapter versioned with its dataset and metrics; blind
A/B evaluation against the baseline, with the win rate and its confidence interval in Result. The
datasets come from phase 2's `generations` table, DPO pairs from candidates of one `requestGroup`.
The A/B uses at least 40 pairs in randomized order, a pairing fixed before listening, and a Wilson
interval; at 40 pairs a 65% win rate is not yet distinguishable from 50%, so the plan states the
pair count needed for the effect it hopes to see. Training checks free memory first and caps MLX's
memory, refusing to start if it would push omlx's loaded model into swap. Train and evaluation sets
split by vibe, and SFT uses the logged prompts verbatim; a generation whose retrieved examples come
from the other side of the split is excluded, or the held-out vibes leak into training through the
prompts. **Gate:** `./scripts/check`; the A/B result. **Result:**

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
- 2026-11-05: review round 2 (fresh context, Sonnet: 66.5k tokens, 8 tool calls, 107 s). Taken: a
  counter-based PRNG with thinning (1b); rated excerpts kept as FLAC so ratings survive engine bumps
  and extractor changes, and `engine-v<N>` tags (0009 amended); excerpts stated as approximate
  windows; the vector view limited to numeric parameters, and voice start/end/level for morphing
  (0005 amended); solo renders for stems; sessions, vibe revisions and typed directional feedback in
  the phase 2 store; omlx busy detection by time to first token, one candidate per request;
  retrieval before CLAP; the sidecar interface, preference-model method, optimizer budgets, CLAP and
  `mlx-lm-lora` approvals, and training memory checks as phase 4–8 lines.
- 2026-11-05: review round 3 (fresh context, Sonnet: 61.6k tokens, 8 tool calls, 43 s). Taken:
  steps 1c and 1e split, so phase 1 is now 1a–1m; `excerptOffset` given a home in 1d; stems
  tested to a tolerance with limiting after the sum; a 20-minute memory probe in 1a;
  `randomGenome` with a cost cap; interior breakpoints kept by `fromVector` and the optimizer
  vector defined as raw values plus macros (0005 and 0006 amended); the CPU recorded in hash
  files (0009); `rated_audio` rows with hashes, `removedAt`, `finish_reason`, a backup command,
  the evaluation script through the queue and its interval; sidecar timeouts and restarts;
  phase 5 and 8 wording.
- 2026-11-06: review round 4 (fresh context, Sonnet: 70.7k tokens, 7 tool calls, 100 s), the last of
  the three extra rounds the owner allowed; it still found real gaps, listed here, rather than
  coming back empty. Taken: raw goldens in 1g and normalized goldens in 1l (0009 amended); a fixture
  voice for 1c and 1d; 1j and 1k after 1g; `renderPlan` and `trimToResult` so the engine owns
  context length and pre-roll; `genomeHash` moved to `src/server`, because `crypto.subtle` is
  missing in the LAN's insecure context, with references by id (0005 amended); a `candidates` table
  for provenance; a `producer` cache key on derived rows, for the owner to confirm against
  AGENTS.md; an explicit loudness `target`; rated audio in backups; the evaluation as a server job;
  20 random seeds in the gate.
- 2026-11-06: the owner added step 1r, a review of reference recordings and tuning research
  before 1b. 1b now covers absolute-frequency tunings, non-octave tunings, tuning files and
  Scala import, with the Colundi sequence shipped as a tuning; 1c, 1j and 1m follow from it.
- 2026-11-06: phase 1 run started; 1a and 1r briefed in parallel. 1r (Sonnet: 130k tokens, 31 tool
  calls, 12.6 min) measured 32 reference tracks: median −14.7 LUFS, true peak about −1 dBTP,
  78–99% of energy under 100 Hz, about 7 note starts a minute, fades at both ends; the Colundi
  tuning confirmed on two of four sets (median 5.6 cents from the nearest value, against 20.5 for
  a shifted baseline). Its requirements are folded into 1b–1m as "From 1r" lines, and the default
  loudness target moves to −16 LUFS, provisionally (0018). Pending owner check: read
  1r's untracked review against your own listening.
- 2026-11-06: 1a merged as 6f51c65 (Opus: 95.6k tokens, 66 tool calls, 44.6 min, most of it
  probe (b) running 36.7 min before it was stopped). Renders are byte-identical across processes;
  every node is present; `suspend` is exact; the feedback delay floor is 128 frames; rendering is
  single-threaded. Probes: (a) 15.8x, 129 MiB; (b) all grains up front over 20 min did not finish,
  windowed 14x at 887 MiB; (d) 480 sines with a 12 s convolver over 720 s, 6.1x at 584 MiB. 1f, 1j
  and 1k changed to match ("From 1a" lines).
- 2026-11-06: 1e merged as 5cfd550 (Opus: 116k tokens, 57 tool calls, 9.1 min). Every
  synthesizable Tech 3341 case passes: integrated and windowed loudness within 0.04 LU, true peak
  within −0.31/+0.03 dB. Cases 6 (5.0 surround), 7 and 8 (programme material) are untested; the
  ffmpeg comparison stands in for 7 and 8. 300 s stereo costs about 93 ms integrated and 271 ms
  true peak. The LSP plugin loaded in its worktree but served no `.js` file.
- 2026-11-06: 1i merged as 892fa90 (Opus: 81k tokens, 30 tool calls, 4.4 min). `encodePcm24` is
  the one float-to-24-bit conversion (round to nearest, clip, NaN throws); a plain PCM WAV header;
  FLAC by streaming the WAV into `flac --best`. 300 s stereo: 0.16 s encode, 1.3 s FLAC.
- 2026-11-06: 1b merged as 24bc97b (Opus: 154k + 165k-context fix round, 80 tool calls, 13.4 min;
  reviewer Sonnet: 72k tokens, 12 tool calls, 2.6 min, PASS). A counter-based PRNG (lowbias32
  absorption; draws independent on every key axis by the reviewer's chi-square and lag-1 checks);
  relative and absolute tunings as JS data modules through one registry; Scala text with an
  optional base frequency; Colundi with `subset38`, `core36`, `core18`; shared diatonic modes;
  `Math.random` and `Date.now` banned in src/engine by arch.js. 0003 and 0004 are provisional.
- 2026-11-06: retrospective after 1r, 1a, 1e, 1i, 1b (orchestrator rule 11).

  | Step | Model | Tokens | Tool calls | Wall time |
  |---|---|---|---|---|
  | 1r | Sonnet | 130k | 31 | 12.6 min |
  | 1a | Opus | 96k | 66 | 44.6 min |
  | 1e | Opus | 116k | 57 | 9.1 min |
  | 1i | Opus | 81k | 30 | 4.4 min |
  | 1b | Opus | 154k, then a 1.2 min fix round | 80 | 13.4 min |
  | 1b review | Sonnet | 72k | 12 | 2.6 min |

  Where it went: 1a's time was a probe with no cap (37 of 45 min); 1r's was decoding and
  analyzing 32 long files. Tokens track how much a step reads before writing (1b read the most:
  five records, the Scala spec, the arch and dupes scripts). One reviewer on the largest diff cost
  less than half a build and found the two places 1b bent its data around a checker; sending the
  fixes back to the same builder took 70 s. The LSP plugin loads in worktrees but serves no `.js`,
  so builders fall back to `rg` and `tsc`. Changes: builders cap hand-run measurements at five
  minutes, and never shape data to dodge a checker (agent-rules Builders 9 and 10); briefs say the
  LSP tool doesn't serve `.js` in worktrees. The gate's tools still skip `tmp/`,
  `.claude/worktrees/`, `node_modules/` and `.venv/` with two worktrees live.
- 2026-11-06: 1h merged (Opus: 126k tokens, 60 tool calls, 12.9 min). `normalize(channels,
  sampleRate, {target, ceiling})` with `target` required; a linked look-ahead limiter (5 ms
  attack, 250 ms release in dB) that holds the meter's reading 0.4 dB under the ceiling for its
  0.31 dB under-read; passes aim for ±0.1 LU, accept ±0.5 only when passes or the +40 dB cap run
  out. 300 s stereo at −16 LUFS: 1.6 s; 900 s at −9 LUFS: 8.4 s. 0011 is provisional. Pending
  owner check: a heavily limited −9 LUFS drone, listening for pumping or bass distortion.
- 2026-11-06: 1c merged as 7b36494 (Opus: 183k tokens, 101 tool calls, 14.5 min, then a 3.9 min
  fix round; reviewer Sonnet: 75k tokens, 16 tool calls, 3.0 min, PASS). Descriptors (`number`,
  `int`, `choice`, `flag`), `validateGenome` listing every error with its path, `canonicalGenome`,
  `schemaText()` at 1,519 characters before voices, a voice registry, at most 16 voices and 64
  trajectory points. The fix round removed the fixture voice's import side effect, fixed
  `dupes.js` reading a wrapped import's closing line as a literal, and defined the default tuning
  once. 0005's 1c amendment is provisional.
- 2026-11-06: 1d merged as f1b0a13 (Opus: 214k tokens, 72 tool calls, 17.6 min, then a 1.5 min
  fix round; reviewer Sonnet: 77k tokens, 11 tool calls, 2.6 min, PASS). Trajectories with a
  curve per segment in timeline seconds, `effectiveParams` exact at neutral macros, the vector
  view with exact round trips, `excerptOffset` inside the fades, `randomGenome`. The fix round
  capped delay feedback at 0.75 so the worst-case pre-roll falls from about 151 s to 68 s, and
  defined the genome key names once. 0007 and the 1d amendments to 0003, 0005 and 0006 are
  provisional.
- 2026-11-06: 1f merged as 6f43135 (Opus: 247k tokens, 82 tool calls, 23.8 min, then a 17.7 min
  fix round at 307k; reviewer Sonnet: 86k tokens, 17 tool calls, 5.7 min, PASS). `render`,
  `renderPlan`, `trimToResult`, the master bus (seeded dark IR, feedback delay, side/mid width,
  fades ending in exact zeros) and the drone. Events go in 2 s `suspend` windows 1 s ahead;
  parameters follow a 0.1 s control grid. The drone renders at 28.9x real time over 900 s with an
  8 s reverb, peak RSS 719–791 MiB. Stems sum to the mix within 2.1e-7; excerpts match a full
  render within 8.3e-7 (tolerance 1e-5, 100 dB under). The review asked for a test of the window
  event path; writing it found three bugs, now fixed: oscillators started between frames had the
  wrong phase, a render ending on a window boundary dropped its last control sample, and the
  short-reverb start error came from the first. Pending owner checks: the drone golden and a
  300 s drone for zipper noise on the sweep, clicks and thumps; the three detuned copies in mono;
  the reverb at 8 s and 20 s for ringing or flutter; the 0.1 s fade with `fadeOut` 0; a Colundi
  drone for roughness.
- 2026-11-06: 1g merged as 2ed1509 (Opus: 191k tokens, 83 tool calls, 14.8 min). Golden hash
  files per genome per engine version with peak, RMS and 8-band summaries, a writer that refuses
  to overwrite, and every genome in `src/engine/genomes/` a golden. `cost(genome)` in node-seconds
  per second with a budget of 560, calibrated against 1a's probes and 1f's drone (11.5x at the
  slowest measured rate); `randomGenome` capped by it. A 30-grain-a-second cloud at three nodes a
  grain costs about 560 on its own, so 1k mixes grains into buffers. The first full gate after
  the merge failed intermittently: `suspend` registers on the library's runtime thread and can
  lose the race with `startRendering`, which rejects the render (never changes its samples). Fixed
  in 7cc147e (Sonnet: 65k tokens, 22 tool calls, 6.2 min) by a bounded retry on exactly that error,
  logged and at most three attempts, after reordering alone still failed 4 of 8 runs; 0 of 8
  failed after. Tagged `engine-v1`.
- 2026-11-06: retrospective after 1c, 1h, 1d, 1f, 1g (orchestrator rule 11).

  | Step | Build | Fix round | Review |
  |---|---|---|---|
  | 1c | 183k, 101 calls, 14.5 min | 3.9 min | 75k, 3.0 min, PASS |
  | 1h | 126k, 60 calls, 12.9 min | — | read by the orchestrator |
  | 1d | 214k, 72 calls, 17.6 min | 1.5 min | 77k, 2.6 min, PASS |
  | 1f | 247k, 82 calls, 23.8 min | 17.7 min (307k) | 86k, 5.7 min, PASS |
  | 1g | 191k, 83 calls, 14.8 min | race fix 65k, 6.2 min | read by the orchestrator |

  Where it went: build tokens grow with the code each step reads first (126k for a standalone
  domain step, 247k for the render core). Reviews cost 75–86k and 3–6 min and each found
  something worth fixing before merge; 1f's led to three render bugs. Fix rounds resume the
  builder, which is fast but carries its whole context (1f's cost 307k); that is still cheaper
  than a fresh agent re-reading the render core. The suite-level race cost one gate run and a
  6-minute fix; it slipped because builders test at two workers. Changes: render-path merges run
  the suite twice, and tags wait for the gate (orchestrator rule 6); voice briefs carry the
  render and cost API so builders read less. The gate's tools still skip `tmp/`,
  `.claude/worktrees/`, `node_modules/` and `.venv/`.
- 2026-11-06: 1j merged as d50c845 (Opus: 309k tokens, 132 tool calls, 33.3 min, then a 2.7 min
  fix round; reviewer Sonnet: 100k tokens, 20 tool calls, 7.0 min, PASS). The pad (chords on a
  hold grid, ADSR, swell; chords sounding at an excerpt's start begin mid-chord, so it adds no
  pre-roll) and the bell (additive, FM and Karplus-Strong notes computed in JS into one buffer each;
  at most 8 at once, cut deterministically by the seed). Densest pad and additive bell over 900 s
  with an 8 s reverb: 18.6x, 923 MiB; excerpts within 9e-8. JS note time isn't in the cost unit:
  the densest FM bell on a genome at the budget would fall to about 9.4x, for the bench to check.
  `--low` test runs now allow 30 s per test, since background priority stretched render tests past
  5 s. Pending owner checks: pad chord changes for clicks and swell depth; Colundi bells may sound
  thin above 685 Hz; bright and high-index FM bells for whistling or aliasing; the 8-note cap for
  chopping at 40 notes a minute; the pluck strike at `fall` 3; whether the pad needs more upper
  partials.
- 2026-11-06: 1k merged as 2ce63ab (Opus: 303k tokens, 154 tool calls, 37.3 min; rebase onto 1j
  3.7 min; fix round 3.3 min; reviewer Sonnet: 85k tokens, 22 tool calls, 3.9 min, PASS). The
  granular cloud mixes grains in JS into one buffer per 2 s window (cost 49 at 30 grains a second,
  against 585 for a source, gain and panner per grain); noise beds in white, pink and brown
  (slopes within 0.05 dB/octave of nominal) shaped into wind, rain and surf, at least 30 dB under
  the drone. Excerpts within 3.4e-8. A default drone, pad, bell and noise genome renders at 22.7x
  with an 8 s reverb. The review found an automated filter costs about 20 node-units, so the
  drone's cost now counts its swept filter (golden 73 → 93). 1j and 1k each built a `MACRO`
  export, `highestValue` and the excerpt helpers in parallel; 1k took 1j's on rebase. Pending
  owner checks: grain edges and window joins every 2 s; grain pitch on the scale; wind, rain and
  surf read as named, rain drops not clicks; whether 30 dB under the drone is too quiet; zipper
  noise on swept filters; the cloud in mono.
- 2026-11-06: 1l merged as a14b7ff (Opus: 150k tokens, 66 tool calls, 11.9 min; rebase and
  follow-ups 15.7 min; fix round 3.5 min; reviewer Sonnet: 63k tokens, 3.5 min, FAIL; second
  reviewer Sonnet: 48k tokens, 2.4 min, PASS). The offline render sequence moved to src/server;
  `exportRender` validates, renders, refuses non-finite samples, normalizes to an explicit target,
  hashes the 24-bit PCM once, writes WAV, FLAC and the sidecar JSON (0015), and never overwrites;
  `rerender` refuses another engine version up front and fails on a hash mismatch. Normalized
  goldens cover all six genomes' start windows. The first review failed the step: cleanup after
  a failed write could delete a file another process created at the output name mid-render, and
  a dangling symlink let FLAC write outside the output folder. The fix stages into an `mkdtemp`
  folder and hard-links each file into place. 300 s export of the drone: 7.6 s, 701 MiB, −16.05
  LUFS, −1.40 dBTP. The first gate after the merge failed one 1a spike test under load (passed in
  11 reruns); being fixed as the same suspend race in a test that called `suspend` directly.
- 2026-11-06: 1m merged as fe48056 (Opus: 189k tokens, 100 tool calls, 27.2 min; rebase 3.0 min;
  read by the orchestrator). `./scripts/render` over a strict `parseArgs` CLI, `./scripts/bench`
  with a 720 s case, `./scripts/loudness-oracle.js`, and the `example.json` and `colundi.json`
  genomes as goldens (cost 311 and 320 of 560). By hand: acceptance 1, 2, 3, 4 and 6 pass; 5
  failed. The renderer isn't deterministic past about a minute: the library drops a node when V8
  collects its handle and reuses its id, and nodes are summed in id order, so GC timing moved
  samples by up to 1.8e-7 (first at 60 s, from the bell). Holding every node fixed it but would
  need about 3.4 GB at the densest bell setting over 900 s. A determinism fix is in progress.
  Colundi bell partials come from the genome's scale (`core18`), not all 128 values, since the
  schema has one scale per genome.
- 2026-11-06: render determinism fixed in ec9a5c6, merged as 9b3d135 (Opus: 183k tokens, 86 tool
  calls, 24.4 min; reviewer Sonnet: 86k tokens, 28 tool calls, 5.7 min, PASS). Setup nodes are held
  for the render, bell notes go through 8 fixed slot gains, and pad notes share long-lived envelope
  gains, so no node ever sums three inputs whose order the library's id reuse can change (rule in
  0010). A GC-stress harness found 0 differing samples across the example, Colundi, 10 random and
  densest-setting genomes, against 2.4–2.8 million before. Bell, pad, example and Colundi hashes
  moved: ENGINE_VERSION 2, v2 goldens written, v1 kept, tagged `engine-v2`.
- 2026-11-06: three faults only the full gate's load showed, each fixed: `writeFlac` turned a
  successful flac exit into "Premature close" when flac closed its input first (3295aeb, also hit
  real exports); render tests near Vitest's 5 s default (one 30 s suite timeout, fcf0bd0); and the
  suspend race beating three back-to-back retries (1cfb0c0: six attempts with a growing wait of
  10 ms to 2 s before rendering starts; a stress harness of 384 renders failed none, against 2 of
  256 before). Four gates in a row passed after.
- 2026-11-06: phase 1 retrospective (orchestrator rule 11).

  | Work | Build | After the build | Review |
  |---|---|---|---|
  | 1j | 309k, 132 calls, 33.3 min | fix 2.7 min | 100k, 7.0 min, PASS |
  | 1k | 303k, 154 calls, 37.3 min | rebase 3.7, fix 3.3 min | 85k, 3.9 min, PASS |
  | 1l | 150k, 66 calls, 11.9 min | rebase 15.7, fix 3.5 min | 63k FAIL, then 48k PASS |
  | 1m | 189k, 100 calls, 27.2 min | rebase 3.0 min | read by the orchestrator |
  | determinism | 183k, 86 calls, 24.4 min | — | 86k, 5.7 min, PASS |
  | gate faults | 45k + 51k + 80k, 24.4 min | — | — |

  Where it went: the two voice steps run side by side were the most expensive of the phase, and
  each built its own `MACRO` export, `highestValue` and excerpt helpers, because their briefs
  didn't say which one owned shared helpers (orchestrator rule 4, not applied). The largest bug of
  the phase, GC-dependent summing order, passed every review and every 2–4 s golden and was found
  only by acceptance check 5 at 300 s; a gated test now forces collection mid-render. Load-only
  faults cost four extra rounds; each showed first in a gate run while a builder was also working.
  Reviews paid for themselves: 1l's found a cleanup that could delete another process's file, and
  1f's led to three render bugs. Changes for phase 2: parallel briefs name an owner for every
  helper both steps could need; a step that adds a render path runs a long-render determinism
  check, not only short goldens; the orchestrator runs merge gates when no builder is running, or
  runs them twice. The gate's tools still skip `tmp/`, `.claude/worktrees/`, `node_modules/` and
  `.venv/`.
- 2026-11-06: found while preparing the owner's listening files: the drone golden can't be
  exported at −9 LUFS, the top of the loudness range (normalize stops at −9.82 after 8 passes;
  −10 reaches −10.13). The schema accepts −9, so a valid genome can fail to export. Left for the
  owner: narrow the range's top, or let the limiter work harder on bass-heavy material (0011,
  0018). Pending owner checks, in order, are in `~/Desktop/ambient-studio-phase-1/LISTEN.txt` on
  mbp2015: the 1r review, then the drone and master bus, the limited drone, pad, bell, cloud,
  noise bed, the 300 s WAV against its FLAC, a loudness comparison at −16 LUFS, and the Colundi
  export.
- 2026-11-06: phase 2 expanded into steps 2a–2l. The owner settled the `producer` cache key
  (allowed), the loudness range's top (−10 LUFS), three seed vibes for the evaluation, and the
  sample layer in phase 2 reading WAV, FLAC and AIFF. Review (fresh context, Sonnet: 78.9k
  tokens, 9 tool calls, 126 s). Taken: a seed and the model's intent on each candidate, with the
  intent answered beside the genome rather than in the schema; `notes`, `session_events` and
  `evaluations` tables, ratings and feedback pointing at their `rated_audio` row; raw and heard
  features; the render cache keyed on target; the queue on an injected clock; no repair round
  for truncated responses; the excerpt-length lint floor and silent renders as failed checks;
  the FFT promoted from the golden helper; `samples` carried through export and `--from`; 2g and
  2h split into four steps; owners for `arch.js`, `producer` and the `samples` plumbing.
- 2026-11-06: 2a merged as b40833d (Opus: 112k tokens, 57 tool calls, 10.9 min). `loadConfig()`
  with every key required and unknown keys refused, `paths(dataRoot)`, `src/config/example.json`,
  `test/support/temp-root.js`, and an `arch.js` rule against `process.env` outside src/config.
  Under Vitest the config refuses the owner's two real folders, checked against both `$HOME` and
  the account's home, without case. The guard tests were seen failing only on the missing
  module: switching the guard off would have read the owner's real config. Pending owner checks:
  the model id in `example.json` is a placeholder; host `0.0.0.0` and port 4180.
- 2026-11-06: 2b merged as f6b50ea (Opus: 209k tokens, 82 tool calls, 20.6 min). The genome's
  loudness tops out at −10 LUFS (0018 and 0011 amended; no render changed). 14 constraint kinds
  with a validator, `constraintsText()` (539 of 800 characters for a full set) and
  `lintGenome`, each kind with a passing and a failing fixture in one table (acceptance 2);
  `EXCERPT_SECONDS` 25; floors at −50 dB per voice over the span it plays, a lone static drone,
  and the excerpt length. 2a and 2b were merged before review, against orchestrator rule 10; a
  review of both runs after the fact. Pending owner checks: the −50 dB near-silence floor, the
  25 s excerpt, and whether a lone drone with only a sweep should pass.
- 2026-11-06: review of 2a and 2b after merge (Sonnet: 80k tokens, 13 tool calls, 3.4 min,
  FAIL). Blocking: the excerpt floor subtracted the fades in another order than `excerptOffset`,
  so `duration 122.8, fadeIn 8.1, fadeOut 89.7` passed lint and then threw (95 of 2 million
  random draws). Fixed in e118675 by `excerptRoom` in the engine, which both call, with a
  4,000-case sweep; also 3c4c834 (`Object.hasOwn` for config keys) and fae110d (`arch.js` catches
  destructured and optional `process.env`) (Sonnet: 57k tokens, 17 tool calls, 2.0 min; gate
  passed, 583 tests). Read by the orchestrator. Not fixed: the arch rule still misses a namespace
  import of `node:process` and a multi-line `env` import, and the config guard doesn't follow
  symlinks; no code does either today.
- 2026-11-06: 2c merged as cae5925 (Opus: 208k tokens, 92 tool calls, 21.8 min, then a fix
  round at 242k, 41 calls, 12.0 min; reviewer Sonnet: 67k tokens, 3.0 min, FAIL; second
  reviewer Sonnet: 40k tokens, 3.1 min, PASS). `node:sqlite` in WAL with SQL migrations, one store
  file per table group, and append-only triggers generated from each table's live columns after
  every migration; `recursive_triggers` on so `INSERT OR REPLACE` can't delete a kept row. The
  first review failed the step: an applied migration edited later went unnoticed, so old and new
  databases could diverge; migrations now carry a SHA-256 checked at open. Also a 5 s busy timeout,
  the applied list read inside `BEGIN IMMEDIATE`, and ratings and feedback checked against the
  `rated_audio` row they name. The two-process open test found that switching a new file to WAL
  fails at once while another connection does the same; `useWal` waits on the write lock and
  tries up to three times (40 runs alone and 18 under load, no failures). `./scripts/backup`
  writes a UTC-dated folder and keeps it when the rated-audio check fails. 631 tests. 0021 is
  provisional.
- 2026-11-06: 2d merged (Opus: 137k tokens, 62 tool calls, 15.2 min, then a fix round at 215k,
  86 calls, 25.3 min; reviewer Sonnet: 62k tokens, 8 tool calls, 1.3 min, PASS with findings
  taken before merge; fixes read by the orchestrator). `createOmlxQueue` with a required
  `onRetry`, an injected clock and jitter, one connection per attempt through `node:http` with no
  keep-alive, and the end of a request stamped only after its socket closes: the first version's
  pooled `fetch` socket let the 20-request test see 2 in flight. `maxTokens` 10,752 (the longest
  `{intent, genome}` answer over 100,000 `randomGenome` seeds is about 6,430 tokens, plus 4,096
  for thinking); a new key `minPrefillTokensPerSecond` (100) adds the prompt's prefill to the
  first-token threshold (30 s) and the timeout (600 s), so an 8,192-token prompt isn't read as
  busy. `arch.js` refuses `fetch`, `node:http(s)` clients and dynamic imports outside the queue,
  and `node:http2`, `node:net` and `undici` in src/. 660 tests. Pending owner checks: the real
  model id; whether 4,096 tokens of thinking room, 20 tokens a second of output and 100 tokens a
  second of prefill fit the omlx model (2l's percentiles calibrate them).
- 2026-11-06: 2e merged as 7750632 (Opus: 172k tokens, 105 tool calls, 21.3 min; reviewer
  Sonnet: 56k tokens, 8 tool calls, 2.7 min, PASS). The FFT moved to `src/domain/fft.js`, then
  computes each twiddle once per stage (bit-identical, checked by hand at N = 2 to 4096; no gate
  test pins it). `extractFeatures(raw, heard)` returns raw loudness, short-term maximum, loudness
  range (Tech 3342) and true peak, and heard gain, centroid mean and spread and onset rate, every
  value finite or null; `renderChecks` for clipping, near-silence (−50 LUFS), DC (0.01) and cost.
  `FEATURE_EXTRACTOR` lists 55 files, the whole import closure engine included, checked against
  a derived closure. The first real run read a drone at 15 onsets a second; 2048-sample frames on
  log-compressed magnitudes fixed it. Features and checks on 30 s: 0.46 s (65x real time).
  Pending owner checks: onset rates against your ears (the bell golden reads 4 for its 3 notes),
  granular grains reading as 0 onsets a second, the −50 LUFS and 0.01 DC thresholds.
- 2026-11-06: 2f merged (Opus: 210k tokens, 86 tool calls, 17.0 min, then a fix round at 283k,
  52 calls, 12.8 min; reviewer Sonnet: 61k tokens, 8 tool calls, 1.6 min, PASS with findings
  taken before merge; fixes read by the orchestrator). `buildPrompt` with the constraints, the
  macro and parameter reference and up to four retrieved examples (3,771 characters, about 1,078
  tokens, with none; 8,258 with four), `extractGenome` for one `{intent, genome}` answer, and one
  repair request that sends back the validator's and linter's findings; a truncated answer is not
  repaired. `generateCandidates` runs N seeds through the queue, and every generation ends in a
  candidate row, failed requests and a cancel before the repair included. Migration 0002 adds
  `reasoning`, `requestParams`, `retries` and `error` to generations and `rejectedGenome` to
  candidates, tested over a database built with 0001 alone; the queue now returns what it sent and
  rejects with `OmlxRequestError`. A failure in the queue stops the batch after its rows are
  stored, so a busy omlx isn't sent the rest (0024). 736 tests.
- 2026-11-06: retrospective after 2a–2f (orchestrator rule 11).

  | Step | Build | Fix rounds | Review |
  |---|---|---|---|
  | 2a | 112k, 57 calls, 10.9 min | shared with 2b | 80k, 3.4 min, FAIL (after merge) |
  | 2b | 209k, 82 calls, 20.6 min | e118675, fae110d | same review |
  | 2c | 208k, 92 calls, 21.8 min | 242k, 12.0 min | 67k FAIL, then 40k PASS |
  | 2d | 137k, 62 calls, 15.2 min | 215k, 25.3 min | 62k, 1.3 min, PASS with findings |
  | 2e | 172k, 105 calls, 21.3 min | — | 56k, 2.7 min, PASS |
  | 2f | 210k, 86 calls, 17.0 min | 283k, 12.8 min | 61k, 1.6 min, PASS with findings |

  Where it went: fix rounds cost as much as builds in three of six steps, and every one followed a
  review that found a real fault (a migration editable after it ran, two requests in flight
  through a pooled socket, an excerpt floor that disagreed with the renderer, failed requests that
  left no row). Reviews stayed cheap, 1.3 to 3.4 minutes each. Skipping review on 2a and 2b saved
  nothing: the review ran anyway, after merge, and its fixes landed on main. Two smaller costs:
  worktrees started from an old commit until briefs named the base sha, and a reviewer's worktree
  had no `node_modules`. Changes: briefs name the base sha and say to run
  `pnpm install --frozen-lockfile --offline` first (both already in use since 2c); every step is
  reviewed before merge, with no exception for small ones; `scripts/dupes-allow.txt` conflicted at
  every merge and is resolved by keeping both sides' entries. The gate's tools still skip `tmp/`,
  `.claude/worktrees/`, `node_modules/` and `.venv/`: arch and dupes walk `src/` and
  `sidecar/src/`, biome reads `.gitignore` (which lists all four), tsc, knip and Vitest name
  their folders, and ruff skips `.venv`.
- 2026-11-06: 2g merged as 81255de (Opus: 148k tokens, 65 tool calls, 13.4 min, then a fix round
  at 202k, 69 calls, 16.5 min; reviewer Sonnet: 69k tokens, 20 tool calls, 4.2 min, FAIL; fixes
  read by the orchestrator). `startServer(config)` with a route table later steps add to, static
  serving of `src/web`, `src/engine` and `src/domain` with only listed extensions, and
  `GET /audio/:renderId` with single ranges per RFC 9110 (several ranges or `If-Range` get the
  whole file). Paths are parsed raw, since `new URL()` folds `/%2e%2e/x` into `/x`; JSON bodies
  only, 1 MiB at most. The review failed the step on a 500 that any LAN client could trigger with
  a 300-character file name, and whose body held the server's absolute path; such names are now a
  404, and a 500 sends only "internal error". The fix round also added a Host allowlist against DNS
  rebinding (loopback, this machine's name and current interface addresses, else 421), and the
  full suite found the 413 reply racing a client still sending (29 of 600 reset); the server now
  drops the rest of the body. 827 tests. Pending owner check: the index page reads "Engine version
  2 loaded." in Safari 17.6 on mbp2015 and on mbp2026, by LAN IP (`mbp2021.local` gets a 421, since
  this machine's host name is `MacBookPro`).
- 2026-11-06: 2h merged as 298d65e (Opus: 192k tokens, 104 tool calls, 18.9 min, then a fix round
  at 240k, 81 calls, 10.3 min; reviewer Sonnet: 64k tokens, 13 tool calls, 5.1 min, PASS with
  findings taken before merge; fixes read by the orchestrator). A job runner that runs one job at a
  time in order, with polled status (`list` without results, `get` with them) and cancellation
  through an `AbortSignal`; nothing starts on its own. `renderExcerpt` renders at the candidate's
  seed and `excerptOffset`, 25 s, normalized to the vibe's loudness constraint or −16 LUFS so both
  A/B sides play at one level, with 2e's checks and both feature sets, cached as WAV under a name
  that carries the target and the producer's hash. `PRODUCER` is `engine-<version>
  features-<sha256 of FEATURE_EXTRACTOR's files>`. Any normalize throw is a failed check on that
  candidate and the job goes on. Migration 0003 recreates `renders` with AUTOINCREMENT: without
  it SQLite reused a replaced render's id, so a stale `/audio/:renderId` URL could serve other
  audio. `captureRatedAudio` writes the FLAC once per heard identity. 25 s excerpt with checks and
  features: 1.0–2.6 s; a cache hit 0.2 ms; a capture 150 ms. 852 tests. 0026 is provisional.
- 2026-11-06: 2i merged as 114927d (Opus: 285k tokens, 156 tool calls, 27.7 min, then a fix round
  at 313k, 45 calls, 9.3 min; reviewer Sonnet: 105k tokens, 39 tool calls, 6.6 min, PASS with
  findings taken before merge; fixes read by the orchestrator). JSON routes over 2c–2h for vibes,
  revisions and notes, sessions, candidate and excerpt jobs, job status and cancel, and ratings:
  thumbs, macro more/less with the macro's value over the heard window, A/B and sketches. Ratings
  name the render heard, are checked whole before `captureRatedAudio` runs, so a refused rating
  keeps nothing, and are filed under the vibe's current revision. The server draws each A/B pair's
  `orderSeed` and recomputes `leftSide = abOrder(orderSeed)` when the rating arrives; over seeds
  0–199 side a is on the left 53.5% of the time. Stopping a session cancels its jobs and, through
  `queue.cancel()`, its queued omlx requests, which holds because one job runs at a time. Every
  POST reads a JSON body, so a cross-site form gets a 415; text fields are capped (name 200,
  brief 4,000, notes 2,000, 32 tags of 64). A test ties the rating enums to 0001's CHECK lists.
  Acceptance 4 passes: every rating kind read back whole after a restart on the same root. 877
  tests.
- 2026-11-06: 2k merged as c035a18 (Opus: 360k tokens, 228 tool calls, 41.6 min, then a fix round
  at 421k, 72 calls, 20.4 min; reviewer Sonnet: 101k tokens, 43 tool calls, 9.2 min, PASS with
  findings taken before merge; fixes read by the orchestrator). A `recording` voice that plays
  one decoded file, named by its SHA-256, looped or scattered by the seed in equal-power
  crossfaded passes, with rate, a fixed high-pass, a low-pass cutoff and pan; computed in JS one
  2 s window at a time like the noise bed, so an excerpt matches a full render exactly. The engine
  does no I/O: the server indexes the folder (header reads, streamed hashes, reused when size and
  time are unchanged), rehashes and decodes only what a genome uses, and passes `samples` through
  render, export, rerender, the CLI's `--recordings` and the excerpt jobs. `decodeAudioData` read
  WAV, 24-bit FLAC and big-endian AIFF; 44.1 kHz decodes to 48 kHz deterministically. Decoded
  length and channels are checked as well as the header's, since a header can understate them.
  `schemaText()` and `randomGenome` leave the voice out, so both are byte-identical (old seeds
  pinned by hash); the prompt lists up to 32 recordings only when the folder has some. Every
  existing golden matches, ENGINE_VERSION stays 2, and the voice's golden joins them. The
  reviewer's mutation checks caught four of five breaks; a one-frame shift of window starts is
  caught only by the noise bed's test. The header reader trusted a chunk whose size ran past the
  file, found by the new header tests. A 25 s excerpt with two recording voices: about 0.67 s.
  919 tests. Pending owner checks: point `fieldRecordings` at the real folder and listen for
  clicks at pass seams in loop and scatter modes, for aliasing at rates above 1, and look at the
  folder rules in 0029 (20 minutes, 2 channels, 32 listed, one unreadable header stops the index).
- 2026-11-06: retrospective after 2g, 2h, 2i, 2k (orchestrator rule 11).

  | Step | Build | Fix round | Review |
  |---|---|---|---|
  | 2g | 148k, 65 calls, 13.4 min | 202k, 16.5 min | 69k, 4.2 min, FAIL |
  | 2h | 192k, 104 calls, 18.9 min | 240k, 10.3 min | 64k, 5.1 min, PASS with findings |
  | 2i | 285k, 156 calls, 27.7 min | 313k, 9.3 min | 105k, 6.6 min, PASS with findings |
  | 2k | 360k, 228 calls, 41.6 min | 421k, 20.4 min | 101k, 9.2 min, PASS with findings |

  Where it went: every step had a fix round, and the round's tokens exceed the build's, because a
  resumed builder carries its whole build context; the round's wall time is a third to a half of
  the build's. Each round fixed something a user would hit: a 500 that leaked paths, render ids
  reused under stale URLs, a whole batch failed by one candidate, uncapped text fields, a
  recording header trusted past the file's end. Reviews ran 4–9 minutes and slowed when two
  shared the machine with a builder's full suite; two reviewers stopped their own long test runs
  and relied on targeted files. 2k was the most expensive step of the phase so far: engine
  plumbing through five render paths plus a performance target re-measured twice. Changes:
  reviewers run the test files the diff touches first and the `--changed` suite only when the
  machine is quiet; when a review finds only small items, the orchestrator sends them as one round
  rather than waiting for a second review; briefs for steps that call each other's functions name
  who adapts the caller at merge (2k adapted 2i's job, which worked). The gate's tools still skip
  `tmp/`, `.claude/worktrees/`, `node_modules/` and `.venv/`; nothing in the checkers changed.
- 2026-11-06: 2j merged as 12e8274 (Opus: 337k tokens, 146 tool calls, 32.1 min, then a fix round
  at 388k, 50 calls, 7.6 min; reviewer Sonnet: 108k tokens, 21 tool calls, 5.8 min, FAIL; fixes
  read by the orchestrator). Three pages in plain HTML, CSS and ES modules: the vibe list, the vibe
  page (brief, a constraints form built from `CONSTRAINT_KINDS` and validated as it's typed, notes,
  revisions, every rating of the vibe) and the session view (a candidate grid with an `<audio>`
  per excerpt, features, lint and check findings, intent, rating controls, and an A/B view). Every
  action has a key, listed on its page; job status is polled every second. Played fraction is the
  union of played intervals from the audio element's events; time taken runs from when a
  candidate is shown or last rated, or a pair opened, to the rating. The review failed the step: a
  poll that landed an excerpt on the selected card moved the focus out of the note being typed,
  so the rest of the note fired rating keys on audio not yet heard. Selection now never takes the
  focus from a form field; each rating action posts once while a press is pending, and held keys
  repeat nothing. No API newer than Safari 15.4 is used (checked across all 60 modules); the
  pages were driven by key presses in headless Chromium against a temp root. 967 tests. Pending
  owner checks, on Safari 17.6 (mbp2015) and mbp2026: playback and seeking, rating everything by
  keyboard, visible focus and readable type, ratings listed after a restart, A/B sides equally
  loud, and `Q` confirming before a stop.
- 2026-11-06: owner check of 2j on a throwaway studio served on the home network (temp data
  root, omlx address unreachable, three seeded candidates): the owner tried the pages and called
  them a good start. No faults reported; the per-item listening and keyboard checks above stay
  open for the first real session.
- 2026-11-06: the studio's omlx key, merged (Sonnet: 72k tokens, 18 tool calls, 8.9 min; read by
  the orchestrator). omlx requires an API key on every request (its settings refuse
  unauthenticated inference), which no phase 2 step knew; the owner chose a key of the studio's
  own, revocable apart from the live site's. `omlx.apiKey` is required in the config, which is
  refused when group or others can read it; the queue sends it as a bearer token and nowhere else
  (not in `params`, errors, retry events or logs); a 401 or 403 fails at once with an
  owner-facing message. AGENTS.md's secrets line now names this one secret. The orchestrator wrote
  the owner's config at their request (model `Qwen3.6-35B-A3B-oQ4e-mtp`, the model behind omlx's
  recent requests in its own log; recordings in `~/Music/Field Recordings`; mode 600) with the key
  left as a placeholder for the owner to paste. omlx's own stats put that model at about 1,700
  prompt tokens a second and 88 output tokens a second, well above the queue's assumed 100 and 20.
- 2026-11-06: 2l merged as 3fd8b31 (Opus: 316k tokens, 170 tool calls, 29.2 min, then a rebase
  onto the omlx key and a fix round at 335k, 21 calls, 6.4 min; reviewer Sonnet: 115k tokens, 34
  tool calls, 7.2 min, PASS, reviewing 2l merged onto main). Three seed vibes (cold-dorian,
  bell-field, tidal-noise) load from the vibe list once each while their vibe is kept; between
  them they set every constraint kind but `bpm`, and a test meets each one with a genome built
  from the goldens. The evaluation is a job of kind `evaluation`, started only from
  `POST /api/evaluations` (one at a time), run through 2f's `generateCandidates` and the shared
  queue with one stream seed and no session. Its stored report counts valid before and after
  repair, schema-only validity, truncations and failed requests apart, reject reasons, 95% Wilson
  intervals, latency and first-token percentiles by nearest rank, and whether omlx took
  `response_format`; a run stopped by an error or a cancel keeps its partial report. The review
  found that a cancel while the recordings folder was indexed never reached the queue, in the
  evaluation and in 2i's candidate job; both now check the signal before the first request. A
  test pins that a 401 stops the run after one request with the key in neither the report nor the
  job. Record 0030. 1023 tests. Known: a focused vibe checkbox holds the evaluation page's keys
  until Esc (0028).
- 2026-11-06: phase 2 retrospective (2a–2l plus the omlx key). Builder steps ran 29–42 min and
  310–390k tokens on Opus; the steps that crossed tiers (2j, 2k, 2l) cost the most, mostly in
  reading neighbors and full-suite runs, since any change under test/support runs everything.
  Reviews ran 6–15 min on Sonnet; two of six failed a step (2g leaking a path in a 500, 2j moving
  focus out of a typed note), both on paths a user reaches with no test driving them, which is
  what the reviewer rules already ask for. Reviewing a branch merged onto current main, rather
  than its own base, caught nothing new this time but made the omlx-key rebase a non-event; keep
  it whenever main moved during a build. The omlx key was the phase's one surprise: no step knew
  omlx refuses unauthenticated requests, because the plan described omlx from the brief, not from
  its settings. Change: a step that crosses a boundary to another system (omlx, the sidecar)
  starts by reading that system's settings with secrets hidden, written into the brief. A full
  gate failed once on a render test past its 10 s limit while a builder loaded the machine; it
  passed alone and on every run since, and stays watched rather than hunted until it recurs. The
  gate's tools still skip `tmp/`, `.claude/worktrees/`, `node_modules/` and `.venv/` (biome via
  `.gitignore`, links via `git ls-files`, tsc, knip, arch and dupes by their `src`/`test`/`scripts`
  roots); nothing in the checkers changed.
- 2026-11-06: the owner's first evaluation (Cold dorian drone, 16 candidates): 2 valid on the
  first try and 14 after one repair. Every first-try failure was a schema error: the model copied
  the prompt's `~` mark for macro parameters into key names (`cutoff~` 22 times, `sweep~` 22,
  `swing~` 19, `tone~` 14, `level~` 13). No lint errors, no truncations. A request takes 54 s at
  the median, almost all of it about 5,000 tokens of thinking before a 400-character answer.
  The owner, quoted: "any action to queue a job should only ever be able to be triggered once
  per unique action"; "automate all of the task except for describing the brief ... and
  evaluating the results"; and asked for traditional navigation in place of single-key
  commands, tooltips on everything, plain language, smaller type, a dashboard explaining the
  process, more progress detail, and a literal name for vibes. Steps 2m and 2n were added for
  this. The owner also listened to the first session's 25 s excerpts: "all sound pretty good".
- 2026-11-06: 2m and 2n merged together, fast-forward to e1753ab, through an integration branch
  that was reviewed as one tree. Effort per agent:
  - 2m builder (Opus): 299k tokens, 232 tool calls, 50 min.
  - 2n builder (Opus): 285k tokens, 124 tool calls, 22 min.
  - Reviewer (Sonnet): 102k tokens, 30 tool calls, 5.3 min. PASS.
  - Fix round (Sonnet): 84k tokens, 37 tool calls, 23 min.

  What 2m changed:
  - **Prompt notation.** The prompt writes `(T)` after a parameter's default where it wrote `name~`.
  - **Thinking switch.** `queue.thinking` is sent as `chat_template_kwargs.enable_thinking` and
    stored with each request and evaluation.
  - **Automatic excerpts.** A candidates job renders each valid candidate's excerpt between model
    requests.
  - **One job per action.** A repeated job is refused with 409 `{error, jobId}`.
  - **Progress.** It carries a plain step sentence.
  - **Ratings.** Thumbs and macro feedback hold one live choice per candidate. A new choice marks
    the old row removed as "replaced", and an undo marks every live row of that choice "undone".
    Rows are never deleted.

  What 2n changed:
  - Ordinary navigation and buttons replace every key command.
  - Every control has a full-sentence title, and every page has a muted help line.
  - The dashboard opens with a card that explains the process.
  - Pages say "brief" for vibe; routes and stored names are unchanged.
  - The evaluation page becomes "Model test", in plain words.
  - Jobs show a step sentence, a progress bar and elapsed time.
  - Cards have Less | — | More controls and toggling thumbs.
  - The look is shadcn-like, in 14px type.

  What the review found:
  - The two builders worked blind to each other's contract, and the review drove both together in
    a browser. Results: one live state per choice, clear and undo working, and three quick asks
    giving one job and two 409s.
  - Should-fix: the owner's pre-2m rows hold two live choices, so clearing one brought the older
    one back. The server now clears all of them, and the page reads choices from one source (the
    candidates list).
  - A failed poll no longer leaves the job buttons off.
  - Stale parts of 0005 and 0030 were amended. Records 0031 and 0032.

  Gate: 1068 tests, run twice. The orchestrator added `"thinking": true` to the owner's config so
  it still loads.

  Pending owner checks:
  - In Safari 17.6 on mbp2015: layout and type size, tooltips, the segmented controls and dark mode.
  - Whether the help wording is plain enough.
  - A small model test with `thinking: false`. Reasoning should come back from none of the
    requests, latency should fall from about 55 s, and validity should hold.
- 2026-11-06: model tests after 2m, on Cold dorian drone with 16 candidates each.
  - **Test 2:** `(T)` notation, thinking on. 12 of 16 worked first time and 15 after one fix.
    Median request 57 s, and all 20 answers came back with reasoning. The 9 schema errors left
    were trajectories written as bare arrays (6) and brightness written as a bare array (3).
  - **Fix (b11cb8a):** the schema text gives a `{"points": ...}` example. The brightness rule
    stops reading as a ramp.
  - **Correction (b38ae92):** b11cb8a called brightness "one number". Brightness may be a
    trajectory, so the rule now says it stays within the range the whole time.
  - **Test 3:** thinking off (Sonnet fixes: 60k tokens, 21 calls, 2.9 min; then 38k, 9 calls,
    2.3 min). 14 of 16 worked first time and 16 of 16 after one fix. Median request 6.6 s,
    slowest 9 s, first token 0.2 s, and no answer came back with reasoning (0 of 18), so omlx
    honoured the switch. The genomes were as varied as with thinking on. The two first-try
    misses were a drone given 3 partials (the minimum is 4).
  - **Decision:** the owner's config keeps `queue.thinking` false.
  - **Caching:** omlx's prefix cache already reuses about 1,224 of the prompt's 2,300 tokens, so
    prompt reading costs under a second. Time went to generating thinking tokens.
- 2026-11-06: phase 3 expanded into steps 3a–3g, with records 0033–0039 reserved. The owner
  settled four choices: a locked raw value still follows the macros; the owner writes a vibe's
  feature ranges; after a revision the grid shows the card that misses fewer ranges, the
  revision on a tie; nudge is built in phase 3.
- 2026-11-07: review of the phase 3 expansion (fresh context, Sonnet: 100k tokens, 14 tool calls,
  3.0 min), seven blocking findings, all taken. The owner chose to test the revision against a
  control arm that sees the ranges but not the measurements, since a test against the first
  tries alone couldn't fail. Also taken:
  - the evaluation reads "inconclusive" below 20 revised first tries, and 3b calibrates the seed
    ranges before fixing them;
  - `sessionId` on candidates (migration 0005), since nudge children have no model request;
  - the follow-up replays only the round-0 prompt, is never trimmed and never chains, and
    explore became its own step (3f) with a fresh prompt;
  - locks stay an explicit argument, so evaluations get none;
  - 3d moves the shared generation helpers out first, so 3e can build beside it;
  - stereo width as a share, so mono measures 0;
  - revisions get their own seed;
  - rules for overlapping locks, failed nudge draws and other `softTargets` keys.

  Phase 3 is now 3a–3h, with records 0033–0040.
- 2026-11-07: phase 3 run started; 3a and 3c built in parallel from ee240c6.
- 2026-11-07: 3a merged as d3f185c (Opus: 126k tokens, 56 tool calls, 17.5 min, then a fix round
  of 39 s; reviewer Sonnet: 62k tokens, 20 tool calls, 12.6 min, PASS). Low-end share (power under
  150 Hz), stereo width (side over mid plus side, mono a measured 0) and spectral flatness on
  magnitudes from 20 Hz to 16 kHz, each 0 to 1 or null; `FEATURE_NAMES` lists the nine features a
  range may name, without integrated loudness or `gainDb`, and `featuresText` reads it.
  "Tonality" became `flatness`, since the value rises with noise. The fix round made flatness
  throw below a 32 kHz sample rate rather than store NaN. On the goldens: drone 0.82 low end,
  noise bed 0.92 low end and 0.61 flatness, widths 0.07–0.36. Pending owner checks: the noise bed
  reading that bass-heavy; most goldens sitting near the centre.
- 2026-11-07: 3c merged as 38aafb2 (Opus: 277k tokens, 100 tool calls, 29.5 min, then a rebase
  and fix round of 1.3 min; reviewer Sonnet: 82k tokens, 17 tool calls, 10.5 min, PASS with a
  security pass). Locks on globals, macros, voice parameters and whole voices, with a
  `voiceType` so a retyped voice is caught; `applyLocks` restores changed values, fills omitted
  ones, puts back a dropped voice and is all-or-nothing; migration 0004 adds `locks`, one live
  lock per path, removed as `unlocked`, `replaced` or `covered`; a path inside a voice locked
  whole is a 409. The fix round seeded the lock-route tests' candidates instead of rendering
  them (4–8 s a test to 0.1 s) and capped a lock path at 64 characters. Pending owner checks:
  the prompt's `(a pad voice)` lock lines, the word "unlocked", and the 409 over replacing the
  voice lock.
- 2026-11-07: the merge gate failed one test: the suspend-retry test injected a no-op settle
  wait, so under full parallelism the library's real race added a retry after the two scripted
  ones. Fixed in 3dde5a8 (Sonnet: 42k tokens, 9 tool calls, 3.0 min): the test counts its scripted
  failures exactly and allows real races after them. Three fresh full runs passed, and the gate
  after.
- 2026-11-07: 3b merged as c39924b (Opus: 237k tokens, 105 tool calls, 19.3 min, then a fix round
  of 2.3 min; reviewer Sonnet: 77k tokens, 11 tool calls, 3.2 min, PASS). Ranges at
  `softTargets.features`, one optional `[low, high]` per entry of `FEATURE_NAMES`, validated on
  every save; `targetsText` in every first prompt; `checkTargets` gives one `target` finding per
  miss, compared at the prompt's rounding, with a null value a miss; a ranges form on the brief
  page. `shortTermMax` and `truePeak` take no range, since normalize cancels the render's level.
  Calibration rendered 154, 188 and 200 lint-passing draws (the first two hit the five-minute
  cap); draws had the vibe's fixed values forced in, since 0 of 5,000 raw draws passed a seed's
  lint. Share missing at least one range: cold-dorian 0.50, bell-field 0.53, tidal-noise 0.73 of
  all draws (0.53 of those not near silent). No seed has a flatness range. The fix round made one
  rounding helper for the prompt and the check. The seed files changed, so they are new seeds:
  vibes loaded earlier keep `{}`. 1196 tests. Pending owner checks: each seed's ranges against its
  brief; the noise-bed golden's 6,710 Hz centroid against tidal-noise's 1,500 Hz ceiling; the
  ranges form in Safari 17.6.
- 2026-11-07: retrospective after 3a, 3c, 3b (orchestrator rule 11).

  | Step | Build | Fix round | Review |
  |---|---|---|---|
  | 3a | 126k, 56 calls, 17.5 min | 39 s | 62k, 12.6 min, PASS |
  | 3c | 277k, 100 calls, 29.5 min | 1.3 min, with a rebase | 82k, 10.5 min, PASS |
  | 3b | 237k, 105 calls, 19.3 min | 2.3 min | 77k, 3.2 min, PASS |

  Where it went: every review passed and found only small items, sent as one round each, which
  took seconds to minutes against phase 2's 10–25 min rounds. Reviews running beside a builder
  took 10–13 min against 3 min alone, mostly in full test runs under load. The one gate failure
  came from a test that turned off the settle wait and so met the library's real race at full
  parallelism; it was a test fault, hunted and fixed in 3 min. 3b's calibration hit the
  five-minute cap on two vibes and was reported as measured. No rule changes. The checkers'
  configuration hasn't changed this phase (only `scripts/dupes-allow.txt`), so they still skip
  `tmp/`, `.claude/worktrees/`, `node_modules/` and `.venv/`.
- 2026-11-07: 3d merged as a18fbc0 (Opus: 84k tokens, 26 calls, 6.1 min for the helper move,
  then 245k, 104 calls, 32.5 min; two fix rounds of 4.4 and 1.5 min; reviewer Sonnet: 120k
  tokens, 25 calls, 4.6 min, FAIL; second reviewer Sonnet: 50k tokens, 7 calls, 2.8 min, PASS
  with one finding taken before merge). The shared helpers (`currentRevision`, `ask`, `keep`,
  `failedVerdict`, `requestCandidate`) moved out of `generateCandidates` with no test edited.
  `followUp` builds both the repair and the revision. A valid first try whose excerpt misses a
  range or fails a render check gets one revision: the round-0 messages replayed byte for byte,
  the locked genome as the assistant turn, then the locks in force, the ranges, the features
  line and the misses; its own seed (stream slot 3) and request group (`<group>-revisions`); an
  unchanged answer stored on the first try's genome and seed and never shown; an over-budget
  follow-up stored as a skip. The candidates route gives each pair `{firstTryId, revisionId,
  shownId}`: fewer misses (failed checks counted), the revision on a tie. The first review
  failed the step: a poll could hide the card whose note was being typed. The swap now waits
  while the card holds the focus, unsent text or a pressed pointer; the pointer was the second
  reviewer's finding, since Safari doesn't focus a clicked button, so a swap on the blur hid the
  card before the click landed and the rating was lost. 1225 tests. Pending owner checks: revised
  cards and their link on a seed vibe with ranges, swaps waiting while an excerpt plays or a note
  is typed, the ask's wording in a stored prompt, and whether omlx's prefix cache reuses the
  replayed turns (revisions' first-token times against first tries').
- 2026-11-07: 3e merged as ab87a15 (Opus: 254k tokens, 101 calls, 38.2 min, then a rebase onto 3d
  and fix round of 9.1 min; reviewer Sonnet: 93k tokens, 21 calls, 7.7 min, PASS, with a dry-run
  merge against 3d). Migration 0005 adds `candidates.sessionId`, filled from each row's
  generation, and `listSessionCandidates` reads it. Nudge: N children of a base by seeded normal
  steps of 0.05, 0.12 or 0.25 in the vector view over the paths the locks and the vibe's fixed
  values leave free, at most 4 draws a child, a lint failure or repeated genome stored rejected;
  children keep the base's seed and are never revised. `POST /api/sessions/:id/nudges` is a job;
  an identical one queued or running is a 409. Over 1,000 nudges on cold-dorian, draws rejected:
  7.5% small, 26.6% medium, 39.1% large, mostly the 300 s duration floor; children given up 1, 16
  and 60 of about 2,670. The review found the acceptance test took its locks from the base, so
  it couldn't fail without `applyLocks`; a base predating the locks now proves it. Acceptance 3
  passes. 1245 tests. Pending owner checks: small, medium and large against their names; whether
  60 failed children in 2,664 at large is acceptable (0037 records clipping into ranges as the
  alternative).
- 2026-11-07: 3f merged as 6bc05aa (Opus: 195k tokens, 73 calls, 20.5 min, then a fix round of
  8.3 min; reviewer Sonnet: 69k tokens, 17 calls, 9.0 min, FAIL; second reviewer Sonnet: 46k
  tokens, 8 calls, 4.1 min, PASS). Explore: N children (default 4) of a base, each a fresh first
  prompt with a base section holding the base's genome with the live locks applied and the
  owner's direction quoted as a JSON string, then the revision pass like any first try. A base
  that can't take the locks is a 409, as for nudge. Trimming drops examples, then the base; a
  child whose base was dropped is a plain first try marked `baseTrimmed`. `POST
  /api/sessions/:id/explores` reuses the candidates job; an identical explore queued or running
  is a 409. A direction is at most 200 characters with no control characters. A seed-sized
  prompt with a base is about 4,309 of 8,192 tokens, its revision follow-up about 5,132. The
  review failed the step on a test that rendered three excerpts it didn't check, about 40 s
  against the 30 s timeout under load; seeded rows took it to 9.7 s and three others from 12–18 s
  to 0.1 s. 1258 tests. Pending owner checks: the base section and variation ask in a stored
  prompt; whether children copy the base too closely or move too far, with and without a
  direction; the 200-character cap.
- 2026-11-07: retrospective after 3d, 3e, 3f (orchestrator rule 11).

  | Step | Build | Fix rounds | Review |
  |---|---|---|---|
  | 3d | 84k + 245k, 130 calls, 38.6 min | 4.4 + 1.5 min | 120k FAIL, then 50k PASS |
  | 3e | 254k, 101 calls, 38.2 min | 9.1 min, with a rebase | 93k, 7.7 min, PASS |
  | 3f | 195k, 73 calls, 20.5 min | 8.3 min | 69k FAIL, then 46k PASS |

  Where it went: splitting 3d at its helper move let 3e build beside it at the cost of one
  extra report, and the reviewer's dry-run merge named every conflict before the rebase, so the
  rebase was routine. Two reviews failed: 3d's on a card that hid under a typed note and then
  under a click in Safari, which needed the owner's browser named in the second review, and
  3f's on a test that timed out. Server tests that render excerpts only to make a row showed up
  in 3c, 3d and 3f, each costing a timeout and a fix round. Change: Builders 11, below: render
  in a test only when the render is what it checks. The checkers' configuration hasn't changed
  this phase (only `scripts/dupes-allow.txt`), so they still skip `tmp/`,
  `.claude/worktrees/`, `node_modules/` and `.venv/`.
- 2026-11-07: 3g merged as 73b1c2e (Opus: 290k tokens, 115 calls, 27.2 min, then fix rounds of
  5.4 min and 39 s; reviewer Sonnet: 90k tokens, 17 calls, 5.3 min, FAIL; second reviewer Sonnet:
  56k tokens, 9 calls, 2.3 min, PASS). `GET /api/vibes/:id/lineage` lists every session candidate
  of the vibe with its parents, `pair`, excerpt, thumbs and sketch flag, leaving out evaluation
  and `revise-control` candidates and folding unchanged revisions into their first try; rejected
  ones only with `includeRejected=true`. The lineage page draws the tree as nested lists, each
  node playable with "explore from here" and "nudge from here". Session cards gained the ranges
  readout (range misses and failed checks, counted by `excerptMisses`), lock controls with the
  macro offer, the vibe's locks with unlock, and explore and nudge. Operator names live in
  `src/domain/operator.js`; the explore and nudge default counts moved to `src/domain` and the
  page sends them. The first review failed the step: in Safari a click on Lock let a poll hide the
  card and its macro offer unseen, and the default counts were written into the page titles as
  well as the server. A card now holds its pair's swap while a rating or lock request is in
  flight or an offer is unanswered. Both pages were driven in headless Chromium. 1290 tests.
  Acceptance 4 passes. The steer-controls template is copied into both pages, with a test that
  the copies stay equal.
- 2026-11-07: pending owner checks after 3g, on mbp2015 (Safari 17.6) and mbp2026, as the phase
  lists them: revised cards and their first try on 8 candidates of a seed vibe with ranges, and
  whether the revision moved toward the brief; a locked voice and its macros holding across
  explored children; nudge at small, medium and large; the lineage page after two rounds of
  exploring, playing and exploring from a first-round node; each seed vibe's ranges on the brief
  page. Also: in Safari, pick a lock path and press Lock while a revised pair waits to swap; the
  card and its offer should stay until answered. The seed files changed in 3b, so load the seeds
  again (or type ranges onto the loaded vibes) before checking them.
- 2026-11-07: 3h merged as d446aa8 (Opus: 243k tokens, 79 calls, 23.1 min, then a fix round of
  4.7 min; reviewer Sonnet: 93k tokens, 23 calls, 5.8 min, PASS with findings taken before
  merge; fixes read by the orchestrator). The evaluation gains "Also test the revision step":
  every first try that misses a range or fails a render check is revised twice from the same
  first try, the treatment through 3d's ask and the control (`revise-control`, never in a
  session) with the measured line and misses taken out; the arms alternate which goes first, and
  have their own seeds (slots 3 and 4) and request groups. `exactMcNemar` gives the one-sided p
  (9 against 1: 11/1024); the report gives shares before and after each arm with Wilson
  intervals, the paired counts, unchanged, over-budget and rejected revisions per arm, each arm's
  request times, and the revision and ranges each vibe used, read from its first tries' own
  revision. Verdicts: passes (p < 0.05 over at least 20 revised first tries), inconclusive below
  20, asking again, fails. The review found a mid-run range edit could score a vibe against the
  wrong ranges, the confirm promised about 192 minutes for a 27–40 minute run, and a render fault
  lost the whole report; all three fixed. 1322 tests.
- 2026-11-07: phase 3 retrospective (3a–3h).

  | Step | Build | Fix rounds | Review |
  |---|---|---|---|
  | 3a | 126k, 17.5 min | 39 s | 62k PASS |
  | 3c | 277k, 29.5 min | 1.3 min | 82k PASS |
  | 3b | 237k, 19.3 min | 2.3 min | 77k PASS |
  | 3d | 329k, 38.6 min | 5.9 min | 120k FAIL, 50k PASS |
  | 3e | 254k, 38.2 min | 9.1 min | 93k PASS |
  | 3f | 195k, 20.5 min | 8.3 min | 69k FAIL, 46k PASS |
  | 3g | 290k, 27.2 min | 6.0 min | 90k FAIL, 56k PASS |
  | 3h | 243k, 23.1 min | 4.7 min | 93k PASS |

  Where it went: builds ran 17–39 min and 126–329k tokens; fix rounds stayed under 10 min each,
  against phase 2's 10–25, because every round was sent as one list. Three reviews failed: two
  on the session page in Safari (a swap hiding a card under a typed note, then under a click,
  then under a lock offer), one on a test past its timeout. Each fix of the Safari class came
  from a reviewer reasoning about Safari's focus rules, since no agent can drive Safari 17.6;
  the owner's checks are the only test of it. Changes for phase 4: a brief for any session-page
  control names `card-hold.js` and says what holds a card; rule 11 (seed rows) stays. No gate
  failed for a product fault; the one failure was a test that met the library's real race. The
  checkers' configuration hasn't changed this phase (only `scripts/dupes-allow.txt`), so they
  still skip `tmp/`, `.claude/worktrees/`, `node_modules/` and `.venv/`.
- 2026-11-07: phase 3 built; the gate passes on main at d446aa8. Acceptance 1, 3 and 4 pass.
  Acceptance 2 waits on the owner's evaluation (three seed vibes, 32 each, revision test on); its
  numbers go in Result. Phase 4 is not expanded until then.
- 2026-11-07: owner: "record phase 3 now, or if you are able to debug the tidal noise you can do
  that, and ideally you run it yourself. then expand phase 4 into full plan". Evaluation 4 read
  through the app's API: inconclusive, 10 revised first tries, treatment 8 of 10 against control
  4 of 10; tidal-noise 0 of 32 valid. Debugged offline: its 300 cost ceiling against a reverb
  costing 214 at the default decay, which neither the prompt nor the finding named. Fixed as
  `05370bf`, 1323 tests, the gate passes. Running the evaluation from the session wasn't possible:
  a temp-rooted server would need the omlx key copied out of the owner's config, and the
  permission check refused that. Phase 3 closed with acceptance 2 inconclusive. Phase 4 expanded.
  Through the API the owner's data holds 0 A/B ratings, 8 thumbs and 3 sketches, all on vibe 1.
- 2026-11-07: owner: "add the web package you need. start 4a and 4c." Read as approval of phase
  4's packages: `torch` 2.15.0, `transformers` 5.22.2 and `numpy` 2.5.4 added to the sidecar
  (venv 804 MB). The CLAP checkpoint is fetched in 4b, not now.
- 2026-11-07: 4c merged as 66fc1ec (Opus: 181k tokens, 77 calls, 40.7 min; read by the
  orchestrator, no reviewer, as it adds no subsystem and crosses no process boundary). A tie is
  half a win each way, live thumbs are pointwise items, macro feedback stays out, a fold's
  candidate is a genome, and the key hashes ids and producers. With today's data the set holds
  8 thumbs and no folds. 0043 is provisional on calls 3 and 4 until the owner confirms them.
- 2026-11-07: 4a merged as 55bca77 (Opus: 218k tokens, 119 calls, 41.5 min, then a fix round of
  7.5 min; reviewer Sonnet: 60k tokens, 5 calls, 0.8 min, PASS with findings taken before
  merge: requests refused after stop, a failing server stop still ends the sidecar, a failed kill
  still fails what is in flight, and the Python loop answers bad UTF-8 and unencodable results).
  The gate passes, 1371 tests and 22 in the sidecar. The owner's config needs
  `"sidecar": { "requestTimeoutMs": 120000 }` before the server loads.
- 2026-11-07: owner: "we need a way to automate a/b testing quickly ... use wasd and left/right
  keys ... session cards should be more compact ... revised candidates nested underneath ...
  minimal audio player ... mp3 320 or similar ... remember where in the scroll ... a marker for
  chosen, and a marker for not chose ... a hidden panel". Added as 4i and 4j. Asked: MP3 for
  playback with rated audio kept FLAC; pairs from one session; champion stays with a random
  switch; arrows play, A/D choose, S same, W skip. The owner has run sessions for all three
  briefs. 4b and 4i start in parallel.
- 2026-11-07: phase 5 expanded, planned against phase 4 as written (4a and 4c merged, 4b and 4i
  being built). Owner: "i want to make sure our workflow supports being able to upload a song or
  audio file and analyze parts of it that i want to use as inspiration for future seeds and
  candidates." Added as 5a–5c, ahead of the optimizers: upload, regions analysed with the features
  and a CLAP embedding, and the owner's three uses (a brief's ranges, the prompt, a search
  target); uploaded audio never plays in a render. The acceptance means model-in-the-loop CMA-ES
  (0054). Waiting on the owner: `cma` for 5e (or numpy written here), and numpy rather than
  `botorch` for 5f.
- 2026-11-07: phase 6 expanded, planned against phases 4 and 5 as written. The owner chose
  "proposal, then edit": they give a length and an arc, the model proposes sections from their
  sketches, and they reorder, resize and retime them before rendering. Their goal is "get closer
  to being able to put together some songs", so a hand-made crossfade track renders and exports
  after 6a–6c, before morphs, lanes and the proposal. Read from the engine: nothing in `render()`
  changes; a long section renders as chunks through the existing excerpt windows, and the
  meters, limiter and WAV writer gain streaming forms with the same bits. No package is needed.
- 2026-11-07: phases 5 and 6 planned (Opus planner: 237k tokens, 55 calls, 25.7 min for both;
  merged as 05f2ffc and 83dce79). Owner's choices: reference uploads used to set a brief's
  targets, guide generation and steer by sound, never rendered; phase 5 before 6; tracks are an
  LLM proposal the owner edits on a timeline; at an owner gate, keep building and batch the asks.
- 2026-11-07: owner chose: try `laion/larger_clap_general` and `laion/clap-htsat-unfused` and
  keep whichever passes, after 4b found `laion/larger_clap_music`'s text side collapsed (every
  text at cosine 0.999); `cma` approved for 5e; regions, directions and axes in their own table
  rather than `softTargets`. 4b reviewed (PASS, fix round asked); 4i built and in review.
- 2026-11-07: 4b merged as 1cc2ce7 (Opus: 294k tokens, 164 calls, 37.8 min, then a fix round of
  9.7 min and 51k tokens; reviewer Sonnet: 74k tokens, 9 calls, 1.5 min, PASS with findings taken).
  `laion/larger_clap_music`'s text side collapsed, so 0042 keeps `laion/clap-htsat-unfused` at
  8fa0f1c after a four-sound, four-text test; 0.17 s per 30 s excerpt warm. The embed job keeps
  going past bad files and fails at the end naming them. The gate passes, 1392 tests.
- 2026-11-07: 4i merged as 1e074f6 (Opus: 328k tokens, 188 calls, 42.0 min, then fix rounds of
  10.6 and 3.8 min; reviewer Sonnet: 70k tokens, 9 calls, 2.2 min, FAIL; second reviewer Sonnet:
  49k tokens, 4 calls, 0.9 min, FAIL on a failed save redrawn and double-posted, fixed with a hold
  and Discard). Cached excerpts are MP3 at 320 kbps (7.2 MB to 1.0 MB); capture re-renders for the
  FLAC (0.8–2.3 s). 4d started beside it rather than after 4j, since it reads neither page. The
  gate passes, 1453 tests.
- 2026-11-07: 4d merged as ae9e574 (Opus: 225k tokens, 99 calls, 17.6 min, then a fix round of
  9.5 min; reviewer Sonnet: 66k tokens, 9 calls, 1.3 min, PASS with caveats taken: each vibe's
  prior is fitted on the other vibes, folds keep a held-out session out of every file a fit reads,
  constant columns and thin components carry no term, and the model code's hash is in the key).
  `readModelCode` and `fitModels` stay unexported until 4e uses them. A model with no terms
  predicts variance 0; 4e and 4f must say "no model yet" for it rather than rank on it.
- 2026-11-07: 4j merged as 012a3d0 (Opus: 290k tokens, 127 calls, 22.4 min, then a fix round of
  3.8 min; reviewer Sonnet: 65k tokens, 13 calls, 1.5 min, PASS with minor findings taken: scroll
  kept only on the way to A/B, a revised pair hides as one on the server, marks belong to the
  excerpt). The gate passes, 1493 tests.
- 2026-11-07: 4g merged as e565382 (Opus: 183k tokens, 76 calls, 11.5 min; read by the
  orchestrator). The brief page's "What you like" card reads the model under the vibe's current
  key, asking the sidecar for the producer and model code only once a model file exists. 4e merged
  after it (Opus: 253k tokens, 114 calls, 19.8 min; read by the orchestrator): a session-bootstrap
  interval (2,000 resamples, seeded), louder-wins on the heard loudest 3 s, and one derived report
  file. The merge's conflicts were resolved by keeping both sides, and "A/B choice" is now defined
  once in preference-minimum.js. The gate failed once after 4g's merge on a test in
  render.test.js while 4e's builder loaded the machine; it passed alone, on six concurrent runs
  and on the next two gates. That is its second load-only failure, so it is now hunted, not
  watched: next time, keep the failing test's name and message. The gate passes, 1533 tests.
- 2026-11-07: 4h merged as 802ca5e (Opus: 171k tokens, 76 calls, 16.8 min; reviewer Sonnet: 60k
  tokens, 17 calls, 5.8 min, PASS with two low findings: a cancel during a cached brief embedding
  could let the first omlx request out, fixed in b5bd293; the job asks the sidecar for its embedder
  before generating, kept, since the job starts it anyway). Examples are ordered by the cosine
  between the brief's text embedding and each genome's mean rated-audio embedding; unembedded
  genomes follow by recency, and the evaluation job stays on recency. The gate passes, 1539 tests.
- 2026-11-07: 4f merged as 97d951f (Opus: 407k tokens, 258 calls, 36.4 min including a fix round
  of 6.3 min; reviewer Sonnet: 80k tokens, 16 calls, 11 min, PASS with two medium findings taken:
  a reorder never moves a row that is playing or held, and the job kinds are defined once in
  `job-kind.js`). Ranking reads the current model only when a model file exists; ratings carry the
  rank shown. Phase 4 is built; its Result is written with agreement inconclusive, waiting on data.
  5d started beside 4f's fix round. The gate passes, 1580 tests.
- 2026-11-07: 5d merged as 6092b95 (Opus: 206k tokens, 122 calls, 20.9 min; reviewer
  Sonnet: 62k tokens, 13 calls, 8.7 min, PASS with low findings left: the sidecar trusts any
  absolute path as 0041 does, Node confines runs to the data root; a kill between writing an
  ask and its state fails the next ask loudly). Nudge's chain is `proposeGenome` and
  `searchPaths`; the optimizer protocol keeps run state in `<dataRoot>/search/<run>/`, built in
  `search-run.js` until 5a's `paths()` lands. Making preference.py's JSON helpers public changed
  `model_code()`, so any fitted model refits; none were fitted. The gate passes, 1604 tests.
- 2026-11-07: 5a merged as c369e8d (Opus: 334k tokens, 186 calls, 39.8 min including a fix round
  of 5 min; reviewer Sonnet: 70k tokens, 11 calls, 7.2 min, PASS with a security pass finding no
  path or argument injection, and three medium findings taken: bounds rounded to the millisecond,
  a lossy file's end padded by at most 0.1 s, and timeouts plus one shared decode per span).
  Uploads stream to a hashed name under `references/`, ffmpeg and ffprobe read only whitelisted
  demuxers and the file protocol, and backups copy the folder. Migration 0008. The gate passes,
  1661 tests.
- 2026-11-07: 5e merged as 9d1b555 (Opus: 334k tokens, 195 calls, 31.2 min including a fix round
  of 5.4 min; reviewer Sonnet: 84k tokens, 20 calls, 9.5 min, PASS with one medium finding taken:
  points folded under a hidden shown point nest under their base, and a fold never hides a held
  or playing row). `cma==4.5.0` behind 5d's protocol, its strategy pickled in the run's state
  with name and dimension checked on read. The quadratic test's bound is the score gap plus a
  distance under 0.1 (0054): the best point is a sample at the final step size, about 0.05 from
  the optimum at the median of 30 seeds. `paths().search` replaces search-run's own path. The
  gate passes, 1682 tests.
- 2026-11-07: 5b merged as c2d4a94 (Opus: 286k tokens, 144 calls, 29.4 min including a fix round
  of 6 min; reviewer Sonnet: 64k tokens, 11 calls, 7.1 min, PASS with low findings taken: a
  migration test for 0009, a sweep of leftover temp folders, cancel kills ffmpeg, and job tests
  for cancel, failure and a re-embed that skips measuring). Regions are read in 25 s windows
  hopped by 12.5 s plus a tail, normalized as renders are, into a derived `region_analyses`
  table (migration 0009). Two render-backed route tests hit the 30 s timeout once under load in
  the builder's run; they passed alone and in the gate. The gate passes, 1719 tests.
- 2026-11-07: 5f merged as fdd00fc (Opus: 490k tokens, 382 calls, 68 min including a fix round;
  reviewer Sonnet: 83k tokens, 16 calls, 10.5 min, FAIL on the search holding the one job runner
  after the page closed, fixed with a same-origin `sendBeacon` Stop on pagehide and a 10-minute
  idle stop on an injected clock; speculative renders no longer fail the job). A numpy
  pairwise-probit GP with a Laplace posterior and expected improvement, behind 5d's protocol;
  each answer is an ordinary rating first. The builder's gate failed once on a test in
  write-flac.test.js, name and message not kept; third load-only failure, so the flakes get a
  hunt. The gate passes, 1742 tests.
- 2026-11-07: the load-only failures hunted (Sonnet: 78k tokens, 34 calls, 14.2 min), merged as
  04867a5. render.test.js's suspend-race retry test failed 1 in 12 under load because the race
  can also land on a window's suspend; it now scripts only the first two failures and waits
  `SETTLE_MS` after (24 of 24 under load). write-flac: writing after flac exits can fail with
  ENOTCONN on macOS (2 in 1,200 under load), a product bug, now accepted as flac closing first.
  The 30 s timeouts in session-routes and rating-routes didn't reproduce; their setup renders two
  25 s excerpts per test, and a seeded-candidate helper is the likely cure if they recur.
- 2026-11-07: 5c merged as ba04d22 (Opus: 323k tokens, 167 calls, 58 min including a fix round of
  3.8 min; reviewer Sonnet: 64k tokens, 17 calls, 14 min, FAIL on two vocabulary words swapped to
  pass the dupes check, restored with allow-list entries; a stale region embedding now refuses
  with "press Measure" instead of giving no words). Attachments live in `vibe_attachments`
  (migration 0010) with per-kind `details` checks for 5g and 5h, and generations record what the
  prompt kept in `attachmentIds`. Two regions add about 250 tokens to the seed-sized prompt, at
  most 1,500. The gate passes, 1774 tests.
- 2026-11-07: 5g merged as 213914f (Opus: 367k tokens, 172 calls, 36 min including a fix round of
  5.1 min; reviewer Sonnet: 77k tokens, 11 calls, 1 min, PASS with two medium findings taken: a
  one-ended direction now starts from the brief's text, not the mean excerpt audio, so CLAP's
  text-to-audio gap cancels; the region term is clamped to [0, 1]). Directions are
  `vibe_attachments` rows of kind `direction`; steer is 5e's job with direction, region and
  model terms, scales read once a run, and needs no model. The gate passes, 1804 tests.
- 2026-11-07: 5h merged as 6c1a8e4 (Opus: 429k tokens, 238 calls, 39.3 min including a fix round
  of 3.2 min; reviewer Sonnet: 90k tokens, 11 calls, 1.3 min, PASS with minor findings taken: axis
  details refuse prototype keys, the map page coalesces archive reads, an open cell's controls
  keep their held state). Axes are `vibe_attachments` rows of kind `axis`, replaced as a set by
  marking the old ones removed; the archive is rebuilt on each read from the rated windows'
  descriptors; the fill job nudges elites beside empty cells, with its control on by default.
  The gate passes, 1840 tests.
- 2026-11-07: 5i merged as 764c3cd (Opus: 328k tokens, 184 calls, 53 min including a fix round of
  6.3 min; reviewer Sonnet: 71k tokens, 14 calls, 1.7 min, PASS with one design finding taken: a
  child's `parentIds` lists only the parents its prompt held, the owner's picks staying in
  `sketchIds`). Crossover is a fresh first prompt with both parents after the live locks, then one
  small-step mutation per valid child from a new stream slot (slots 0–4 unchanged). The builder's
  `--low` run had 13 render-backed route tests time out under load; the seeded-candidate helper
  goes next. The gate passes, 1862 tests.
- 2026-11-07 — Route-test seeding merged (e3e92ce). `test/support/seed-excerpts.js` writes
  candidates, their excerpt rows and MP3 files straight to the store and render cache; a test that
  rates an excerpt asks for `measured`, which renders once per worker and copies the result.
  `rating-routes` drops from 46 s to 16 s, 57 s to 21 s under load; no test neared the 30 s
  timeout in the loaded runs. Rating tests still render on capture. The gate passes, 1862 tests.
- 2026-11-07 — 5j merged (4f936b2): the optimizer test on the Model test page, 3 CMA runs plus a
  control per vibe, 4 rank-matched pairs a run, the verdict rule on 4e's agreement, and a
  spot-check mode in quick A/B whose ratings count only under the pair's stored order seed. A
  cancelled test stores no report. Review passed; fixes added a cancel test, the order-seed match,
  and a 404 for optimizer rows on the generation-run route. Phase 5's Result written. 1,896 tests.
- 2026-11-07 — 6b merged (4c8f195): tracks, track_revisions and track_exports (migration 0011,
  append-only), `validateArrangement` with paths, the length as sections less overlaps, the track
  routes, and the timeline page with a key and a button for every action. A section plays through
  an owner-started section-audio job; the embed job skips any render that isn't the excerpt window
  (`isExcerptWindow`). Defaults taken for the owner to overrule: one brief per track, extension to
  900 s, a 1,200 s track. Review passed; fixes added the embed skip, a 409 test, a window check and
  trigger checks after migrating. Under `--low` "reuses a cached excerpt" timed out twice; it
  passes at normal priority. 1,954 tests.
