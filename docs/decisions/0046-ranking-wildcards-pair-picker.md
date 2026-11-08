# 0046. Ranking, wildcards and the pair picker

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the wildcard place and the table's order.
  Amends [0047](0047-what-you-like.md) (the card points at buttons, and the lookup is shared),
  [0048](0048-quick-ab-player-mp3.md) (a third order, Best questions) and
  [0049](0049-session-table-hiding-marks.md) (the table's order and the rank badges)

## Context

Step 4f puts the taste model to work. A vibe's model ([0044](0044-bayesian-bradley-terry.md)) is
a file under `<dataRoot>/models/<key>.json`, and the sidecar's `predict` gives each item's
posterior mean and the full covariance of the items' scores. A model with no terms predicts
variance 0 for everything, which [0045](0045-held-out-agreement.md) reads as "no model yet".
[0047](0047-what-you-like.md) finds the vibe's current model by its key from `modelPlan`. Ratings
carry `aRank`, `aScore`, `aModelVersion` and `aWildcard` and the `b` ones, which 2c added and
every row so far leaves null. Phase 5 reuses the pair picker and the posterior (5d–5f). No page
could start the embed job or the fit job; the brief page told the owner to POST them by hand.

## Decision

**When a session is ranked.** The candidates job (an explore too, which is the same job) ranks
the session after its last candidate, in `rankSession` (`src/server/session-ranking.js`). It
looks up the vibe's current model with 0047's `currentModel`, the one lookup both use. With no
model file at all it asks the sidecar nothing, and the job's result says nothing: the job is as
it was before this step. With a model under an older key, or an embedder it can't use, the
session's ranking is removed and the result's `notRanked` says why, shown in the job box under
`notEmbedded`. Only when the current file exists is `predict` asked, and a failure there fails
the job, naming the ranking. A model whose every variance is 0 ranks nothing and removes the
ranking. The taste test's report shares the models folder and doesn't count as a model.

**What is ranked.** Every excerpt of the session's candidates with a sound analysis under the
current embedder, children and revisions included, each once: two candidates with the same
genome and seed share one excerpt and its place, as they share A/B marks (0049). A candidate
whose excerpt isn't analyzed is left unranked. Each excerpt is described for `predict` by its
features and macros over its window, the same terms a fit reads (`excerptTerms`).

**The ranking.** `rankCandidates` (`src/domain/rank-candidates.js`) orders the excerpts by
posterior mean, highest first, a tie to the earlier excerpt. Rank 1 is the highest.

**Wildcards.** One place in every eight (`WILDCARD_EVERY`) goes to a wildcard: `floor(n / 8)` of
them for `n` excerpts, so a session of fewer than eight has none. Each is drawn from the
excerpts ranked outside the top half (below the first `ceil(n / 2)`), without replacement. The
k-th wildcard (from 0) takes place `8k + 4`: 4, 12, 20, the middle of its eight, so a listen from
the top meets one before the eighth place. The rest fill the other places in rank order.
**Seed rule:** the k-th draw is `draw(sessionId, ":wildcard", k, 0)` from the counter-based PRNG
([0003](0003-counter-based-prng.md)), taken as an index into the excerpts still in the pool. The
same session with the same scores draws the same wildcards; a later job that adds candidates
reranks the whole session and may draw others.

**Where it lives.** One JSON file per session, `<dataRoot>/rankings/<sessionId>.json`, written
through a `.partial` copy: the model key, each excerpt's render id, score, rank, wildcard flag
and place, and the full covariance in the same order. Derived data: no version field, no table,
no migration; the next candidates job replaces it.

**What the table shows.** `GET …/candidates` gives each candidate its excerpt's `ranking`
(`rank`, `score`, `wildcard`, `slot`) or null, and the session's `ranking` (model key, render ids
and covariance) or null. The table's roots follow their places, a revised pair by its better
member's, and the unranked roots come after them in the order made. Children stay under their
parent in the order made, so lineage reads as before: a wildcard that is a child stays nested,
with its badge. Each ranked row has a badge "Taste #2 of 9, score 1.53", whose title says what
the score is, and a wildcard has a second badge saying why it sits above its rank.

**The pair picker.** `widestPair` (`src/domain/widest-pair.js`): of the pairs offered, the one
whose score difference has the largest posterior variance, `var(a) + var(b) − 2 cov(a, b)`, read
from the full covariance; the first offered wins a tie, and a variance of 0 is no question.
`questionOf` (`src/web/best-question.js`) maps candidates to their rows by render id.

- **On the session page**, a Best question button, shown only in a ranked session, opens the A/B
  view on the widest pair among the shown, unhidden candidates with an excerpt, leaving out the
  pairs the session already rated. Marking two candidates with Compare is unchanged and stays
  the way to compare in an unranked session.
- **In Quick A/B**, a third order beside "the one chosen stays" and "Random pairs": Best
  questions, which asks the widest pair not yet rated, on the page or earlier in the session, and
  not held out by a failed save. A rating doesn't refit the model, so the next widest follows.
  The order is off, with a title saying why, in an unranked session. The switch is now three
  radio buttons, which the keys still pass through. Both pages draw through
  `createQuickAbOrder`'s best mode, so the rules are one.

**Ratings.** `POST …/ab-ratings` reads the session's ranking when the rating arrives and fills
each side's rank, score, model key (`aModelVersion`) and wildcard flag from its excerpt's entry,
or nulls when the session isn't ranked or the excerpt has no entry. Thumbs and other feedback
have no such columns.

**The owner's buttons.** The Model test page has a "Fit your taste model" section beside "Test
your taste model": Analyze the sound starts the embed job (`POST /api/embeddings`) and Fit the
taste model the fit job (`POST /api/preference-models`), each held off while its job runs, with a
job box showing its step and a Cancel, and followed again after a reload. The brief page's "What
you like" text points at the two buttons.

## Alternatives considered

- **Ranking in the candidates route on every read** — rejected: each page load would ask the
  sidecar to predict, and the rank a rating stores could differ from the one the page showed.
- **A rankings table** — rejected: it is derived data, rebuilt by every job, and a table would
  need a migration for no gain.
- **Ranking only the job's new candidates** — rejected: the table orders the whole session, and
  the picker needs the covariance across every candidate, which one `predict` gives.
- **Wildcards at the end of each eight** — rejected: the eighth place is where a bottom-half
  excerpt would sit anyway, so the wildcard would change nothing the owner hears first.
- **Nesting ranked children by score too, or lifting a wildcard child to the top level** —
  rejected: the table's point is lineage at a glance (0049); only the roots move.
- **The picker by the larger variance alone** — rejected: two items that are each uncertain but
  move together make a pair whose answer teaches little.
- **Sending the shown rank with the rating from the page** — rejected: the server would have to
  trust it. The server reads the file; a job that replaced it between showing and rating is the
  one case where they differ, and then the rating names the newer model's key.

## Consequences

- A rating changes every model key (0043), so the session is unranked from the next candidates
  job until the owner fits again. The job box says so.
- Phase 5 reads the same `predict` wrapper and `widestPair`; 5f's EI picker is its own.
- A nudge job doesn't embed or rank; its children show unranked until Analyze the sound and the
  next candidates job.
