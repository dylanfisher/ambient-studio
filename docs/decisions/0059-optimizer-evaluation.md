# 0059. The optimizer test: three searches with controls, two verdicts, twelve blind pairs

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the pairs per run, the model verdict's
  rule and the defaults once a test has run. Amends
  [0031](0031-fewer-waits-after-first-evaluation.md) (the test's conflict rule and progress
  step), [0045](0045-held-out-agreement.md) (reads its agreement; reports in `evaluations`) and
  [0048](0048-quick-ab-player-mp3.md) (a spot-check mode of the Quick A/B page)

## Context

Phase 5's acceptance 4 asks that the model-in-the-loop optimizer beat an equal budget of
nudges. Per brief, CMA-ES's best is compared with the best of a control, as many nudges from
the same base, scored the same way: by the model, the share of runs CMA-ES wins and the mean
score difference with a bootstrap 95% interval, counted only when 4e's held-out agreement has a
lower bound above 0.5; by the owner, blind A/B pairs of the two bests, an exact one-sided
binomial test on decided pairs that passes at p < 0.05 over at least 12. Acceptance 5 asks for
the archive's coverage beside its control's. 5e's search job
([0054](0054-model-in-the-loop-cma-es.md)) already runs the control arm and writes both arms'
scores in `results.json`; 5h's fill job ([0057](0057-map-elites-archive-and-map.md)) writes
both coverages in `fill.json`. The plan has the owner start the test once a brief meets 4e's
minimum, and the numbers go in phase 5's Result; no agent runs it on real data.

## Decision

**The job** (`optimizerTestJob`, `src/server/optimizer-test-job.js`, kind `optimizer-test`),
started by `POST /api/optimizer-tests` with `{vibes: [{vibeId, candidateIds?}], budget?}`.
Budget is 5e's (default 96, at most 400). For each brief in order:

- **The model.** `modelCheck` reads the brief's current taste model as the search route does
  (`searchRefusal`). With none, the brief is left out with that sentence. The route refuses
  with a 409, listing each reason, when every chosen brief would be left out, so a test that
  can do nothing is never added.
- **The bases.** Up to 3 candidates the owner names, each a live candidate of the brief in an
  open session that takes the live locks and leaves a macro to search, or a 400 or 409 naming
  why. With none named, `topRanked` takes the brief's 3 best by the ranking files of its open
  sessions made under the current model's key, one per genome, each taking the locks. A brief
  with no such candidate is left out, saying so. The runs go through the bases in turn, so
  one base gives three runs of it with three seeds.
- **The runs.** **3** (`OPTIMIZER_TEST.runs`) runs of 5e's search with the control on, called
  in the job as a function, not added as jobs, so the test holds the runner throughout and its
  cancel stops whichever search is running. Each run's points go to its base's session, as any
  search's do, and the session is ranked after it.
- **The model comparison** (`compareRuns`, `src/domain/optimizer-report.js`). Each run's two
  bests by `searchScore`, read from `results.json`. The share counts a tie as half a win, as
  0043 counts an A/B tie. The mean difference is search best less control best, with the 2.5th
  and 97.5th nearest-rank percentiles of `BOOTSTRAP.resamples` (2,000) resamples of the runs
  under `BOOTSTRAP.seed`, keyed `optimizer-bootstrap`, so a report is the same every time. With
  3 runs there are only 10 distinct resamples, and each run drawn three times has a chance of 1
  in 27, more than the 2.5% tail, so the interval runs from the smallest difference to the
  largest. That is the honest width for 3 runs.
- **The model verdict** (`modelVerdict`). The agreement is the brief's `test.model.agreement`
  from 4e's last report, copied into this report with that report's `createdAt`. With no
  agreement, or its `low` at or under 0.5, the verdict is "inconclusive: the model doesn't yet
  beat chance on held-out pairs", whatever the scores. Otherwise the interval decides: above 0,
  the search is better; below 0, the control; holding 0, neither.
- **The spot-check pairs** (`spotPairs`). Per run, each arm's points by score, best against
  best, second against second, **4 a run** (`spotPairsPerRun`), so 3 runs give the 12 pairs the
  owner's test needs (`minimumPairs`). Each stores its run, rank, the base's session, both
  candidates with their genome and seed, and an order seed drawn from `app.random`, so the
  sides are fixed when the test runs and `abOrder(orderSeed)` puts one on the left.
- **Coverage.** The brief's newest `fill.json` with a control (`lastFill`), as written; null
  with the sentence "No fill of the map with a control has run for this brief yet."
- **Timings.** The estimate the confirm gave (`searchEstimate` when the job started, times
  3 × 2 × budget) beside what the brief took: wall seconds from `performance.now()`, the count of
  excerpts scored and their median render and analysis seconds.

The report, `{createdAt, vibes: [...]}`, is stored once the job finishes with `addEvaluation`,
`params` `{kind: "optimizer-test", vibes, budget, runs}`. A cancelled test stores no report; its
points and control children stay, as every search's do.

**The owner's verdict is read, not stored** (`ownerTally`). `GET /api/optimizer-tests` lists the
stored tests and counts each brief's pairs against the brief's live ratings as they stand. A
rating is a pair's when it was made in the pair's session of the pair's two excerpts (genome
and seed), either way round; the latest counts. A choice of a side is a win or a loss; a tie
and a skip aren't decided. Below 12 decided pairs the verdict is "inconclusive, waiting on
data" and no p is given. From 12, p is the exact one-sided binomial tail of the wins, which is
`exactMcNemar(wins, losses)` (0040's test, whose discordant pairs are the same fair coins), and
the search is better by ear when p < 0.05. 10 of 12 gives 79/4096 = 0.019.

**Why 12.** The plan's dozen. At 12, the test passes from 10 wins (p = 0.019); 9 of 12 is
p = 0.073. So it passes only when the owner prefers the search in about 5 of 6 pairs, which a
real gain of the size worth having should give. Fewer pairs can pass at all from 5 (5 of 5 is
p = 0.031), but a single miss then fails it, and 12 matches what 4 pairs from each of 3 runs
give with no extra runs.

**Rating the pairs.** `GET /api/sessions/:id/spot-checks` lists the session's pairs from every
stored test: whether rated, and, when both excerpts are in the render cache, `pair` `{a, b,
orderSeed, leftSide}` with the search as side a, and each side as Quick A/B plays it. The Quick
A/B page in spot-check mode (`quick-ab.html?id=<session>&spot`, `quick-ab-spot.js`, no DOM)
plays the pairs not yet rated in turn and saves each choice through `POST …/ab-ratings` with the
pair's stored seed, so the row holds the session and the sides the seed drew. Each side is
named only Left or Right: a candidate number would say which arm made it, the control's being
made after the search's. Undo and the order switch are off. A stopped session takes no rating,
so its pairs say so and can't be rated. A choice is an ordinary A/B rating, so it also trains
4d.

**The page.** The Model test page's "Test the optimizer" section, after the taste test's: a
tick and a "Start from" field per brief, the evaluations per search, a confirm
(`optimizerTestCostText`: briefs × 3 × 2 × budget evaluations at 5e's seconds, nothing sent to
the language model), the job box with its cancel, followed again after a reload, and the newest
test's cards, one per brief: a sentence for each verdict, a row per search, the coverage and
the time, and a "Rate N blind pairs in session S" link for each session with pairs to rate.

## Alternatives considered

- **One pair per run, the two bests only** — rejected: 3 pairs per test, so 4 tests of a
  brief before the owner's test can read anything. Ranks 2 to 4 are still each arm's best few
  under the same model and budget, which is what "the two bests" compares.
- **More runs, one pair each** — rejected: 12 runs of 96 points with controls is about 83
  minutes of renders per brief at the bench's 2.2 s, against 21 for 3 runs.
- **The search's 4 shown points against the control's best 4** — rejected: the shown points are
  spread apart in sound and the control's aren't, so the two arms would be picked differently.
- **Storing the owner's tally** — rejected: the ratings are the record, and a tally stored at
  any moment goes stale with the next choice.
- **A pass rule for the model comparison by share alone** (2 of 3 runs) — rejected: one run
  more or less flips it; the interval at least says when every run went one way.
- **Sides drawn by `POST …/ab-pairs` at rating time** — rejected: the plan asks for the sides
  by seed with the pair; a stored seed also makes the order of every pair known before the
  owner hears it.
- **A table or column for the optimizer test** — rejected: a migration for what a `kind` in the
  JSON params says.
- **Adding each run as its own search job** — rejected: three jobs to follow and cancel, and a
  search by ear or a fill could run between two of a test's runs.

## Consequences

- A test at the default budget renders about 576 excerpts per brief, about 21 minutes at the
  bench's 2.2 s; the confirm says so before it starts.
- Each run leaves its points in the base's session, folded under its shown 4, and its control
  children outside any session, as a search with the control does.
- The owner's verdict changes as pairs are rated; the page reads it again on each load.
- A render cache cleared after the test leaves pairs that can't be played; the page says how
  many. Nothing renders them again: the control children are in no session, so no Render
  missing excerpts reaches them.
- With today's data every brief is left out (no model) or reads inconclusive on the model; the
  test is built but not run until the owner meets 4e's minimum on one brief.
