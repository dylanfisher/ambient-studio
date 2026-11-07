# 0042. CLAP embeddings: the checkpoint, windows, the embeddings table and the embed job

- **Date:** 2026-11-07
- **Status:** accepted; provisional: the checkpoint fails its text-to-audio check (below), and
  the owner chooses what replaces it; amends [0019](0019-config-file-and-paths.md) (adds
  `sidecar.checkpointCache`), [0021](0021-store-tables-and-append-only.md) (the `embeddings`
  table) and [0041](0041-sidecar-process.md) (the `path` type)

## Context

Phase 4's preference model (4d) reads a CLAP embedding of every excerpt the owner rated, and
4h finds rated genomes near a vibe's brief by text-to-audio similarity. The plan names the
sidecar ([0041](0041-sidecar-process.md)) as where CLAP runs, on the CPU so it leaves omlx the
GPU, and AGENTS.md says nothing runs in the background. On 2026-11-07 the owner approved
`torch`, `transformers` and `numpy` (already in `sidecar/pyproject.toml` and `uv.lock`) and the
checkpoint `laion/larger_clap_music`. Embeddings are derived data: one shape, rebuilt when what
made them changes. Rated audio is FLAC ([0026](0026-job-runner-and-excerpt-renders.md)); the
render cache is WAV today and becomes MP3 in step 4i.

## Decision

**Packages.** torch 2.15.0, transformers 5.22.2 and numpy 2.5.4, as locked. No other package:
audio is decoded by the `ffmpeg` CLI, as FLAC is written by the `flac` CLI
([0012](0012-flac-via-cli.md)).

**The checkpoint** is `laion/larger_clap_music` at commit
`a0b4534a14f58e20944452dff00a22a06ce629d1` (`CHECKPOINT` and `REVISION` in
`sidecar/src/ambient_sidecar/clap.py`), read from `pytorch_model.bin`: the repo has no
safetensors file at that commit. Its own configs give 48 000 Hz, a 10 s window (480 000
samples) and 512 dimensions, which `load` checks against `SAMPLE_RATE`, `WINDOW_SAMPLES` and
`DIMENSION` and refuses to run with when they differ.

**The checkpoint's folder** is the config's `sidecar.checkpointCache`, a folder or `null`.
`null` means embedding is off. The sidecar fetches the eight files it needs one by one with
`cached_file`, not through `from_pretrained`, which also downloads a safetensors copy from an
unpinned conversion branch of the repo. It loads the model from the snapshot folder's path
rather than the hub id, because by id transformers asks the hub about a safetensors
conversion in a background thread even with `local_files_only`. So loading makes no network
request (checked with sockets blocked), and only `embedder` with `fetch: true` reaches the hub.

**Methods** (in `src/server/sidecar-protocol.json`, handlers in `clap.py`):

- `embedder {checkpointCache, fetch}` → `{producer, dimension, ready}`. With `fetch`, it
  downloads what is missing first. `ready` says whether the folder holds every file.
- `embed_audio {checkpointCache, audio, out}` → `{windows}`: writes the file's embedding to
  `out` as 512 little-endian float32s, and refuses an `out` that exists.
- `embed_text {checkpointCache, text, out}` → `{}`: the same for one text.

One file or text per request, not a batch, so each request fits under the timeout, progress
counts files, and a failure names its file. Vectors go back as files because arrays pass as
paths ([0041](0041-sidecar-process.md)). This adds the protocol's `path` type: an absolute path,
checked by both sides. The model loads on the first `embed_*` request and stays loaded for the
life of the process.

**Decoding.** `ffmpeg -f f32le -ac 2 -ar 48000` decodes any file to float32 stereo at 48 kHz,
and the mean of the two channels is the mono input CLAP takes. Python's standard library reads
only WAV, which the render cache stops being in 4i, so one decoder serves FLAC, MP3 and WAV.
A missing file, a file ffmpeg can't decode, or an empty one is an error answer naming the file.

**Windows.** An excerpt of up to 10 s is one window, which the feature extractor pads by
repeating it. A longer one is cut into ⌈length / 10 s⌉ windows of 10 s, evenly spaced from its
first sample to its last, so they overlap instead of leaving a short window at the end: a 25 s
excerpt is windows at 0, 7.5 and 15 s. Each window is embedded (transformers normalizes each),
and the excerpt's embedding is the mean of its windows, unit-normalized. No window is longer
than the extractor's `max_length`, so its `rand_trunc` never crops at random, and the same file
embeds to the same bytes.

**Threads and device.** The model stays on the CPU, `torch.set_num_threads(4)`
(`TORCH_THREADS`): omlx has the GPU, and four of mbp2021's ten cores leave the rest to omlx's
CPU side and the server.

**The producer** is `laion/larger_clap_music@<revision> clap-<SHA-256 of clap.py>`. The file
holds the decoding, the windowing and the normalization, so editing it changes the producer, as
editing a feature file changes the renders' ([0026](0026-job-runner-and-excerpt-renders.md)).
The sidecar computes it and `embedder` reports it, since Python holds the source it hashes.

**The table** (`0006-embeddings.sql`, `src/server/embedding-store.js`) is derived and listed
in `NOT_APPEND_ONLY`: one row per rated audio or render (a CHECK holds exactly one, each
UNIQUE), its `producer` and `vector`, the BLOB the sidecar wrote. `findEmbedding` returns a row
only under the caller's producer; `putEmbedding` replaces the source's row;
`dropOtherEmbeddings` deletes every row under another producer. A render's row is deleted with
the render (`ON DELETE CASCADE`), since a replaced render's file is gone.

**The embed job** (`src/server/embed-job.js`), started only by `POST /api/embeddings`, one at a
time: asks `embedder` with `fetch: true`, drops the rows under other producers, then embeds every
live rated audio from its FLAC and every render under this server's producer whose file exists,
each from the file its row names, that has no row. Its progress counts files. A failure stops it
with the file named, and the rows already written stay. With `checkpointCache` null it fails at
once, saying to set it.

**The candidates job** embeds each excerpt it renders after its features, first tries and
revisions alike, when it has no row. It asks `embedder` once, at the first excerpt, without
fetching. When the config's folder is null, or the checkpoint isn't in it, it embeds nothing,
logs why once, and returns the reason as `notEmbedded`, null when it embedded. A sidecar
failure while embedding fails the job like any other fault.

**The timeout.** `sidecar.requestTimeoutMs` stays at 120 000 ms. Measured on mbp2021 at a load
average of 1.9 (bench below): fetching into an empty folder took 15 s for 744 MB on the home
connection, and the cold first `embed_audio`, torch and the checkpoint loaded, took 1.9 s. A
fetch on a connection under about 50 Mbit/s would pass 120 s; the timed-out request fails the
job, and the next run resumes the download.

**Bench**, on mbp2021 on the CPU, four threads, through the real sidecar over stdio: a 30 s
stereo FLAC (three windows) embeds in 0.24 s warm (five runs, 0.241–0.247 s) and 1.9 s on the
first request of a process; a text embeds in 0.04 s. Six embeddings of one file were
bit-identical. `ping` from a cold start through `uv run` takes 0.08 s.

**The check the checkpoint fails.** `test_the_real_checkpoint_is_repeatable_and_matches_text_to_audio`
in `sidecar/tests/test_clap.py` runs only when `$AMBIENT_CLAP_CACHE` names a folder holding the
checkpoint. Its repeatability half passes. Its text half fails: "loud white noise" scores 0.007
against white noise and 0.010 against a 440 Hz sine. Probing further, every text embedding
has cosine 0.999 with every other ("a pure sine tone", "white noise", "a piano melody", "a drum
beat"), every text-to-audio similarity sits between 0.001 and 0.015 in the same order for every
text, and the checkpoint's logit scales are about 1.0. The weights load exactly (all 555
tensors equal to the file's), with eager attention as with the default. The checkpoint's own
discussion #2 reports the same: zero-shot scores of 0.5 for every label through transformers,
open since 2023 with no answer. So the audio side may still order excerpts usefully for 4d,
which can test that on the owner's ratings, but text-to-audio retrieval (4h) can't work with
this checkpoint.

## Alternatives considered

- **Batch requests (`paths`, `texts`)**, as the plan sketched — rejected: one long request holds
  the ones behind it under one timeout ([0041](0041-sidecar-process.md)), and a failure would
  name a batch, not a file.
- **Vectors inline in the JSON answer** — rejected: 0041 passes arrays as paths, and a file of
  float32s is the exact bytes the table stores.
- **The `soundfile` or `torchaudio` package to decode** — rejected: a new dependency, where the
  ffmpeg CLI is already on the machine like `flac`.
- **Python's `wave` for the WAV cache** — rejected: it reads only WAV, so FLAC and MP3 would
  still need ffmpeg, and two decoders could give two embeddings of one excerpt.
- **Fusion or random crops for long excerpts** — rejected: both draw at random, so a file would
  embed differently each time.
- **Downloading on the first embed in any job** — rejected: the candidates job would spend its
  time and the timeout on 0.8 GB the owner didn't ask for. Only the owner-started embed job
  fetches.
- **Making the key required** — rejected for now: the owner's config would fail to load until
  they choose a folder, and `null` is the same off switch `fieldRecordings` uses.
- **The safetensors copy on the repo's conversion branch** — rejected: it isn't the pinned
  commit, and the `.bin` at the commit loads with torch's weights-only loader.

## Consequences

- Every rated audio and kept render can be embedded, and 4c's training set joins rated audio
  ids to rows here (0043).
- A change to `clap.py` or the revision drops every row at the next embed job and re-embeds,
  about 0.25 s per excerpt.
- The owner's config needs `sidecar.checkpointCache`; with `null`, nothing is embedded and each
  candidates job says so.
- **Open, for the owner:** a checkpoint whose text side works. Candidates: LAION's
  `laion-clap` package with its music checkpoint (a new dependency), or another transformers
  CLAP checkpoint such as `laion/clap-htsat-unfused` or `laion/larger_clap_general`. Each needs
  the owner's approval; changing `CHECKPOINT`, `REVISION` and the checked constants is the
  whole code change, and the cached-checkpoint test is the check.
