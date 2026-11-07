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

- the embedding projected on the top **12** principal components of the global set's
  embeddings, each divided by its standard deviation, so every component has unit variance;
- each feature standardized by the global set's mean and standard deviation, a null (nothing
  measurable) set to 0, the mean;
- each macro's heard-window mean standardized the same way.

That is 27 weights. A pair is won with probability `σ(w · (φ(winner) − φ(loser)) + b·s)`, where
`s` is +1 when the winner was on the left and −1 when on the right, so `b > 0` is a lean to the
left. A thumbs up has probability `σ(w · φ(item) + c)`, at weight 1 against a win's 1. `b` and
`c` are not part of an item's score: `predict` uses `w` alone.

**The fit** is the posterior mode under a Gaussian prior, by Newton's method from the prior
mean, halving any step that doesn't lower the loss, until no parameter moves more than 1e-10
(100 steps at most; synthetic sets take 6 to 8). The posterior is the Laplace approximation:
the Gaussian at the mode whose precision is the Hessian there. The loss is strictly convex, so
the mode is unique and the iteration has no seed: nothing in it draws at random. A PCA
component's sign is fixed by making its largest loading positive.

**The global prior.** The fit job fits a **global model** first, on every live vibe's pairs and
thumbs together, with a prior centered on zero. It also computes the basis (the projection and
the standardization) from those items. Then each vibe's model uses the global model's basis and
a prior centered on the global posterior mean. Each vibe's hyperparameters carry the global
model's key (`globalModel`), so a rating in any vibe changes every vibe's key, as 0043 asks. A
vibe with no ratings gets a model equal to its prior: the global mean with the vibe's own
spread.

**Prior strengths** (`HYPERPARAMETERS` in `src/server/preference-model.js`, written into every
set file and every key; the sidecar holds no defaults):

| | value | per parameter | why |
|---|---|---|---|
| `pcaDimension` | 12 | | the middle of the plan's 8–16; with features and macros, 27 weights against tens of pairs |
| `weightScale` | 1.5 | variance 1.5² / 27 | an item's prior score has a standard deviation near 1.5, so a pair's prior difference near 2.1 logits: most pairs land between 10% and 90% |
| `vibeScale` | 1.5 | variance 1.5² / 27 | how far a vibe's weights may sit from the global ones |
| `biasScale` | 1 | variance 1 | a left lean of 1 logit is a 73% left win rate, more than any listener should show |
| `interceptScale` | 2 | variance 4 | the thumbs-up rate is unknown, anywhere from 12% to 88% at one standard deviation |
| `thumbsWeight` | 1 | | a thumbs counts as much as a win |

Dividing by the term count keeps an item's prior spread the same if the dimension changes.

The vibe's prior covariance is `vibeScale²/27 · I`, **not** the global posterior covariance plus
that. The global fit already holds the vibe's own ratings, so adding its covariance would count
them twice and make the vibe more certain than its data; with one vibe holding every rating, as
today, it would halve the variance. With `vibeScale` equal to `weightScale`, a vibe with no
ratings is never more certain than the global model, and the prior's precision is fixed while
the vibe's data grows, so the vibe's own ratings outweigh it once it has some. Both scales are
placeholders until 4e's held-out agreement can compare others.

**Items with no embedding are left out**, not fitted on features and macros alone. A rating or
thumbs whose excerpt has no embedding under the embedder's producer leaves the set before the
key is computed and is listed as `unembedded`, one entry per excerpt, as 0043 lists one with no
features. An item with the CLAP terms set to the mean would be keyed the same before and after
it was embedded, so a model fitted without its sound would be kept after the sound arrived; and
a pair of an embedded and an unembedded side would read the unembedded one as average. The fit
job asks the sidecar's `embedder` without fetching, and fails, with the reason, when the config
names no checkpoint folder or the checkpoint isn't there: the owner runs the embed job first.

**What it says it fitted.** The job's result gives, for the global model and each vibe, the key,
whether the file was already there (`kept`), the A/B ratings (a tie once), the ties, the thumbs,
the excerpts left out for no embedding or no features, and a sentence: "Fitted on 0 A/B choices
and 8 thumbs; with no A/B choices, the left/right lean stays at its prior." or "No ratings to
fit, so it predicts from the model over every brief." With no pairs the bias has no data, so its
posterior is its prior.

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
  `prior` (the global model's path, or null for the global fit), `items` (each excerpt once:
  `features` with nulls, `macros`), `pairs` (`winner` and `loser` by item index, `weight`,
  `winnerLeft`) and `thumbs` (`item`, `up`).
- `predict {model, items, out}` → `{count}`. The items file has the same names, dimension,
  embeddings and items; it must match the model's names or the request fails. `out` gets each
  item's `mean` and `variance` and the full `covariance`, so a pair's difference has variance
  `var(a) + var(b) − 2 cov(a, b)`.

**The route.** `POST /api/preference-models` starts the fit job, one at a time (a second gets a
409 naming the first). Its progress counts the global model and each vibe. Nothing else starts
it.

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
- **The global posterior covariance in the vibe's prior** — rejected above: it counts the vibe's
  own ratings twice.
- **A global fit over every vibe but the vibe's own** — rejected: the basis then comes from the
  other vibes' items, and with one vibe holding every rating, as today, there would be no basis.
- **An unwhitened projection, or raw features** — rejected: a prior of one width per weight
  means the same only when every term has unit variance.
- **Capping BLAS threads with `VECLIB_MAXIMUM_THREADS`** — rejected above. `threadpoolctl` would
  do it at run time, but it is a new dependency for fits that already run on one core.
- **`.npz` model files** — rejected: Node reads JSON without a library, and 4g reads the weights.

## Consequences

- The owner runs the embed job, then the fit job. Today it fits 8 thumbs in one vibe, says so,
  and leaves the bias at its prior; the other vibes predict from the global model.
- Every model file is rebuilt when a rating, an embedding producer, the feature producer or a
  hyperparameter changes. Old files stay in `models/` until deleted by hand.
- 4e fits per fold through the same `fit`. Its features-only baseline can set `pcaDimension` to
  0, which the fit accepts, though it still reads an embeddings file; 4e decides whether to let
  the file be absent. 4f and 5d call `predict`; no Node wrapper exists yet.
- The scales are guesses. 4e's held-out agreement is the first measure of them; changing one
  changes every key, so every model is refitted.
