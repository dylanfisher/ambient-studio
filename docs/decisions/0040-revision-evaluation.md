# 0040. The revision evaluation: treatment against a control from the same first try, with an exact paired test

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0030](0030-seed-vibes-and-evaluation.md) (revision mode, the route's `revise` field, the
  report's new fields) and [0036](0036-revision-pass.md) (the control arm's ask, the second
  revision of a first try).

## Context

Phase 3's acceptance 2 asks whether revising with the measurements beats revising without them.
Every valid first try that misses one of its vibe's feature ranges is revised twice from the same
first try: once with its measured features and misses (the treatment), once with the same ranges
and no measurements (the control). The primary test is an exact one-sided McNemar test on the
pairs, treatment inside every range against control inside every range, passing at p < 0.05
overall over at least 20 revised first tries; below 20 the report says "inconclusive" and gives
no p. The owner settled on 2026-11-07 that the evaluation tests treatment against control,
since a test against the first tries alone can't fail: only first tries that missed are
revised, and any second try lands inside the ranges some of the time. The seed vibes' ranges
were calibrated and fixed in 3b (0034), before this run, so about half of first tries miss.

## Decision

**Revision mode.** `POST /api/evaluations` takes `revise: true` beside `vibeIds` and `count`;
left out it is false, and the run is 0030's. In revision mode, for each vibe in turn and each
first try in turn, the job:

1. asks for the first try, as before, with no locks;
2. when it is valid, renders its excerpt and lists its misses with `excerptMisses`, ranges and
   render checks both, as 0036 does;
3. when it misses anything, asks for its two revisions back to back, then renders each that
   came back changed and valid, and checks it the same way;
4. counts the first try done and moves to the next.

Renders run between requests, never during one, as in the candidates job (0031).

**The two arms.** Both are `reviseCandidate` (0036) on the same first try: the round-0 messages
replayed, the first try's genome as the assistant turn, the same sampling (temperature, top_p
and seed) as the first try, no locks, the same request path with one repair round. They differ
only in the last user turn. The treatment's is 0036's ask, byte for byte. The control's
(`controlAsk` in `src/domain/revision-ask.js`) drops the measured line and the misses, and
changes two phrases so it reads as a request to fit the brief better:

| Part | Treatment | Control |
|---|---|---|
| Opening | "Your genome was rendered, and its excerpt measured." | "Your genome was rendered." |
| Locks | none in an evaluation | none |
| Ranges | `targetsText` | the same |
| Measured line and misses | present | left out |
| Request | "Revise the genome once so its excerpt fits the vibe, …" | "Revise the genome once so its excerpt fits the brief and the ranges better, …" |
| Last line | "If the genome already fits the vibe as it is, answer with it unchanged." | the same |

The opening changes because a control that said its excerpt was measured and then gave no
measurement would hint that one exists. Both keep the "unchanged" line, so either arm may
decline.

**Control candidates.** Operator `revise-control`, `parentIds` naming the first try,
`sessionId` null; `reviseCandidate` refuses a control with a session, and refuses to revise a
revision of either arm. They are never shown: they exist only in evaluations, which have no
session, and the lineage route leaves them out (0039). Their request group is
`<first tries' group>-controls` (`controlGroupName`), apart from the treatment's `-revisions`,
so a DPO pair from one group never mixes the arms.

**Seeds.** The treatment's render seed is `revisionSeed(streamSeed, index)`, slot 3 of 0024's
stream; the control's is `controlSeed(streamSeed, index)`, slot 4, so no two of the first try,
the treatment and the control share a seed. An unchanged answer in either arm keeps the first
try's genome and seed, as 0036 does.

**Order.** Pairs are counted across the whole run, every vibe included, and the arms alternate:
the treatment asks first in pairs 0, 2, 4 … and the control in 1, 3, 5 …. The second request of
a pair replays the same turns as the first, so omlx's prefix cache may serve it faster, and a
live-site request between them may evict it; alternating gives each arm the first place in half
the pairs, at most one apart, which a seeded draw would only do on average.

**Inside.** A revision is inside when its excerpt misses no range and fails no render check,
the same count the session's shown-card rule uses (0036); a revision that lands in a range by
clipping is not a fix. An unchanged, over-budget or rejected revision has no new excerpt and is
outside, since the first try it repeats missed.

**The report.** Each vibe's tally and the overall one gain `revision`, null outside revision
mode (`evaluationReport`, `src/domain/evaluation-report.js`):

- `measured`: valid first tries whose excerpt was measured and, when they missed, both
  revisions done; `firstTries`: of those, the share inside every range, with its Wilson interval;
- `revised`: first tries revised in both arms; `afterTreatment` and `afterControl`: of those,
  the share inside after each arm, with Wilson intervals;
- `firstTriesAfterTreatment`: of `measured`, the share inside before or after the treatment,
  against `firstTries` before;
- `pairs`: `both`, `treatmentOnly`, `controlOnly`, `neither`;
- `p`: `exactMcNemar(treatmentOnly, controlOnly)` (`src/domain/exact-mcnemar.js`), the chance
  of at least `treatmentOnly` heads in `treatmentOnly + controlOnly` fair tosses, summed in
  BigInt; null below `REVISION_TEST.minimumPairs` (20) revised first tries;
- `verdict`: `inconclusive` below 20; `passes` when p < `REVISION_TEST.alpha` (0.05);
  `askingAgain` when p ≥ 0.05 and the treatment fixed at least one first try, which is the
  plan's "the treatment beats the first tries but not the control": the gain comes from asking
  again, the acceptance fails, and the owner decides whether to keep the revision pass; `fails`
  when the treatment fixed none;
- `unchanged`, `overBudget` and `rejected`, each `{treatment, control}`; `unchanged` includes
  the over-budget ones.

Each vibe's tally also gains `ranges`, the ranges its revision had when the run started, beside
its `revisionId`, so a later edit to the ranges shows against the run. The report gains
`revisionTiming`, each arm's round-0 latency and first-token percentiles, null outside revision
mode: the treatment's first-token times against the first tries' say whether omlx's prefix
cache reuses the replayed turns. `params` gains `revise`.

The acceptance reads the overall verdict. Per vibe each tally gets its own p and verdict under
the same minimum, so a vibe reads "inconclusive" until about 40 first tries of it are run.

**A partial report.** A cancel between requests (during a render, or before a revision) now
stops the run the way a failed request does: the report of what was made is stored with
`stopped`, then the job fails. A first try whose pair was left unfinished is left out of
`revision`; its first-try outcome still counts in 0030's rates.

**The page.** "Model test" gains "Also test the revision step"; ticking it changes the count
from 16 to 32 a vibe (`EVALUATION_COUNT.revise`) unless the owner typed another. A report with
`revision` shows "Does hearing the measurements help?" with the verdict in words, a revision
section on each card, the ranges each brief used, and the arms' request times. A report stored
before this record has no `revision`, `ranges` or `revisionTiming` and shows as before.

**The suggested count.** 32 a vibe over the three seed vibes is 96 first tries. If about half
miss, as 0034's ranges aim for, that is about 48 revised first tries overall, over twice the
minimum of 20, and about 16 a vibe, under it.

## Cost of the owner's run

Three seed vibes at 32 each, `queue.thinking` false, about 7 s a request:

- 96 first tries, plus their repairs, perhaps 10 to 30;
- about 45 to 60 that miss, each with two revisions: 90 to 120 requests, plus their repairs,
  perhaps 10 to 25;
- in all about 210 to 270 requests, at most 576 (every first try repaired and missing, every
  revision repaired);
- about 90 first-try excerpts and up to 120 revision excerpts, 1.3 to 2.5 s each on mbp2021
  (measured on the three seed genomes, the server at normal priority).

That is about 25 to 32 minutes of omlx and 5 to 8 of renders: roughly 35 to 50 minutes, longer
while the live site keeps omlx busy. The page's confirm counts a minute a request, which assumes
thinking on, and overstates it with thinking off.

## Alternatives considered

- **Testing the treatment against the first tries** — rejected by the owner: it can't fail.
- **The control as a fresh first prompt** — rejected: it would differ from the treatment in
  every turn, not only in the measurements, and couldn't replay the first try's genome.
- **The control's ask with the treatment's opening and request unchanged** — rejected: "its
  excerpt measured" with no measurement given hints at one, and "fits the vibe" without a miss
  to fix reads as a request to return it unchanged, which would weaken the control and favor
  the treatment.
- **Dropping the "unchanged" line from the control** — rejected: the arms would then differ in
  whether declining is allowed, and the report counts unchanged answers in each.
- **One request group for both arms** — rejected: a DPO pair from one group would mix them.
- **A seeded draw for the order of each pair** — rejected: alternation gives each arm first place
  in half the pairs exactly; a draw only on average.
- **Asking the two arms in separate passes, all treatments then all controls** — rejected: the
  live site's load and omlx's cache change over an hour, and the two arms of a pair would meet
  different conditions.
- **Counting only range misses as outside** — rejected: a revision that clips into a range would
  count as a fix, which the session's shown card wouldn't take (0036).
- **A two-sided test** — rejected: the question is whether the measurements help; a control that
  beats the treatment fails the acceptance either way.
- **The chi-squared McNemar** — rejected: with 20 to 60 pairs, and few discordant ones, the
  normal approximation is poor; the exact test is a binomial sum.
- **Reporting p below 20 with an "inconclusive" note** — rejected: the plan says the report gives
  no p below 20, so a small run can't be read as a pass.
- **A version field on the report** — rejected: derived reports have one shape and no version
  (AGENTS.md); the page reads a missing `revision` as a run without revision mode.

## Consequences

- The owner starts the run from "Model test": tick the three seed vibes, tick "Also test the
  revision step", keep 32, start. The overall verdict is the acceptance.
- A run with `revise` makes excerpts, so it fills the render cache with evaluation renders the
  sessions never play; they are derived data, rebuilt or discarded like any render.
- A per-vibe p needs about 40 first tries of that vibe; the count's maximum, 64, allows it.
- The control arm's candidates stay in the store as ordinary rows. Phase 8 can read them, as it
  reads a first try's, but no page shows them.
- Changing the seed vibes' ranges after the run makes a new run's numbers incomparable; the
  report's `ranges` and `revisionId` show which ranges each run used.
