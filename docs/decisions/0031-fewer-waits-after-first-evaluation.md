# 0031. Fewer waits: excerpts in the candidates job, one job per action, progress steps, a thinking switch, a plain notation, feedback that can be undone

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm. Amends
  [0019](0019-config-file-and-paths.md) (`queue.thinking`),
  [0022](0022-omlx-queue.md) (the request body and a per-request `onRetry`),
  [0024](0024-prompt-parse-repair-generation.md) (the schema notation and the generation hooks),
  [0026](0026-job-runner-and-excerpt-renders.md) (progress steps),
  [0027](0027-session-api-and-ratings.md) (duplicate jobs, the candidate job's renders, and
  feedback states and removal) and
  [0030](0030-seed-vibes-and-evaluation.md) (the evaluation's params and report, and its 409 body).
  Amended by [0036](0036-revision-pass.md) (the candidates job's revision steps, and the
  candidates route's `pair` field).

## Context

The owner's first evaluation (Cold dorian drone, 16 candidates) gave 2 valid answers on the
first try and 14 after one repair. Every first-try failure was a schema error, and every error
was a key with the prompt's `~` copied onto it: `cutoff~` 22 times, `sweep~` 22, `swing~` 19,
`tone~` 14, `level~` 13, `reverbLevel~` 5, `macros.brightness~` 4, and one each of
`delayFeedback~`, `delayLevel~` and `macros.warmth~`. The schema text wrote the trajectory mark
against the name (`cutoff~ 100..2000 Hz =600 low-pass`). Each request spent about 5,000
completion tokens and 12–20k characters of reasoning on a 400-character answer, at about 55 s a
request.

The owner also queued excerpts by hand, could queue the same job twice, saw only a count while a
job ran, and found that "more brightness" then "less brightness" on one card left both attached:
"i would think they cancel each other out."

## Decision

**Prompt notation.** `schemaText` writes the name plainly and puts `(T)` after the default when
the parameter may be a trajectory: `cutoff 100..2000 Hz =600 (T) low-pass`. The header line reads
`(T) = may be a trajectory: …`. The token beside a name is now always its range, never a mark. The
text is 2,982 characters, under the 3,000 that 0005's test holds. The validator still refuses a
`~` key, and the repair message is unchanged: with no `~` left in the prompt there is nothing to
warn about. Prompts are not audio, so the engine version stays.

**Thinking switch.** `queue.thinking` (boolean, required) is sent with every request as
`chat_template_kwargs: {enable_thinking: <value>}`. It is a request field that omlx 0.7.3 passes
to the model's chat template, not an omlx setting. The example sets it `true`, which is what
requests did before. It is part of each generation's stored `requestParams`, since those are the
body as sent, and of the evaluation's `params`. The evaluation report gains
`reasoning: {answered, withReasoning}`: of the generations that were answered, how many came back
with reasoning text. With thinking off, a `withReasoning` above 0 says omlx or the template
ignored the switch.

**The candidates job renders each excerpt as the candidate is made.** `generateCandidates` awaits
`onCandidate` before its next request, and the candidates job renders a valid candidate's
excerpt there. Between requests nothing is in flight at omlx, so a render never shares the event
loop with a request's first-token timer (the reason 0026 runs one job at a time). The queue's
gap is counted from the end of the last attempt, so the render's time counts toward it. A cancel
aborts the job's signal, which cancels the queue (0027); a render already started finishes, and
the job checks the signal before and after each render, so it stops before its next request. A
request that fails in the queue still stops the batch, and the candidates made before it keep
their excerpts. The excerpts route stays as the way to get back an excerpt that was replaced or
made by an older server.

**One job per action.** Adding a job like one queued or running is a 409 whose body is
`{error, jobId}`, `jobId` naming the unfinished job:

| Route | Refused while |
|---|---|
| `POST /api/sessions/:id/candidates` | the session has a candidates job unfinished |
| `POST /api/sessions/:id/excerpts` | the session has an excerpts job unfinished, or a candidates job, which renders them itself |
| `POST /api/evaluations` | any evaluation is unfinished |

"Unfinished" is queued or running. Another session's job is another action and is accepted. The
check and the add run with no `await` between them, so two requests at once give one job and one
409. A candidates request is not refused while an excerpts job runs: generating is different
work, and the runner queues it behind. `HttpError` takes an optional `details` object that is
spread into the body beside `error`.

**Progress steps.** A job's `progress` is `{done, total, step}`, null until the job first
reports. `done` of `total` is for a progress bar; `step` is a sentence for the owner, from
`JOB_STEP` in `src/server/job-steps.js`, or null between steps. The runner sets `step` to null
when a job finishes, however it finishes, so a stopped job never shows a stale step.

| Job | `done` / `total` | Steps |
|---|---|---|
| candidates | candidates finished (stored, and rendered when valid) / asked for | "Asking the model for candidate 3 of 8", "Asking the model to fix candidate 3", "Rendering the excerpt for candidate 3 of 8", "Waiting for the model: it is busy with another request" |
| excerpts | excerpts rendered / to render | "Rendering excerpt 2 of 8" |
| evaluation | candidates stored, across every vibe / vibes × count | "Asking the model for candidate 19 of 48", fixing and waiting as above, numbered across every vibe |

The waiting step comes from a per-request `onRetry` the queue now calls after its own, which
`generateCandidates` turns into an `onStep({index, kind})` callback. It stays until that request
answers or fails, since the queue reports a backoff's start but not the retry's.

**Feedback holds one state.** Thumbs and macro feedback hold one live row per candidate (session,
genome and seed), kind and, for macro feedback, macro. `setFeedback` runs in one transaction:
a live row with the same direction and note is returned as it is and nothing is added; any other
live row is marked removed with reason `replaced` and the new row added. So "more" then "less"
leaves one live "less", and "more" twice leaves one row. A thumbs post with the same direction
and a new note replaces the row, so the note is not dropped. Two posts at once can't both pass
the check: the route awaits the rated-audio capture first, and the check and the insert then run
synchronously.

**Removing.** `POST /api/sessions/:sessionId/feedback/:feedbackId/remove` and
`POST /api/sessions/:sessionId/ab-ratings/:ratingId/remove`, each with body `{}`, mark the row
removed with reason `undone` and return it. A row already removed, for either reason, comes back
unchanged with a 200. A row of another session, or none, is a 404; a stopped session is a 409,
as for every rating route. Removed rows already count for nothing downstream: `listRatedGenomes`
(retrieval's scores, 0024), `listFeedback` and `listRatings` all read live rows only.

**The page reads the state** from `GET /api/sessions/:sessionId/candidates`: each candidate gains
`feedback: {thumbs: {id, direction, note} | null, macros: {<macro>: {id, direction}}}`, with only
the macros that have a live row.

**Rated audio is kept.** A replaced or undone row still names its `rated_audio` row, which stays:
it is the audio that was heard when the row was made, and a removed row is still a record of what
was rated. A no-op post still calls `captureRatedAudio`, which returns the existing row for the
identity. No rated audio is removed when a rating is.

## Alternatives considered

- **Listing trajectory keys on a line of their own** — rejected: about 200 more characters, past
  0005's 3,000.
- **Accepting `~` keys and stripping the mark** — rejected: it hides a prompt the model misreads,
  and the schema is the one definition of a key.
- **Rendering every excerpt after all candidates are made** (the old order) — rejected: the owner
  hears nothing until the last answer, minutes in.
- **Refusing a candidates request while any job of the session runs** — rejected: an excerpts job
  is quick and different work; the runner queues the candidates job behind it.
- **A 409 body with only `error`** — rejected: the page needs the job id to show or cancel the
  job it already has.
- **Deleting a replaced row, or updating its direction** — rejected by the append-only rule:
  ratings are irreplaceable.
- **A no-op that also drops a changed thumbs note** — rejected: the note is the owner's words.
- **A step that names omlx or "repair"** — rejected: the page shows it to the owner as written.

## Consequences

- The owner's config fails to load until it has `queue.thinking`; `true` keeps today's requests.
- A second click on any job-starting control is a 409 naming the job, which the page can show.
- A candidates job takes as long as before; its excerpts arrive one by one instead of at the end.
- The page shows each candidate's live feedback and removes it by id; a replaced row is not shown.
- Rated-audio files are never cleaned up by an undo; they are kept as heard.
- Old sessions may hold more than one live row for one state, made before this rule; the next
  post on that state replaces all of them.

## Amendments

- 2026-11-06: from step 2m's second model test (16 candidates: 12 valid first try, 15 after one
  repair). All 9 remaining schema errors were two kinds. Six wrote a trajectory as a bare array
  (`"cutoff": [[0,120],[300,250]]`, likewise `tone` and `level`), and one wrote a malformed
  point. Three wrote `macros.brightness` as `[[0,0.1],[600,0.45,"linear"]]`. The schema text's
  header now says a trajectory is an object with key `"points"`, never a bare array, and gives
  `"cutoff": {"points": [[0, 400], [300, 900]]}`; `TRAJECTORY_TEXT` is shortened to fit, and
  the schema text is 2,996 characters. The brightness constraint reads `macros.brightness
  between 0.3 and 0.7 (one number)`: "from 0.1 to 0.45 over the whole timeline" read as a ramp.
  The other constraint texts name no macro or trajectory. The schema still refuses bare arrays,
  and the engine version stays: prompts are not audio.
  Correction: "(one number)" was wrong, because a macro may be a trajectory and the linter checks
  its whole range. 7 of 16 valid answers in the next test wrote `{"points": [...]}` for
  brightness and passed. The text now reads `macros.brightness stays between 0.3 and 0.7 the
  whole time (a number, or a trajectory within that range)`.
- 2026-11-07: from step 3d ([0036](0036-revision-pass.md)). The candidates job's steps gain
  "Measuring candidate 3 of 8" after each first try's render, "Revising candidate 3 of 8" while
  its revision is asked for, and "Rendering the revision of candidate 3 of 8". `done` counts
  first tries, each done once revised when it needed it. `candidateIds` in the job's result
  lists the revisions too, each after its first try. `GET /api/sessions/:id/candidates` gives
  each candidate `operator`, `parentIds` and `pair`, and leaves unchanged revisions out; the
  page shows one card of each pair and links the other.
