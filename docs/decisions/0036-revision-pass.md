# 0036. The revision pass: one follow-up turn with the measurements, and the card with fewer misses shown

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0024](0024-prompt-parse-repair-generation.md) (the request helpers, `followUp`, revision
  candidates and their request group),
  [0026](0026-job-runner-and-excerpt-renders.md) (what the candidates job does after a render)
  and [0031](0031-fewer-waits-after-first-evaluation.md) (the candidates job's steps, and the
  candidates route's `pair` field). Amended by [0040](0040-revision-evaluation.md) (the control
  arm's ask).

## Context

Phase 3 gives the model ears: each excerpt's features are measured (0023, 0033), and a vibe may
give feature ranges (0034), which every first prompt already states. Step 3d sends a first try
whose excerpt misses back to the model once, with what was measured. 3h then tests the
measurements against the same follow-up without them, so the revision's prompt has to differ
from the control's only in the measurements. The owner settled which card the grid shows after a
revision: the one that misses fewer ranges, the revision on a tie, the other one click away.
omlx contexts are short (`contextBudgetTokens`), and its prefix cache can reuse a prompt's
earlier turns only when they are sent byte for byte.

## Decision

**When.** In the candidates job, after a valid first try's excerpt renders, `excerptMisses`
(`src/domain/excerpt-misses.js`) lists its misses: `checkTargets`'s findings against its vibe
revision's ranges, then the render checks' findings. A first try with any miss gets one
revision request before the next first try. A failed render check counts as a miss, since a
clipped or near-silent excerpt is as worth fixing as one outside a range. The evaluation job
doesn't revise; 3h adds its own mode.

**The follow-up turn.** `followUp(messages, answer, ask)` (`src/domain/follow-up.js`) is the
one function that adds an exchange to a sent prompt: the messages as they were, the answer as
compact JSON in an assistant turn, and one user turn. `buildRepairPrompt` is built on it. The
revision's prompt is the first try's round-0 generation's messages (never a repair round's, so
a repaired first try replays the same turns as an unrepaired one), then
`{"intent", "genome"}` with the stored genome, the one after locks, then the ask
(`revisionAsk` in `src/domain/revision-ask.js`):

1. "Your genome was rendered, and its excerpt measured."
2. The vibe's locks in force now, in `buildPrompt`'s words (`locksText`), left out when there
   are none. They may differ from the first prompt's, and every valid answer gets them.
3. `targetsText(ranges)`.
4. `Measured on the excerpt: ` and `featuresText`'s line.
5. Each miss as the repair quotes an error: `- path (rule): message`.
6. The ask for one revision as the whole object, or the genome unchanged if it already fits.

3h's control arm takes out items 4 and 5 and keeps the rest.

**No trimming.** A follow-up over the context budget isn't trimmed, since its earlier turns must
match what was sent. It isn't sent. A `revise` candidate on the first try's genome and seed is
stored with no generation, `operatorParams.unchanged` true and a lint finding with rule
`revisionOverBudget`, the counterpart of `repairOverBudget`.

**Requests.** The revisions of one job form their own request group,
`<first tries' group>-revisions` (`revisedGroupName`), so a DPO pair from one group (0021)
never mixes a first try with a follow-up. Each revision uses its first try's round-0 sampling.
The exampleIds and retrieval method logged are the first try's, since its prompt is replayed.

**The answer** goes through the first try's path (`requestCandidate`): parse, `applyLocks`,
validate, the recordings check, lint, and one repair round, whose prompt is a follow-up on the
revision's prompt. It becomes its own candidate: source `llm`, operator `revise`, `parentIds`
naming the first try, the vibe revision of the first try, and the locks in force. Its render
seed is `revisionSeed(streamSeed, index)`, slot 3 of 0024's stream, so its excerpt and its
ratings never share a heard identity with the first try. Its excerpt renders before the next
first try.

**Unchanged answers.** An answer whose genome after locks hashes to the first try's is stored as
a `revise` candidate with `operatorParams.unchanged` true, on the same genome row and the first
try's seed. It is neither rendered nor shown. The candidates route leaves it out, so the first
try stays a plain card. `operatorParams` also holds 0035's lock changes, as for a first try.

**One round.** A revision is never revised again. A second round would double the model time
for each miss, and a third prompt carries two full genomes, near the budget. 3h measures whether
one round helps before more are considered.

**The shown card.** `GET /api/sessions/:id/candidates` gives each candidate `operator`,
`parentIds` and `pair`. `pair` is null, or `{firstTryId, revisionId, shownId}` on both members
of a first try and its valid, changed revision. `shownId` follows the owner's rule: the one with
fewer misses (`excerptMisses`'s count, ranges and checks), the revision on a tie. Until both
excerpts are measured it is the first try. A rejected revision makes no pair, so the first try
stays shown and the revision is listed with the rejected ones. The session page shows one card
of each pair, headed "Candidate 3, revised" for the revision, with "Show the first try" or
"Show the revision" linking the other. `createPairSwap` (`src/web/pair-swap.js`) holds the
swap rule: the page moves to the server's pick, but not while the visible card is held: its
excerpt plays, it holds the focus, a pointer is pressed inside it, or its note or tags hold text
not yet sent (`createCardHold`, `src/web/card-hold.js`). The press counts because Safari 17.6
doesn't focus a button on click: the press blurs a focused field, and a swap run on that blur
would hide the card before the click lands. A swap that waits runs again when the excerpt
pauses or ends, a turn after the focus leaves the card, a turn after a press ends, and when the
candidates reload after a rating, so a note being typed keeps its text and the focus. After the
owner picks with the link, the pair stays as picked. The A/B view and the status line name a
revision "Candidate 3, revised", as its heading does. `reviseCandidate` refuses a revision.

**Steps.** The job says "Measuring candidate 3 of 8" after a first try's render, "Revising
candidate 3 of 8" while its revision is asked for, the repair and busy steps as for a first try,
and "Rendering the revision of candidate 3 of 8". `done` counts first tries, each done once it
is stored, rendered, measured and revised. A cancel is checked after the measuring and before
the revision request, so a cancel between the render and the revision leaves the first try and
its excerpt stored and sends nothing more. A revision request that fails in the queue stops the
job after its rows are stored, as a first try's does (0024).

## Alternatives considered

- **Always showing the revision** — rejected by the owner: it hides the cases where the revision
  got worse.
- **Counting only range misses for the shown card** — rejected: a revision that clips would tie
  a first try that doesn't, and the tie would show the revision.
- **Trimming the examples out of an over-budget follow-up** — rejected: the earlier turns would
  no longer be the prompt the first try answered, and the prefix cache couldn't reuse them.
- **A fresh first prompt with the measurements added** — rejected: the model would answer
  without seeing its own genome, and 3h's control couldn't hold everything but the measurements
  fixed.
- **Updating the first try's row with an over-budget note** — rejected: candidates are
  append-only. A `revise` row carries the note.
- **Rendering an unchanged revision** — rejected: it is the first try's genome at its seed,
  already rendered.
- **Using the revision's seed for an unchanged answer** — rejected: it would make a new heard
  identity for a genome the model didn't change.
- **The first prompt's locks in the ask** — rejected: the owner may lock a value while the job
  runs, and the revision is stored with the locks in force.

## Consequences

- A job sends up to two requests a candidate before repairs, one for the first try and one for
  its revision, at about 7 s a request on the owner's config.
- The revisions' group is unique because the first tries' group is.
- An over-budget revision has no generation. Until migration 0005 gives candidates a
  `sessionId` (3e), `listSessionCandidates` doesn't find it.
- 3g's lineage folds unchanged revisions into their first try, and reads `pair` for the shown
  status. 3h's control arm reuses `followUp` and the ask without items 4 and 5.
- Whether omlx's prefix cache reuses the replayed turns shows only in the owner's run, in the
  revisions' first-token times.

## Amendments

- 2026-11-07: from step 3h ([0040](0040-revision-evaluation.md)). The control arm's ask
  (`controlAsk`) leaves out items 4 and 5 as planned, and also opens with "Your genome was
  rendered." and asks for a revision that "fits the brief and the ranges better", since an ask
  that said the excerpt was measured and gave no measurement would hint at one. The treatment's
  ask is unchanged. `reviseCandidate` takes `control`, stores a control revision with operator
  `revise-control`, refuses one with a session, and refuses to revise a revision of either arm.
