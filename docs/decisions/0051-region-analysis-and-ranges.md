# 0051. Region analysis: windows, target, embedding, derived rows, and ranges from a region

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0034](0034-feature-ranges-as-soft-targets.md) (a region can fill the ranges form)

## Context

Phase 5 lets the owner aim a brief at part of a reference recording. 5a stores uploads and the
regions marked on them ([0050](0050-reference-uploads.md)) and decodes a region with
`decodeWithFfmpeg` to 48 kHz stereo floats. Use (a), settled by the owner on 2026-11-07, sets a
brief's ranges from a region's features ([0034](0034-feature-ranges-as-soft-targets.md)); use
(c), step 5g, steers toward the region's CLAP embedding. A rated excerpt is `EXCERPT_SECONDS`
(25 s) long, normalized to its brief's loudness target before its heard features are read
([0023](0023-features-and-render-checks.md)), and embedded by 4b's `embed_audio`
([0042](0042-clap-embeddings.md)). AGENTS.md says nothing runs in the background, derived data
has one shape and is rebuilt when it doesn't match, and tests use a fake sidecar.

## Decision

**The Analyze job** (`analyzeRegionJob`, `src/server/analyze-region-job.js`, kind
`JOB_KIND.analyze`) measures one region at one loudness target. Only the owner starts it, from
the References page (Analyze on a region) or the brief page (Set ranges from this region, when
the region has no analysis at the brief's target). `POST /api/reference-regions/:id/analyze`
takes `{}` or `{vibeId}` and starts it, one at a time: a second while one is unfinished is a 409
naming it. A removed region is a 400, an unknown brief a 404.

**Windows** (`regionWindows`, `src/domain/region-windows.js`): `EXCERPT_SECONDS` long, a new one
every half window (12.5 s) while one fits, so a region is read as an excerpt is. When the hops
leave a tail, one more window ends at the region's end, so no part of the region goes unread: a
60 s region gives windows at 0, 12.5, 25 and 35 s, a 50 s one at 0, 12.5 and 25 s. A region no
longer than one window (a 15 s one) is one window read whole.

**Target.** Each window is normalized to the target, with normalize's default −1 dBTP ceiling,
then `extractFeatures(decoded, heard)`. The target is the brief's saved `vibeLoudness` when the
request names a brief, and [0018](0018-default-loudness-target.md)'s −16 LUFS
(`GLOBAL_PARAMS.loudness.default`) on the References page. A window normalize can't take, such as silence, keeps its raw features, `heard: null`, and
normalize's message as `notHeard`; it is a fact of the recording, not a fault of the job.

**Embedding.** Each window, as heard (the decode where normalize couldn't take it), is written
as a 24-bit 48 kHz stereo WAV in a temp folder under `reference-cache/` and sent to
`embed_audio` one file a request, as 0042 sends excerpts. The region's embedding is the unit
mean of the windows' (`unitMean`, `src/domain/unit-mean.js`), 0042's rule for an excerpt's 10 s
windows. The heard audio is embedded rather than the raw decode so a region's embedding sits
beside the renders', which are embedded from their normalized MP3s. The job asks `embedder`
without fetching: with no checkpoint folder, or the checkpoint not in it, the features are kept
and the result's `notEmbedded` says why, as the candidates job does. A sidecar failure while
embedding fails the job with `analyzing the sound of region <id> (“<label>”) failed: …`, after
the features are stored, so the next run embeds without measuring again. A new embedder
producer re-embeds the same way: the windows are decoded and normalized again for their WAVs,
and their stored features are not read again. A cancel kills ffmpeg mid-decode (the job's
signal reaches `decodeWithFfmpeg`) and stops between windows. The temp folder is removed when
the job ends, however it ends; one a killed server left (`reference-cache/.analyze-*`) is
removed when the next Analyze job starts, since only one runs at a time.

**Derived rows** (`0009-region-analyses.sql`, `src/server/region-analysis-store.js`, listed in
`NOT_APPEND_ONLY`): `region_analyses`, one row per region and target (UNIQUE), holding
`producer` (this server's `PRODUCER`, the engine version and the feature files' hash), `windows`
(JSON: each window's start and length in seconds, features and `notHeard`), and
`embeddingProducer` and `embedding` (512 little-endian float32s, both null until embedded). A
row under another features producer is replaced and measured again; an embedding under another
embedder producer is made again in place. An analyzed region under both current producers is
neither decoded nor sent to the sidecar again.

The rows don't join 4b's `embeddings` table. Its shape (0042) is one row per rated audio or
render, a CHECK holding exactly one: a region would need a third column, a wider CHECK and a
migration that rebuilds the table, for a row keyed by region and target that `findEmbedding`
and the embed job would then have to skip. The embed job also drops every row under another
producer and re-embeds from files; a region has no file, so it is rebuilt by its own job.

**Ranges** (`rangesFromRegion(windows)`, `src/domain/ranges-from-region.js`). For each feature in
0034's range table, over the windows that measured it: the 10th to the 90th percentile by
nearest rank, so each end is a value a window read and the median always lies between them;
widened about its middle to `MIN_RANGE_WIDTH` when narrower; moved inside 0034's bounds, keeping
the width where the bound leaves room; and each end rounded outward to the digits the prompt
writes. The minimum widths:

| Feature | Minimum width | Why |
|---|---|---|
| loudness range | 2 LU | about a sixth of the 1–13 LU spread 0034's calibration read |
| spectral centroid | 100 Hz | about a third of a narrow brief's p10–p90 (bell field's 212–503 Hz) |
| centroid spread | 20 Hz | about half of cold dorian's 9–42 Hz p10–p90 |
| onset rate | 0.1 a second | 0034's tightest seed range, "at most 0.1" |
| low-end share | 0.1 | a tenth of the share |
| stereo width | 0.04 | half of 0034's p10–p90 (0.01–0.09) |
| spectral flatness | 0.05 | a fifth of tidal noise's 0–0.27 p10–p90 |

The two raw levels are never proposed: they are not in 0034's table, and a mastered recording's
level says nothing a genome can match. Integrated loudness and gain are never proposed either,
as 0033 leaves them out of `FEATURE_NAMES`. A feature no window measured is left out.

**The brief page.** On a saved brief, "Set ranges from a region" lists every live region
(`GET /api/reference-regions`). Its button reads `GET /api/reference-regions/:id/analysis?vibeId=`,
runs the Analyze job first when there is no analysis at the brief's target, and fills the range
inputs the proposal names, leaving the others as the form holds them. Beside each filled range
a line says what the brief has saved now ("Saved now: at most 400 Hz."). Nothing is posted: the
owner's Save is the only write, and it makes a new revision as any edit does. The form fill is
`rangeFill` (`src/web/region-ranges.js`, no DOM).

**The References page** gets Analyze on each region, which runs the job at −16 LUFS and shows
what it found ("Measured on 4 windows at -16 LUFS. Its sound is analyzed too.").

## Alternatives considered

- **Rows in 4b's `embeddings` table** — rejected, as above: a migration that rebuilds a table to
  hold a row keyed differently from every other row in it.
- **Windows on the hop alone, dropping the tail** — rejected: up to 12.5 s of the region would
  never be read, and the region's last sound is often the part the owner marked it for.
- **Windows spread evenly across the region, as 0042 spreads 10 s windows** — rejected: the plan
  reads a region as excerpts are read, half a window apart, and an even spread changes every
  window's start whenever the region's length changes.
- **Embedding the whole region as one file** — rejected: one request could pass the sidecar's
  timeout on a 5-minute region, and `embed_audio`'s own windows are 10 s, not the excerpt's.
- **Embedding the raw decode** — rejected: renders are embedded as heard, and 5g compares the
  two.
- **Fetching the checkpoint in this job** — rejected: only the embed job downloads 0.8 GB, as
  0042 settled.
- **Min to max instead of the 10th to 90th percentile** — rejected: one loud or bright window
  would set the range.
- **A range on the loudest 3 s or the true peak** — rejected, as above.
- **Saving the proposed ranges at once** — rejected by the plan: nothing changes until the owner
  saves.
- **Measuring at the form's unsaved loudness** — rejected: the analysis is keyed by a target the
  server reads from a stored revision, so the page and the server agree on it.

## Consequences

- 5c reads a region's median features from `windows`, and 5g its `embedding` under the current
  embedder producer.
- Changing a feature file or the engine version drops every region's analysis at its next
  Analyze; changing the CLAP producer re-embeds without measuring again.
- A 5-minute region holds 23 windows: one decode of 115 MB, and up to 165 MB of temp WAVs,
  removed when the job ends.
- The References page shows an analysis only after Analyze is pressed in that visit.
