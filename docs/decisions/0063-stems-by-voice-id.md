# 0063. Stems are one per voice id, rendered through the mix's path at its gain, as float WAV

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm stems as 32-bit float WAV, the export with
  stems as one folder, and the stem file names; amended by
  [0064](0064-morph-transitions.md) (a morph's instances join their voice's stem). Amends
  [0062](0062-track-render-and-export.md) (an export can write stems)

## Context

Step 6d adds stems to a track's export (0062). The plan's acceptance 5 asks for one stem per
voice id that sums to the mix before the limiter, at the mix's gain, within a peak of 1e-5 and
at least 100 dB under the mix, and for stems exported unlimited as 32-bit float WAV. The engine
already renders a subset of a genome's voices (`voices` on `render()`), and its master bus is
linear, so solo renders sum to the full render (0010, `STEM_PEAK` 1e-6). A track's mix goes
through `mixTrack`, and 6c's memory bound comes from it: one chunk and one crossfade at a time.
Step 6e, built at the same time, makes morph genomes in which an incoming voice whose id is
taken plays as a second instance, renamed with a suffix.

## Decision

**One stem per voice id across the track** (`stemIds`, `stemVoices` in
`src/server/stem-voices.js`). The stems are every voice id any section's genome plays, sorted. A
stem holds, in each section, the voices of that id; two sketches that both have a `drone` share
one `drone` stem, and a section without the id is silence in it.

**Rendered through the mix's own path** (`renderStem` in `src/server/render-stem.js`). `mixTrack`
takes `voices`, a function from a section's genome to the voice ids to render, passed through
`renderChunks` to `render()`. A stem is the same plan, chunk length, crossfades and track fades
as the mix, with `voices` set to `stemVoices(genome, stem)`, so nothing about the mix is forked.
A section with none of the stem's voices renders no context: `renderChunks` yields zeros for an
empty `voices`, which is what the master bus gives with no input (measured exactly 0 on the
drone, bell, example and pad genomes).

**The gain** is the cached render's `loudness.gainDb`, the gain normalize accepted for the mix:
each sample of the stem's mix is multiplied by `10 ** (gainDb / 20)` and stored. No stem passes
through the limiter, so a stem can pass 0 dBFS, and the stems add up to the mix before its
limiter, not to the limited WAV.

**32-bit float WAV** from 6a's `createWavWriter` with `FLOAT32` and `encodeFloat32`, streamed a
block at a time and hashed as written, so no stem is held whole. Float keeps samples past full
scale exactly; 24-bit PCM would clip them, and FLAC can't hold float.

**The export option.** `POST /api/tracks/:id/export` takes `kind`, `mix` (0062's export, the
default) or `stems`. With `stems`, the job writes the mix's files as before, then one
`<folder>-stem-<voice>.wav` per stem into the same folder, and the manifest gains
`stems: [{ voice, file, sha256 }]`, `sha256` being the WAV's data chunk. The export is logged in
`track_exports` as `stems`. A version is exported once, with stems or without. Progress names
the stem ("Stem 2 of 4, pad: rendering section 1 of 3, chunk 2 of 6"). A failure or a cancel
removes the folder, partial stems with it, as 0062's export does; `renderStem` also removes its
own partial file. The page's "Export with stems" (V) confirms first with the time: the track
render's estimate times the number of stems, "about one track render per stem".

**The error bound** is acceptance 5's, the same as 0007's excerpt tolerance: the stems' sum
against the mix times the gain, peak under 1e-5, the difference at least 100 dB under. Measured
on mbp2021: 2.3e-7 and 142.4 dB on the test's two-section track (the drone with a second drone,
then the drone alone, at +3.5 dB); 3.0e-7 and 132.5 dB on `example` then `pad`, four stems
(`air`, `bell`, `drone`, `pad`), with `drone` in both. The difference is float32 rounding: each
stem's mix and the product with the gain round to float32 on their own.

**The seam for 6e.** `stemOf(voiceId)` in `stem-voices.js` is the one place that says which stem
a voice plays in; today it returns the id. When 6e's morph genome plays an incoming voice as a
second instance renamed with a suffix, `stemOf` maps the suffixed id back to the original, using
the suffix rule 6e's `morphGenome` defines (imported from it, not written twice), so the
instance joins its id's stem and `stemIds` doesn't list it. Nothing else in the stem path reads
voice ids.

## Alternatives considered

- **A copy of `mixTrack` for stems** — rejected: two copies of the crossfade and fade code could
  drift, and the sum would only be as good as a test of both.
- **Rendering every voice of a chunk once and splitting it into stems** — rejected: the engine
  sums voices into one bus, so splitting needs a render per voice anyway, and holding every
  stem's chunk at once multiplies the memory by the stem count.
- **Rendering a context with no voices for a section without the stem** — rejected: it spends a
  reverb's pre-roll to produce zeros.
- **24-bit stems with a stated headroom gain** — the plan's alternative, rejected for now: a gain
  chosen in advance either clips a loud stem or wastes bits on a quiet one, and the stems no
  longer sum to the mix at its gain without undoing it.
- **Stems in their own folder, exported separately** — rejected: the stems belong to the mix they
  sum to, and one folder with one manifest keeps them together.
- **One stem per voice instance** (per section) — rejected: the owner mixes by instrument, and
  a `drone` that runs through several sections is one part.

## Consequences

- An export with stems takes about one track render per stem on top of the mix's FLAC: each stem
  renders every section's chunks with that voice alone. A voice's cost is lower than the whole
  genome's, so this overstates; the confirm says "about".
- Memory is 6c's: one stem at a time through `mixTrack`, one chunk and one block held.
- `rerenderTrack` checks the mix's hash only; a stem's hash is recorded for checking a file, and
  re-rendering a stem from the manifest is `renderStem` over `recipePlan` of it.
- A voice id renamed between two sketches makes two stems; the stems follow ids, not sound.
- Tests render a 7 s track for the sum, the silence, the unclipped sample and the cancel, and an
  18 s track of two sections through the route, about 30 s under `--low`.

## Amendments

- 2026-11-07: from step 6e ([0064](0064-morph-transitions.md)). `stemOf` is
  `voiceOfInstance` from `src/engine/morph.js`: a morph renames an incoming voice whose id the
  outgoing section holds to `<id>--in` (`MORPH_SUFFIX`), whole and never cut, and falls back to a
  crossfade when that id would pass 16 characters or a voice already ends in the suffix, so the
  id alone names the stem. `test/server/render-stem.test.js` holds a morph track whose renamed
  drone plays in the drone's stem, the stems summing to the mix within the tolerance. The
  timeline's keys table holds this step's V beside 6e's M (morph) and K (curve).
