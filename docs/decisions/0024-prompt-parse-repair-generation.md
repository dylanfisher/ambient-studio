# 0024. The generation prompt, the {intent, genome} answer, one repair round, typed rejects

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm; amended by [0035](0035-locks.md) (the
  lock shape and its line, locks applied to each answer) and
  [0034](0034-feature-ranges-as-soft-targets.md) (the vibe's feature ranges in the user turn)
  and [0036](0036-revision-pass.md) (the request helpers, `followUp`, and revision candidates)
  and [0038](0038-explore.md) (the base section, its trimming, and explore children)

## Context

Step 2f turns a vibe into candidate genomes through omlx. The spec's loop gives the LLM the
brief, the constraints, the genome schema, the owner's notes, rated sketches from the vibe and the
current locks, and gives invalid output one repair round with the errors fed back. The queue
([0022](0022-omlx-queue.md)) refuses a prompt over `contextBudgetTokens` (8 192 at 3.5 characters
a token) and returns `finishReason: "length"` for a cut answer. The store
([0021](0021-store-tables-and-append-only.md)) keeps every generation's exact prompt for phase 8's
fine-tuning, a `requestGroup` for DPO pairs, and left the reject reasons to this step. The linter
reports and never rewrites ([0020](0020-vibe-constraints-and-linter.md)), and the genome schema
has no description field ([0005](0005-genome-schema-table.md)): adding one would change
`genomeHash`.

## Decision

**Prompt layout** (`buildPrompt` in `src/domain/build-prompt.js`). Two messages:

- *system*: one line on the task, the answer format, then `schemaText()`. It is the same for every
  vibe.
- *user*: `Vibe: <name>` and the brief; `constraintsText()`; the locks, one `path = value` line
  each under "Locked by the owner; keep these values exactly"; the owner's notes, oldest first;
  the rated examples, one `Liked: ` or `Disliked: ` line each with the genome's canonical JSON;
  and the ask. A section with nothing in it is left out. The vibe's feature ranges follow the
  constraints (amended 2026-11-07, [0034](0034-feature-ranges-as-soft-targets.md)).

A lock is `{path, value}` with the vector view's paths (`reverbDecay`, `voices.pad.hold`), so
phase 3's locking and phase 5's optimizers name a value the same way; phase 3 may widen the shape.
The signature is `buildPrompt(revision, {notes, locks, examples, budgetTokens})`: the plan's
`vibe` argument carried nothing the revision doesn't.

**Budget.** The prompt is estimated with the queue's own `estimateTokens`, which moved to
`src/domain/prompt-tokens.js` with `CHARS_PER_TOKEN` so both count the same text. Examples are
trimmed from the end until it fits; when it doesn't fit with none, `buildPrompt` throws, naming
the size and the budget, and says to shorten the brief or notes. Measured: a typical vibe (nine
constraint kinds, a two-sentence brief, three notes) is 3 771 characters, about 1 078 tokens, with
no examples, and 8 258 characters, about 2 360 tokens, with four examples. A test holds a vibe the
size of a seed vibe (every kind, a 600-character brief, twelve 150-character notes, three locks)
with six examples under half the budget, leaving the other half for a repair.

**The answer** is `{"intent": "<one line>", "genome": {...}}`. The intent is stored on the
candidate. `extractGenome` scans for top-level `{…}` spans (tracking JSON strings, so a brace in
a string doesn't count), parses each, and takes the one that parses as an object: fences and
prose around it are ignored. A span that never closes is scanned again from its next character,
so a stray `{` in prose doesn't swallow the answer after it; an answer cut short may then yield
an inner object, which fails the shape check and is repaired. None found is `noJson`; object
spans found and none parses is `invalidJson` with the longest span's parse error; two or more
that parse is `severalObjects`. A list holding the answer (`[{"intent": …}]`) is `invalidJson`,
not unwrapped: the prompt asks for one object, and unwrapping would hide that the model didn't
follow it. A list in prose holding no object is ignored.
A parsed answer whose shape is wrong (no one-line `intent`, no `genome`, another key) comes back
with errors, which count as schema errors and get the repair round.

**Example retrieval** before CLAP: `rating-recency`, logged as `retrievalMethod`.
`listRatedGenomes` scores each of the vibe's genomes +1 per thumbs up or A/B win and −1 per thumbs
down or loss (ties, skips, macro feedback and removed rows count for nothing) and orders them by
their newest counted vote. `retrieveExamples` takes the newest three liked (score above 0) and
three disliked (below 0), alternating liked first, so trimming from the end drops the oldest of
both sides. The genome row ids go in `exampleIds`.

**Sampling per candidate.** The caller passes a stream seed, an integer in [0, 2³²). Candidate
i's draws are `draw(seed, ":generation", i, slot)` from the engine PRNG
([0003](0003-counter-based-prng.md)); the key isn't a valid voice id, so it never shares a draw
with a render. Temperature is uniform in 0.6–1.0, rounded to 0.01; `top_p` is 0.95 for all; the
omlx `seed` is a draw in [0, 2³¹); the candidate's render seed is a draw in [0, 2³²). The sampling
sent is stored on each generation. The request group is `vibe-<vibeId>-stream-<seed>`, so the
seed is logged and an evaluation can use one fixed seed across vibes; a seed whose group already
exists for the vibe is refused before anything is sent.

**Requests run one candidate at a time**: candidate i's request, then its repair if it gets one,
then candidate i + 1. The queue holds one request in flight anyway, and storing each generation as
it returns keeps what was made when the job is cancelled.

**The repair round.** At most one, for an answer that parsed into something with errors to quote:
schema errors (shape and validator, rule `answer` and `schema`) or lint findings. The repair
prompt is the first prompt, the parsed answer as compact JSON in an assistant turn (no prose or
thinking, so it stays short), and a user turn listing each error as `- path (rule): message` and
asking for the whole corrected object. It uses the same sampling. A repair prompt over the budget
is not sent; the candidate keeps its reason and gains a `repairOverBudget` finding saying so. A
truncated answer, no JSON, invalid JSON or several objects get no repair: there is no parsed
answer to correct.

**What is stored.** Every response is a `generations` row (round 0, or round 1 naming the
generation it repairs in `repairsId`), with the reasoning text (null when the model sent none),
the request as the queue sent it (`requestParams`: the body without its messages, so
`max_tokens`, sampling, `stream`, `n`, and `response_format` when it went out), and the queue's
backoffs (`retries`), all from what the queue reports, not from the config. A rejected candidate
whose answer parsed keeps the genome as written in `rejectedGenome`, so phase 4 and phase 8 read
negatives without parsing raw text again. Each requested candidate is one `candidates` row naming the
last generation made for it, with its seed, source `llm`, the locks, the intent when the answer
had a one-line one, `rejectReason` (null when valid) and every reason in `lint` as a `LintResult`:
the linter's findings, schema errors with rule `schema` or `answer`, and for an answer that never
parsed a single finding whose rule is the reject reason. Only a valid candidate writes a
`genomes` row.

**A request that fails in the queue** (a cancel, busy past the maximum wait, a timeout, a
connection error, an error status) stops the batch and is rethrown: the next request would most
likely fail the same way, and on a busy omlx it would add load to the live site. Before
rethrowing, a request the queue sent at least once (`OmlxRequestError.attempts` above 0) is
stored as a generation with `finishReason` `error`, an empty response and the message in `error`,
and its candidate gets reason `requestFailed`. When it was a repair, the candidate keeps the first
try's findings and adds the failure. A repair the queue never sent (a cancel during the gap)
leaves no generation; the candidate names the first try, keeps its reason, and adds a
`repairNotSent` finding. So every stored generation ends with a candidate, and 2l counts
`requestFailed` apart from the model's failures.

**Reject reasons** (`REJECT_REASON` in `src/domain/reject-reason.js`): `truncated`, `noJson`,
`invalidJson`, `severalObjects`, `schemaErrors`, `lintErrors`, `requestFailed`. `severalObjects` is a sixth beside
the plan's five, because "the model wrote two answers" and "the model wrote broken JSON" call for
different fixes to the prompt, and 2l counts them by type.

**`response_format`** is sent with every request as a loose schema (an object with a string
`intent` and an object `genome`); the queue sends it only when `queue.sendResponseFormat` is on,
which 2l settles.

## Alternatives considered

- **A repair for invalid JSON, quoting the parse error** — rejected for now, following the plan:
  the parse error points at a character, not a genome path, and 2l's counts show whether invalid
  JSON is common enough to need it.
- **The raw response as the repair's assistant turn** — rejected: prose and pretty-printing can
  double its length and push a repair over the budget for nothing.
- **Reserving budget for the repair when building the first prompt** — rejected: the answer's
  size isn't known in advance, and the seed-vibe test shows half the budget is left as it is.
- **Sending all n requests to the queue at once** — rejected: the queue runs them one at a time
  either way, and repairs would then queue behind every other candidate's first request.
- **Varying `top_p` as well** — rejected: two knobs that both widen sampling make the logged
  sampling harder to read against outcomes; temperature alone gives the spread.
- **A UUID request group** — rejected: naming the group by its stream seed logs the seed without a
  new column, and refusing a reused seed keeps groups unique.

## Consequences

- The caller (2i's job, 2l's evaluation) draws the stream seed, for example from `Math.random` in
  the server, and passes the config, the session and the locks.
- A change to the prompt's wording changes every later generation's prompt; stored prompts keep
  the old one, so SFT and DPO still read what was sent.
- A vibe whose brief and notes alone pass the budget can't generate until the owner shortens them;
  the error says so.

## Amendments

- 2026-11-06: from step 2f's review. Migration 0002 stores the reasoning, the request as sent,
  the retries, a failed request's error and a rejected candidate's genome; failed requests and a
  repair cancelled before it was sent are stored with a candidate; a stray brace in prose is
  rescanned, a listed answer is refused, and request groups are named per vibe.
- 2026-11-06: from step 2l ([0030](0030-seed-vibes-and-evaluation.md)). `generateCandidates`
  takes an optional `onCandidate(candidate, firstReason)`, called as each candidate is stored
  with the reason its first answer was rejected, which a repaired candidate's row no longer
  holds; the evaluation's before-repair rates read it. `requestGroupName(vibeId, seed)` is
  exported, so a caller can name a group before generation returns.
- 2026-11-06: from step 2m ([0031](0031-fewer-waits-after-first-evaluation.md)). The schema text
  writes a name plainly and marks a possible trajectory with `(T)` after the default
  (`cutoff 100..2000 Hz =600 (T) low-pass`), since the model copied a `~` written against the
  name into its keys. `generateCandidates` awaits `onCandidate` before its next request, and
  takes `onStep({index, kind})`, called as each first request or repair is queued and as omlx
  answers one busy.
- 2026-11-07: from step 3c ([0035](0035-locks.md)). The lock is widened to `{path, value,
  voiceType?}`: a path may name a choice, a whole trajectory or a whole voice, and a voice's
  parameter carries the voice's type, which its prompt line adds (`voices.pad.hold = 30 (a pad
  voice)`). The `Lock` type moved to `validate-lock.js`. Every valid answer gets the locks
  written in by `applyLocks` before the recording check and the linter; a lock the answer can't
  take is a `lock` finding and goes to the repair round. A candidate made with locks stores the
  paths changed and filled in `operatorParams`. The session's candidates job passes the vibe's
  live locks; the evaluation still passes none.
- 2026-11-07: from step 3b ([0034](0034-feature-ranges-as-soft-targets.md)). Every first prompt
  carries the vibe's feature ranges as `targetsText`'s lines, after `constraintsText()` and
  before the locks, and leaves them out when the vibe has none. `PromptRevision` gains `ranges`,
  which `generateCandidates` takes from `validateTargets` on the revision's soft targets, and a
  revision whose stored ranges don't validate stops generation with an error naming it. Other
  keys of `softTargets` still stay out of the prompt. The seed-sized budget tests now carry a
  range on every feature and still fit under half the budget.
- 2026-11-07: from step 3d ([0036](0036-revision-pass.md)). The request, store and repair steps
  are module functions every operator that asks the model calls, over a `Batch` (one request
  group's store, queue, config, revision, retrieval, constraints, playable recordings, locks and
  hooks): `ask`, `keep`, `failedVerdict`, and `requestCandidate`, which is a first try, one
  repair round and the stored candidate. `keep` takes the candidate's origin (seed, source,
  parents, operator, operatorParams). `currentRevision` and `checkRevision` check a revision's
  constraints and ranges. `buildRepairPrompt` is built on `followUp`, which the revision uses
  too, and quotes errors with `quotedErrors`. The locks' prompt paragraph is `locksText`. A
  revision is a `revise` candidate with its first try in `parentIds`, in its own request group
  `<group>-revisions`, with its render seed from slot 3 of the stream.
- 2026-11-07: from step 3f ([0038](0038-explore.md)). `buildPrompt` takes an optional `base`
  (`{genome, direction}`), written after the rated examples as "The base genome to vary:", the
  base's canonical genome with the locks applied, and the direction as a JSON string, with an ask
  for a variation in place of "Write one new genome for this vibe." Over the budget the examples
  are trimmed first, then the base, and the examples that fit without it come back; the result's
  `baseTrimmed` says so, and the error says "with no examples and no base" when even that
  doesn't fit. `generateCandidates` takes an optional `explore` (`{base, genome, direction}`):
  its candidates store the base in `parentIds`, operator `explore` and `{direction,
  baseTrimmed}`, in the request group `vibe-<vibeId>-explore-<seed>`, which
  `requestGroupName(vibeId, seed, operator)` names.
