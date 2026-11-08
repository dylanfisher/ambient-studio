# 0062. A track renders in fixed chunks, mixes with an equal-power crossfade through a temp file, and exports a folder with a manifest

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the track's own fades, the chunk length,
  keeping one cached render per track, and the export folder's name; amended by
  [0063](0063-stems-by-voice-id.md) (an export can write stems) and
  [0064](0064-morph-transitions.md) (morphs: section windows, the manifest's transitions, the
  cost). Amends
  [0010](0010-event-windows-control-grid-memory.md) (a track renders as several contexts),
  [0015](0015-export-sidecar-json.md) (the track manifest),
  [0016](0016-render-speed-bench.md) (`--track`), [0019](0019-config-file-and-paths.md) (two
  folders) and [0048](0048-quick-ab-player-mp3.md) (an MP3 from chunks)

## Context

Step 6c gives the owner a first playable, exported track: the sections of a 6b arrangement
(0061) rendered, crossfaded, normalized to the vibe's loudness target and written as WAV and
FLAC with a manifest that renders the same PCM again. A track runs to 20 minutes, and phase 6
holds it to a peak RSS under 1 GiB, against 0010's one context of about 0.8 GiB for 900 s. A
window of a genome already renders exactly from any offset with its own pre-roll (0007), and
6a's meters, limiter, normalize and WAV writer take chunks with the bits of the whole-array
forms (0060). No stored genome and seed may render differently, so the engine version stays.

## Decision

**Chunks** (`src/engine/chunk-windows.js`, `src/server/render-chunks.js`). A section's window
renders as chunks of `CHUNK_SECONDS`, 120 s of timeline, each its own `renderOffline` with its
own pre-roll. Boundaries sit on multiples of the chunk length from the window's own start, so a
section splits the same way wherever it sits on its sketch's timeline; the last chunk ends
exactly at the window's end, so it never runs past an extended genome's duration. A chunked
window matches one render of it within 0007's tolerance (peak 1e-5, the difference 100 dB
under), at every seam (`test/server/render-chunks.test.js`: the drone in 2 s chunks, and the
bell with a 10 s reverb, about 18 s of pre-roll and its seeded strikes, in 2 s chunks). By
hand at the real 120 s chunk, `example.json` with a 20 s reverb (30 s of pre-roll), 250 s from
30 s in three chunks against one render: a peak of 1.25e-6 and 122.4 dB under over the window,
6.6e-7 and 121.3 dB at the 120 s seam, 7.2e-7 and 121.6 dB at the 240 s one. `renderChunks` can skip the chunks
a span of frames doesn't need, which the seam preview uses, and checks the job's signal before
each chunk. 120 s, not 60: on the bench's track 60 s chunks lowered the 20-minute peak RSS from
about 600 to 492 MiB but spent more on pre-roll (25.6x against 27.2x), and 600 MiB is already
well under the ceiling.

**Section genomes** (`sectionGenome(arrangement, index, genomes)` in `src/domain`). Each section
renders its sketch's genome with `fadeIn` and `fadeOut` set to 0. When the section runs past
the sketch's end (0061's extend), `duration` is raised to the section's end and each voice whose
`end` reached the old duration moves to the new one; trajectories hold past their last point as
0007 says. 6e's `morphGenome` and 6f's `applyLanes` are called from here.

**The track's own fades** (`trackFades`, `trackFadeGain` in `src/domain/track-fades.js`). The
plan has the first section keep its fade-in and the last its fade-out. A genome's fades sit at
its timeline's 0 and its duration, and a section's window rarely reaches either, so a track
cut from the middle of its last sketch would end without one. Instead the mix fades in over the
first sketch's `fadeIn` and out over the last sketch's `fadeOut`, at the track's own start and
end, with the master bus's `smooth` curve at each frame's center; both are scaled down together
when they add up to more than the track.

**The crossfade** (`src/engine/crossfade.js`). `CROSSFADE_LAW` is `equal-power`: at frame `j`
of an `n`-frame crossfade the outgoing section is scaled by `cos(π/2 · (j + 0.5)/n)` and the
incoming by `sin`, so the two gains' squares sum to 1. Two sketches are unrelated signals whose
powers add, so the overlap keeps its level, where a linear crossfade dips 3 dB in the middle.
The law assumes the two sections are unrelated. Neighbors cut from the same sketch at the same
seed, near the same point of its timeline, are correlated, and their sum can rise up to 3 dB at
the crossfade's midpoint; the owner hears it as a swell where the two windows play the same
material.
The chunk length and the law are named in the manifest; changing either changes a track's
samples and bumps the engine version (0009).

**The mix** (`mixTrack` in `src/server/mix-track.js`). Sections are laid out in frames: each
starts where the one before ends less their crossfade. The mix yields blocks in track order and
holds one chunk and the overlap still waiting for the next section: frames before the next
section's start are final once a chunk passes them. The outgoing section's weighted samples are
written first and the incoming one's added, in float32. Given a span, it renders only the chunks
that reach it, and the span's samples equal the same span of the whole mix exactly. Each block
it yields is a view of one buffer the next block overwrites, and neither it nor `renderChunks`
keeps a chunk referenced across the next render, so a suspended generator frame holds no
finished chunk.

**The render** (`renderTrack` in `src/server/render-track.js`). The mix is written as interleaved
float32 to `mix.f32` in a temp folder, the only copy of the raw track (461 MB at 20 minutes);
`normalizeStream` reads it again for each pass, to the vibe's loudness target (`vibeLoudness`,
as a section's player uses) under the lowest `ceiling` any section's genome sets; one more
limiter pass at the accepted gain encodes 24-bit PCM, hashed as it is written into a WAV from
`createWavWriter`; the MP3 preview is lame fed from the WAV's data chunk. The temp file is
removed however the render ends. A sample that isn't finite throws before anything is written.

**The job** (`track-render`, `POST /api/tracks/:id/render` with `{revisionId}`). Nothing renders
until the owner starts it; one track job (render, seam preview or export) runs at a time, and a
second is a 409 naming the first. Progress counts chunks ("Rendering section 2 of 5, chunk 3 of
6"), then the loudness passes and the encoding. Cancel aborts at the next chunk or read block,
or kills lame (`writeMp3` takes the signal) and removes its partial file; the job removes its
temp folder, ends cancelled, and the revision is untouched. Renders are derived and cached
in `track-renders/<trackId>/<hash>/` (`mix.wav`, `mix.mp3`, `manifest.json`, moved in last), the
hash being SHA-256 of the sorted JSON of every recipe field that decides the samples (sections
with their genome hashes, seeds and windows, transitions, fades, chunk length, law, target and
ceiling, engine, schema and renderer versions), not the track's id, so two revisions that sound
the same share one. A finished render removes the track's other cached renders, about 0.4 GB each at
20 minutes; flipping back to an older version renders it again.

**The confirm** states `trackCost`'s estimate: the work, each chunk's cost (`cost()`) times its
length and pre-roll, divided by the last track render's rate in node-seconds a wall second, or
`BENCH_RATE` (4,000, from the bench's render and export) before any since the server started.
When a crossfade's two sections together cost more than `COST_BUDGET`, the confirm says so: it
renders slower, since each section is its own context.

**Seam preview** (`seam-preview`, `POST …/seam-preview` with `{revisionId, transition}`, counted
from 0). 30 s of track centered on the transition's middle, inside the track, rendered through
`mixTrack` with that span, so before normalizing it is that span of the full render; it is then
normalized on its own to the target, like an excerpt, and cached as `seam-<n>.mp3` in the
revision's cache folder. Writing one removes the track's other cache folders, as a render does,
so a seam-only folder doesn't outlive the version being heard.

**Export** (`track-export`, `POST …/export` with `{revisionId}`). Needs the revision's cached
render, else a 409 saying to render first. The folder is `exports/track<id>-v<n>-<name>`, `n` the
version as the page counts it and `<name>` the track's name lowered to `a-z`, `0-9` and dashes,
at most 40 characters, or nothing; so neither the name nor the body can reach outside
`exports/`, and the resolved path is checked to sit directly in it. A folder that exists is a
409 before the job and `mkdir` without `recursive` refuses it again in the job, so an export
never writes into one. In it: `<folder>.wav`, a hard link to the cached WAV; `<folder>.flac`
from it (0012); `<folder>.json`, the manifest with `files` first and `track` set to the
revision being exported, since revisions that sound the same share one cached manifest; its
audio fields and `pcmSha256` are the cached render's. A failure removes the folder, and so does
a cancel, which kills flac (`writeFlac` takes the signal) and ends the job cancelled with no
row logged.
The export is logged in `track_exports` as `mix` with the manifest's SHA-256.

**The manifest**, built like 0015's sidecar: `files`, `track` (`id`, `name`, `revisionId`),
`sections` (each `sketchId`, `candidateId`, `seed`, `offset`, `duration`, `genomeHash` and the
normalized section `genome`), `transitions`, `fades`, `chunkSeconds`, `crossfadeLaw`, `loudness`
(`target`, `ceiling`, `integrated`, `truePeak`, `gainDb`), `engineVersion`, `schemaVersion`,
`sampleRate`, `node`, `nodeWebAudioApi`, `frames`, `pcmSha256` of the WAV's data chunk, and
`recordings` when a genome plays one. `rerenderTrack(manifest, {tempDir})` checks each field's
type and each genome's hash, refuses another engine version or law, renders from the manifest
alone, and throws with both hashes and any renderer difference when the PCM differs. It writes
nothing but its temp file.

**Routes and page.** `GET …/revisions/:revisionId/render` gives the estimate, the cached preview
(URL, loudness, length), the cached seam previews and the export log, and starts nothing.
`GET /api/tracks/:id/audio/:hash/:file` serves `mix.mp3` or `seam-<n>.mp3` with byte ranges
(0025), the hash and name checked by pattern and the file by `fileInside`. The timeline page's
"Render and export" card acts on the opened version once it is saved: Render (R) after the
confirm, Play the track (P) with a playhead on the timeline, Hear the crossfade (C) of the
chosen section, Export WAV and FLAC (E), once per version, listing where it went.

**Bench** (`./scripts/bench --track`, 0016). A 20-minute and a 10-minute track of five golden
genomes, `example`, `drone`, `colundi`, `pad` and `bell`, each section from 30 s on its timeline
(the short ones extended), with 10 s crossfades and seed 1; each length renders alone (every
chunk mixed, the blocks dropped) and rendered and exported (raw file, normalize, WAV, MP3 and
FLAC) in a child under `/usr/bin/time -l`, one timed run each, about 3 minutes in all. The
ceiling is 1 GiB for any track up to 20 minutes, and the 10-minute render's peak within 10% of
the 20-minute one's. No morph or lane yet: 6e and 6f add them to the case.

## Alternatives considered

- **One context per section** — rejected: a 900 s section holds about 0.8 GiB (0010), and two
  in a crossfade would pass the ceiling.
- **Chunk boundaries on multiples of the chunk length on the sketch's timeline** — rejected: a
  section starting just before a boundary would render a chunk of a few seconds with the full
  pre-roll.
- **Keeping the genome's fades in the first and last sections** — rejected for the reason above:
  a track cut from the middle of a sketch would start and end abruptly.
- **A linear crossfade** — rejected: the overlap of two unrelated sketches dips 3 dB.
- **Holding the mix in memory between normalize passes** — rejected: 461 MB of float for 20
  minutes, plus the output, against a 1 GiB ceiling.
- **Rendering again for the export** — rejected: another full render; the export links the
  cached WAV, which is what the owner heard as the preview.
- **Keeping every cached render** — rejected for now: about 0.4 GB each, derived. The owner can
  overrule it.
- **Folder names from the track's name alone** — rejected: two tracks can share a name, and a
  name can hold `/` or `..`.
- **Forcing a garbage collection between chunks** — rejected as 0010 rejected it: it needs
  `--expose-gc` in every process that renders, and V8 promises nothing about what one collection
  frees.

## Consequences

- Measured on mbp2021, 2026-11-07, Node 26.12.1, at nice 10 with omlx serving, load average
  1.4–1.8, after the review's fixes (block buffer reused, chunks dropped before the next
  render): the 20-minute track (peak cost 441.4, 290k node-seconds) rendered alone at 27.2x
  (44.1 s), peak RSS 544 MiB; rendered and exported at 17.3x (69.4 s), 594 MiB. The 10-minute
  track rendered alone at 25.4x (23.6 s), 467 MiB; rendered and exported at 16.5x (36.4 s),
  585 MiB. The 10x speed target and the 1 GiB ceiling are met.
- **Open: the 10% memory check is missed.** The 10-minute render's peak is 14.2% under the
  20-minute one's (467 against 544 MiB). The bench now samples `process.memoryUsage()` before
  each chunk: the most V8 counts outside its heap is 180 and 181 MiB, nearly all ArrayBuffers
  (175 and 177 MiB), the same at both lengths, while the sampled RSS is at most 409 and 477 MiB.
  So the JS-held memory doesn't grow with length; the difference is native memory outside V8's
  count, the library's rendered contexts and their buffers, freed only when V8 collects their
  small JS objects. Earlier runs missed by 13.0% (522 against 600 MiB) and, with sections from 0 s
  and before two buffers were reused, by 28.8% (492 against 692 MiB): from 0, the 10-minute
  case's only full chunks have no pre-roll.
  The probes say memory doesn't grow with length but with the garbage the library's contexts
  leave until V8 collects them: four passes of the 10-minute track in one process, 40 minutes
  of audio, peaked at 482 MiB with a collection forced after each block, against 467 MiB for one
  pass and 537 MiB for the 20-minute track forced the same way; without forcing, the same
  20-minute render peaked at 692 and 600 MiB in two runs. The target stands, and the spread
  stays open until the library's native memory can be freed when a render ends.
- Tests render seconds: 1 to 3 s chunks against one render, a 7 s track for the mix, the
  normalize and the cancel, and a 26 s track of three sections through the routes, about 12 s
  under `--low`. The long-reverb seam case takes about 3 s at normal priority and about 19 s
  under `--low`, where the pre-roll's 18 s per chunk dominates.
- A removed sketch makes a revision invalid (0061), so it can't render until the section goes.
- 6d's stems render each voice through the same `mixTrack` with `voices` limited, and scale by
  the manifest's `gainDb`; 6e's morph and 6f's lanes change `sectionGenome` and add their rules
  to the manifest.

## Amendments

- 2026-11-07: the export takes `kind`, `mix` or `stems`; with `stems` it also writes one 32-bit
  float WAV per voice id into the same folder, lists each in the manifest's `stems` with its
  hash, and is logged as `stems` (0063). `mixTrack` takes `voices`, and `renderChunks` yields
  zeros without a context when `voices` is empty.
- 2026-11-07: from step 6e ([0064](0064-morph-transitions.md)). A transition may be a morph.
  `sectionGenome` returns the morph's genome for the section a morph leaves, `sectionWindow`
  starts the section it enters at the morph's 4 s handover (`MORPH_HANDOVER`), and
  `renderedTransition` records a morph in the manifest as `{kind: "morph", seconds: 4,
  morphSeconds, curve}`, `seconds` being the crossfade the mix renders, so `mixTrack`,
  `recipePlan`, the seam preview and `rerenderTrack` are unchanged. A morph that falls back is
  recorded as its crossfade. `trackCost` reads both, so a morph's peak is the morph genome's cost
  plus the incoming section's. The bench's first transition is now a morph.
