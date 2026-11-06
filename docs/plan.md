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
| 0019– | Phase 2 records, numbered when phase 2 is expanded | 2 | — |

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

**Result:**

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

## Phase 2 — Vibe and session loop (outline)

**Goal:** the owner opens a vibe, asks for candidates, hears them from mbp2015, and rates them.

**Acceptance, as measurable checks:**

1. Over an owner-started evaluation of at least 48 genomes across at least 3 vibes, at least 90%
   validate after at most one repair round. The run is a server job using the server's omlx queue
   and reports the rate before and after repair, per vibe, with a 95% Wilson interval (about ±8
   points at 48), and counts truncated responses as their own reject reason.
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
  `generations`, `vibe_revisions` and `rated_audio` tables. Irreplaceable rows are marked removed
  with `removedAt` and `removedReason`, never deleted, and a documented backup command copies the
  database with `VACUUM INTO`, since copying a WAL database's file alone can miss writes, and
  copies the `rated_audio` folder with it. What
  later phases train and evaluate on has to be captured from the first session, because it
  can't be recovered afterwards:
  - **generations** (irreplaceable): every LLM call's exact prompt, the ids of the examples
    retrieved into it, model id, sampling parameters, raw response, `finish_reason` (so a
    response cut off by `max_tokens` is told apart from invalid JSON), repair round, latency and
    token counts, and a `requestGroup` shared by the candidates of one request. SFT and DPO
    (phase 8) need the exact prompt each completion came from, and DPO pairs are strongest when
    both sides share one.
  - **genomes** hold content only: the normalized genome and `genomeHash` (0005), unique per
    vibe, one row however often it is reached. **candidates** hold provenance, one row per time
    a genome was produced: the genome id, source, parent ids, the locks in force, the operator
    and its parameters, and the generation that made it. Two parents reaching one genome, or an
    LLM call and a later mutation, are two candidates of one genome, and the lineage tree
    (phase 3) is built from candidates. Candidates the linter rejected are stored too,
    with the reasons: they are negative examples and the denominator of the valid rate.
  - **ratings** name what was heard by genome id, seed, excerpt offset and duration, and engine
    version, never by a `renders` row: renders are derived data that is discarded and rebuilt.
    Each also stores the left/right order shown, each candidate's rank and score, the model
    version that ranked them, whether either was a wildcard, how long the owner took, and how
    much of each excerpt was played. Pairs shown and skipped are stored as skips. Bradley–Terry
    needs position-bias correction, and evaluating a reranker needs to know what was shown and
    why.
  - **rated_audio** (irreplaceable): every excerpt the owner rated is stored as FLAC (about 4 MB)
    under the app-data root, with a row holding its path, the SHA-256 of its PCM and the gain
    applied. A store check fails loudly when a rated file is missing or its hash differs. After an
    engine bump the current engine can't re-render it (0009), and without the file every feature and
    CLAP embedding of a rated excerpt would be lost when the extractor changes. Ratings also store
    the gain normalization applied to what was heard.
  - **vibe_revisions**: editing a vibe's constraints appends a revision, and each generation,
    lint result and rating names the revision it was made under, because a constraint change
    alters what an earlier pass or rating meant.
  - **directional feedback** ("more like this / less like this" on a macro or parameter) and
    thumbs are typed rows of their own, not encoded as pairs, so phase 4 decides how each enters
    the model.
  - **renders** carry features under the derived-data rule: when the extractor changes, rows are
    discarded and recomputed. Each derived row carries an opaque `producer` key (engine version
    plus a hash of the extractor's source) so a mismatch can be detected. It is a cache key, not
    a schema version, and the phase 2 record says so; the owner confirms that reading of
    AGENTS.md when phase 2 is expanded.
- **omlx queue** — one in-process FIFO, and only the server calls omlx (the CLI never does). One
  request in flight, and a minimum gap between requests so the live site's requests interleave; one
  candidate per request, with one prompt shared by the candidates of a `requestGroup` and varied
  sampling, so a timeout loses one candidate and DPO pairs share an exact prompt; a timeout per
  request through `AbortController`; a hard `max_tokens`; a context budget estimated at 3.5
  characters per token, since Node has no tokenizer here. Busy means HTTP 429 or 503, or time to the
  first streamed token above a configured threshold (total latency mixes our output length with the
  other site's load); whether omlx accepts a JSON-schema `response_format` per request is checked,
  since that is a request parameter, not a setting; the queue backs off exponentially with jitter up
  to a maximum wait, then fails the request with a message to the owner, never retrying silently.
  Tests use a fake omlx that records the most requests it ever had in flight (must be 1) and an
  injected clock for backoff.
- **Constraints and linter** — the vibe's hard constraints as a schema in `src/domain`, and lint
  rules over the genome and over render checks (clipping, near-silence, DC offset, cost budget).
- **Prompt, parse and repair** — the prompt built from brief, constraints, `schemaText()`, notes and
  locks; examples retrieved by rating and recency until CLAP arrives in phase 4, with the retrieval
  method's name logged in `generations` so the two policies stay apart in the data; JSON extraction;
  one repair round fed the validator's errors.
- **Excerpt renders and audio serving** — 20–30 s excerpts through 1l's functions, at
  `excerptOffset` (0007), normalized to the vibe's loudness target so an A/B choice isn't won by
  the louder side, each with a first feature set (integrated and short-term loudness, true peak,
  spectral centroid, onset rate) as pure functions in `src/domain`, so the first sessions'
  ratings already have features. Excerpts are served as WAV with HTTP range requests, which
  Safari needs to play `<audio>`; 30 s is about 8.6 MB on the LAN, and WAV avoids a lossy
  encoder and a new tool.
- **Session UI and ratings** — vibe page, candidate grid, thumbs, A/B and notes, keyboard first,
  checked in Safari 15. A/B sides are randomized from a logged seed.
- **Evaluation job** — the owner-started run behind acceptance 1, a server job started by a route,
  so it shares the server's one omlx queue; any script for it is an HTTP client of that route, never
  a second process calling omlx, with `randomGenome` as a fake-LLM baseline for the pipeline tests.
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
Result. **Result:**

## Phase 5 — Optimizers

**Goal:** search inside the vibe's constraints, not only through the LLM. **Acceptance:**
preference-based BO or CMA-ES over the macros and selected raw parameters never moves a locked value
and never renders or presents a genome the linter rejects; a MAP-Elites archive on two or three
owner-chosen axes fills its cells and the map view plays a cell on click; breeding makes children
from two sketches by LLM crossover plus mutation; CLAP text directions become sliders and reference
audio becomes a target region. Optimizers propose through `fromVector` (0005), and the archive's
descriptors are computed on the same excerpt windows the owner rates. Gains are measured against the
preference model, whose own held-out error bounds the claim, and spot-checked with owner A/B pairs.
Owner-in-the-loop preferential BO (a query budget in the tens) and model-in-the-loop CMA-ES
(hundreds of render-and-embed evaluations, an owner-started job with a stated budget) are different
tools; the phase's records say which the acceptance means. Linter-rejected points are penalized, and
locks remove their paths from the vector. **Gate:** `./scripts/check`; archive coverage and the
optimizer's agreement with the preference model in Result. **Result:**

## Phase 6 — Track builder

**Goal:** sketches arranged into 3–20 minute tracks. **Acceptance:** sections on a timeline,
crossfade and morph transitions (genome interpolation over time), macro automation curves, an
LLM-proposed structure for a target length and arc; morphs interpolate numeric parameters in encoded
space and crossfade two instances of a voice for enums and bools; a full-track render of 20 minutes
stays at least 10× real time on the bench and inside a stated memory ceiling; per-voice stems (solo
renders through `voices`) sum to the full mix before the limiter within a stated error; the limiter
is nonlinear, so the stems are exported unlimited at the mix's gain. **Gate:** `./scripts/check`;
bench numbers for a 20-minute track in Result. **Result:**

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
