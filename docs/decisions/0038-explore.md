# 0038. Explore: fresh first prompts holding a base, with an optional direction

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0024](0024-prompt-parse-repair-generation.md) (the base section, its place in the trimming
  order, and the explore request group) and
  [0031](0031-fewer-waits-after-first-evaluation.md) (explore's row in the conflict table and
  its progress steps).

## Context

Phase 3 lets the owner move around a candidate they like. Nudge
([0037](0037-nudge-and-branch.md)) moves its numbers with no model request; explore asks the
model for variations, which can change what a nudge can't: voices, choices, flags, recordings.
The owner names a base candidate of the session's vibe, made in any session, and may add a
one-line direction ("slower", "less bell"). Every model answer already takes one path
([0036](0036-revision-pass.md)): parse, locks, validate, lint, one repair round. A first try
that misses a feature range is revised once by a follow-up turn on its round-0 prompt.

## Decision

**Each child is a fresh first prompt.** `buildPrompt` builds it from the vibe's current
revision, notes, locks in force and rated examples, as for any first try, with one more section
holding the base. It's never a follow-up turn on the base's conversation, so exploring from a
revision, a nudge child (which has no conversation) or another explore child never chains turns,
and a brief, note or lock changed since the base was made is the one the model reads.

**The base section** comes after the rated examples and replaces the ask:

```
The base genome to vary:
<the base's canonical genome, with the locks in force applied>
The owner's direction for this variation, as a JSON string: "slower"

Write one variation of the base genome for this vibe: keep the locked values exactly and change the rest. Follow the owner's direction.
```

The direction line and "Follow the owner's direction." are left out when there is no direction,
and the clause after the colon when no lock is in force. The base's genome is written by
`canonicalGenome`, as the examples are. The locks go into it first, since the base may predate a
lock, so the base the model reads agrees with the locks section above it. A base that can't take
the locks (a lock on a voice it lacks) is refused, as a nudge's is: a 409 at the route, and a
failed job if the locks changed after the request.

**The direction is quoted as JSON.** It goes into the prompt as the owner wrote it, inside
`JSON.stringify`, so a quote, backslash or line break in it is escaped, and it can't end the
direction line or start a section of its own (the prompt's sections are separated by blank
lines). The route also refuses a direction holding any control character (`\p{Cc}`: line breaks,
tab, NUL, DEL and NEL among them) or U+2028 or U+2029, which `JSON.stringify` leaves as they
are, and one over `MAX_CHARS.direction`, 200 characters: a 400 each. The direction is the
owner's text and reaches pages as it was written, so 3g's card and lineage page show it with
`textContent`, never as HTML. A direction that is absent, null, empty or
only white space is no direction.

**Trimming.** When the prompt is over the context budget, examples are trimmed from the end
first, as before. When it is still over with every example gone, the base section goes, and the
examples that fit without it come back: the prompt is then the plain first prompt, and the child
stores `baseTrimmed: true`. When even that doesn't fit, `buildPrompt` throws as before, saying
"with no examples and no base". A seed-sized vibe (every constraint kind, a range on every
feature, a 600-character brief, a dozen 150-character notes, three locks, six examples) with a
315-token base and a 200-character direction is about 4,300 tokens of the 8,192; its revision
follow-up, with the answer and a miss on every range, about 5,100.

**Children.** Each child goes through `requestCandidate`: parse, locks, validate, lint and one
repair round. It stores the base in `parentIds`, operator `explore`, source `llm`, the session
the request was sent to in `sessionId`, and `{direction, baseTrimmed}` in `operatorParams`,
beside the lock paths the answer changed and left out. Its render seed and sampling come from
the job's own stream seed, as a first try's do, so a child never shares a heard identity with
its base. The children of one job form their own request group,
`vibe-<vibeId>-explore-<seed>`, so their logs read apart from first tries
(`vibe-<vibeId>-stream-<seed>`).

**Children are revised like any first try.** The explore job is the candidates job with the
base passed in: each valid child's excerpt is rendered and measured, and one that misses a range
or fails a render check is revised once (0036). The revision replays the child's own round-0
prompt, its explore prompt, byte for byte, never the base's conversation, in the group
`vibe-<vibeId>-explore-<seed>-revisions`. The candidates route pairs it with the child as for a
first try.

**The job and route.** `POST /api/sessions/:sessionId/explores` takes
`{candidateId, direction?, count?}`: `direction` a string or null, `count` 1 to 32, default 4.
A malformed body is a 400 naming the field; a candidate that doesn't exist, was removed, has no
genome, or belongs to another vibe is a 400, as for a nudge; a stopped session is a 409. It
returns the job's status, `kind: "explore"`, and the job's `result` is the candidates job's,
`{requestGroup, candidateIds, excerpts: [{candidateId, renderId}]}`, revisions included.

**One job per action.** An explore identical to one queued or running in the same session (same
base, direction and count) is a 409 `{error, jobId}`. Any other explore queues, as does an
explore while a candidates or nudge job runs. The action is written as the JSON of
`[candidateId, direction, count]`, since a direction may hold spaces.

**Progress** is the candidates job's, counting children, with "Asking the model for variation 2
of 4" in place of "Asking the model for candidate 2 of 4". The fix, render, measure and revise
steps keep "candidate", the word every card goes by.

## Alternatives considered

- **A follow-up turn on the base's conversation** — rejected: a nudge child has none, a
  revision's would chain a third turn onto its first try's, and the prompt would carry the brief,
  notes and locks of when the base was made.
- **Writing the direction plainly, unquoted** — rejected: a line break would let it open a
  section that reads like the owner's notes or locks. Stripping line breaks instead would change
  what the owner wrote without saying so.
- **Failing the budget rather than dropping the base** — rejected: the plan orders the base after
  the examples and before the failure, and a plain first prompt is still a useful candidate,
  marked `baseTrimmed` so the owner can tell.
- **Showing the base as stored, without the locks** — rejected: a base older than a lock would
  contradict the locks section, and the model tends to copy the base.
- **A separate explore job module** — rejected: it would repeat the candidates job's
  generate, render, measure, revise and render flow line for line.
- **The stream request group name for explore children** — rejected: with a fixed `random` (the
  tests', or a seeded run) an explore after a candidates job would draw the same seed and be
  refused, and the logs couldn't tell the two apart.

## Consequences

- An explore costs one omlx request a child, two when it is repaired, and one more when it is
  revised, so 4 children are 4 to 12 requests through the queue.
- A child's prompt is larger than a first try's by its base, about 150 to 320 tokens for the
  shipped genomes, so the examples are trimmed a little sooner.
- 3g's card adds the direction field and the button; until then the route is reachable only by
  HTTP.
- A child whose base was trimmed is a plain first try in all but its parent. The lineage page
  (3g) reads `operatorParams.baseTrimmed` to say so, and 3h's statistics read it too, so a
  trimmed child isn't counted as a variation of its base.
- An explore prompt is larger than a first try's, so a child near the budget may have its
  revision skipped over budget (`revisionOverBudget`, 0036): the follow-up replays the prompt
  untrimmed and adds the answer and the ask. The seed-sized case above leaves about 3,000
  tokens.
