# 0015. The export's sidecar JSON, file names and re-render check

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

An export is a WAV, a FLAC and a JSON file that holds what's needed to render the same samples
again (spec: "each export comes with a sidecar JSON … so I can re-render it"). Phase 1's
acceptance checks 1, 3, 5 and 6 read these files, and the CLI (step 1m, [0017](0017-phase-1-cli.md))
and phase 2's routes call the same two functions, so their fields and names are fixed here.

## Decision

`exportRender(genome, {seed, duration, offset, target, outDir})` in `src/server/export-render.js`
validates the genome, renders it through `renderOffline` (the offline sequence with 0010's
suspend-race retry), throws if any sample is NaN or ±Infinity, normalizes to `target` under the
genome's `ceiling` ([0011](0011-normalize-true-peak-limiter.md)), encodes the PCM once with
`encodePcm24`, and writes `<name>.wav`, `<name>.flac` and `<name>.json` into `outDir`. `offset`
defaults to 0; `target` has no default. It returns `{sidecar, paths}`, with the absolute paths of
the three files.

- **File name.** `<name>` is `<first 12 hex of genomeHash>-seed<seed>-<offset>s-<duration>s`,
  for example `1f0c2a9e4b7d-seed1-0s-300s`. It is built from numbers and a hash only, so it
  can't leave `outDir`; the paths are also checked to sit directly in it. 12 hex characters
  (48 bits) tell the owner's genomes apart; the full hash is in the JSON. The loudness target
  isn't in the name, so exporting the same window at two targets needs two folders.
- **No overwriting.** All three names are checked with `lstat` before rendering, so a taken
  name fails before a long render, and a dangling link counts as taken rather than being
  followed. The files are written into a new temp folder made with `mkdtemp` inside `outDir`
  (`.export-XXXXXX`), the WAV with `wx` and the FLAC by flac into that fresh folder, then each is
  hard-linked to its name. `link` fails on any existing entry, a link included, and never
  follows one, so a name another process takes during the render is left alone and the error
  names it. The temp folder is removed after the links. `outDir` is created when missing.
- **No partial exports.** When a write or a link fails, the call removes the names it linked,
  its temp folder and the folders it created (with `rmdir`, which refuses a folder something
  else has written into), then rethrows the original error. Only entries this call created are
  removed. If the removal itself fails, both errors are thrown together in an
  `AggregateError`.
- **Sidecar fields**, in this order, camelCase:
  - `files`: `{wav, flac}`, the other two files' names, relative to the sidecar's folder.
  - `genomeHash`: SHA-256 hex of `canonicalGenome()` ([0005](0005-genome-schema-table.md)).
  - `pcmSha256`: SHA-256 hex of the interleaved 24-bit PCM, exactly the WAV's data chunk without
    its pad byte, after normalization and limiting: the bytes the normalized goldens hash
    ([0009](0009-engine-version-golden-hashes.md)).
  - `seed`, `duration`, `offset`: the render's window, in timeline seconds.
  - `loudness`: `{target, integrated, truePeak, gainDb}`: the target passed in (LUFS), the
    integrated loudness and true peak measured after limiting (LUFS, dBTP), and the gain applied
    before the limiter (dB).
  - `engineVersion`, `schemaVersion`, `sampleRate`.
  - `node` (`process.version`) and `nodeWebAudioApi` (the installed package's version).
  - `genome`: the normalized genome, defaults written out, last because it's the longest.
- **Re-render.** `rerender(sidecarPath, outDir)` reads the sidecar and checks each field it uses
  has the right JSON type. It refuses a sidecar from another engine version before rendering,
  naming both versions and any Node or node-web-audio-api difference, and saying to re-render
  from a worktree at tag `engine-v<N>`. It refuses a sidecar whose `genomeHash` doesn't match its
  genome, saying the file was edited or the schema's defaults changed, and one that isn't valid
  JSON, naming its path. It then renders and normalizes with the recorded values and writes the
  three files only when the new PCM hash matches; otherwise it throws with both hashes, says both
  runs share the engine version, and names the Node or library version that differs, or says
  none does.
  Re-rendering into the export's own folder fails on the taken names, so it takes another folder.
- **Version lookups.** `rendererVersions()` in `src/server` reads the Node and node-web-audio-api
  versions for the sidecar and for the golden harness, so both record the same strings.

## Alternatives considered

- **Leaving a failed export's files for the caller to remove** — rejected: a WAV with no JSON
  beside it looks like a finished export.
- **Re-render first, compare after writing** — rejected: a failed re-render would leave files
  that look like a good export.
- **Re-render an older engine's sidecar and compare anyway** — rejected: a version bump means
  the samples are allowed to differ, so a match would be luck and a mismatch says nothing new.
- **A name from the genome's file name, or a timestamp** — rejected: `exportRender` takes a
  genome object, phase 2's genomes have no file, and a timestamp makes the same export differ
  between runs.
- **The CLI's output folder as a whole export, with fixed names (`export.wav`)** — rejected:
  several exports couldn't share a folder.
- **The genome in canonical (sorted) form** — rejected: the normalized genome reads in the
  schema's order and hashes the same.

## Consequences

- Measured on mbp2021 at nice 10: a 300 s export of the drone golden genome (its duration set to
  300 s) took 7.6 s, of which the render alone was 4.5 s; `rerender` took 7.5 s; peak RSS
  701 MiB. It read −16.05 LUFS and −1.40 dBTP against a −16 target.
- Stems wait for phase 6.
