# 0047. The "what you like" summary

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the wording and the cap. Amends
  [0041](0041-sidecar-process.md) (a route, not only a job, may ask the sidecar two metadata
  methods). Amended by [0046](0046-ranking-wildcards-pair-picker.md) (the text points at the
  Model test page's buttons, and the ranking shares the current-model lookup)

## Context

Step 4g puts a short plain-language summary of a vibe's taste model on its brief page. The model
([0044](0044-bayesian-bradley-terry.md)) is a Bradley–Terry fit whose file under
`<dataRoot>/models/<key>.json` holds the term names, the posterior mean and full covariance, and
the basis. Up to 12 of its terms are whitened CLAP components; the rest are the nine
`FEATURE_NAMES` and six macros, each standardized over the basis items. 4e sets the minimum below
which a vibe reads "not enough data" (40 A/B choices, a tie counted once, over 3 sessions,
`src/domain/preference-minimum.js`). On 2026-11-07 the owner had 8 thumbs and no A/B choices.

The model key names the sidecar's embedding producer and model code, which only the sidecar knows,
and `App.sidecar` said only jobs send to it.

## Decision

**A template, never the LLM.** `preferenceText` in `src/domain/preference-text.js` writes the
text from the model file. It costs no omlx time, and it says only what the weights say.

**Which weights.** A feature or macro term is named when its 95% interval, the mean ± 1.96
standard deviations from the covariance's diagonal, excludes zero. A column the basis found
constant (scale 0) is never named: its term is 0 for every item, so its weight is the prior's.
Named terms are ranked by |mean| / sd, and at most **4** are shown, with "(the 4 clearest of N)"
when more pass.

**Direction, not units.** Every column is standardized, so a weight has no unit. A positive
weight says more, a negative one less: "to have the onset rate higher", the feature's label from
`FEATURE_NAMES`, or "to be darker", "to move more", the session page's macro words
(`src/domain/macro-words.js`, moved down from web for this). The sentence is "From 52 A/B choices
over 4 sessions, you prefer candidates to be darker, to have the onset rate higher, and to move
more."

**The sound itself.** The CLAP components have no names, so they are never listed. The text gives
their share of the weights instead: the sum of their squared means over the sum of every
component, feature and macro term's (constant columns left out). Each term has unit variance over
the basis items, so a squared weight is about its share of the score's spread; the share ignores
the correlation between terms, which a feature and the sound share, so it reads "about".

**What it rests on.** The A/B choices the vibe's current model was fitted on, a tie once, and the
sessions they came from, counted from the plan's set. Under the minimum the text is only "Not
enough data yet: the taste model rests on 0 A/B choices over 0 sessions, and needs 40 more A/B
choices and 3 more sessions before it says what you like." No weights are named then, though a fit
on thumbs alone has some.

**No model, a stale model.** `GET /api/vibes/:vibeId/preference` answers `{state, text}`:

- `none`: the models folder is empty, the embedder can't be used (the config names no checkpoint
  folder, or the checkpoint isn't there; the reason is given), or the model has no component and
  no usable feature or macro term. The text says to run the embed job and then the fit job, naming
  their routes, since no page starts them yet.
- `stale`: model files exist, but none under the vibe's current key from `modelPlan`. The text says
  the model is out of date and to run the fit job. A stale model is never described, since it can't
  be told from the key which earlier file was this vibe's.
- `fitted`: the file under the current key, described as above.

**The route asks the sidecar.** The current key needs the embedder's producer and the preference
code, so the route asks `embedder` (without fetching) and `preference_code`. Neither loads a model:
one reads package versions, `ffmpeg -version` and a folder, the other a file hash. With the models
folder empty it asks nothing, so a studio that never fitted a model never starts the sidecar from a
page. The requests are never cancelled when the page closes, because cancelling stops the sidecar
process and would fail a job's request in flight beside it; the client's timeout bounds them. The
brief page loads the summary apart from the rest, so a sidecar failure shows in the section and
leaves the page filled.

## Alternatives considered

- **Asking the LLM to describe the weights** — rejected: it spends omlx time shared with a live
  site, and it can say more than the fit supports.
- **Naming the PCA components** — rejected: a whitened direction in CLAP space has no meaning a
  listener can name. Matching each to text embeddings is 5g's work.
- **Units or sizes ("0.4 more per unit")** — rejected: a standardized weight's unit is a standard
  deviation over the basis items, which means nothing to the owner and changes with every fit.
- **Ranking by |mean| alone** — rejected: a large weight with a wide interval would come before a
  smaller one the data pins down.
- **Computing the key in Node without the sidecar** — rejected: the embedding producer holds the
  installed torch, transformers and ffmpeg versions, which only the sidecar reads, and hashing
  `preference.py` in Node would write the model code's rule twice.
- **Remembering the producer and code from the last fit job** — rejected: jobs live in memory, and
  a changed `preference.py` or CLAP producer would leave a stale model shown as current.
- **Showing the last model found, marked stale** — rejected: a file's key doesn't say which vibe
  it was, and a stale model read beside the current wording would pass for current.
- **A button to start the fit job** — left out to keep the step small; the text names the routes.

## Consequences

- Opening a brief page once any model exists starts the sidecar process if it isn't running.
- 4e and 4g read the one minimum, so the brief page and the Model test page agree on "not enough
  data".
- The share of the sound is an approximation. If the owner reads it as exact, a variance
  decomposition over the basis items' terms would replace it, at the cost of storing them.

## Amendments

- 2026-11-07 (4f, [0046](0046-ranking-wildcards-pair-picker.md)): the Model test page has
  Analyze the sound and Fit the taste model buttons, so the `none` and `stale` texts name them
  instead of the routes. The lookup of the vibe's current model is `currentModel` in
  `preference-summary.js`, which the ranking reads too. The models folder's taste test report is
  no model, so a studio with only a report reads `none` and asks the sidecar nothing.
