# 0037. Nudge and branch: seeded steps in the vector view, a session on every candidate

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0005](0005-genome-schema-table.md) (`fromVectorUnchecked`),
  [0021](0021-store-tables-and-append-only.md) (`candidates.sessionId`, migration 0005),
  [0027](0027-session-api-and-ratings.md) (the nudge route, and how a session's candidates are
  found) and [0031](0031-fewer-waits-after-first-evaluation.md) (the nudge's row in the
  conflict table and its progress step). Amended by [0053](0053-search-space-ask-tell.md)
  (the draw's chain and the free-path rule moved out of `nudge`) and [0076](0076-parallel-excerpt-renders.md) (children render
  three at a time).

## Context

Phase 3 lets the owner move around a candidate they like. Explore (3f) asks the model for
variations; nudge makes them with no model request, which costs no omlx time and tests the
locks ([0035](0035-locks.md)) most directly, since nothing but the code decides what moves. The
owner settled on 2026-11-06 that nudge belongs in phase 3 beside explore, and phase 5's
optimizers build on its draws. Acceptance 3 asks that every locked value in every stored child
equal its lock, over 1,000 seeded nudges.

Until now a session's candidates were found through their generation's `sessionId`
(`listSessionCandidates` joined `generations`), so a candidate made without a model request
could not be found at all. Branching, working from a candidate of an earlier session, needs the
candidate's own session too.

## Decision

**`sessionId` on candidates.** Migration `0005-candidate-session.sql` adds
`candidates.sessionId` (null outside a session, as in an evaluation) and fills existing rows
from their generation's session; a row with no generation stays null. The append-only triggers
are made again after the file, so the column can't be changed once written. `keep` writes it
from the batch, and `listSessionCandidates` reads it, so nudge children appear in their
session's list like any other candidate.

**Branching is working from any node.** A nudge (and an explore, 3f) names a base candidate of
the session's vibe, made in any session. The children belong to the session the request was
sent to. There is no branch object: the owner goes back to an old branch by working from one of
its nodes, and the lineage page (3g) draws the tree from `parentIds`.

**The nudge** (`src/domain/nudge.js`, operator `nudge`, source `mutation`) makes N children of
a base, 8 by default and at most 32:

1. The vibe's live locks are applied to the base first, since the base may predate a lock. A
   base that can't take them (a lock on a voice it lacks) is refused: a 409 at the route,
   `candidate 12 can't take the vibe's locks: …`, and a failed job if the locks changed after.
2. The free paths are the base's vector paths ([0005](0005-genome-schema-table.md)), macros
   included, less those `lockedPaths` covers and those the vibe's constraints fix to one value
   (`key` and `loudness` when the vibe sets them). A fixed value has one right answer, so any
   move there could only fail the linter. On the cold-dorian seed with the test's three locks,
   every one of 3,168 draws failed `loudness` when they moved; held, about 1 in 13 fails at the
   small step.
3. Each free path's position moves by a normal step and is clipped to [0, 1]. The step's
   standard deviation is the step size: **small 0.05, medium 0.12, large 0.25** of the
   parameter's scale. The moved vector is decoded as `fromVector` does, then validated, the
   locks applied, and linted against the vibe's current constraints.
4. Choices, flags and recordings have no vector path, so a nudge never changes them; a child
   differs from its base only in numbers.

**Seeds.** The job draws a nudge seed in [0, 2³²) from the app's `random` when it starts. Draw
`d` of child `c` takes its steps from `drawer(seed, ":nudge:<baseId>:<stepSize>")`
([0003](0003-counter-based-prng.md)), at event index `c × 4 + d` and slots `2i` and `2i + 1`
for free path `i`, turned into a normal value by Box–Muller. The key starts with `:`, which no
voice id can, so it never meets a render's draws. The same base, step size, seed, locks and
constraints give the same children. Each child keeps the **base's render seed**, so it differs
from its base only in its genome, and an A/B of base and child compares genomes alone.

**Failed draws.** A draw is rejected when the schema refuses it (`schemaErrors`, as fades
longer than a shortened timeline), the linter refuses it (`lintErrors`), or it lands on the
base's genome, the base's with the locks applied, or an earlier sibling's (`repeated`, a new
reject reason, as when an int rounds back). A rejected draw is stored as a rejected candidate
with its findings and the genome as drawn in `rejectedGenome`, and the child is drawn again, at
most 4 draws a child. A child whose 4 draws all fail is listed in the job result's
`failedChildren` as `{child, findings}`, with its last draw's findings, and has no excerpt. So
no unlinted or repeated genome is rendered or shown.

**A base that breaks a value the vibe fixes** (made under an earlier revision, before the vibe
fixed `key` to another value, say) can't be nudged into a child: the nudge holds the fixed value
at the base's, so every draw fails on it. The job still stores the draws and gives each failed
child's findings, such as `$.key: must be 5, which the vibe fixes; got 2`, so the owner sees why
and can work from a candidate made under the current brief. Writing the vibe's value into the
child was rejected: a new key or loudness changes the whole sound, which isn't a nudge.

Measured over the acceptance test's 1,000 nudges (cold-dorian seed genome and constraints,
locks on `macros.brightness`, `voices.drone.cutoff` and `voices.pad`, 8 children each, the step
sizes in turn):

| Step | Draws | Rejected | Redraws a child | Children given up |
|---|---|---|---|---|
| small | 2,888 | 217 (7.5%) | 0.08 | 1 of 2,672 |
| medium | 3,608 | 960 (26.6%) | 0.35 | 16 of 2,664 |
| large | 4,274 | 1,670 (39.1%) | 0.60 | 60 of 2,664 |

Almost every rejection is the vibe's duration range: the base sits at 360 s, near the 300 s
floor. At the large step 103 draws were refused by the schema and 164 lint findings were
`excerptLength`. None repeated: the free paths include continuous numbers.

**Children aren't revised.** Their excerpts render and their features are measured and shown,
but the revision pass (0036) needs a conversation to follow up, and a nudge child has none.

**The job and route.** `POST /api/sessions/:sessionId/nudges` takes
`{candidateId, stepSize, count?}`: `stepSize` one of `small`, `medium`, `large`, `count` 1 to
32, default 8. A malformed body is a 400 naming the field; a candidate that doesn't exist, was
removed, has no genome, or belongs to another vibe is a 400, as for a lock's candidate; a
stopped session is a 409. It returns the job's
status, `kind: "nudge"`. The job reads the vibe's current revision and live locks when it
starts, stores each child's draws, renders the child's excerpt, and goes on. Its `result` is
`{seed, candidateIds, excerpts: [{candidateId, renderId}], failedChildren: [{child, findings}]}`, `candidateIds`
holding every draw stored, rejected ones included. Children store the base in `parentIds`, the
locks in force in `locks`, and `{stepSize, seed}` in `operatorParams`, beside the lock paths
restored when a lock is in force, as an answer's are (always empty for a nudge: the free paths
leave the locks alone).

**One job per action.** A nudge identical to one queued or running in the same session (same
base, step size and count) is a 409 `{error, jobId}`. Any other nudge queues, as does a nudge
while a candidates job runs: the runner runs one job at a time. The route keeps each job's
action beside its id, so explore (3f) adds its row the same way with its own action string.

**Progress.** `done` of `total` counts children: one is done once its draws are stored and,
when one passed, its excerpt rendered. The step is "Rendering the excerpt for nudge 3 of 8";
drawing takes milliseconds and has no step.

## Alternatives considered

- **Finding a session's candidates through their generations, with nudge children through
  their parent** — rejected: a child of a base in an earlier session would be found in the wrong
  session, and the join would grow with each operator.
- **A branch table** — rejected: the tree is already in `parentIds`, and a branch the owner
  never named would need a name and a way to close it.
- **Nudging every vector path, the vibe's fixed values included** — rejected: a continuous
  `loudness` moved never equals the vibe's value, so on a seed vibe no draw passed.
- **Clipping a range constraint (duration, brightness) into its range instead of redrawing** —
  rejected for now: it piles children at the range's edge, and the redraw already handles it at
  the small step. Worth revisiting if the owner hears too many children given up at large.
- **A uniform step** — rejected: a normal step makes most moves small with an occasional larger
  one, which is what phase 5's optimizers expect of a mutation.
- **A new render seed per child** — rejected: the child would then differ in its events too, and
  "nudge" would no longer mean "the same, a little moved".
- **Revising nudge children** — rejected: there is no first prompt to follow up, and a fresh
  prompt is explore's job.
- **Refusing every nudge while one runs** — rejected: nudging two bases, or one base at two step
  sizes, is two actions, and the runner queues them.

## Consequences

- Nudge costs no omlx time; each child costs one excerpt render, a few seconds.
- A rejected draw is a rejected candidate, so the session page's rejected list counts nudge
  draws beside model answers until 3g labels them. A nudge child has no intent, and the page
  currently shows "The model gave no intent." on its card; 3g's card shows the operator.
- A nudge child has no `pair` and is never folded: `candidatePairs` (0036) pairs only `revise`
  candidates. The revision pass's over-budget skip, which has no generation, is now listed in
  its session through `sessionId` and folded as an unchanged revision.
- Children of one base share its render seed, so two children can be compared by A/B as
  genomes alone; a child and a different first try cannot.
- Phase 5's optimizers take the free-path rule from `searchPaths` and the draw's chain from
  `proposeGenome` (0053), and the step sizes from `nudge.js`.
- A recording a base names that has since left the recordings folder fails the child's render,
  and with it the job, as for any candidate.

## Amendments

- 2026-11-07: from step 5d ([0053](0053-search-space-ask-tell.md)). The free-path rule (step 2)
  is `searchPaths` in `src/domain/search-paths.js`, and the chain a draw runs (decode, validate,
  lock, repeat check, lint) is `proposeGenome` in `src/domain/propose-genome.js`. `nudge` calls
  both; its draws, seeds and stored rows are unchanged.
- 2026-11-08: from step perf.1 ([0076](0076-parallel-excerpt-renders.md)). The job renders up to three children at once. Each
  child's draws are still stored in the children's order. Progress reports after each child
  finishes, with the step for the next: "Rendering the excerpt for nudge 2 of 8" at 1 done.
