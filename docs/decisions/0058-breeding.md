# 0058. Breeding: two-parent prompts, one small nudge after, the confirm's cost

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0024](0024-prompt-parse-repair-generation.md) (the parents sections and their place in the
  trimming order), [0038](0038-explore.md) (the candidates job's breed, and parent A alone as a
  base) and [0031](0031-fewer-waits-after-first-evaluation.md) (the breed's conflict rule and
  progress steps); amended by [0072](0072-prompt-room-and-low-chant.md) (the parents written
  without their defaults)

## Context

Phase 5's acceptance 6: breeding makes children of two sketches by LLM crossover plus mutation,
and each stores both parents, its operator and its source. The owner keeps sketches on the
session page and finds them on the brief page; they are rows naming a candidate, with removed
marks. Explore (0038) already asks the model for variations of one base by a fresh first prompt,
through `requestCandidate`, one repair and the revision pass (0036), and the nudge (0037) moves a
genome's numbers through `proposeGenome` (0053). The context budget is 8,192 tokens, and 0038's
seed-sized prompt with a base and six examples is about 4,300.

## Decision

**The owner picks two sketches on the brief page and presses Breed.** The card "Breed two
sketches" lists the brief's live sketches in two choosers, Parent A on the newest and Parent B on
the one before. A removed sketch isn't listed, and the route refuses one. Breed confirms the cost
(below), then posts to the brief's newest open session, or a new one when every session is
stopped, and opens that session page, which follows the job like any other.

**The route.** `POST /api/sessions/:sessionId/breeds` takes `{sketchIds: [a, b], count?}`,
`count` 1 to 32, default 4 (`DEFAULT_BREEDS`, `src/domain/breed-settings.js`). Each of these is
a 400 naming it: not two different ids, no such sketch, a removed sketch ("sketch 5 was removed
(…)"), two sketches of one candidate, a candidate of another brief, or one with no genome. A
parent that can't take the vibe's live locks is a 409 ("parent A, candidate 12, can't take the
vibe's locks: …"), as a nudge's base is; a stopped session is a 409. The job's kind is `breed`.

**The crossover** is the candidates job with `breed` passed in, as explore is with `explore`:
each child is a fresh first prompt built by `buildPrompt` from the current revision, notes,
locks, rated examples and attached references (0052), and two sections after the examples in
place of the ask:

```
Parent A:
<A's concise genome, with the locks in force applied>

Parent B:
<B's concise genome, with the locks in force applied>

Write one child of parents A and B for this vibe, taking parts from each, such as voices from one and settings from the other: keep the locked values exactly.
```

The clause after the colon is left out when no lock is in force. The locks go into both parents
before the prompt is built, so the parents agree with the locks section, and a parent whose
locks changed after the route took it fails the job before any request, naming it. Each answer
goes through `requestCandidate` (parse, locks, validate, lint, one repair) and the revision pass,
replaying its own crossover prompt. A child stores `parentIds: [A, B]` (the candidates the
sketches keep), operator `breed`, source `breeding`, and `operatorParams` `{stage: "crossover",
sketchIds, parentsTrimmed}`, beside the lock paths the answer changed. `parentIds` holds only
the parents the prompt held after trimming: `[A]` when B was trimmed, `[]` when both were, so
the lineage shows what the model read. The owner's two picks stay in `sketchIds`. Its group is
`vibe-<vibeId>-breed-<seed>`, its revisions' `<group>-revisions`.

**Trimming.** Over the budget, examples go first, then references, then parent B, then parent
A; each part kept is the most of the later parts that still fit, as 0052 says. With B gone, A is
written as explore's base with no direction ("The base genome to vary:"), so the model reads a
plain variation; with both gone, the prompt is the plain first prompt. `parentsTrimmed` lists
the letters left out, B first, and the error says "with no examples and no parents" when even
the plain prompt doesn't fit. A is the one kept because the owner chose it first. 0038's
seed-sized vibe with two 315-token parents and six examples is about 4,600 tokens; its revision
follow-up with a miss on every range is under three quarters of the budget.

**The mutation.** Each crossover child with a genome, or its revision when the revision changed
it and rendered, is nudged once at the small step (`mutateChild`, `src/domain/breed-mutation.js`,
which is `nudge` with count 1, so `proposeGenome`'s chain holds the locks and the linter). Its
draws, at most four, are stored as the nudge's are: operator `breed`, source `breeding`, its
child in `parentIds`, the child's render seed, and `{stage: "mutation", stepSize: "small",
seed}`, the seed drawn from slot 5 of the job's stream (`mutationSeed`). The mutation's excerpt
is rendered; it isn't measured or revised, since it sends nothing to the model. The crossover
child stays on the page beside it: it has its own excerpt already, and the owner can hear what
the nudge changed.

**The confirm** (`breedCostText`, `src/domain/breed-cost.js`) states the requests, 1 to 3 a
child (a first try, a fix, a revision), and their time from `GET /api/breed-estimate`, which
gives the median `latencyMs` of the last 20 generations the model answered (failed requests left
out) as `{seconds, timed}`. Renders add 2 to 3 excerpts a child at the bench's 2 s. With no
request timed yet it says the time can't be estimated, rather than guess.

**Progress** is the candidates job's, counting crossover children, with "Asking the model for
child 2 of 4" as the asking step and "Rendering the mutation of child 2 of 4" after the revision
steps. **One job per action**: a breed with the same sketches in the same order and count,
unfinished in the session, is a 409 `{error, jobId}`; the action is the JSON of `[a, b, count]`,
since A and B play different parts. The page, given that 409, opens the session page, which
follows the running job.

## Alternatives considered

- **A voice-wise programmatic crossover** (take some voices from A and the rest from B,
  splice the top-level numbers) — rejected: two genomes from different requests rarely share
  voice ids, so a swap mostly builds a genome the linter refuses: a duplicate id, a voice
  count or cost over the brief's, or a value the brief fixes. The model reads both genomes and
  the brief and writes one whole genome, through the same repair path as every answer.
- **Mutating before the crossover, or in place of the revision** — rejected: the revision pass
  is what aims a child at the ranges, and a nudge after it keeps that aim; a nudge before would
  hand the model a parent the owner never kept.
- **Showing only the mutation** — rejected: the crossover child is a model answer the owner
  hasn't heard, and hiding it would make its excerpt and revision invisible work.
- **Trimming A before B, or both together** — rejected by the plan: A is the owner's first
  choice, and one parent is still a useful variation.
- **Both parents in `parentIds` whatever was trimmed** — rejected: the lineage page would draw
  a child under a parent the model never read; `sketchIds` already keeps what the owner chose.
- **Writing parent A alone under its own heading** — rejected: one parent is exactly explore's
  case, and its base section is the text the model already answers.
- **A breed route under the brief, outside any session** — rejected: every job, cancel and
  candidate list is a session's (0027), and the session page already follows a job it didn't
  start.
- **The bench's 55 s or 7 s a request when nothing was timed** — rejected: a vibe with
  sketches has candidates, so its requests were timed; a store with none timed has nothing to go
  on, and a guess would read as measured.

## Consequences

- A breed costs 1 to 3 omlx requests a child through the queue, 4 to 12 by default, plus 2 to 3
  renders a child.
- A child's prompt is about 330 tokens larger than an explore's, so the examples are trimmed a
  little sooner.
- The lineage page draws a crossover child under parent A, its first parent; the card's origin
  line names both parents, or says which sketch the model never read.
- 5j's statistics can tell crossover children from mutations by `operatorParams.stage`.

## Amendments

- 2026-11-08: from step CV.4 ([0072](0072-prompt-room-and-low-chant.md)). Each parent's section
  holds its `conciseGenome`, with the locks applied, as the examples now do.
