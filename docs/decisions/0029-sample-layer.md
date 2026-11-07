# 0029. Field recordings are named by hash, decoded by the server, and played in crossfaded passes

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm. Amends
  [0005](0005-genome-schema-table.md) (a `recording` descriptor kind) and
  [0015](0015-export-sidecar-json.md) (the sidecar's `recordings` field).

## Context

Step 2k adds a voice that plays the owner's field recordings: WAV, FLAC and AIFF files in the
config's `fieldRecordings` folder (`null` until the owner sets one). The engine runs in the
browser too and does no I/O ([map.md](../map.md)), renders must be reproducible
([0009](0009-engine-version-golden-hashes.md)), every existing genome must render the same, and
`randomGenome` must draw what it drew before. The prompt's schema text was already 2,931 of its
3,000 characters ([0005](0005-genome-schema-table.md)).

## Decision

**Naming.** A genome names a recording by the SHA-256 of its file, in lowercase hex, through a new
descriptor kind, `recording`, which has no default: a voice without one is a validation error.
The hash names content, not a path, so renaming or moving a file inside the folder changes
nothing, and a file whose bytes change is a different recording.

**The index.** `indexRecordings(folder, previous)` in `src/server/recording-index.js` lists every
`.wav`, `.flac`, `.aif` and `.aiff` file (any case) in the folder and its subfolders, skipping
hidden files and folders, sorted by path. Each entry holds the path, the SHA-256 of the bytes,
hashed as a stream so a file of any size is listed, and the duration, channels and sample rate
from the header in the file's first MiB (`src/server/audio-header.js`). The reader reads a
`fmt ` or `COMM` chunk only when its stated size fits the bytes. An entry from `previous` whose
file has the same size and modification time is kept without reading it again. A file whose
header can't be read (truncated, a chunk running past the file, zero channels or rate) fails
the index, naming the file. Nothing watches the
folder: a caller indexes it when it needs to, and the server keeps the last index to pass back in.

**Decoding.** The server refuses a file over 2 GiB by name (`readFile`'s limit), reads each file
a genome names, hashes the bytes again, and decodes them
with node-web-audio-api's `decodeAudioData` on an `OfflineAudioContext` at 48 kHz
(`loadSamples` in `src/server/load-samples.js`). It passes the result to `render()` as `samples`:
`{[hash]: {sampleRate, channels}}`. Measured on mbp2021 with node-web-audio-api 2.2.0:
`decodeAudioData` reads 16-bit big-endian AIFF, 16-bit WAV and 24-bit FLAC; a 44.1 kHz file
comes back resampled to 48 kHz with its length rounded up (44,100 frames to 48,001), and two
decodes of the same bytes give the same samples. Decoding a 1 s file takes 1–4 ms. The header is
read separately because `decodeAudioData` returns the resampled buffer, which no longer says the
file's own rate.

**The voice** (`src/engine/field-recording.js`, type `recording`). Beside the common parameters:
`recording`; `mode` `loop` (every pass plays the span starting at `position`, a share 0–1 of the
room the file leaves after the span) or `scatter` (pass k starts at a place in the file drawn
from `(seed, voice id, k, 1)`); `span`, 1–120 s of the file a pass plays, at most the whole file;
`fade`, the crossfade as a share of a pass, 0.02–0.5; `rate`, 0.25–2, which changes speed and
pitch together; `lowcut`, a fixed high-pass at 20–2,000 Hz; `cutoff`, a low-pass at
100–20,000 Hz that may be a trajectory and that brightness moves by 0.25 of its range; and `pan`,
a stereo panner's balance, −1 to 1, which may be a trajectory. Both filters are Butterworth.

- **Passes.** A pass lasts `L = ⌊(span frames − 1) / rate⌋ + 1` timeline frames, its fade is
  `F = ⌊fade × L⌋` frames, and pass k starts `k × (L − F)` frames after the voice's first frame,
  so neighbors overlap by exactly their fades and at most two sound at once. Fades are
  equal-power (sine in, cosine out), so two uncorrelated passes keep a steady level.
- **Reading the file.** A pass reads the file at `start + i × rate` by 4-point Catmull-Rom
  interpolation, holding the end samples past either end; a whole frame reads the sample itself,
  so at rate 1 a pass copies the file. Content above 24 kHz / rate folds back at a rate over 1;
  `cutoff` is the control for it.
- **Windows.** The passes are computed in JS for each 2 s window's frames, from timeline frames
  only, and played by one buffer source a window into the high-pass (`playWindowBuffer`, shared
  with the noise bed). The buffers abut, so 0010's summing rule holds, an excerpt plays exactly
  what a full render plays from its first frame, and `longestEvent` is 0. A mono file plays the
  same in both channels.
- **Limits.** The voice plays files of 1 or 2 channels, 0.1 s to 1,200 s long (`unplayable`). A
  render holds each file decoded, 384 kB a second in stereo, so 20 minutes is 461 MB beside
  0010's 1.5 GiB ceiling. The limits are checked on the header before decoding and on the
  decoded buffer after, naming the file: the decoder reads every frame the data chunk holds, so
  an AIFF whose `COMM` says 1 s decodes for as long as its `SSND` runs.
- **Cost.** The low-pass on the control grid (`SWEPT_FILTER_WEIGHT`, 21), the high-pass and the
  panner (1 each), a buffer source a window (4), and 16 node-seconds for the JS: 1.95 ms a
  timeline second with two passes always overlapping at rate 1.99, measured on mbp2021 over
  60 s. That is the worst case: at a rate just under 2 every frame interpolates and the most
  file is read, while at exactly 1 or 2 every frame lands on a file frame and skips the
  interpolation (1.46 ms at 2).
  The voice costs 43, 559 beside the longest reverb, under the budget of 560. Measured with a
  drone, an 8 s reverb and the voice at rate 2 over 120 s: 5.7 ms a timeline second more than
  the drone alone, about 46 node-seconds against the 45 `cost()` adds; at 1.99 that run measured
  50, before the frame loop computed each frame's gain and position once for both channels,
  which took the JS at 1.99 from 2.57 to 1.95 ms.

**What the schema, `randomGenome` and the prompt see.** `schemaText()` lists only the voice types
that play no recording, so its text is byte-identical to before (2,931 characters) and every
prompt sent without recordings reads as it did. `randomGenome` draws from those types too
(`selfContainedVoiceTypeIds()`), since it has no recording to name; a test pins the SHA-256 of
seeds 0–199's genomes, capped and uncapped, to the values measured before the voice existed.
`buildPrompt` takes the index as `recordings`, and when at least one file is playable the system
message gains the voice's schema lines (`recordingVoiceText()`, 561 characters) and one line per
playable recording: hash, seconds, channels and the file's quoted path, at most 32
(`MAX_PROMPT_RECORDINGS`, about 900 tokens) in path order, saying when more exist. Generation
treats a hash that names no playable indexed file as a schema error at the voice's
`recording` path, so the repair round asks for a listed one.

**When the folder changes.** A renamed or moved file still renders, found by its hash. A file
deleted or moved out fails the render with the hash and, when the caller knows it (an export's
sidecar), the file name. A file edited after it was indexed fails with its path and both hashes,
because the bytes are hashed again before decoding. A cached excerpt stays valid either way: it
was rendered from the bytes the hash names.

**Where `samples` is carried.** `render()` and `renderOffline` take `samples`; a voice whose hash
is missing from them throws, naming the hash and the voice. `exportRender`, `rerender`,
`renderExcerpt` and `renderExcerpts` take the index instead (optional, as their last input),
and decode only what the genome names, an excerpt only on a cache miss. A genome that plays a
recording without an index fails saying no recordings folder was given. The export's sidecar
gains `recordings`, `{[hash]: file}`, before `genome`, only when the genome plays one; `rerender`
passes it on for the error message. The render CLI takes `--recordings DIR` in both forms.

**Engine version.** No existing genome changes sound: every golden still matches, and
`ENGINE_VERSION` stays 2. The voice's golden genome, `field-recording.json`, plays the 44.1 kHz
fixture FLAC in a loop and the fixture WAV scattered, with a trajectory on each voice and
brightness at 0.7, so a change to the decoder or its resampler fails the golden too. The golden
harness decodes `test/fixtures/recordings/`, three synthetic files of 1–2 s at 44.1 kHz made with
ffmpeg from seeded noise and sine tones (`anoisesrc`, `sine`, `-fflags +bitexact`).

## Alternatives considered

- **Naming a recording by its path** — rejected: a rename would break every genome naming it, and
  an edit would change a genome's sound without a trace.
- **A short hash prefix in the genome, mapped to the full hash by the server** — rejected: the plan
  names recordings by their SHA-256, and a prefix needs a collision rule and a second name for
  one file. The cost is 64 characters per recording in the prompt.
- **Decoding in the engine** — rejected: the engine does no I/O and runs in the browser.
- **Decoding every file to build the index** — rejected: it holds each file at 48 kHz floats only
  to read three numbers, and the decoded buffer no longer says the file's rate.
- **Playing passes through `AudioBufferSource.playbackRate`, one source a pass** — rejected: an
  excerpt starting inside a pass would start the source at a fractional offset, which the
  library interpolates differently from a source started at the pass's start, and a pass of up to
  480 s at rate 0.25 would push the excerpt's pre-roll that far back.
- **The voice in `schemaText()`** — rejected: it takes the text past its 3,000-character limit, and
  without recordings the LLM can't write a valid one.
- **`randomGenome` drawing a placeholder hash** — rejected: the genome couldn't render.
- **More than one recording per voice** — rejected for now: a genome layers recordings as several
  voices, each with its own level, filters and pan, within the 16-voice cap.

## Consequences

- The server's session and evaluation code (2i, 2l) passes the index to `generateCandidates` and
  `renderExcerpts`; `indexRecordings(config.fieldRecordings)` when the folder is set, `[]` when
  it is `null`.
- A corrupt file in the folder stops indexing until the owner removes or fixes it; the error names
  it.
- A recording longer than 20 minutes or with more than two channels isn't offered or played.
