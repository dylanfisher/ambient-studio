# 0042. CLAP embeddings: the checkpoint, windows, the embeddings table and the embed job

- **Date:** 2026-11-07
- **Status:** accepted; amends [0019](0019-config-file-and-paths.md) (adds
  `sidecar.checkpointCache`), [0021](0021-store-tables-and-append-only.md) (the `embeddings`
  table) and [0041](0041-sidecar-process.md) (the `path` type). Amended by
  [0049](0049-session-table-hiding-marks.md) (the session page shows `notEmbedded`)

## Context

Phase 4's preference model (4d) reads a CLAP embedding of every excerpt the owner rated, and
4h finds rated genomes near a vibe's brief by text-to-audio similarity. The plan names the
sidecar ([0041](0041-sidecar-process.md)) as where CLAP runs, on the CPU so it leaves omlx the
GPU, and AGENTS.md says nothing runs in the background. On 2026-11-07 the owner approved
`torch`, `transformers` and `numpy` (already in `sidecar/pyproject.toml` and `uv.lock`) and the
checkpoint `laion/larger_clap_music`, and after it failed (below), `laion/larger_clap_general`
and `laion/clap-htsat-unfused` to test in its place. Embeddings are derived data: one shape, rebuilt when what
made them changes. Rated audio is FLAC ([0026](0026-job-runner-and-excerpt-renders.md)); the
render cache is WAV today and becomes MP3 in step 4i.

## Decision

**Packages.** torch 2.15.0, transformers 5.22.2 and numpy 2.5.4, as locked. No other package:
audio is decoded by the `ffmpeg` CLI, as FLAC is written by the `flac` CLI
([0012](0012-flac-via-cli.md)).

**The checkpoint** is `laion/clap-htsat-unfused` at commit
`8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a` (`CHECKPOINT` and `REVISION` in
`sidecar/src/ambient_sidecar/clap.py`), read from `pytorch_model.bin`: the repo has no
safetensors file at that commit. Its own configs give 48 000 Hz, a 10 s window (480 000
samples), 512 dimensions and no fusion, which `load` checks against `SAMPLE_RATE`,
`WINDOW_SAMPLES` and `DIMENSION` and refuses to run with when they differ. It is a general
audio checkpoint, not a music one; see "Choosing the checkpoint".

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

**The producer** is `<checkpoint>@<revision> torch-<v> transformers-<v> ffmpeg-<v>
clap-<SHA-256 of clap.py>`. The torch and transformers versions are read from the installed
packages and ffmpeg's from the first line of `ffmpeg -version`, once per process; `clap.py`
holds the decoding, the windowing and the normalization. A change to any of them changes the
producer, as editing a feature file changes the renders' ([0026](0026-job-runner-and-excerpt-renders.md)).
The sidecar computes it and `embedder` reports it, since Python holds what it names.

**The table** (`0006-embeddings.sql`, `src/server/embedding-store.js`) is derived and listed
in `NOT_APPEND_ONLY`: one row per rated audio or render (a CHECK holds exactly one, each
UNIQUE), its `producer` and `vector`, the BLOB the sidecar wrote. `findEmbedding` returns a row
only under the caller's producer; `putEmbedding` replaces the source's row;
`dropOtherEmbeddings` deletes every row under another producer. A render's row is deleted with
the render (`ON DELETE CASCADE`), since a replaced render's file is gone.

**The embed job** (`src/server/embed-job.js`), started only by `POST /api/embeddings`, one at a
time (a second gets a 409 naming the first): asks `embedder` with `fetch: true`, drops the rows
under other producers, then embeds every live rated audio from its FLAC and every render under
this server's producer whose file exists, each from the file its row names, that has no row.
Its progress counts files. One bad file doesn't stop the rest: a rated-audio file that is
missing (irreplaceable, so a failure, where a missing render is rendered again later and
skipped) and every file the sidecar fails on are collected, the rest are embedded, and then the
job fails with one message naming every failed file. The rows written stay. A cancel stops it
at once. With `checkpointCache` null it fails at once, saying to set it.

**The candidates job** embeds each excerpt it renders after its features, first tries and
revisions alike, when it has no row. It asks `embedder` once, at the first excerpt, without
fetching. When the config's folder is null, or the checkpoint isn't in it, it embeds nothing,
logs why once, and returns the reason as `notEmbedded`, null when it embedded. The job's box on
the session page shows the reason ([0049](0049-session-table-hiding-marks.md)). A sidecar failure while embedding
fails the job, naming the file, like any other fault, since the owner set the sidecar up.

**The timeout.** `sidecar.requestTimeoutMs` stays at 120 000 ms. Measured on mbp2021: fetching
into an empty folder took 12 s for 589 MB on the home connection, and the cold first
`embed_audio`, torch and the checkpoint loaded, took 1.8 s. A fetch on a connection under about
40 Mbit/s would pass 120 s; the timed-out request fails the job, and the next run resumes the
download.

**Bench**, on mbp2021 on the CPU, four threads, through the real sidecar over stdio, at a load
average of 2.6: a 30 s stereo FLAC (three windows) embeds in 0.17 s warm (five runs,
0.173–0.176 s) and 1.8 s on the first request of a process; a text embeds in 0.04 s. Six
embeddings of one file were bit-identical. `ping` from a cold start through `uv run` takes
0.08 s.

**Choosing the checkpoint.** `test_the_real_checkpoint_is_repeatable_and_matches_text_to_audio`
in `sidecar/tests/test_clap.py`, which runs only when `$AMBIENT_CLAP_CACHE` names a folder
holding the checkpoint, embeds four 25 s sounds (a 440 Hz sine, white noise, a plucked
harmonic melody, a drum pattern) twice each and four texts naming them ("a pure sine tone",
"loud white noise", "a piano melody", "a drum beat"). It asks that each file embed to the same
bytes twice, that no two texts sit above cosine 0.9, and that each text be nearest its own
sound. Each checkpoint, pinned and fetched into a temp folder:

| Checkpoint @ commit | Repeatable | Largest text–text cosine | Texts nearest their sound | Margin over the next sound (tone, noise, piano, drums) |
|---|---|---|---|---|
| `laion/larger_clap_music` @ `a0b4534` | yes | 0.999 | — (all ranked alike) | — |
| `laion/larger_clap_general` @ `ada0c23` | yes | 0.639 | 4 of 4 | 0.240, 0.088, 0.001, 0.017 |
| `laion/clap-htsat-unfused` @ `8fa0f1c` | yes | 0.506 | 4 of 4 | 0.394, 0.149, 0.193, 0.027 |

`larger_clap_music` was dropped. Through transformers 5.22.2 every text embedding sat at
cosine 0.999 with every other, every text-to-audio similarity fell between 0.001 and 0.015 in
the same order whatever the text, and its logit scales were about 1.0, though all 555 tensors
loaded equal to the file's and eager attention gave the same. Its hub discussion #2
("Equally-weighted output when using with HF transformers `pipeline` API") reports the same,
every label scoring 0.5, open since 2023 with no answer. Both others passed; `clap-htsat-unfused`
was kept because its text ranking is clearer: its smallest margin is 0.027 against 0.001 for
`larger_clap_general`, whose piano text scored the piano 0.148 and the sine 0.147. Its
weights are 589 MB against 744 MB.

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
- **`laion/larger_clap_music`**, the owner's first choice and trained on music — rejected: its
  text side doesn't work through transformers (above).
- **`laion/larger_clap_general`** — rejected: it passed, with smaller text margins than
  `clap-htsat-unfused`.
- **The safetensors copy on the repo's conversion branch** — rejected: it isn't the pinned
  commit, and the `.bin` at the commit loads with torch's weights-only loader.

## Consequences

- Every rated audio and kept render can be embedded, and 4c's training set joins rated audio
  ids to rows here (0043).
- A change to `clap.py`, the revision, or the torch, transformers or ffmpeg version drops every
  row at the next embed job and re-embeds, about 0.2 s per excerpt. A `brew upgrade ffmpeg` is
  enough to do it.
- The owner's config needs `sidecar.checkpointCache`; with `null`, nothing is embedded and each
  candidates job says so.

## Amendments

- 2026-11-07: from step 4j ([0049](0049-session-table-hiding-marks.md)). The session page shows
  a finished candidates job's `notEmbedded` reason in its job box.
