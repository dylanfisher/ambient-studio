# 0053. Search space, proposals, ask/tell and the objective

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0037](0037-nudge-and-branch.md) (the nudge's chain and free-path rule move out of `nudge`)
  and [0041](0041-sidecar-process.md) (the optimizer methods and run folders). Amended by
  [0055](0055-search-by-ear.md) (a null score, and copies of a run) and
  [0056](0056-directions-sliders-reference-target.md) (`searchScore` takes a steer's terms)

## Context

Phase 5's optimizers (5e's CMA-ES, 5f's preferential BO, 5h's archive emitter, breeding's
mutation) all search inside one base's structure through the vector view
([0005](0005-genome-schema-table.md)), and acceptance 3 asks of each what 0037 asked of the
nudge: no locked value moves, and no genome the linter rejects is rendered or shown. The nudge
held the steps that make that true inside `nudge`, so each optimizer would have copied them. The
optimizers run in the Python sidecar, whose protocol passes only strings, numbers, booleans and
paths ([0041](0041-sidecar-process.md)), and a model-in-the-loop run lasts hundreds of
evaluations, longer than one sidecar process may live: a cancel or a timeout on another request
kills it.

## Decision

**The moved chain.** `proposeGenome(start, paths, vector, {locks, constraints, seen})` in
`src/domain/propose-genome.js` turns one point into a proposal: `fromVectorUnchecked`,
`validateGenome`, `applyLocks`, a repeat check against `seen` on `canonicalGenome`, then
`lintGenome`. A failed step gives a rejected proposal with its reason, findings and the genome
as written. `searchPaths(genome, locks, constraints, chosen)` in `src/domain/search-paths.js`
gives the paths of `chosen` that no lock covers and the vibe doesn't fix. `nudge` calls both, so
its draws are unchanged (the commit that moved them changed no test). Every optimizer and the
emitter call the same two.

**The space** (`searchSpace` in `src/domain/search-space.js`) is the macros `searchPaths`
leaves free, then the raw paths the owner chose, each group in the vector view's order. The
owner picks raw paths from `searchPaths` on the job form; none by default. A chosen path that is
locked, fixed by the vibe, not a number of the genome, a macro, or chosen twice is refused, as
is a space over **24 dimensions** (`MAX_SEARCH_DIMENSIONS`), the plan's cap: past it a budget of
a few hundred evaluations is only a few per dimension. Positions are the vector view's, so the optimizer works in [0, 1]^d and
the base's vector is its start.

**The protocol.** Three methods, each with its arrays as JSON files in the run's folder,
`<dataRoot>/search/<run>/`:

| Method | Params | Result | Files |
|---|---|---|---|
| `optimizer_start` | `spec` | `dimension` | reads `spec.json`; writes `state.json` |
| `optimizer_ask` | `run`, `count`, `out` | `count` | writes `{points}` to `out` (`ask-<g>.json`) |
| `optimizer_tell` | `run`, `points`, `scores` | `generations` | reads `ask-<g>.json` and `{scores}` from `tell-<g>.json` |

`run` is the folder's absolute path, a `path` param, so a fresh process finds the run with no
memory of it. A run's name is letters, digits and dashes, so it can't leave the search folder.
The spec is `{optimizer, start, seed, settings}`: the optimizer's name in the sidecar's
`OPTIMIZERS`, the start position, a seed, and the optimizer's own settings. Points are in
[0, 1]^d, checked on both sides; higher scores are better. Node decodes, lints, stores, renders,
embeds and scores; Python only proposes.

**State files.** The sidecar writes `state.json` after every ask and every tell, through a
temporary file and a rename, so a process killed mid-write leaves the last whole state. It holds
the optimizer's own state (JSON its class writes and reads back), the points asked and not yet
told, and the generations told. A sidecar started again reads the run where the last one left
it: pytest stops one process after an ask and has a second take the tell and ask on. A start on
a run that has a state, an ask while points wait for scores, and a tell of other points than the
last ask gave are refused. A refused tell leaves the state as it was.

**Failures.** Any sidecar error fails the caller (the job) with the sidecar's message, and
nothing is retried, as 0041 says of every request. The run's files stay, so the owner sees the
last generation reached.

**The optimizer interface** (`ambient_sidecar/optimizer.py`): a class with `ask(count)`,
`tell(points, scores)` and `state()`, made from the spec and its saved state, or none for a new
run. 5d registers `scripted`, which answers the points its settings list and keeps the best
told, for tests. 5e adds CMA-ES (`cma`, approved by the owner) under the same interface.

**Rejected points** are stored as rejected candidates with their findings and the genome as
written, never rendered. `searchGeneration` (`src/server/search-run.js`) asks, proposes each
point, stores every one with `keep` (its origin's `operatorParams` plus `generation` and
`point`), hands only the points that passed to the caller's `evaluate`, and tells. A rejected
point is told the generation's worst valid score less the valid scores' **population** standard
deviation, or **−1** when no point is valid (`penalizedScores`). The population form gives a
value with one valid point: the penalty is then that point's score, a tie with it. A valid point
is added to `seen`, so a later point landing on the same genome is a repeat.

**The Node helper is one generation.** `startSearch` makes the folder and starts the run;
`searchGeneration` runs one ask/tell round. 5e's job loops over generations, decides the budget,
the population and the cancel, and passes an `evaluate` that renders, embeds and predicts. A
whole-run loop here would fix choices that are 5e's.

**The objective** (`searchScore` in `src/domain/search-score.js`) is 4d's posterior mean less
κ standard deviations, **κ = 1** (`SEARCH_KAPPA`): a lower bound, which keeps the search where
the model has evidence rather than where it is unsure. 5g adds terms.

**Macro feedback isn't read.** "More / less like this" on a macro (0027, 0043) is one excerpt's
wish about one macro. It is too sparse to steer a search over up to 24 dimensions, and the
preference model already learns from thumbs and pairs, which cover the whole excerpt.

**The search folder** is `paths().search` ([0019](0019-config-file-and-paths.md)),
`<dataRoot>/search/`. Run folders are derived data: no version field, and
nothing reads one after its job ends.

## Alternatives considered

- **Each optimizer keeping its own copy of the nudge's chain** — rejected: four copies of the
  rule acceptance 3 tests, and a fix to one would miss three.
- **Every vector path in the space, as the nudge moves** — rejected: the seed genomes have 33 to
  49, and a budget of 96 to 400 evaluations is then only a few per dimension. The macros cover
  the whole sound, and the owner adds the raw paths they care about.
- **Passing a run id and keeping the folder in the sidecar's memory** — rejected: a restarted
  sidecar wouldn't know where the run lives. The folder's path is the id.
- **State written only after a tell, as the plan first said** — rejected: a restart between an
  ask and its tell would then lose the asked points, and the tell would be refused. Writing after
  both costs one small file write per request.
- **Retrying a request after a crash** — rejected by 0041.
- **A penalty from a fixed constant, or the worst score seen in the run** — rejected: model
  scores move between vibes and fits, so a constant is either lost in the spread or swamps it;
  the run's worst would make one bad early generation punish every later rejected point. The
  generation's worst valid less one spread sits just below its valid points.
- **Clipping a rejected point into the linter's ranges and scoring it** — rejected as in 0037:
  it piles points at a range's edge, and its score would be the edge's, not the point's.
- **The posterior mean alone** — rejected: the search runs to the mean where the model has no
  data, which held-out agreement can't support. **An upper bound (UCB)** — rejected for the
  model-in-the-loop search: it explores where the model is unsure, and an owner's ear, not the
  model, is what resolves that. 5f, which asks the owner, uses expected improvement instead.
- **A Node loop helper that runs the whole search** — rejected for 5d: the budget, cancel,
  progress and control arm are 5e's job shape, and one generation is what tests can drive.

## Consequences

- 5e, 5f, 5h and breeding call `searchPaths` and `proposeGenome`, and acceptance 3 holds for
  each by the same code; a change to the chain changes the nudge too.
- A search moves numbers inside one base's structure; voices, choices and recordings change only
  through the model, as with nudges.
- Each generation costs the sidecar two requests and four small files; a 400-evaluation run with
  populations of 12 writes about 140 files.
- A run's folder outlives its job. Nothing removes it yet; a later step can when a run's
  candidates are all that matter.
- Acceptance 3's 1,000 asks (8 points each, three locks, the free macros plus `duration` and
  `voices.drone.level`) run in about 5 s against the fake sidecar.

## Amendments

- 2026-11-07: from step 5e, once 5a had merged. The search folder moved from a join in
  `search-run.js` into `paths()` as `search`, and the run helpers take that folder.
- 2026-11-07 (5f, [0055](0055-search-by-ear.md)): a tell's score may be null for an optimizer in
  `TAKES_NO_ANSWER` (preferential BO, for a skip); the others still refuse one. `forkSearch`
  copies a run's spec, state and last ask into a run folder inside it, and `searchGeneration`'s
  ask and tell are `askPoints` and `tellScores`, which the search by ear shares.
- 2026-11-07 (5g, [0056](0056-directions-sliders-reference-target.md)): `searchScore(mean,
  variance, terms)` adds weighted terms to the lower bound, and with none it is the bound
  exactly, so a search scores as before. `termsScore` is the terms alone, a steer's score when the
  brief has no current taste model. A steer's terms are each chosen direction's distance from its
  slider's setting and each chosen region's nearness, both on the vibe's scale, at weight 10
  against the model's 1.
