# 0054. Model-in-the-loop CMA-ES, and which optimizer the acceptance means

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the shown distance and the fold. Amends
  [0031](0031-fewer-waits-after-first-evaluation.md) (the search's conflict rule and progress
  steps)

## Context

Phase 5's acceptance 4 asks that a search beat an equal budget of nudges. 5d
([0053](0053-search-space-ask-tell.md)) built the search space, the ask/tell protocol with its
run folders and state file, the moved proposal chain and the objective, `searchScore`: the taste
model's posterior mean less one standard deviation. It left the job's shape to this step: the
budget, population, cost, progress, cancel, what the session shows and the control arm. The
owner approved `cma` (pycma) on 2026-11-07. The taste model scores an excerpt in milliseconds,
so a search's cost is its renders and embeddings, and it never reaches omlx.

## Decision

**The acceptance means this search.** Model-in-the-loop CMA-ES is the optimizer acceptance 4
tests: a hundred evaluations cost CPU minutes, not listening hours, and its best can be compared
with a control on equal terms, by the model and then by a dozen owner pairs. Preferential BO
(5f) spends tens of ratings per point, too few to test, so its acceptance is check 3 alone.

**The optimizer.** `cma` **4.5.0**, pinned exactly in `sidecar/pyproject.toml`, registered as
`cma-es` in the sidecar's `OPTIMIZERS` (`CmaOptimizer` in `optimizer.py`) behind 5d's interface.
It works in [0, 1]^d with `cma`'s bound handling, from the base's position (`toVector` over the
space), and is told the negated scores, since `cma` minimizes.

- **Settings** (`src/domain/search-settings.js`): starting step **0.12**, the medium nudge's
  (`STEP_SIZE.medium`), so the two arms start alike; population **4 + ⌊3 ln d⌋**, Hansen's
  default (10 for 8 macros, 4 for one dimension). Node computes both and writes them in the
  spec's settings, so the job knows the generation size without asking.
- **Seeded.** The strategy draws from its own `numpy.random.RandomState(seed)`, passed as `cma`'s
  `randn`, and `cma`'s own seeding is off, so nothing reads numpy's global generator: one seed
  gives one run whatever else the sidecar draws between requests. The seed is drawn from
  `app.random` when the job starts and stored in each point's `operatorParams`.
- **State: pickled.** The strategy, its generator inside it, is pickled and stored as base64 in
  the run's `state.json`, under `strategy`, beside `told` and `updates`. One file keeps 5d's
  single rename, so a sidecar killed mid-write still leaves a whole state; a side file would need
  a second atomic write. The pickle is about 18 KB for d = 8. It is read back only from a run
  folder the server made and the sidecar wrote. pytest checks that a run whose state is read
  back on every request, with draws from numpy's global generator in between, asks the same
  points as one never interrupted.
- **A short last generation.** `cma`'s tell needs at least half a population. When the budget
  leaves a last generation shorter than the population, its points are asked, scored, stored and
  told, and counted in `told`, but the distribution doesn't update: the run ends there anyway.

**Budget.** In points asked, rejected ones included: default **96**, at most **400**, at least 1.
Counting rejected points bounds the job even when most points fail the linter, and a rejected
point costs no render. The job asks whole generations until the budget, the last one the
remainder.

**Cost first.** The confirm (`searchCostText` in `src/domain/search-cost.js`) gives evaluations ×
(render + embed seconds), doubled with the control arm, and says nothing is sent to the language
model. The seconds are the medians (nearest rank) of the newest run that scored a point, from
its `results.json`, or before any run the bench (`BENCH_SECONDS`): 2 s to render, from the
logged model tests' 1.3–2.5 s, and 0.17 s to embed, from 4b's bench
([0042](0042-clap-embeddings.md)). `GET /api/search-estimate` answers `{seconds, measured}`.
The job measures each render and embed with `performance.now()`; nothing waits on it. A render
the cache already held counts at its cache-hit time.

**Progress, cancel and refusals.** Progress is points asked of the budget (twice it with the
control), one step a generation: "Searching: generation 3 of 10". A cancel stops at the next
check; every point is stored before it is rendered, so every row stays, and `results.json`
holds the last generation scored. `POST /api/sessions/:id/searches` takes `{candidateId,
budget?, paths?, control?}`. It refuses with a 409, before adding a job, a brief with no current
taste model (none, out of date, or an embedder that can't be read), saying why and which button
fixes it, and a space with no dimension; a raw path `searchSpace` refuses is a 400. An identical
search (same base, budget, paths and control) queued or running is a 409 naming it. The job
checks the model again when it starts and fails with the same reason if it went meanwhile.

**Runs and their summary.** Runs are numbered, `run-1`, `run-2`, …, in the search folder (5d's
`<dataRoot>/search/`, still joined in `search-run.js` until it moves into `paths()` after 5a).
After each generation the job writes `results.json` through a temp file: the space's paths, the
base, each scored point's candidate and score, the shown points, what each other point folds
under, the shown distance, each evaluation's timings and the control's scores. It is derived
data, like the rest of the folder.

**What the session shows.** Every point is a session candidate: operator `optimize`, source
`optimizer`, parent the base, the base's seed, and `operatorParams` `{run, seed, budget,
population, paths, generation, point}`. `shownPoints` (`src/domain/search-shown.js`) picks the
best **4** by score, greedily, a tie to the point evaluated first, skipping any nearer than
**0.02** in CLAP cosine distance (1 − cosine similarity) to a better shown point
(`MIN_SHOWN_DISTANCE`, provisional until the owner has heard runs). Every other scored point
folds under the shown point nearest it. `GET …/candidates` gives each point `search: {shown,
foldedUnder, score}`; a point not yet scored folds under the run's best, or the base before any
is scored. In 4j's table each point nests under the point it folds under, closed: the shown
point's row has "Show 23 nearby points", which opens the fold in place. A shown point's line
says it is one of the search's best, with its score. Rejected points go to the Rejected
candidates box as "search points … each told a low score". The session is ranked after the
search, as after a candidates job ([0046](0046-ranking-wildcards-pair-picker.md)).

**The control arm** is a switch on the form ("With a control"), off by default. After the
search, `nudge` makes `budget` medium children of the base from the run's seed; each child is
stored with operator `optimize-control` outside any session (`sessionId` null, as 3h's control
revisions are), so no page shows it, and scored by the same scorer in batches of the population.
`results.json` and the job's result hold each arm's best, which 5j compares.

**The form.** The steer controls on a session row and a lineage node gain a points field
(default 96), the control switch and Search from here. The page sends no raw paths, so a search
moves the free macros; the route takes `paths` for a later picker.

## Alternatives considered

- **About 120 lines of numpy after Hansen's `purecma`** — rejected by the owner's approval of
  `cma`: its step-size and covariance updates and their tests would be ours.
- **Serializing `cma`'s fields to JSON** — rejected: the strategy holds the mean, step, paths,
  covariance and its eigendecomposition, the bound handler, the solution cache tell reads and the
  generator, and a field missed restarts differently with no error.
- **Seeding numpy's global generator** — rejected: any other request that draws from it between
  an ask and the next would change the run.
- **Rounding the budget up to whole generations** — rejected: the owner sets the number of
  renders, and the job then stops at exactly that.
- **Counting only valid points toward the budget** — rejected: a base near the linter's edges
  could ask without end.
- **Reading "within 0.05 of the optimum" as the best point's distance** — rejected for the
  pytest: after 200 evaluations in 8 dimensions the best point sits about 0.05 from the optimum
  at the median over 30 seeds (0.04–0.09), a sample drawn at the last step size rather than the
  mean, so a distance bound fails about half the seeds. The test asks the best score to be
  within 0.05 of the optimum's, and the distance under 0.1.
- **Showing every point** — rejected: a hundred rows of small moves around a few good ones.
- **The best 4 by score alone** — rejected: they are most often four neighbors that sound the
  same. **Folding under the best only** — rejected: the nearest shown point says what a folded
  one sounds like.
- **Control children in the session, hidden** — rejected: hiding is the owner's act (0049), and
  quick A/B, the lineage and the ranking would all have to skip them.

## Consequences

- A search costs about 96 × 2.2 s, under 4 minutes, at the default, and twice that with the
  control; a 400-point run about a quarter of an hour.
- The lineage page lists every point of a run under its base; only the session folds them.
- Each run leaves about 4 files a generation and its summary in the search folder; nothing
  removes them yet (0053).
- 5g's steer job, 5h's fill job and 5j reuse this job's shape: a budget in points, the estimate
  from the last run's medians, progress per generation, cancel keeping rows, and a control arm.
- The shown distance is a guess until the owner hears runs: if the 4 sound alike, raise it.
