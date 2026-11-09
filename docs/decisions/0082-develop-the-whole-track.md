# 0082. A proposal writes every part's line, and one job develops every section in turn

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm a missing line as a repair finding,
  keeping developed sections unless a box is ticked, always keeping bridges, stopping the run at
  the first section still invalid, placing a listed development with the section's seconds, and
  the keys Backslash and Backquote. Amends [0067](0067-proposed-track.md) (the answer holds each part's text;
  the budget rechecked), [0079](0079-develop-a-section.md) (`developSection` is the one request
  both develop jobs send; the develop route refuses while every section is developed; a skipped
  swap points at the developments list) and [0081](0081-bridges.md) (a bridge's state keeps every
  value its check compares at its cap; a skipped bridge names its join; the bridge route refuses
  while every section is developed)

## Context

Step TD.6, acceptance 6 of phase TD: "A proposal writes text for every section and transition,
and one owner-started job develops every section in order, each request reading the developed
section before it. Every request goes through the queue, one at a time, with a cost confirm."
The owner's words for the phase: the track builder should "use text at each part of the song to
describe what happens, then it analyzes whats going on with those sketches, where the sketches
came from (lineage, etc.) to reconstruct a longer and more appropriate version of that sequence
for that part of the track", and "develop in track mode is where you can put together sketches
and describe how you want them to develop in the track."

Before this step the proposal filled `""` on every part (0077), a section was developed one at a
time from the timeline (0079), and a development whose swap was skipped stayed stored where the
page couldn't place it. TD.5's re-review found that a bridge's neighbor state, cut to its
270-token cap (0081), could drop a voice's settings or its type, which the bridge's check then
compares exactly, and that a skipped bridge's status didn't say which join it was for.

## Decision

**The proposal's text.** The answer format puts `"text"` on each section and on each kind of
transition, and a rule asks for one short line on every part, at most `MAX_TEXT_CHARS` (300),
drawn from the owner's arc: for a section what happens there, for a transition how one part
becomes the next. `checkProposal` no longer fills `""`: a part without text is
`validateArrangement`'s `missing` finding, quoted by the repair, and the text is checked as the
owner's is. `""` passes, as it does for the owner. Measured at its largest (24 full material
lines, a 600-character brief, the longest arc, a 40-window region): **3,661 tokens** of the
first prompt's 4,096, up from 3,544; the test holds it under **3,700**. A repair then has 4,531
tokens for the answer and its findings; an answer of 20 sections with every line at 300
characters would pass that, and its repair isn't sent, as 0067 says of any repair over the
budget.

**The plan** (`developPlan` in `src/domain/develop-plan.js`), read by the route and the page:
each section in order is developed, kept (it plays a development and the owner didn't ask
again), a bridge (always kept), or skipped as under `DEVELOP_LEAST` (60 s). A developed section
shortened under 60 s is kept, or skipped when asked again.

**Developing again is a checkbox**, "Develop the developed ones again", beside Develop every
section, off by default. A second button would sit beside the first doing almost the same
thing; a checkbox reads as a setting of one action and is said in the confirm. **A bridge is
always kept**: developed again as a section it would lose the end rules it was written to
(0081), and the owner can still develop it alone from its section.

**The job** (`POST /api/tracks/:trackId/develop-all {revisionId, again}`, `JOB_KIND.developTrack`
in the main lane, `developTrackJob` in `develop-track.js`): the route checks the saved version,
refuses with a 409 when the plan develops nothing, and refuses while a develop, bridge or
whole-track job is unfinished; the develop and bridge routes refuse while it runs. The job sends
through `ownedBy(app.queue, job.signal)` (0092), one request at a time, and calls
`developSection` (TD.3's prompt, request, repair and store, now shared with `developJob`) for each
section the plan develops. After each, the section takes the development at offset 0 in the
job's working arrangement, so the next section's `meetingState` reads the development just
written. The job checks its signal before each section, and a cancel during a request aborts
it, so cancel works between and during requests.

**Each development is stored as it finishes**, in its own transaction, so a cancel after the
second section keeps the first two, as acceptance 6's test asks. A section whose answer is still
invalid after its repair fails the job there: the developments before it are kept, and the
sections after it aren't asked, so a run that fails on section 3 of 10 costs no more requests;
the owner runs it again, and the sections developed so far are kept by the plan.

**One revision at the end.** The job writes no revision, as 0079 keeps that to the page. When
the job ends, however it ends, the page reads the developments again and takes the run's: those
not listed before it started, oldest first, paired in order with the sections the plan develops
(`runDevelopments`), stopping at one of another sketch than its section's. A cancelled job has no
result, so the page reads the rows, which are the same whether the job finished or not. Then
`developAllSwap` places each by `developSwap`'s rules (0066's `steerSwap`) on one timeline in
turn: a section changed or removed during the run is left out with its reason and the others
are placed; opening another version by hand leaves out all. With nothing unsaved the timeline is
saved as one version noted "Sections 1, 2, and 4 developed"; with unsaved edits it is put on the
timeline to save. One revision per section was rejected: a ten-section run would add ten
versions to the list for one action.

**The confirm** (`developAllCostText`) says what each request reads, the sections it develops
with the requests, one a section and another for each that needs fixing, the bridges and
developed sections it keeps, the sections it skips as under 1:00, that a cancel keeps those
finished, and the time from recent request times (`requestsTimeText`). The button is off on an
unsaved timeline, one with errors, or one the plan develops nothing of, saying why.

**The developments list.** A Developments card lists every development of the track
(`GET /api/tracks/:id` already returns them), oldest first, each as "Development 8 of sketch 1,
4:00, from your words “rise”: plays in sections 1 and 3." or "… not in this version.", a bridge
named as one. A select and Place in the chosen section (Backquote) put the chosen development in the
chosen section (`placeDevelopment`): the development's sketch, its id, offset 0, and the
section's seconds and words kept, as a finished development's swap leaves them; the edit is
unsaved and checked with the validator first, and one it refuses is not made, the first error
said. The development's own seconds were rejected for the section: they move every section
after it and can break a neighbor's transition, while the section's own seconds play a window
of it or hold its end, both valid.

**Keys.** Every letter is taken by the track page's tables, so Develop every section is
`Backslash` and Place in the chosen section is `Backquote`, labeled on their buttons.

**A bridge's state at its cap.** `meetingState` with `fixed` never names a voice only: its cuts
take each voice, last first, to its level and its settings that can't move, then to those
settings alone with its id and type, which the check compares. Past the cap the state is those
values alone, longer than 270 tokens, and the develop prompt's own budget leaves out the
lineage's reading and then the sketch's for the room, or refuses the bridge saying so. The join
globals in its first line were already written as the check compares them; the shared fixed
globals are written in the bridge's rules, outside the cap. Measured on the largest genome: the
state with default settings is 268 tokens; with 17-digit settings on 2, 4, 8 and 16 voices it
is at most 270, then 328, 422 and 694. The worst bridge prompt of 0081 is now 4,077 tokens (4,068
before this change) of 4,096.

**A skipped bridge** says "Kept bridge 7 for the join between sections 2 and 3 but didn't put it
in the track: … It is listed under Developments, to place by hand." (`bridgeSkippedText`); a
skipped development says the same of the list.

## Alternatives considered

- **Filling `""` for a part the model left without text** — rejected: the prompt asks for a
  line on every part, and a default would hide a missing value (principle 5); the repair names it.
- **Storing every development at the end, in one transaction** — rejected: acceptance 6 asks
  that a cancel after the second section keep the first two, and a long run would lose every
  answer to one late cancel.
- **The job keeping a partial result for a cancelled run** — rejected: it changes the runner's
  contract for every job (0026), while the rows already say what was written.
- **Skipping a section still invalid and going on** — rejected for now: every later section
  would meet a neighbor the run meant to develop, and the run would spend requests the owner
  may not want once one section fails.
- **One revision per developed section** — rejected above.
- **Raising `BRIDGE_STATE_TOKENS`** — rejected: the cap still holds every state with few long
  settings, and the prompt's budget is already the place that trades readings for room.

## Consequences

- Measured by test: `test/domain/arrange-prompt.test.js` (the text rule, 3,661 under 3,700),
  `test/domain/check-proposal.test.js` (a part without text is a finding),
  `test/server/propose-track.test.js` (text kept on every part), `test/domain/develop-plan.test.js`,
  `test/server/develop-track.test.js` (acceptance 6 against the fake omlx: the order and the
  previous development in each prompt, a cancel after the second, kept sections, the refusals),
  `test/domain/meeting-state.test.js` (17-digit settings on a dense neighbor),
  `test/web/develop-text.test.js` (the confirm's count, the run's developments, the swap, the
  list, the bridge's status), `test/web/timeline-edits.test.js` (placing).
- A run whose page is closed stores its developments and places none; the list shows them, to
  place by hand.
- A bridge between two neighbors with 16 voices sounding, long settings on every one and the
  largest readings can't be written: its two states take about 1,400 tokens, and the prompt
  refuses saying so rather than drop a compared value.
