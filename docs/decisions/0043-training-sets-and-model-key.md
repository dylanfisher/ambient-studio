# 0043. Training sets: ties as half a win, thumbs as points, folds by session, and the model key

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm

## Context

Phase 4 fits a per-vibe Bradley–Terry model of the owner's taste (4d) and reports its held-out
agreement one session at a time (4e). Both read one training set, and every model, report and
ranking must name the data and settings it came from, so a stale model is rebuilt rather than
trusted (AGENTS.md's derived-data rule). Step 4c builds that set and the key, before the sidecar
(4a) or the embeddings (4b) exist.

What the store holds: A/B ratings with outcome `a`, `b`, `tie` or `skip`, `leftSide` drawn from
`orderSeed`, and each side named by the rated audio the owner heard
([0027](0027-session-api-and-ratings.md)); thumbs and "more / less like this" feedback, each on a
rated audio; removed rows marked with `removedAt` and kept ([0021](0021-store-tables-and-append-only.md)).
Features live in the derived `renders` table under a `producer` key. `FEATURE_NAMES` is the one
list of features, without integrated loudness, which normalization makes the same for every
heard excerpt ([0033](0033-low-end-width-flatness.md)). On 2026-11-07 the owner's store held
8 thumbs and no A/B ratings.

## Decision

**The set** (`buildTrainingSet` in `src/domain/training-set.js`) holds `pairs`, `thumbs` and
`missing`. Every side is an item: its **rated audio id**, which 4b embeds and 4d joins an
embedding to; its genome id; each of `FEATURE_NAMES` by name, null where the excerpt had nothing
to measure; and each macro's **mean** over the heard window from `macroWindow` (0027). The set
carries no embedding. Rows come out in id order, so the same rows in any order give the same set.
`readTrainingSet` in `src/server/read-training-set.js` reads a vibe's rows from the store and
builds it.

**Features are the heard excerpt's.** The reader takes them from the renders row of the rated
audio's window and target under this server's producer, and only when the rated audio was heard
under the current engine: a render by another engine is of other samples than the owner heard.
An excerpt with no such features makes its rating or thumbs **missing**: left out of the set and
listed in `missing` as `{ratingId, ratedAudioId}` or `{feedbackId, ratedAudioId}`, one entry per
excerpt, for the fit job to show the owner. A genome a row names that isn't given, an unknown
outcome or an unknown thumbs direction throws.

**Pairs.** A win is one pair, winner and loser, at weight 1. **A tie is two pairs at weight 0.5,
one each way**, both marked `tie: true`. In the logistic fit that is a likelihood of
p^0.5 (1 − p)^0.5, highest when the two score the same, so a tie pulls the pair's difference
toward zero without a parameter of its own. **Agreement leaves ties out**: 4e scores only pairs
with `tie: false`, since a tie has no side to agree with. Each pair says whether its winner was
on the left (`winnerLeft`), for 4d's left/right bias term; a tie's two halves have opposite
`winnerLeft` and weigh the same, so a tie adds nothing to the bias. **Skips and removed rows are
left out**, the filter in the domain, so a caller passing removed rows still gets none.

**Thumbs are a pointwise term.** Each live thumbs is an item with `up` true or false, for 4d to
fit on the same score as the pairs (the link function is 4d's to record). Played fraction and
time taken weight nothing.

**"More / less like this" stays out of the set.** It says which way the owner wants one macro to
move from one excerpt, which is a direction in macro space near an item, not a score of the
item. As a pair it would need a second side, an excerpt with the macro moved that nobody
rendered or heard, so it has no audio, features or embedding. Phase 5's steering and optimizers
read it where a direction is what they need. It is not in the model key either.

**Folds** (`sessionFolds` in `src/domain/session-folds.js`): one per session that has pairs, by
session id. A fold trains on every other session's pairs and thumbs and tests on the held-out
session's pairs. **A test pair is held back (`leaked`) when either side's genome appears in the
fold's training pairs or thumbs**, so no candidate is scored by a model that was fitted on it.
A candidate here is a genome: the same genome at another seed, window or engine has the same
macros and sounds close, so it would leak as surely as the same excerpt. Thumbs count, since the
fit trains on them. A session with only thumbs is never held out, and its thumbs train every
fold. The plan drops the leaking pair from the test, not from training, so each fold trains on
everything outside its session, as the final model does.

**The model key.** `modelKeyText(set, terms)` (domain) is the canonical JSON (`sortedJson`, as in
[0005](0005-genome-schema-table.md)) of:

- the rating ids of the set's pairs and the feedback ids of its thumbs, each sorted and unique;
- `featureProducer`, the renders' producer, which names the engine and the feature extractor;
- `embeddingProducer`, the embedding checkpoint's producer from 4b, or null for a fit that reads
  no embeddings (4e's features-only baseline); it must be given either way;
- `hyperparameters`, an object, as the fit is given them.

`modelKey(set, terms)` (`src/server/model-key.js`) is SHA-256 of that text in hex, the way
`genomeHash` hashes a canonical genome: the domain can't import `node:crypto`. The set's values
aren't written into the key: the ids and the producers fix them, since features follow the
producer and macros follow the genome, window and engine. A row added or removed changes the
key; row order doesn't; a row left out as missing isn't in it, so the render that fills it in
later changes the key.

## Alternatives considered

- **A Davidson tie model** — rejected for now: one more parameter against tens of pairs, and
  half a win each way already pulls a tied pair together. 4d can revisit it once there are
  enough ties to fit a tie rate.
- **Dropping ties from the fit** — rejected: a tie says the two are close, which is information,
  and the owner chose it over skip.
- **Thumbs as pairs (every up against every down)** — rejected: the pair count grows as the
  product, and it ties together excerpts the owner never heard side by side.
- **Macro feedback as a pseudo-pair against the excerpt with the macro moved** — rejected: that
  excerpt was never rendered or heard.
- **The macro's min and max beside its mean** — rejected for now: the fit takes one number per
  macro, and most macros hold still over a 25 s window.
- **A candidate as genome and seed, or as the rated audio, for the leak rule** — rejected: both
  let the same genome at another seed or window sit in training and test at once.
- **Dropping a leaking pair from training instead of the test** — rejected: training would then
  differ from the final model's in more than the held-out session.
- **Hashing in the domain**, with Web Crypto or the PRNG's mix — rejected: Web Crypto's digest is
  async and would be a second way to hash beside `sha256Hex`; the mix is 32 bits.
- **Hashing the whole set, values included** — rejected: the values follow from the ids and the
  producers, and the producers are already the cache keys the derived-data rule uses.
- **Features from the current render of a rating heard under an older engine** — rejected: they
  describe audio the owner didn't hear.

## Consequences

- 4b embeds by rated audio id, and 4d's fit job joins those embeddings to the set's items; a side
  with no embedding is reported the same way as one with no features.
- 4d standardizes features and must fill or drop the nulls a silent or unmeasurable excerpt
  gives; its record says how.
- A vibe's fit whose prior is centered on the global fit must put the global model's key in its
  `hyperparameters`, or two vibes with no rows would share a key.
- **An engine version bump makes every earlier rating missing**, since none was heard under the
  new engine. The rated audio is kept, so a later step can measure features on the rated audio
  file itself; the raw-render features (loudest 3 s, loudness range, true peak) can't be read
  from the normalized file and would need another source.
- With today's data the set holds only thumbs, and `sessionFolds` gives no folds until there are
  A/B ratings.
