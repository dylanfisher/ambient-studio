# 0026. One job at a time, and excerpts cached by window, target and producer

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

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
Statuses are copies, and every job since start-up is kept in memory; a restart forgets them.

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

**A render normalize can't lift.** `normalize` throws on silence and on gain above its 40 dB
cap. Both happen only under the near-silence check's −50 LUFS floor, so when that check has
failed, the throw becomes `heard: null` in the features, the WAV holds the raw render with no
gain, and the job goes on. A normalize throw with that check passing is a fault, and fails the
job. A rated copy of such an excerpt records 0 dB of gain.

**The render cache.** WAVs sit flat in the render-cache folder, named
`<genomeId>-seed<seed>-<duration>s-<target>LUFS-<12 hex of SHA-256 of the producer>.wav`, so a
render under a new target or producer never overwrites a file a row still names. A WAV is
written into a temp folder beside it and renamed into place. The row's key is the window
(genome, seed, offset, duration) as 0021 says; a row is reused when its target and producer
match and its file exists. Otherwise the excerpt is rendered again, `putRender` replaces the row,
and the replaced row's file is deleted.

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
the row would record this engine version for audio another one made. A FLAC already at the name
with no row fails with its path, since a rated file is never replaced.

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
- **Failing the job on a silent genome** — rejected: one quiet candidate would cost the other
  seven their excerpts, and the near-silence check already says what is wrong.
- **Naming cached files by render id** — rejected: the id is known only after the row is
  written, and SQLite gives a replaced row's id back to the next insert.
- **Hashing the producer on every render** — rejected: it would hash edits the running server
  hasn't loaded, and reads about sixty files per excerpt.

## Consequences

- A generation and the renders of its candidates are one job (2i), so a session's next request
  for candidates waits behind the previous one's renders.
- Finished jobs stay in memory until the server stops; at a few hundred a session that is
  small, and a cap can come with the first sign it isn't.
- Editing any engine or feature file re-renders every cached excerpt on its next request; each
  takes one to three seconds.
- SQLite reuses the id of a deleted row when it was the highest, so a replaced render's new row
  can get its old id. An audio URL for the stale render then serves the new one, which is the
  same window under the current producer.
