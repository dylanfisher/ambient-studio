# 0023. Features are measured raw and heard, and render checks run on the raw render

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm; amended by
  [0033](0033-low-end-width-flatness.md) (three heard features, `FEATURE_NAMES`)

## Context

Every excerpt the owner rates gets measured features (spec, phase 3's "ears"): the revision
prompt quotes them, vibes will hold ranges over them, and the preference model reads them. Each
excerpt is normalized to the vibe's loudness target before the owner hears it (step 2h), so
loudness measured after normalize is the target and says nothing about the genome. The renders
row stores the features and the render checks beside an opaque `producer` key
([0021](0021-store-tables-and-append-only.md)), which 2h composes from the engine version and a
hash of the extractor's source. Loudness and true peak come from the meter in
[0008](0008-loudness-written-here.md); normalize and its 40 dB gain cap from
[0011](0011-normalize-true-peak-limiter.md). Domain code runs in the browser, so it can't read
files.

## Decision

**Two sets, one call.** `extractFeatures(raw, heard)` takes the raw `RenderResult` and the
`Normalized` value `normalize` returned for it, or `null` when normalize threw, and returns:

| Set | Feature | Measured as |
|---|---|---|
| `raw` | `loudness` | BS.1770-4 integrated, LUFS |
| `raw` | `shortTermMax` | the loudest 3 s short-term window, LUFS |
| `raw` | `loudnessRange` | EBU Tech 3342: short-term windows gated at −70 LUFS and 20 LU under their mean power, 95th minus 10th percentile (nearest rank), LU |
| `raw` | `truePeak` | dBTP |
| `heard` | `gainDb` | the gain normalize applied before its limiter |
| `heard` | `centroidMean`, `centroidSpread` | per frame, the magnitude-weighted mean frequency; then the mean and standard deviation over frames, Hz |
| `heard` | `onsetRate` | onsets a second |

Loudness is read raw because it describes the genome; the spectrum and onsets are read on what the
owner hears, and onset detection gets one level range to work in. `heard` is `null` when
normalize couldn't run (silence, or more than 40 dB of gain). Every value is a finite number or
`null` for "none measurable", so the object stores as JSON unchanged; `-Infinity` never reaches
the store as a silent `null` from `JSON.stringify`.

**Frames.** Both spectral features mix the channels to mono and use Hann-windowed frames from the
first sample, complete frames only, through the radix-2 FFT promoted from the golden harness. A
frame whose mean square is under 1e-7 (−70 dBFS) is silent: the centroid skips it and its flux is
0.

- Centroid: 2048-sample frames (43 ms, bins 23 Hz apart), hop 1024.
- Onsets: 2048-sample frames, hop 512 (10.7 ms). Magnitudes are compressed as
  log(1 + 30·|X|). A frame's flux is the compressed magnitude its bins gained since the previous
  frame, as a share of its total; the first frame's flux is 0. An onset is a frame whose flux is
  above 0.1 + 1.5 × the median flux within 47 frames (0.5 s) each side, and the largest within 4
  frames (43 ms) each side, the earliest winning a tie. The rate is onsets over the excerpt's
  seconds.

**Render checks.** `renderChecks(raw, genome)` returns the lint result type of
[0020](0020-vibe-constraints-and-linter.md), every finding at path `$`:

| Rule | Fails when |
|---|---|
| `clipping` | a channel's sample peak is at or above 1.0 (0 dBFS); one finding per channel |
| `nearSilence` | integrated loudness is under −50 LUFS, or `-Infinity`. Under −50, normalize's 40 dB cap can't reach −10 LUFS, the loudest target the schema allows |
| `dcOffset` | a channel's mean is further than 0.01 (−40 dBFS) from 0; one finding per channel. The golden excerpts' largest is 3.8e-4 (noise-bed) |
| `costBudget` | `cost(genome)` is over `COST_BUDGET` |

They run on the raw render because normalize's limiter would hide clipping and its gain would
hide near-silence.

**Producer.** `FEATURE_EXTRACTOR` in `src/domain/feature-extractor.js` lists, as paths from the
repository root, every file `extract-features.js` and `render-checks.js` import directly or not,
engine files included. The server resolves them against the repository root and hashes their
contents; 2h composes `producer`. A test derives the import closure and fails with the
difference, so the list can't drift from the code.

**featuresText.** `featuresText(features)` writes one line for the revision prompt, loudness to
0.1 LU, centroid to 1 Hz and onsets to 0.01 a second, and says "none measurable" or "too quiet to
normalize" in place of nulls.

**Cost.** On mbp2021 under `nice -n 10`, `./scripts/bench --features` times `extractFeatures` and
`renderChecks` on a 30 s excerpt of example.json at a median of 0.46 s (65× real time, load
average 2.3). The FFT is most of it; computing each twiddle once a stage instead of once a block
took it from 0.95 s, with every golden summary unchanged.

## Alternatives considered

- **Features on the normalized audio only** — rejected: its loudness is the target, and its true
  peak is the limiter's ceiling.
- **Linear-magnitude flux with 1024-sample frames** — rejected: on a drone of 110 Hz and 165 Hz
  partials it read 15 onsets a second, because partials a bin apart beat from frame to frame.
  2048-sample frames still read 5.6 a second; the log compression brought it to 0, and the bell
  golden's 3 notes in 10 s to 4.
- **Loudness range as max minus min short-term** — rejected: a fade or one loud bar sets it.
  Tech 3342's percentiles ignore both, and its four test cases are in the tests.
- **Only `src/domain` files in `FEATURE_EXTRACTOR`** — rejected: `costBudget` reads `cost()`,
  which can change without a new engine version, since it doesn't change the audio. Listing the
  engine files means an engine edit that doesn't change audio still re-renders cached excerpts;
  they are derived and render in a few seconds.
- **`FEATURE_EXTRACTOR` as `import.meta.url` URLs** — rejected: absolute paths differ between
  checkouts, and the list reads plainer as repository paths a test can check.

## Consequences

- Granular grains read as texture, not onsets: the granular-cloud golden reads 0 a second. A
  vibe that wants busy grains can't range over onset rate for that.
- The onset parameters were tuned on synthetic signals and the eight golden genomes; phase 3's
  evaluation may move them, and a change rebuilds cached rows through `producer`.

## Amendments

- 2026-11-07: the heard set also holds `lowEndShare`, `stereoWidth` and `flatness`, and
  `featuresText` writes every feature but integrated loudness and gain from `FEATURE_NAMES`,
  as "label: value unit", after the loudness and the gain. Both are in
  [0033](0033-low-end-width-flatness.md).
