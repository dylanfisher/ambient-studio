# 0035. Locks: paths and values, kept per vibe, applied to every answer

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0005](0005-genome-schema-table.md) (lock paths beyond the vector view),
  [0006](0006-macros-bounded-offsets.md) (settles whether a locked value follows the macros),
  [0021](0021-store-tables-and-append-only.md) (the `locks` table, migration 0004) and
  [0024](0024-prompt-parse-repair-generation.md) (the lock shape, its prompt line, and locks
  applied to answers).

## Context

Phase 3 lets the owner keep a value they like while the model, explore and nudge change the
rest. 0024 gave a lock as `{path, value}` with the vector view's paths and wrote each into the
prompt under "Locked by the owner", but nothing set a lock or held an answer to one: both jobs
passed none. The vector view (0005) covers numbers and ints only, while the owner also wants to
keep a scale, a voice's waveform, a whole trajectory or a whole voice. 0006 left open whether a
locked raw value still follows the macros. Acceptance 3 of phase 3 asks that every locked value
in every stored child equals the locked value, across answers, explore and nudge.

## Decision

**Lock paths and values.** A lock is `{path, value, voiceType?}` (`Lock` in
`src/domain/validate-lock.js`). The path names a global parameter (`reverbDecay`, `scale`), a
macro (`macros.space`), a voice's parameter of any kind (`voices.pad.hold`, `voices.air.color`,
`voices.drone.cutoff`) or a whole voice (`voices.pad`). A trajectory is locked whole, so no path
ends in `.start` or `.end`. The value is taken from the candidate the owner locked it on, as
canonical JSON: a trajectory with every curve written out, a voice with every default.
`voiceType` is the voice's type, given exactly when the path is a voice's parameter, because a
voice whose type changed has other parameters and the lock no longer fits it. `lockOn(genome,
path)` takes a lock from a candidate's genome; `validateLock(lock, genome)` checks one against
it, by writing the value into a copy of the genome and running the validator, so a voice, a
trajectory and a parameter that exists only beside another (`key`) get every check the genome
does. It refuses an unknown parameter, a voice id the candidate lacks, a value its descriptor
doesn't allow, and a whole voice under another id.

**Locks per vibe.** A lock belongs to a vibe and stays until the owner removes it: a `locks`
table (migration 0004) with the vibe, the candidate the value came from, the path, the value as
JSON and `voiceType`, irreplaceable under 0021's triggers. A partial unique index keeps one live
lock per path in a vibe. The session's candidates job passes the vibe's live locks
(`locksInForce`) to `generateCandidates`; the evaluation passes none, so a lock the owner set on
a seed vibe never changes what the evaluation measures. Each candidate stores the locks in force.

**Applying rather than rejecting.** `applyLocks(genome, locks, written)` writes each locked value
into an answer after validation has filled it out, then validates the result. The answer keeps
everything else the model wrote. Rejecting an answer that moved a locked value would cost a
request and throw away the model's other ideas for one value that is known in advance.

**Changed against filled.** `applyLocks` lists a lock path as `changed` when the answer held
another value there, and as `filled` when the answer as written (`written`) left it out, a
dropped voice included: the model omitting a value is not the model going against the lock. A
nudge passes no `written`, so nothing it makes counts as filled. A valid candidate made with
locks stores both lists in `operatorParams` as `locksChanged` and `locksFilled`; with no lock in
force, `operatorParams` stays null.

**What applying can't fix.** A lock on a parameter of a voice the answer dropped, or of a voice
whose type changed, and locks that leave the genome invalid (a locked fade longer than the
answer's duration) are lint findings with rule `lock` (`LOCK_RULE`). The answer is then rejected
as `lintErrors`, gets 0024's repair round with each finding quoted, and the locks are applied to
the repair's answer in turn. `applyLocks` applies every lock or none: with findings it returns
the genome as given.

**Overlapping locks.** Two live locks never hold one value. Locking a path that has a live lock
marks the old row removed as `replaced`. Locking a whole voice marks the live locks inside it
removed as `covered`. Locking a path inside a voice locked whole is refused (a 409): the owner
unlocks the voice first. A lock removed by the owner is marked `unlocked`; its row stays, and the
next prompt no longer has it.

**Locks and macros.** By the owner's choice on 2026-11-06, a locked raw value still follows the
macros: the lock fixes the raw value, and the macros still offset it as 0006 says. Locking a
macro is the way to hold what one moves, so the lock route answers with `macrosMoving(path,
genome)`, the macros whose rows move the locked value (every macro a voice type's rows name, for
a whole voice), and the lock control offers to lock them too.

**For nudges and optimizers.** `lockedPaths(locks, genome)` gives the vector paths of the genome,
locks applied, that the locks cover: a whole trajectory covers its `.start` and `.end`, a number
locked over a parameter the genome holds as a trajectory covers the plain path it becomes, and a
whole voice covers every numeric path of the voice. Choices, flags and recordings have no vector
path and are held by `applyLocks` alone. It throws when the genome can't take the locks.

**Routes.**

| Route | Body | Answer |
|---|---|---|
| `GET /api/vibes/:vibeId/locks` | none | `{locks}`, the live rows, oldest first |
| `POST /api/vibes/:vibeId/locks` | `{candidateId, path}` | `{lock, removed, macros}`: the new row, the rows it replaced or covered, and the macros that move the value |
| `POST /api/vibes/:vibeId/locks/:lockId/remove` | `{}` | the row, marked `unlocked`; one already removed comes back as it is |

A malformed body is a 400 naming the field, as 0027's routes do: an unknown field, a path that
isn't a non-empty string, a candidate id that isn't a row id, a candidate that doesn't exist, has
no genome or belongs to another vibe, and every `validateLock` refusal. An unknown vibe, or a lock
of another vibe, is a 404.

**The prompt line.** Each lock is `path = <value as JSON>`, and a voice's parameter adds the
voice's type: `voices.pad.hold = 30 (a pad voice)`. A whole voice costs 56 to 80 tokens for the
example genome's voices; a seed-sized vibe with every voice of the example locked whole, three
other locks and six examples stays under half the 8,192-token budget, as 0024 requires.

## Alternatives considered

- **Reject an answer that changes a locked value** — rejected: it costs a request, sends a repair
  for a value known in advance, and loses the model's other ideas.
- **Lock the effective value** — rejected by the owner: a lock that pinned the value the engine
  plays would need a genome field the engine reads, which changes `genomeHash` and the schema
  text.
- **Paths only from the vector view** — rejected: it can't name a scale, a waveform or a whole
  voice, which the owner wants to keep as much as a number.
- **Locks per session, or per candidate** — rejected: a lock is a statement about the vibe, and
  re-locking at each session would be work the owner repeats.
- **Telling a retyped voice from its parameters alone** — rejected: a voice turned from a pad
  into a noise bed still has `tone` and `level`, so the lock would apply to a voice it was never
  set on. `voiceType` in the lock names what it was set on.
- **Several live locks on one value, the newest winning** — rejected: the list the owner reads
  would show values that no longer hold.

## Consequences

- A genome stored from an answer holds every live lock's value, by construction rather than by
  the model's compliance; the scripted-answer tests prove it.
- 3e calls `applyLocks` on each nudged or explored genome and draws over `vectorPaths` less
  `lockedPaths`. 3g builds the lock control on the routes and `macros`.
- A lock taken on one candidate may not fit an answer that drops its voice; that answer then
  spends its repair round on the lock.
- A lock on a parameter the macros move still sounds different when the macros change, as the
  owner settled; the lock control's offer is the remedy.
