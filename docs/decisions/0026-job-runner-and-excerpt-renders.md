# 0026. One job at a time, and excerpts cached by window, target and producer

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm; amended by
  [0036](0036-revision-pass.md) (the candidates job revises after a render) and
  [0048](0048-quick-ab-player-mp3.md) (the cache holds MP3s; capture renders the excerpt again)
  and [0076](0076-parallel-excerpt-renders.md) (a job renders a batch of excerpts three at a time)
  and [0092](0092-words-beside-a-job.md) (words jobs run in a second lane, beside the main one)

## Context

Step 2h gives the server its first long-running work: asking for candidates (2f) and rendering
the excerpt the owner rates for each. A generation waits on omlx through the queue
([0022](0022-omlx-queue.md)), which reads a slow first token as omlx being busy. An excerpt
render runs normalize and feature extraction on the event loop, blocking it for a large share of
the render (features alone take 0.46 s on 30 s of audio, [0023](0023-features-and-render-checks.md)). Excerpts are a window
of the genome's timeline at the candidate's seed ([0007](0007-trajectories-time-base-excerpts.md)),
`EXCERPT_SECONDS` long. The store keeps a derived `renders` row per window with an opaque
`producer` key, and an irreplaceable `rated_audio` row per heard excerpt
([0021](0021-store-tables-and-append-only.md)). AGENTS.md says nothing runs in the background.

## Decision

**The job runner** (`createJobRunner` in `src/server/job-runner.js`) is one in-process FIFO.
One job runs at a time, so a generation's omlx requests never share the event loop with a render,
and the queue's time-to-first-token reading measures omlx. A job starts only when a caller adds
it, at once when nothing is running; there is no timer or start-up hook. A job gets an
`AbortSignal` and a `progress(done, total)` function. Its status, which the UI polls, is its
`id`, `kind`, `state` (`queued`, `running`, `done`, `failed`, `cancelled`), `progress`, `result`,
the `error` message and the `addedAt`, `startedAt` and `finishedAt` times from an injected clock.
Statuses are copies. `get(id)` returns one with its `result`, and `list()` returns every job's
without it, so polling the list doesn't copy each finished job's output; the UI polls `get`.
Every job since start-up is kept in memory; a restart forgets them.

**Cancelling** a queued job removes it unstarted. Cancelling a running one aborts its signal: the
job stops at its next check, and the excerpt job checks before each render. A job that rejects
after its signal was aborted is `cancelled`, whatever it rejected with, since an aborted omlx
request fails with its own error. A failed job doesn't stop the next one.

**An excerpt** (`renderExcerpt` in `src/server/render-excerpt.js`) is `EXCERPT_SECONDS` (25 s)
of the genome at the candidate's seed and `excerptOffset`. It calls `renderOffline` and
`normalize` directly, since `exportRender` writes export files, and checks its input with
`requireGenome` and the export's `requireFinite`. It is normalized to the vibe's loudness target, so both
sides of an A/B choice play equally loud: `vibeLoudness(constraints)` is the vibe's fixed
`loudness` constraint, or the schema's default of −16 LUFS ([0018](0018-default-loudness-target.md))
when it sets none. The genome's own `loudness` is not used: two genomes of one vibe could
differ. The ceiling is the genome's. 2e's render checks run on the raw render, and both feature
sets are measured.

**A render normalize can't lift.** Any throw from `normalize` is that candidate's failed check,
never the job's failure: the features get `heard: null`, the WAV holds the raw render with no
gain, and the job goes on. On silence and on gain above its 40 dB cap, which happen only under
the near-silence check's −50 LUFS floor, that check has already failed and says why. Any other
throw, such as a limiter that stops short of the target on a quiet, peaky render (the noise-bed
golden at −10 LUFS stops at −12.26), adds a finding with rule `normalize` (`NORMALIZE_FAILED`)
and normalize's message. Only a fault outside normalize, such as I/O, an invalid genome or a
non-finite sample, fails the job. A rated copy of such an excerpt records 0 dB of gain.

**The render cache.** WAVs sit flat in the render-cache folder, named
`<genomeId>-seed<seed>-<duration>s-<target>LUFS-<12 hex of SHA-256 of the producer>.wav`, so a
render under a new target or producer never overwrites a file a row still names. A WAV is
written into a temp folder beside it and renamed into place. The row's key is the window
(genome, seed, offset, duration) as 0021 says; a row is reused when its target and producer
match and its file exists. Otherwise the excerpt is rendered again, `putRender` replaces the row,
and the replaced row's file is deleted. A render id is never reused: migration
`0003-renders-autoincrement.sql` rebuilds `renders` with `AUTOINCREMENT`, since SQLite otherwise
gives the highest id back after a delete and a stale `/audio/:renderId` URL would serve another
render. The migration drops the rows, which are derived, so the WAVs cached before it stay in the
render-cache folder with no row, once; nothing reads or deletes them.

**The producer** is `engine-<ENGINE_VERSION> features-<SHA-256>`, the hash over each
`FEATURE_EXTRACTOR` file's path and contents in the list's order, each ended by a NUL. It is
computed once when `src/server/producer.js` loads, so it describes the code the server is
running. The engine version covers the render and the normalizer
([0009](0009-engine-version-golden-hashes.md)); the hash covers features and checks.

**Rated audio** (`captureRatedAudio(store, paths, renderId)`) encodes the cached WAV as a FLAC
in the rated-audio folder, named
`<genomeId>-seed<seed>-<duration>s-engine<version>-<target>LUFS.flac`, and adds a `rated_audio`
row with the heard identity, the target, the PCM hash `checkRatedAudio` checks, and the gain from
the heard features. A second call for the same identity returns the existing row, removed or
not, since the table holds one per identity. It refuses a render made under another producer:
the row would record this engine version for audio another one made. When the FLAC's name is
already taken, it reads the row again: a capture of the same excerpt running at the same time
linked first and wrote it, and that row is returned. A taken name with no row fails with its
path, since a rated file is never replaced.

**Cost**, measured on mbp2021 under `nice -n 10` at a load average of 2.7: rendering, checking,
normalizing, measuring and writing one excerpt took 1.04–1.09 s for the drone golden and
2.49–2.61 s for `example.json`; a cache hit took 0.2 ms; capturing rated audio took about 150 ms.

## Alternatives considered

- **Jobs side by side, or renders in a worker thread** — rejected for phase 2: the owner waits
  on one request at a time, and a worker would need the render and the features to cross a
  thread boundary as copies of 2.4 million samples. One at a time is also the simplest reading
  of AGENTS.md's single-request rule for omlx.
- **Excerpts through `exportRender`** — rejected: it writes a FLAC and a sidecar JSON next to
  each WAV, and refuses to overwrite, which a cache must do.
- **The genome's `loudness` as the target** — rejected: an A/B choice between genomes at
  different targets is won by the louder one.
- **Failing the job on a silent genome, or on any other normalize throw** — rejected: one odd
  candidate would cost the other seven their excerpts, and a failed check says what is wrong.
- **Naming cached files by render id** — rejected: the id is known only after the row is
  written.
- **Hashing the producer on every render** — rejected: it would hash edits the running server
  hasn't loaded, and reads about sixty files per excerpt.

## Consequences

- A generation and the renders of its candidates are one job (2i), so a session's next request
  for candidates waits behind the previous one's renders.
- Finished jobs stay in memory until the server stops; at a few hundred a session that is
  small, and a cap can come with the first sign it isn't.
- Editing any engine or feature file re-renders every cached excerpt on its next request; each
  takes one to three seconds.
- An audio URL for a replaced render stops resolving; the UI asks for the candidate's current
  excerpt again.
- Migration 0003 orphans the WAVs cached before it, once. They are derived and can be deleted
  by hand; nothing cleans the folder.
- A candidate with a `normalize` finding plays its raw render, at whatever level it rendered,
  so it won't match the other side of an A/B choice. The finding says so.

## Amendments

- 2026-11-06: from the step's review, before merge. Any normalize throw is a failed check, not a
  failed job; render ids are never reused (migration 0003); `list()` leaves out results; a
  capture that finds its name taken by a parallel capture returns that capture's row.
- 2026-11-06: progress is `{done, total, step}`; `step` is a sentence for the owner from
  `JOB_STEP`, or null between steps, and the runner sets it to null when a job finishes. A job
  reports `progress(done, total, step)`. The excerpt job says which excerpt it is rendering
  ([0031](0031-fewer-waits-after-first-evaluation.md)).
- 2026-11-07: from step 3d ([0036](0036-revision-pass.md)). After a first try's excerpt renders,
  the candidates job checks its features against its vibe's ranges and reads its render checks.
  A first try with a miss is revised once, and the revision's excerpt rendered, before the next
  first try. The job checks for a cancel after measuring and before the revision request. An
  unchanged revision isn't rendered.
- 2026-11-07: from step 4i ([0048](0048-quick-ab-player-mp3.md)). The render cache holds each
  excerpt as a 320 kbps constant-bit-rate MP3 from the `lame` CLI, named as above with `.mp3`,
  and no WAV. A row whose file is not an MP3 counts as not cached and is rendered again, its WAV
  deleted. `captureRatedAudio` no longer reads the cached file: it renders the row's window
  again (`renderHeardAgain`), checks that the gain and the render checks match the row, and
  encodes that PCM to the FLAC, so the rated file and its PCM hash are made from the exact
  normalized samples as before. A first capture now takes about as long as the render, 0.8 s
  for the drone golden and 2.3 s for `example.json`, instead of 150 ms.
- 2026-11-08: from step perf.1 ([0076](0076-parallel-excerpt-renders.md)). Jobs still run one at a time, but the excerpt job,
  and the search, steer, nudge and fill-control batches, render up to `RENDER_CONCURRENCY` (3)
  excerpts at once in the job's process, still with no worker thread. A cancel starts no more
  renders and waits for those in flight. A call for an excerpt that is rendering waits for that
  render and returns its row as cached, since a second `putRender` would replace the first
  caller's row.
