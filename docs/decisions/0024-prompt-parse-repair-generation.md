# 0024. The generation prompt, the {intent, genome} answer, one repair round, typed rejects

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

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
  and the ask. A section with nothing in it is left out. Soft targets are left out until phase 3
  gives them features to be measured against.

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
prose around it are ignored. None found is `noJson`; spans found and none parses is
`invalidJson` with the longest span's parse error; two or more that parse is `severalObjects`.
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
sent is stored on each generation. The request group is `stream-<seed>`, so the seed is logged,
and a seed whose group already exists is refused before anything is sent.

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
generation it repairs in `repairsId`). Each requested candidate is one `candidates` row naming the
last generation made for it, with its seed, source `llm`, the locks, the intent when the answer
had a one-line one, `rejectReason` (null when valid) and every reason in `lint` as a `LintResult`:
the linter's findings, schema errors with rule `schema` or `answer`, and for an answer that never
parsed a single finding whose rule is the reject reason. Only a valid candidate writes a
`genomes` row.

**Reject reasons** (`REJECT_REASON` in `src/domain/reject-reason.js`): `truncated`, `noJson`,
`invalidJson`, `severalObjects`, `schemaErrors`, `lintErrors`. `severalObjects` is a sixth beside
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

- The model's reasoning text (`Completion.reasoning`) is not stored: `generations` has no column
  for it. Keeping it for fine-tuning needs a migration adding one.
- The caller (2i's job, 2l's evaluation) draws the stream seed, for example from `Math.random` in
  the server, and passes the config, the session and the locks.
- A change to the prompt's wording changes every later generation's prompt; stored prompts keep
  the old one, so SFT and DPO still read what was sent.
- A vibe whose brief and notes alone pass the budget can't generate until the owner shortens them;
  the error says so.
