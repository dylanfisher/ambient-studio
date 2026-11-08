# 0021. The SQLite store: SQL migrations, append-only triggers, and the backup

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm; amended by [0035](0035-locks.md) (the
  `locks` table), [0037](0037-nudge-and-branch.md) (`candidates.sessionId`) and
  [0050](0050-reference-uploads.md) (the reference tables, and `references/` in the backup)
  and [0061](0061-tracks-and-the-timeline.md) (the track tables)

## Context

Phase 2 stores the owner's vibes, notes, sessions, every LLM call, genomes, candidates, the
excerpts they heard and their ratings, and a cache of renders. AGENTS.md splits data into two
kinds: irreplaceable data is append-only (mark rows removed, never delete, and a shape change
ships with a migration), and derived data has one shape and is discarded and rebuilt when it
doesn't match. The owner settled on 2026-11-06 that a derived row may carry an opaque `producer`
key: a cache key, not a schema version. Step 2c of the plan lists the tables and what each
holds; later steps (2f, 2h, 2i, 2l) write them.

## Decision

**Open.** `openStore(file, {now})` in `src/server/store.js` opens `node:sqlite`'s `DatabaseSync`
with `journal_mode = WAL`, `foreign_keys = ON`, `recursive_triggers = ON` and a 5 s busy
timeout (`BUSY_TIMEOUT_MS`, also on the backup's connection), so a second process waits for a
write lock instead of failing at once, and applies the migrations the database hasn't had.
Switching a new file to WAL is the one step SQLite fails at once, without the timeout, when
another connection is switching it too; `useWal` then takes and releases the write lock, which
waits for the other connection, and tries again, up to 3 times. `now` is the clock for `createdAt`, `removedAt` and the
migration log, in milliseconds since the Unix epoch; tests pass a counting clock
(`test/support/temp-store.js`).

**Migrations are SQL files**, `src/server/migrations/NNNN-slug.sql`, numbered 1, 2, 3… with no
gaps, applied in order, each in its own `BEGIN IMMEDIATE` transaction and recorded in a
`migrations` table (`id`, `name`, `sha256` of the file's text, `appliedAt`). The applied list is
read inside that transaction, so two processes opening a new database at once apply each
migration once. A failed migration rolls back and throws its name. A database that has applied a
migration this code doesn't have, or one under another name, is refused: it was written by a
newer version. An applied migration is never edited, and open enforces it: a file whose SHA-256
differs from the one recorded when it was applied is refused, naming the file and both hashes,
since an edit would leave old and new databases with different shapes under one number. A
change is a new file. Every later shape change to an irreplaceable table ships as a migration with a
test that runs it over the previous shape (`openStore`'s `migrations` option takes a shorter
list for that).

**Append-only triggers are generated, not written by hand.** In each migration's transaction the
store drops every table's append-only triggers, runs the SQL, then creates them again from each
table's columns as they are now: `<table>_no_delete` raises on any `DELETE`, and
`<table>_no_update` raises unless the update sets `removedAt` and `removedReason` on a row whose
`removedAt` is null and changes no other column (compared with `IS NOT`, so null counts).
Setting `removedAt` back to null raises too.
Dropping them first lets a migration rewrite rows; recreating them from the live schema covers a
column a migration adds. Every table except `migrations` and the derived ones listed in
`NOT_APPEND_ONLY` (`renders` and `embeddings`) is irreplaceable, and must have `removedAt` and
`removedReason`, or the migration fails. `recursive_triggers` is on because without it
`INSERT OR REPLACE` deletes the row it replaces without firing the delete trigger.
`markRemoved(store, table, id, reason)` is the one way to remove a row.

**Tables** (`0001-initial.sql`). Table names are snake_case, columns camelCase so a row is the JS
object. Tables are `STRICT`; JSON columns are TEXT checked with `json_valid`; booleans are 0 or 1.
Every table name is defined once, in `TABLE` in store.js.

| Table | Holds |
|---|---|
| `vibes` | identity only; everything the owner edits is a revision |
| `vibe_revisions` | name, brief, constraints, softTargets; one row per edit, the newest current |
| `notes` | the owner's notes on a vibe |
| `session_events` | `start` and `stop` rows; a session's id is its start row's, and a stop names it in `sessionId` (unique, so a session stops once) |
| `generations` | revision, session (null outside one), `requestGroup`, exact prompt, example ids and retrieval method, model, sampling, raw response, `finishReason`, `repairRound` and `repairsId` (null exactly in round 0), latency, time to first token, token counts (null when omlx doesn't report them) |
| `genomes` | the canonical genome and `genomeHash` (0005), unique per vibe; `putGenome` returns the existing row when the vibe has reached it before |
| `candidates` | revision, generation, genome (null when the output never parsed), seed, source, parent ids, locks, operator and its parameters, intent, `rejectReason` (null when valid), the lint result |
| `rated_audio` | genome, seed, offset, duration, engine version, loudness target (unique together), `file` relative to the rated-audio folder, `pcmSha256`, `gainDb` |
| `ratings` | session, revision, both sides (`a…` and `b…` columns: genome, seed, offset, duration, engine version, rated-audio id, played fraction, and rank, score, model version and wildcard, null in phase 2), `leftSide`, `orderSeed`, `outcome` (`a`, `b`, `tie`, `skip`), `timeTakenMs` |
| `feedback` | the same heard identity and measurements, `kind` `thumbs` (direction `up`/`down`, optional note) or `macro` (direction `more`/`less`, the macro's name and its effective value over the heard window as JSON), enforced by a CHECK |
| `sketches` | candidate, notes, tags |
| `evaluations` | parameters and report, one row when the job finishes |
| `renders` (derived) | genome, seed, offset, duration (unique together), target, `producer`, `file` relative to the render cache, features, checks |

**Renders.** `findRender(store, key)` returns the row for the window only when its `target` and
`producer` equal the caller's. `putRender` deletes any row for the window and inserts the new one
in one transaction, and returns the replaced row so the caller can delete its file. The new row
gets a new id, higher than any before it: `renders.id` is `AUTOINCREMENT` (migration 0003), since
SQLite otherwise gives the highest id back after a delete. The store never parses `producer`.

**Store functions** take and return plain objects with JSDoc types. One file per table group, each
named for it: `vibe-store.js` (vibes, revisions, notes), `session-store.js`,
`generation-store.js` (generations, genomes, candidates), `rating-store.js` (rated audio,
ratings, feedback, sketches), `render-store.js`, `evaluation-store.js`. They share `insertRow`,
`selectRow` and `selectRows` from store.js, with a codec naming each table's JSON and boolean
columns. `insertRow` sets `createdAt`; an unknown key fails as an unknown column, and an
`undefined` value throws rather than being stored as null. SQL lives only in these files, store.js
and the migrations. `addRating` (each side) and `addFeedback` throw unless the `rated_audio` row
they name has the same genome, seed, offset, duration and engine version as the identity written
beside it, so the two copies of what was heard can't disagree.

**PCM hash.** A rated excerpt's `pcmSha256` is `sha256Hex` of its interleaved 24-bit
little-endian PCM, the same bytes an export's `pcmSha256` covers (0015).
`readFlacPcm(path)` decodes a FLAC to those bytes with `flac -d --force-raw-format`.
A test checks that a real 3 s export's FLAC hashes this way to the export's own `pcmSha256`.
`checkRatedAudio(store, folder)` checks every `rated_audio` row, removed ones included, and throws
listing each file that is missing, sits outside the folder, fails to decode, or hashes
differently.

**Backup.** `./scripts/backup` (`src/server/backup-cli.js`) loads the config, makes
`<backups>/<UTC time to the second>/` (for example `2026-11-06T21-04-05Z`, no colons), writes
`studio.db` there with `VACUUM INTO` from a read-only connection, and copies the `rated_audio`
folder beside it (an empty folder when nothing has been rated yet). It then runs
`checkRatedAudio` on the copy, so a passing run proves the backup itself is whole; on a failure
the backup stays written and the command exits non-zero. A second backup in the same second is
refused. The read-only connection neither migrates the source nor waits on its writers, and
`VACUUM INTO` copies committed rows still in the WAL.

## Alternatives considered

- **JS migration modules** — rejected for now: every phase 2 change is plain DDL, and SQL files
  read as the schema. If a migration ever needs JS, add `.js` support to `readMigrations` then.
- **Hand-written triggers in each migration** — rejected: each `no_update` trigger lists every
  column, so a column added later without editing the trigger would be silently mutable.
- **A `sessions` row with an `endedAt` column** — rejected: setting it is an update, which the
  append-only rule refuses.
- **Renders keyed on the target and producer too, keeping one row per pair** — rejected: the
  plan wants a mismatch replaced, and keeping stale rows would leave stale files.
- **One `store.js` for every table** — rejected: phase 2 alone adds about a dozen functions per
  group and later steps add theirs, so one file would grow past a thousand lines.
- **`DatabaseSync.backup()` (the online backup API)** — rejected: the plan names `VACUUM INTO`,
  which also writes a compacted file in one statement.

## Consequences

- A table added later without `removedAt` and `removedReason`, and not listed as derived, fails
  its migration at open. `test/server/store.test.js` checks every irreplaceable table has both
  triggers, gets a row from `fillStore`, and refuses `DELETE` and an update of each column, and
  that a column a later migration adds is covered.
- Table rebuilds in SQLite (to change a CHECK or drop a column) need `foreign_keys` off, which
  can't change inside a transaction; the first migration that needs one adds that to the runner.
- `source` and `rejectReason` are free text, so 2f and later steps add values without a
  migration. `source`'s JSDoc lists its values; 2f defines the reject reasons.
- A render's id is never reused, so an audio URL for a replaced render stops resolving rather
  than serving other audio.

## Amendments

- 2026-11-06: `0002-generation-capture.sql` (step 2f, [0024](0024-prompt-parse-repair-generation.md))
  adds `reasoning`, `requestParams`, `retries` and `error` to `generations` (an error only with
  `finishReason` `error`) and `rejectedGenome` to `candidates`, all null on earlier rows. A test
  in `generation-store.test.js` runs it over a database built with 0001 alone.
- 2026-11-06: from step 2h ([0026](0026-job-runner-and-excerpt-renders.md)). A test found
  SQLite giving a replaced render's id back to the next insert, though the Renders paragraph said
  the new row gets a new id. `0003-renders-autoincrement.sql` drops `renders` and creates it
  again with `id INTEGER PRIMARY KEY AUTOINCREMENT`, so an id is never reused and a stale audio
  URL can't serve another render. The rows are derived and are not copied; the WAVs they named
  stay in the render cache with no row, once. A test in `render-store.test.js` runs it over a
  database built with 0001 and 0002. `findRatedAudio(store, heard)` finds the rated-audio row for
  a heard identity and target.
- 2026-11-07: from step 3c ([0035](0035-locks.md)). `0004-locks.sql` adds `locks`, an
  irreplaceable table of a vibe's locks: the vibe, the candidate the value came from, the path,
  the value as JSON, and the voice's type exactly when the path is a voice's parameter (a CHECK).
  A partial unique index on `(vibeId, path) WHERE removedAt IS NULL` keeps one live lock per
  path. `lock-store.js` holds its functions. A lock is removed as `unlocked`, `replaced` by a new
  lock on its path, or `covered` by a lock on its whole voice, the way 0031 marks feedback
  `replaced` and `undone`. A test in `lock-store.test.js` runs 0004 over a database built with
  0001 to 0003.
- 2026-11-07: from step 3e ([0037](0037-nudge-and-branch.md)). `0005-candidate-session.sql` adds `candidates.sessionId`,
  the session a candidate was made in, null outside one. The migration fills existing rows from
  their generation's `sessionId` before the triggers are made again, so evaluation candidates and
  rows with no generation stay null and the column is append-only like the rest. An index on it
  serves `listSessionCandidates`. A test in `generation-store.test.js` runs it over a database
  built with 0001 to 0004.
- 2026-11-07: from step 4b ([0042](0042-clap-embeddings.md)). `0006-embeddings.sql` adds
  `embeddings`, a derived table listed in `NOT_APPEND_ONLY`: one row per rated audio or render
  (a CHECK holds exactly one), its `producer`, and the vector as a BLOB of little-endian
  float32. A render's row is deleted with its render (`ON DELETE CASCADE`), since `putRender`
  deletes the replaced row. `embedding-store.js` holds its functions.
- 2026-11-07: from step 5a ([0050](0050-reference-uploads.md)). `0008-references.sql` adds
  `reference_files` and `reference_regions`, both irreplaceable. A partial unique index on
  `reference_files (sha256) WHERE removedAt IS NULL` keeps one live row per file's bytes. A
  region is removed as `removed`, `replaced` by a successor naming it in `replacesId`, or
  `file removed` when its file is. `reference-store.js` holds their functions. The backup also
  copies the `references` folder beside `rated_audio`, an empty folder when nothing has been
  uploaded. A test in `reference-store.test.js` runs 0008 over a database built with 0001 to
  0007.
- 2026-11-07: from step 6b ([0061](0061-tracks-and-the-timeline.md)). `0011-tracks.sql` adds
  `tracks`, `track_revisions` and `track_exports`, all irreplaceable. A track is its vibe and
  name; each save of its arrangement appends a revision, the newest current, as `vibe_revisions`
  does; an export row logs a folder written from one revision, `mix` or `stems` (a CHECK), with
  its manifest's SHA-256. Removing a track marks it `removed` and keeps its revisions and
  exports. `track-store.js` holds their functions. A test in `track-store.test.js` runs 0011
  over a database built with 0001 to 0010.
