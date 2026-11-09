# 0092. Words beside a running job: a cancel scoped to one job, and a words lane

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the top bar's two entries and its Cancel.
  Amends [0022](0022-omlx-queue.md) (a request carries an owner, and `cancel(owner)`),
  [0026](0026-job-runner-and-excerpt-renders.md) (a second lane for words jobs),
  [0073](0073-top-bar-job-indicator.md) (an entry per lane, each with a Cancel) and
  [0084](0084-words-operator.md) (the shift's words run as a words job)

## Context

Phase WF makes words the main control: the owner's words are read into values by one model
request and its repair (0084), and acceptance 5 asks that each shows in the top bar with a
cancel. The job runner ran one job at a time (0026), so a `words` job waited behind a search by
ear, a render, a fill or a candidates job, which can run for minutes; a search by ear holds the
runner until the owner stops it. The omlx queue's `cancel()` rejected every waiting request and
aborted the one in flight (0022), and every job that talks to omlx called it on abort
(candidates, evaluation, propose, draft brief, develop, words). Running two jobs at once would
let either one's cancel kill the other's requests. 0084 worked around this for the search's
shift words by asking the model inline from the route, so those words showed no top-bar entry
and took no cancel. omlx serves a live site: one request in flight, the gap and the back-off
stay as they are.

## Decision

**A cancel scoped to one job.** A `CompletionRequest` may carry an `owner`, any object. The
queue's `cancel(owner)` rejects that owner's waiting requests with "omlx request cancelled" and
marks its running request cancelled, interrupting its gap, back-off or attempt, as before;
other owners' requests keep their place and their attempt. `ownedBy(queue, owner)` in
`omlx-queue.js` is the queue as one job uses it: each request carries the owner, and its
`cancel()` cancels only those. Every job that cancels on abort builds `ownedBy(app.queue,
job.signal)`, sends through it, and cancels it; the job's `AbortSignal` is the owner, since it
is the one thing each job already holds alone. The queue's order, its one request in flight,
its gap and its back-off are unchanged: owners only decide what a cancel reaches.

**The bare `cancel()` stays**, cancelling every request, for shutting the queue down: the test
app's teardown uses it. Server shutdown cancels each job, and each job cancels its own requests, so nothing in `src/server` calls it.

**A words lane.** The runner keeps one lane per name from `jobLane(kind)` in
`src/domain/job-kind.js`: `words` jobs run in the words lane, every other kind in the main lane.
Each lane runs one job at a time, in the order added; the main lane is the runner of 0026,
unchanged. `idle()` waits for both. `cancel(id)` acts on the job's own lane. Both lanes send
through the one omlx queue, so omlx still sees one request at a time: a words request waits
behind a main-lane request in flight, and the other way round, in the order they were sent.
The 409 for a second unfinished words job stays, now `refuseSecondWords` in `ask-words.js`,
shared by both routes that add one.

**The shift's words are a words job.** `POST …/ear-search/shift-words` builds the `shift`
prompt from the run's steering and best when the owner asks, refuses a second words job, and
adds a `words` job (`shiftWordsJob` in `ear-shift.js`, on `wordsJob`). Its result is
`{shift, said, generationId}` as the route returned before, and its request group keeps the
operator `shift`. A still-invalid answer fails the job with the operator's findings, in place
of 0084's 502. The quick A/B page starts it with `runJob`, as other pages start theirs: a box
under the words field shows its step and a Cancel, the button is held while it runs, and the
finished job's `shift` sets the sliders as before. When the server names another unfinished
words job, the page follows that one and leaves the sliders alone, since its result may be for
another field set.

**The top bar** has an entry per lane, the main one first, each showing that lane's running job,
or its oldest waiting one, with its percent, its bar, how many more wait in that lane, and a
Cancel that cancels the job shown. A lane with nothing unfinished shows nothing. The page that
started a job still follows it in its own box, which shows it cancelled however it was
cancelled. `laneSummaries` in `jobs-summary.js` splits the jobs by `jobLane`.

**Tests changed.** In `test/server/ear-search-job.test.js`, the shift-words test reads the
route's reply as a running words job and its result from the runner; the invalid answer is a
failed job whose error holds the findings, not a rejected route. In
`test/web/jobs-summary.test.js`, the first summary also holds the shown job's `id`.

## Alternatives considered

- **Running any job beside any other** — rejected: renders block the event loop for seconds,
  which 0026 keeps away from a request's first-token timer; a words job is one short request
  and its repair, and renders nothing.
- **A request group or a job id as the owner** — rejected: the signal is already passed to
  everything a job runs, while a request group is per batch and a job id would have to be
  threaded through each operator.
- **Removing the bare `cancel()`** — rejected: shutting down needs to reach every request, and
  the queue's own tests of cancel would all have to change.
- **The queue listening to each request's `signal` itself** — not taken: it would change every
  operator's call shape, where an owner token changes only what the jobs pass and cancel.
- **Cancel only in the page's own box, as 0073 had** — rejected: acceptance 5 asks for a cancel
  with the top bar's entry, and a words job started on one page can be stopped from another.
  0073's worry, that cancelling elsewhere leaves no box saying what was kept, is answered by the
  starting page's box, which follows the job's status to its end.
- **Keeping the shift inline** — rejected: it shows nothing in the top bar and can't be
  cancelled.

## Consequences

- A words request can now be in the queue while a main-lane job renders. A render blocks the
  event loop for 1–3 s at a time, so a words request's first-token timer may read up to that
  much late; the threshold is 30 s plus the prefill allowance, so this does not trip it.
- A words job asked during a long main-lane request waits for that request to end, plus the
  gap; the top bar shows it running, with its step saying it is reading the words.
- A new kind of job that should run beside the main lane is a change to `jobLane` and this
  record.
- A future job that talks to omlx must send through `ownedBy`; one that called the bare
  `cancel()` would cancel the other lane's requests.
