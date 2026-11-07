# 0027. Session and rating routes, A/B order from a logged seed, ratings name the render heard

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

Step 2i puts HTTP routes over the store ([0021](0021-store-tables-and-append-only.md)), the omlx
queue ([0022](0022-omlx-queue.md)), generation ([0024](0024-prompt-parse-repair-generation.md)),
the server ([0025](0025-http-server-and-audio.md)) and the job runner and excerpts
([0026](0026-job-runner-and-excerpt-renders.md)), so 2j's keyboard-first UI can run a session:
make and edit a vibe, ask for candidates, hear them, and rate them. Ratings are irreplaceable and
must store what 2c's rows need, the heard excerpt kept as rated audio. Phase 2's acceptance 4
wants every rating read back after a restart. 0025 requires JSON-only bodies and no CORS
headers, and AGENTS.md that nothing runs on its own.

## Decision

**The App** gains the long-lived parts 0025 left to later steps: the one omlx `queue`, the job
runner `jobs`, `random` (a draw in [0, 1) for stream seeds, order seeds and the queue's jitter),
and `sessionJobs`, the ids of the jobs each session added since start-up. `startServer` takes
an injected `clock` and `random` for tests; run as a program it uses `Date.now`, the real timers
and `Math.random`, and logs each omlx retry. Making the queue sends nothing. `stop()` cancels
every job and waits for them before closing the store, so a job never writes to a closed store
and no request or render holds the process open.

**Routes.** All under `/api/`, all JSON. A body field outside a route's list is a 400 naming
it; a bad field is a 400 that names the field and what it got; an id in the path that isn't a
row id, or names no row, is a 404; acting on a stopped session is a 409.

**Length limits** (`MAX_CHARS` and `MAX_TAGS` in `src/server/request-fields.js`): a vibe's name
200 characters, its brief 4 000, a note 2 000 (a vibe note, a thumbs note, a sketch's notes), and
a sketch at most 32 tags of at most 64 characters each; past any of them is a 400 naming the
field. A brief at its limit is about 1 150 tokens at 3.5 characters a token, a seventh of the
8 192-token context budget ([0024](0024-prompt-parse-repair-generation.md)); vibe notes go into
the prompt too, which is why a note is held under the brief. Many long notes can still pass the
budget together, and then `buildPrompt` fails saying to shorten the brief or notes.

| Method and path | Body | Reply |
|---|---|---|
| `GET /api/vibes` | | `{vibes}`, each with its current `revision` |
| `POST /api/vibes` | `{name, brief, constraints, softTargets}`, all required | the vibe |
| `GET /api/vibes/:vibeId` | | the vibe with `notes` and `sessions` |
| `GET /api/vibes/:vibeId/revisions` | | `{revisions}`, oldest first |
| `POST /api/vibes/:vibeId/revisions` | the whole draft again | the vibe at its new revision |
| `POST /api/vibes/:vibeId/notes` | `{text}` | the note |
| `GET /api/vibes/:vibeId/ratings` | | `{ratings, feedback, sketches}`, oldest first |
| `POST /api/vibes/:vibeId/sessions` | `{}` | the session `{id, vibeId, startedAt, stoppedAt}` |
| `GET /api/sessions/:sessionId` | | the session with `jobs`, their statuses without results |
| `POST /api/sessions/:sessionId/stop` | `{}` | the same, stopped, its jobs cancelled |
| `POST /api/sessions/:sessionId/candidates` | `{count?}`, 1 to 32, default 8 | the job's status |
| `POST /api/sessions/:sessionId/excerpts` | `{}` | the job's status |
| `GET /api/sessions/:sessionId/candidates` | | `{candidates}` |
| `GET /api/jobs` | | `{jobs}`, without results |
| `GET /api/jobs/:jobId` | | the job's status with its result |
| `POST /api/jobs/:jobId/cancel` | `{}` | the job's status |
| `POST /api/sessions/:sessionId/thumbs` | `{renderId, direction, note?, playedFraction, timeTakenMs}` | the feedback row |
| `POST /api/sessions/:sessionId/macro-feedback` | `{renderId, macro, direction, playedFraction, timeTakenMs}` | the feedback row |
| `POST /api/sessions/:sessionId/ab-pairs` | `{a, b}`, two render ids | `{a, b, orderSeed, leftSide}` |
| `POST /api/sessions/:sessionId/ab-ratings` | `{a, b, orderSeed, outcome, aPlayedFraction, bPlayedFraction, timeTakenMs}` | the rating row |
| `POST /api/sessions/:sessionId/sketches` | `{candidateId, renderId, notes, tags}` | the sketch row |

Thumbs take `up` or `down` and an optional non-empty note; macro feedback takes `more` or `less`
and a macro name from the genome schema; an outcome is `a`, `b`, `tie` or `skip`. Rows come back
as the store returns them, so the UI and the read-back see the same objects.

**Every POST reads a JSON body, even one with no fields**, which the client sends as `{}`. A
route that ignored its body would answer a cross-site form post or a `text/plain` fetch, which
skip CORS's preflight, and 0025's protection rests on every body being JSON. Starting a
session, a job or a stop are the routes a page on another site would most want to send.

**Edits append.** An edit is a new revision with the whole draft, never an UPDATE. Constraints
are checked by 2b's `validateConstraints` and refused with every error; soft targets must be an
object and are kept as given until phase 3 measures against them. Notes, sessions and ratings
are appended likewise. Nothing here removes a row: removal routes come with the UI that needs
them.

**The candidate job** (`kind: "candidates"`) runs 2f's `generateCandidates` for the session's
vibe at its current revision, with a stream seed drawn from `random` and no locks (phase 3 adds
them), then renders every valid candidate's excerpt in order through 2h's `renderExcerpts`. Each
candidate's target is its revision's (`vibeLoudness`). While it generates, aborting its signal
calls the queue's `cancel()`: the runner runs one job at a time, so every request in the queue is
this job's. The listener is removed before the renders, and the renders check the signal before
each one. The **excerpts job** (`kind: "excerpts"`) renders every valid candidate of the session
again, reusing cached ones, for a candidate whose excerpt was replaced or made by an older
server (0026 says the UI asks again then).

**Stopping a session** appends its stop row, then cancels each job it added: a queued one is
dropped unstarted, a running one aborts, which cancels the omlx request in flight and the ones
queued behind it. A stopped session takes no jobs and no ratings. Several sessions on one vibe
may be open at once; the UI decides when to stop one. Jobs are kept in memory (0026), so after a
restart a session lists no jobs and an old job id is a 404.

**The job's status** is 0026's `JobStatus`: `id`, `kind`, `state`, `progress`, `result`, `error`,
`addedAt`, `startedAt`, `finishedAt`. `progress` is null while candidates are generated (2f
reports no progress) and counts excerpts once rendering starts. A candidate job's `result` is
`{requestGroup, candidateIds, excerpts: [{candidateId, renderId}]}`, every candidate made counted,
rejected ones included; an excerpts job's is `{excerpts}`. The UI polls `GET /api/jobs/:jobId`
and then reads the candidates.

**A candidate** in the list is `{id, genomeId, seed, intent, rejectReason, lint, genome,
createdAt, excerpt}`. `genome` is the valid genome, null when rejected. `excerpt` is
`{renderId, url, offset, duration, target, features, checks}`, with `url` the
`/audio/:renderId` path, or null when the candidate has no genome or no current render: one made
by this server's producer at its target with its file present.

**Ratings name the render heard.** Each rating body names the render id the page played, never
a candidate alone, so the row records what was heard. The route checks the render is of a genome
of the session's vibe (a 400 otherwise) and was made by this server's producer (a 409 asking for
the excerpt to be rendered again otherwise, since `captureRatedAudio` would refuse it). Only once
every field has passed does it call `captureRatedAudio`, so a refused rating keeps no audio, and
the rating stores the heard identity from the rated-audio row beside its id. A rating is made
under the vibe's current revision. A sketch names its candidate and the render heard, which must
be that candidate's genome and seed; its row has no rated-audio column, and capturing the audio
keeps what was heard all the same.

**A/B order.** `POST …/ab-pairs` draws an order seed, an integer in [0, 2³²), from `random`,
and returns `leftSide = abOrder(orderSeed)`. The page shows that side on the left and sends the
seed back with the rating; the route computes `leftSide` again from `orderSeed` with `abOrder`
and stores both, so a stored pair's order and seed always agree and the order is reproducible
from the row. A client could still send a seed it chose; with a single owner on a home LAN that
doesn't matter.
`abOrder` (`src/domain/ab-order.js`) is one PRNG draw under the key `:ab-order`, which no voice
id can match ([0003](0003-counter-based-prng.md)): below 0.5 is `a`. Over seeds 0–199, `a` is on
the left 107 times (53.5%). The pair route stores nothing: a pair the owner never rates leaves no
row. a and b must be two different renders.

**Played fraction and time taken** are measured by the page (2j), which the server checks only
for range. `playedFraction` is the share of the excerpt's duration the owner played at least
once: the union of the played intervals over the duration, from 0 to 1, so replaying the first
five seconds four times counts five seconds. An A/B rating has one per side. `timeTakenMs` runs
on the page's monotonic clock from when the item was put in front of the owner (the candidate
selected, or the pair shown) to the rating action, up to a day.

**A macro's value** for "more / less like this" is `macroWindow(genome, macro, offset,
duration)` (`src/domain/macro-window.js`): the macro's effective value sampled every second over
the heard window, both ends included, stored as `{min, max, mean}`. A macro can be a trajectory,
so one number at one time would misstate what was heard.

## Alternatives considered

- **Ratings that name a candidate, the server finding its current excerpt** — rejected: after a
  restart under new code the server would capture a render the owner never heard and store it as
  heard.
- **The page drawing the A/B order with `abOrder` itself** — rejected: drawing on the server
  keeps the seeds from one source, and the page only has to echo the seed it was given.
- **Storing the pair when it is drawn** — rejected: a pair row would need a later update to add
  its outcome, which the append-only rule refuses, and an unrated pair says nothing.
- **POSTs with no body** — rejected: see the JSON-body rule above.
- **One open session per vibe, enforced** — rejected for now: the owner may keep two browsers on
  one vibe, and 2j can stop the old session when it opens a new one.
- **Cancelling a session's queued omlx requests one by one** — rejected: the queue has one
  `cancel()` and holds only the running job's requests, since one job runs at a time.
- **A partial edit (`PATCH`)** — rejected: the form sends the whole draft, and a revision is the
  whole draft as edited.
- **The macro's value at the excerpt's middle** — rejected: it misreads a macro that ramps across
  the window.

## Consequences

- 2j drives everything here: it reads `leftSide`, measures played fraction and time taken, sends
  `{}` on bodiless POSTs, and polls the job route.
- An evaluation job (2l) shares the queue; if a session is stopped while an evaluation runs, the
  evaluation is not cancelled, since only the session's own jobs are.
- If jobs ever run side by side, cancelling a job's queue requests needs a cancel per request
  group instead of the whole queue.
- Removing a note, a rating or a sketch needs routes that call `markRemoved`; none exist yet.
