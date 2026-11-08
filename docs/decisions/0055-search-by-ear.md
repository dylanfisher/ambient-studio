# 0055. Search by ear: preferential BO in Quick A/B's champion mode

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the GP's settings, the budget and the wait
  after each choice. Amends [0031](0031-fewer-waits-after-first-evaluation.md) (the search by
  ear's conflict rule and progress steps), [0048](0048-quick-ab-player-mp3.md) (a search-by-ear
  mode of the Quick A/B page) and [0053](0053-search-space-ask-tell.md) (a null score, and
  copies of a run)

## Context

5e ([0054](0054-model-in-the-loop-cma-es.md)) searches by the taste model. Step 5f searches by
the owner's ear: each query is a pair the owner answers, so a run costs listening time, not CPU
time. The plan asks for a pairwise-probit Gaussian process with a Laplace posterior and
expected improvement, at most 12 dimensions (the macros by default), in Quick A/B's champion
mode (4i, 0048): each query pits the run's best against one new point, the best of 1,000 seeded
draws near it. The next excerpt renders while the owner listens; the budget is in queries
(default 20) and the owner can stop at any time; the best is shown in the session. Each answer
is an ordinary rating with the session's id, so it trains 4d too; a skip tells nothing, a tie is
a tie ([0043](0043-training-sets-and-model-key.md)), and a rejected point is told as a loss and
never shown. The owner settled on 2026-11-07: no new package, the GP in numpy.

5d's protocol (0053) passes one score per point, and refuses an ask while points wait for
scores, so the run can't be asked for the next point before the owner answers.

## Decision

**The GP** (`ambient_sidecar/pairwise_gp.py`), after Chu and Ghahramani's preference learning:

- **Prior:** f ~ N(0, K), K squared-exponential with variance 1 (utilities are only compared,
  so 1 sets the units) and length scale **2σ√d**, two draw steps per dimension scaled as
  distances in [0, 1]^d are; a point one step from the best keeps a prior correlation of about
  0.88 with it in any dimension. A jitter of 1e-8 keeps K invertible when two points coincide.
- **Likelihood:** a choice of u over v has probability Φ((f(u) − f(v)) / (√2 · 0.2)): a
  difference of 0.2 is chosen the right way 76% of the time. **A tie is two half-weight choices,
  one each way**, as 4d reads one (0043): highest when the two are equal, with no tie parameter.
- **Posterior:** Laplace's. Newton's method finds the mode, each step f = K (I + W K)⁻¹ (W f +
  ∇ log p), halved until the objective rises, as `preference.laplace` finds its own; W is minus
  the likelihood's Hessian. The predictive covariance takes K W (I + K W)⁻¹ K off the prior's,
  so W, which is singular, is never inverted. Hyperparameters are fixed, not fitted: tens of
  choices can't fit a length scale.
- **Acquisition:** expected improvement of f(x) − f(best), whose mean and variance come from the
  joint posterior of the two, so a draw near the best counts their correlation. The draws are
  **1,000 uniform in the ball of radius σ√d around the best**, σ the medium nudge's 0.12, clipped
  to [0, 1]: σ√d is a medium nudge's typical distance. With few choices told, EI favors the
  draw farthest from the best, which among normal draws would sit about 4.7 steps out in 6
  dimensions. The draws come from a generator seeded by the run's seed and the count of asks
  before, so one seed gives one run and a state read back asks what an unbroken run would.

**The optimizer** is `preferential-bo` in `OPTIMIZERS`, behind 5d's interface, settings `{sigma,
draws}` from `src/domain/ear-settings.js`. It asks one point at a time. It is told, for that
point against the best: **1** a win (the point becomes the best), **0.5** a tie (the best
stays), **0** a loss, or **null**, a skip, which adds nothing: the point is forgotten, and the
next ask draws anew. Its state is the points told, the choices and the best, as JSON. On the
simulated owner (pytest, [0, 1]^4, noise 0.02 on each side's utility, a tie within 0.002) the
best after 30 queries is nearer the optimum than the start in 10 of 10 seeds; the plan asks 9.

**The protocol** (amends 0053): a tell's score may be null for an optimizer in
`TAKES_NO_ANSWER`, preferential BO alone; CMA-ES and the scripted optimizer still refuse one.
`forkSearch` copies a run's spec, state and last ask into a folder inside the run, a run of its
own the sidecar reads like any other, so the copy can be told an answer the run hasn't been.
`askPoints` and `tellScores` are `searchGeneration`'s ask and tell, shared with this job.

**The run is one owner-started job** (`earSearchJob`, operator `optimize-ear`, source
`optimizer`), from Search by ear on a candidate's steer controls to the budget, Stop or a
cancel. `POST /api/sessions/:id/ear-searches` takes `{candidateId, queries?, paths?}`: queries
default **20**, at most **60**, skips counted; the space is 5d's, refused over **12**
dimensions. No taste model is needed. The job:

1. stores the point as a session candidate (`operatorParams` `{run, seed, budget, paths, query,
   generation}`, parent the base, the base's seed) and renders its excerpt;
2. while the owner listens, copies the run for each answer in turn (loss, win, tie, skip), tells
   the copy that answer, draws the point it asks next and renders it, so whichever answer comes,
   the next excerpt is in the render cache. The real run, told the same answer, asks the same
   point (the probe against the real sidecar found all five checked pairs ready), and its render
   is a cache hit. The copies stop between steps, never mid-request: aborting a sidecar request
   kills the process. A copy's genome is stored as a genome row with no candidate, which nothing
   lists, so its excerpt can be cached; the copies' folders are removed once the answer is
   told. The last query renders nothing ahead;
3. waits for the answer, tells it, and makes a winner the best.

A rejected point is stored as a rejected candidate, told as a loss and drawn again, never
rendered or shown; **8** in a row fail the job with the reason (`EAR_REJECTS`), since a base near
the linter's edges could otherwise ask without end. The run's `results.json`, in 5e's shape,
shows the best and folds every other point under it, so the session's table shows the best
first in its fold; it carries no scores, since the owner chose it.

**An answer is a rating first.** The page saves each choice through `POST …/ab-ratings` with the
body every mode sends (`abRatingBody`), then names the stored row in `POST
…/ear-search/answers {query, ratingId}`. The route checks the rating is live, of this session
and of the pair asked, matched by genome and seed, and tells the job what the row says
(`earScore`): the new point's side won, lost or tied, or the pair was skipped. Its reply waits
until the job asks the next pair, or ends, and holds it, so the page needs no poll between
pairs. `GET …/ear-search` reads the run; `POST …/ear-search/stop` ends it at once, the pair on
screen unanswered, and the job finishes as done, its best kept. Cancelling the job or stopping
the session ends it too, every row kept.

**The page** is `quick-ab.html?id=<session>&ear` (`quick-ab-ear.js`, no DOM): the order switch is
hidden, the progress line says "Pair 3 of 20" and names the best, Stop the search ends it, and
the done line names the best. Undo is off: the search has already drawn its next point from the
choice. A choice that failed to save is told nothing and the pair stays; one saved but not taken
by the search waits for Retry.

**Why its acceptance is check 3 alone** (0054): tens of the owner's choices make one point per
run, too few to test against a control. The check holds by 5d's chain: every point goes through
`proposeGenome`, and the job test checks that a locked macro, a locked voice parameter and a
locked voice keep their values in every point the job stored or rendered, the copies' included.

## Alternatives considered

- **botorch's `PairwiseGP` with EUBO** — rejected by the owner: it brings `gpytorch`,
  `linear_operator`, `scipy` and `pyro-ppl`.
- **Rendering the next point after the answer** — rejected: the owner would wait a render, 1.5
  to 3 s, at every pair, and the plan asks for the next excerpt early.
- **Asking the next point before the answer, one answer behind** — rejected: every query would
  be chosen without the last choice, which a 20-query run can't spare, and 5d's protocol refuses
  a second ask.
- **A sidecar method that takes the choices and answers the next point, with no state** —
  rejected: a fifth optimizer method beside 5d's three, for what a copy of the run does with
  them.
- **Copying only the likely answers (loss and win)** — rejected: a tie or a skip would then wait
  a render. The four copies cost up to four renders a pair, about 6–12 s of CPU while the owner
  listens to 50 s of audio.
- **Telling the answer before the rating saves** — rejected: a save that failed afterwards would
  leave the GP told what no rating says, and the rating, which also trains 4d, is the record.
- **The incumbent as the GP's highest posterior mean** — rejected: the best the owner hears is the
  one they chose last, as in champion mode; a best that moved without a choice would surprise.
- **Normal draws at the medium step** — rejected: see the acquisition.
- **Fitting the length scale and noise** — rejected: tens of choices can't, and a refit moves
  every earlier choice's meaning.
- **Undo, as the other modes have** — rejected: the next point was drawn from the choice; taking
  it back would mean rebuilding the run's state.
- **A job per query** — rejected: the runner runs one job at a time, so a candidates job queued
  between two queries would stall the run for minutes.

## Consequences

- While a run waits for the owner, the job runner is busy: another job, in any session, queues
  until Stop or the budget. The job's step says it is waiting for a choice.
- Each choice waits for its capture, about one render of the new point (0048), before the next
  pair shows; the best is captured once. If that wait is too long, the owner can say so.
- Up to three unused excerpts a pair stay in the render cache, and their genomes as rows.
- A server restart ends the run: the channel lives in memory. Its rows and ratings stay.
- The GP's settings are guesses until the owner has heard runs: if pairs sound too alike, the
  step or the reach grows; if they jump, it shrinks.
