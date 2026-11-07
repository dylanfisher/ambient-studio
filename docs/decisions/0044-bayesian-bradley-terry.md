# 0044. Bayesian Bradley–Terry with a Laplace posterior and a global prior

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the prior strengths once 4e can measure
  them. Amends [0019](0019-config-file-and-paths.md) (the `models` folder) and
  [0041](0041-sidecar-process.md) (the `fit` and `predict` methods).

## Context

Phase 4 ranks candidates by a model of the owner's taste, per vibe, and phase 5 searches with it:
5d scores a point by the posterior mean less one standard deviation, and 5e, 5f and 4f's pair
picker need the variance of a difference between two items. The training set
([0043](0043-training-sets-and-model-key.md)) gives A/B pairs, a tie as half a win each way, and
thumbs as points. Each item has a 512-dimension CLAP embedding
([0042](0042-clap-embeddings.md)), the nine `FEATURE_NAMES` and six macros. On 2026-11-07 the
owner had 8 thumbs and no A/B pairs, all in one vibe, so the fit has to work with thumbs alone
and with nothing at all. Only numpy is allowed: no scikit-learn, no scipy.

## Decision

**The model.** An item's score is `w · φ(item)`. `φ` is, in order:

- the embedding projected on the top **12** principal components of the basis items'
  embeddings, each divided by its standard deviation, so every component has unit variance. A
  component whose variance is below **1e-3** of the largest's (`COMPONENT_VARIANCE_FLOOR`) is
  dropped: whitening would multiply it by over 30, and a candidate far out along a direction the
  training items barely span would get a score variance they never showed;
- each feature standardized by the basis items' mean and standard deviation, a null (nothing
  measurable) set to 0, the mean;
- each macro's heard-window mean standardized the same way.

A feature or macro column with fewer than two measured values, or one value throughout (a spread
below 1e-9 of its mean's size, `CONSTANT_TOLERANCE`, since a column of one float has a rounding
spread), gets a scale of 0 and a **term of 0 for every item**: its weight learns nothing, and a
candidate with any value there, however large, gets the same score and variance as with the
mean.

That is up to 27 weights. A pair is won with probability `σ(w · (φ(winner) − φ(loser)) + b·s)`, where
`s` is +1 when the winner was on the left and −1 when on the right, so `b > 0` is a lean to the
left. A thumbs up has probability `σ(w · φ(item) + c)`, at weight 1 against a win's 1. `b` and
`c` are not part of an item's score: `predict` uses `w` alone.

**The fit** is the posterior mode under a Gaussian prior, by Newton's method from the prior
mean, halving any step that doesn't lower the loss, until no parameter moves more than 1e-10
(100 steps at most; synthetic sets take 6 to 8). The posterior is the Laplace approximation:
the Gaussian at the mode whose precision is the Hessian there. The loss is strictly convex, so
the mode is unique and the iteration has no seed: nothing in it draws at random. A PCA
component's sign is fixed by making its largest loading positive.

**The global prior, over the other vibes.** For each vibe the fit job first fits a **prior
model** on every *other* live vibe's pairs and thumbs, under the base prior centered on zero.
Its set file lists every vibe's excerpts as items, the vibe's own included, and it computes the
basis (the projection and the standardization) from all of them, so every vibe's prior and
model share one basis. Then the vibe's model takes that basis and a prior centered on the prior
model's posterior mean. So no rating counts twice: the vibe's own ratings shape its prior's
mean only through the basis, never through the weights. The prior model's hyperparameters carry
`basis`, the key of every vibe's set, because its items depend on them; the vibe's carry
`globalModel`, the prior model's key. A rating in any vibe changes every key, as 0043 asks.
Inputs that are the same give one key and share one file, as two vibes with no ratings do.

With one vibe holding every rating, as today, its prior model is fitted on no ratings: its
posterior is the base prior, mean zero, and the vibe's model is the base prior updated by its
own ratings. A vibe with no ratings gets a model equal to its prior: the other vibes' mean with
the vibe's own spread.

**Prior strengths** (`HYPERPARAMETERS` in `src/server/preference-model.js`, written into every
set file and every key; the sidecar holds no defaults):

| | value | per parameter | why |
|---|---|---|---|
| `pcaDimension` | 12 | | the middle of the plan's 8–16; with features and macros, 27 weights against tens of pairs |
| `weightScale` | 1.5 | variance 1.5² / 27 | an item's prior score has a standard deviation near 1.5, so a pair's prior difference near 2.1 logits: most pairs land between 10% and 90% |
| `vibeScale` | 1.5 | variance 1.5² / 27 | how far a vibe's weights may sit from its prior model's |
| `biasScale` | 1 | variance 1 | a left lean of 1 logit is a 73% left win rate, more than any listener should show |
| `interceptScale` | 2 | variance 4 | the thumbs-up rate is unknown, anywhere from 12% to 88% at one standard deviation |
| `thumbsWeight` | 1 | | a thumbs counts as much as a win |

Dividing by the term count keeps an item's prior spread the same if the dimension changes.
`HYPERPARAMETERS` also carries `modelCode`, `preference-<SHA-256 of preference.py>`, which the
sidecar's `preference_code` reports and `fit` checks against its own, so the key changes when the
model code does, as `clap.py`'s hash changes the embedding producer.

The vibe's prior covariance is `vibeScale²/27 · I`, not the prior model's posterior covariance
plus that. The prior's precision stays fixed while the vibe's data grows, so the vibe's own
ratings outweigh it once it has some, and with `vibeScale` equal to `weightScale` a vibe with no
ratings is never more certain than its prior model. Both scales are placeholders until 4e's
held-out agreement can compare others.

**Folds.** `modelPlan(store, producer, { modelCode, heldOutSession })` leaves one session's pairs
and thumbs out of the vibe's set and out of every set that feeds a prior, so its excerpts are in
no basis either, unless another session rated the same excerpt, which then is training data
too. Each set's ids change, so each fold has its own keys. **4e must fit its folds through it**,
with `fitModels`, so nothing from the held-out session reaches any file a fold's fit reads.

**Items with no embedding are left out**, not fitted on features and macros alone. A rating or
thumbs whose excerpt has no embedding under the embedder's producer leaves the set before the
key is computed and is listed as `unembedded`, one entry per rating and excerpt, as 0043 lists
one with no features; the job's counts are of distinct excerpts. An item with the CLAP terms set to the mean would be keyed the same before and after
it was embedded, so a model fitted without its sound would be kept after the sound arrived; and
a pair of an embedded and an unembedded side would read the unembedded one as average. The fit
job asks the sidecar's `embedder` without fetching, and fails, with the reason, when the config
names no checkpoint folder or the checkpoint isn't there: the owner runs the embed job first.

**What it says it fitted.** The job's result gives, for each vibe, its key and its prior model's,
whether each file was already there (`kept`, `priorKept`), the A/B ratings (a tie once), the
ties, the thumbs, the other vibes' ratings and thumbs, the distinct excerpts left out for no
embedding or no features, and a sentence: "Fitted on 0 A/B choices and 8 thumbs; with no A/B
choices, the left/right lean stays at its prior; no other brief has ratings, so it starts from
the base prior." or "No ratings to fit, so it predicts from the model over the other briefs."
With no pairs the bias has no data, so its posterior is its prior.

**Files.** Under `<dataRoot>/models/`, one `<modelKey>.json` per model: derived data, named by
the key, never versioned, never migrated. The job fits a key only when its file is missing; a
changed key makes a new file and the old one is left (nothing reads it). The sidecar writes to a
temp folder under the data root and Node moves the file into place, so a failed or cancelled fit
leaves nothing under the key. A model file holds the feature and macro names, the embedding
dimension, the hyperparameters, the basis, the parameter names (`clap:1`…`clap:12`,
`feature:<name>`, `macro:<name>`, `leftBias`, `thumbsIntercept`), the posterior mean and full
covariance, and the pair and thumbs counts. 4g reads weights and intervals from it directly.

**Protocol** (`src/server/sidecar-protocol.json`), arrays as files:

- `fit {set, out}` → `{pairs, thumbs, items, clapDimension, iterations}`. The set file is JSON:
  `hyperparameters`, `featureNames`, `macroNames`, `embeddingDimension`, `embeddings` (an
  absolute path to float32 rows, one per item, in item order: the stored BLOBs end to end),
  `prior` (the prior model's path, or null for a prior model's own fit), `items` (each excerpt
  once, a prior model's listing every basis item first:
  `features` with nulls, `macros`), `pairs` (`winner` and `loser` by item index, `weight`,
  `winnerLeft`) and `thumbs` (`item`, `up`).
- `predict {model, items, out}` → `{count}`. The items file has the same names, dimension,
  embeddings and items; it must match the model's names or the request fails. `out` gets each
  item's `mean` and `variance` and the full `covariance`, so a pair's difference has variance
  `var(a) + var(b) − 2 cov(a, b)`.
- `preference_code {}` → `{code}`: the model code the key names.

**The route.** `POST /api/preference-models` starts the fit job, one at a time (a second gets a
409 naming the first). Its progress counts the vibes, each a prior model and its own. Nothing
else starts it.

**Threads and determinism.** CPU only; omlx is never asked. numpy's BLAS here is Accelerate,
the same library torch uses, and its thread count can only be set by an environment variable
read when it loads, which would also change torch's and so the embeddings under an unchanged
producer. So the cap is left to the sizes: a 1,000-pair fit is a 2,000 × 512 SVD and 29 × 29
Newton solves, and used 0.12 s of CPU in 0.10 s of wall time on mbp2021, one core. The same set
fits to the same bytes: JSON floats are written by `repr`, which reads back to the same bits.

**Fit time** on synthetic sets (512-dimension embeddings, 12 components, twice as many items as
pairs, mbp2021 under another builder's load): 40 pairs 0.008 s, 200 pairs 0.03 s, 1,000 pairs
0.10 s, plus the sidecar round trip.

## Alternatives considered

- **An ensemble or bootstrap of point fits** — rejected: it costs a fit per member, its variance
  from tens of pairs is noisy, and it gives no covariance between two items without a sample of
  every member's scores. The Laplace posterior gives the full covariance in one fit, which 5d's
  lower bound, 5f's acquisition and 4f's pair picker read directly.
- **A Davidson tie model** — kept out, as in 0043: half a win each way pulls a tied pair
  together (a test checks it) without another parameter.
- **Fitting items with no embedding on features and macros alone** — rejected above: the key
  can't tell when their sound arrives, and the missing side reads as average.
- **One global fit over every vibe, the vibe's own included, as the prior** — rejected in review:
  its mean already holds the vibe's ratings, so they would count twice.
- **The prior model's posterior covariance in the vibe's prior** — rejected: a tighter prior that
  later steps would read as evidence, for little gain while the scales are guesses.
- **A prior model whose basis comes from the other vibes' excerpts alone** — rejected: with one
  vibe holding every rating, as today, there would be no basis. The basis reads every vibe's
  excerpts, features and embeddings only, never a rating's outcome.
- **Leaving a constant column at scale 1** — rejected: a candidate with a large value there would
  move its score by a weight its training never constrained.
- **An unwhitened projection, or raw features** — rejected: a prior of one width per weight
  means the same only when every term has unit variance.
- **Capping BLAS threads with `VECLIB_MAXIMUM_THREADS`** — rejected above. `threadpoolctl` would
  do it at run time, but it is a new dependency for fits that already run on one core.
- **`.npz` model files** — rejected: Node reads JSON without a library, and 4g reads the weights.

## Consequences

- The owner runs the embed job, then the fit job. Today it fits 8 thumbs in one vibe, says so,
  and leaves the bias at its prior; its prior model is the base prior, and the other vibes
  predict from a prior model fitted on its ratings.
- Every model file is rebuilt when a rating, an embedding producer, the feature producer or a
  hyperparameter or `preference.py` changes. Old files stay in `models/` until deleted by hand.
- 4e fits each fold with `modelPlan(..., { heldOutSession })` and `fitModels`. Its features-only baseline can set `pcaDimension` to
  0, which the fit accepts, though it still reads an embeddings file; 4e decides whether to let
  the file be absent. 4f and 5d call `predict`; no Node wrapper exists yet.
- The scales are guesses. 4e's held-out agreement is the first measure of them; changing one
  changes every key, so every model is refitted.
