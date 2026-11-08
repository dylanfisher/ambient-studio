# 0045. Held-out agreement: leave one session out, a session bootstrap, three baselines and a minimum

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the minimum once there are A/B choices to
  test. Amends [0044](0044-bayesian-bradley-terry.md) (`modelPlan` takes the hyperparameters;
  the features-only baseline keeps its embeddings file). Amended by
  [0059](0059-optimizer-evaluation.md) (the optimizer test reads the agreement's lower bound,
  and its reports go in `evaluations`).

## Context

Phase 4's acceptance asks for held-out pairwise agreement per vibe, split by session, with a
bootstrap 95% interval and the pair count, "not enough data" below a stated minimum, and three
baselines: always-left, louder wins and features only. Ties are left out of agreement
([0043](0043-training-sets-and-model-key.md)). Folds come from 0043's `sessionFolds`, and 0044
says each fold must be fitted with `modelPlan(..., { heldOutSession })` and `fitModels`, so no
file a fold's fit reads holds anything from the held-out session. Every heard excerpt is
normalized to the vibe's loudness target, so integrated loudness can't say which side was
louder. On 2026-11-07 the owner had 8 thumbs and no A/B choices.

## Decision

**The minimum** (`PREFERENCE_MINIMUM` in `src/domain/preference-minimum.js`, which 4g reads too):
**40 A/B ratings over at least 3 sessions per vibe**. A rating is one that isn't a skip, with a
tie counted once. Sessions are those with at least one such rating. With 3 sessions every fold
trains on the other two. At 40 pairs and 70% agreement even an independent-trials interval
runs from about 55% to 82%. Fewer pairs can't tell a model from always-left's 50%. The count is taken twice. First it is taken on the training set (ratings with features under
this engine), before any embedding is read: when no vibe reaches the minimum, the job never
starts the sidecar. A vibe that passes is counted again on the set less the ratings with no
embedding, the set the fits actually use. `shortfall(pairs, sessions)` gives how many more of
each are needed, and the page says so with the ratings left out for want of sound analysis or
features.

**Folds.** For each vibe at the minimum, `sessionFolds` runs on the plan's set (embedded and
featured). For each fold, `modelPlan(store, producer, { modelCode, heldOutSession,
hyperparameters })` is narrowed to the one vibe and fitted with `fitModels`, as 0044 asks. The
prior model is fitted too. Its key changes with the held-out session, so fold models never
share a file with the whole-data model. The models are stored under `models/` by key, like any
other. A test pair that shares a genome with training is **leaked**: held back and counted.
**Ties** are held back and counted. The rest are scored.

**A call.** Each test excerpt is scored by `predict` (`predictScores` in
`src/server/predict-scores.js`, the first Node wrapper, which 4f can reuse). The model agrees when
the winner's posterior mean is higher. The left/right bias is not part of a call, because the
ranking reads the mean alone. Equal scores, or a missing value for a baseline, earn half
(`credit`). **A model with no terms** gives every excerpt variance 0, as a model fitted on no
ratings does. When every test excerpt in a fold has variance 0, the fold is not scored for that
predictor; its pairs are counted as `unscored`, and with no scored fold at all the page reads
"no model yet".

**The baselines**, scored on the same pairs:

- **Always-left:** agrees when the winner was on the left, the share of left wins.
- **Louder wins:** the side whose loudest 3 s as heard is higher: the raw render's
  `shortTermMax` plus the rated audio's `gainDb`, the gain normalize applied before its limiter.
  Because of normalization this equals the target plus the excerpt's loudest 3 s above its own
  integrated loudness, so gain doesn't change it. It is also the loudness the owner heard at the
  loudest moment, give or take the limiter's fraction of a dB.
- **Features only:** the same model, prior and fit with `pcaDimension: 0`, so no CLAP term.
  It trains on the same embedded set and still writes an embeddings file, which the fit reads but
  doesn't use. Dropping the file would let it train on excerpts the full model can't, and then the
  two would be compared on different data.

**The bootstrap** (`agreement` in `src/domain/preference-report.js`). The point estimate is the
pooled credit over the pooled scored pairs. The interval is the 2.5th and 97.5th nearest-rank
percentiles of **2,000 resamples of the held-out sessions** with replacement. The draws come from
the counter-based PRNG ([0003](0003-counter-based-prng.md)) under seed 45, so the same report
comes out every time. A resample that draws only sessions with nothing scored is left out. All
four predictors' tallies are listed in the same session order, so they get the same draws.
**Sessions, not pairs**, because pairs in one session share candidates (quick A/B's champion
meets every challenger) and the owner's ears that day. Resampling pairs treats them as
independent and gives an interval too narrow for what the owner will do in the next session.
With 3 to 5 sessions the interval is coarse, since there are only a few distinct resamples. That
is the honest width, and the page shows it.

**The report** is derived data. Running the test again rebuilds it from the ratings, the
producers and the hyperparameters, so it is one JSON file, `models/preference-test.json`. Each
run replaces it through a temp file. It has no version field, no table and no migration. It
holds `createdAt`, the embedding producer (null when no vibe reached the sidecar), the minimum,
the bootstrap settings, the loudness measure's name, and one entry per live vibe: the counts
(pairs, ties, thumbs, sessions, left out for no features or no embedding), the shortfall, and,
at the minimum, the folds (scored, ties, leaked each) and each predictor's agreement
(`agreed`, `scored`, `share`, `low`, `high`) with its `unscored` count.

**The job and the page.** `POST /api/preference-tests` starts the `agreement` job, one at a
time (a second gets a 409 naming the first); `GET` returns the last report and the unfinished
job. The job has progress steps per fold and a cancel, which leaves the last report as it was.
It runs on the CPU through the sidecar and never asks omlx. The Model test page has a "Test your
taste model" section with the start button, the job box and one card per brief: a sentence, then
the model and each baseline as "71% of 41, probably between 50% and 86%".

## Alternatives considered

- **Resampling pairs** rejected (above). **Resampling folds' pairs within each session**
  rejected: it still treats one session's pairs as independent.
- **A Wilson interval** (as 0030 uses) rejected: it assumes independent trials.
- **Integrated loudness, true peak or loudness range for "louder"** rejected. Integrated
  loudness is the target for everyone. The heard true peak sits at the limiter's ceiling for
  most excerpts. Loudness range measures spread, not level.
- **Including the left/right bias in a call** rejected: 4f ranks by the mean, so agreement
  should measure what ranking uses.
- **Scoring a no-terms model at 50%** rejected: it makes no call, and a 50% beside the baselines
  would read as a measurement.
- **Storing reports in `evaluations`** rejected: that table's reports are generation runs that
  can't be rebuilt, the page reads them as such, and a kind column would need a migration. These
  reports can be rebuilt.
- **A smaller minimum (20 pairs)** rejected: at 70% the interval would run from about 48% to
  85%, overlapping chance, and that's before the session bootstrap widens it.

## Consequences

- The test fits 4 models per fold (two priors, two vibe models). Their files stay in `models/`,
  and a second run with the same ratings refits nothing.
- With today's data every brief reads "Not enough data", naming the 40 A/B choices over 3
  sessions it needs. A brief with only thumbs says thumbs alone can't be tested. The sidecar is
  never started.
- 0044's prior strengths can now be compared by agreement. Changing one changes every key and
  refits.
- 5j amends this record.

## Amendments

- 2026-11-07: step 5j reads this test's report. The optimizer test
  ([0059](0059-optimizer-evaluation.md)) copies each brief's model agreement (`share`, `low`,
  `high`, `scored`) and the report's `createdAt` into its own report when it runs, and counts
  the taste model's comparison of a search with its control only when `low` is above 0.5. With
  no report, or a brief below the minimum, the comparison reads "inconclusive: the model doesn't
  yet beat chance on held-out pairs". This report stays a derived file. The optimizer test's
  reports go in `evaluations`, which this record rejected for its own: they hold search runs
  and the owner's spot-check pairs, which can't be rebuilt, and `params.kind` (`optimizer-test`)
  tells them from the generation runs, with no new column, so no migration. `listEvaluations`
  takes the kind, and the generation runs are the rows with none.
