# 0079. A section is developed into its own genome, stored as the track's and played in place of its sketch

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the 60 s shortest section, the answer as a
  bare genome, leaving the brief's locks and duration range out of the check, the keys Z and /,
  and starting a second development from the sketch rather than the first. Amends
  [0021](0021-store-tables-and-append-only.md) (the `developments` table),
  [0061](0061-tracks-and-the-timeline.md) (a section's `developmentId`, the timeline's develop
  and plain-sketch actions), [0062](0062-track-render-and-export.md) (the genome a section
  renders, the manifest's section, the cost), [0064](0064-morph-transitions.md) (a morph or a
  weave meets the developed genome), [0066](0066-material-panel-and-arc-target.md) (`steerSwap`
  places a development too) and [0067](0067-proposed-track.md) (the repair round shared as
  `answerWithRepair`; a proposed section has no development); amended by
  [0081](0081-bridges.md) (a development may be a bridge, marked in its row; the prompt and the
  check take a bridge's ends; `askDevelopment` is the request both jobs send; the develop route
  refuses while a bridge is written)

## Context

Phase TD develops sketches inside a track. The owner settled the shape on 2026-11-09: "the
sketches you choose are just that: sketches. develop in track mode is where you can put together
sketches and describe how you want them to develop in the track", and earlier, the track builder
should "use text at each part of the song to describe what happens, then it analyzes whats going
on with those sketches, where the sketches came from (lineage, etc.) to reconstruct a longer and
more appropriate version of that sequence for that part of the track." So a development belongs
to its track: it never becomes a sketch or a candidate, never changes its sketch's rows, and
doesn't appear in sessions, ranking, the map or the lineage page.

Before this step a section was a window of its sketch's genome (0061), extended by holding past
the sketch's end (0062), with the owner's words stored and never read (0077). TD.2 wrote what
the model reads about a sketch and its lineage under caps that leave 459 of the first prompt's
4,096 tokens for the develop prompt's own parts (0078). A genome lasts 60 to 900 s (0005).

## Decision

**The table** (`0013-developments.sql`, irreplaceable, removed by mark, functions in
`development-store.js`): the track, the sketch, the owner's words it was written from, `offset`
(where the section started on the sketch's timeline), `seconds` (the length asked for and the
genome's duration), the genome (a `genomes` row under the track's vibe), the seed (the sketch's
candidate's, so a voice that keeps its id plays the sketch's events), the generation the answer
came from (the repair's when there was one) and `createdAt`. `offset` is beyond what the plan
listed: it is what going back to the plain sketch puts the section at again. Developing again
adds a row and keeps the earlier one.

**The section's key.** Every section has `developmentId`, null by default, its last key;
`0014-section-development.sql` adds `"developmentId": null` to every section of every stored
revision, as 0077's migration added `text`, tested over 0013's shape. `validateArrangement`
reads developments through `ArrangementContext.development`, beside the track's id
(`trackId`, null for a proposal's answer), and refuses at `$.sections[i].developmentId` a value
that isn't null or a row id, one that isn't stored, one removed, another track's, and one of
another sketch. A proposal's answer gets `developmentId: null` filled as its text is, and a
development it names is refused, since a new track has none.

**What `offset` means.** On a developed section, `offset` is where the section starts on the
development's timeline, with the bounds a sketch's has: from 0 to under the development's
seconds, and the section may run past its end up to `MAX_DURATION`, held as 0062 extends a
sketch. A section takes a new development at offset 0, so it plays the whole of it; editing the
section afterwards moves it on the development's timeline. Going back to the plain sketch (the
"Play the plain sketch" button, /) sets `developmentId` to null and `offset` to the
development's stored `offset`. Steering a developed section (0066) does the same: a steer starts
from the section's sketch, so `swapSketch` puts the steered sketch in with no development, from
the development's stored `offset` on the sketch, and its seconds and words kept. Keeping the
offset on the development's timeline was rejected: it means nothing on the steered sketch, and
can pass that sketch's end.

**One genome lookup.** `SectionGenomes` stays one map: each sketch's genome by its id, as before,
and each development's under `developmentKey(id)`, the string `development <id>`, so it never
meets a sketch id. `genomeKey(section)` is the one place a section finds its genome, and
`fittedGenome`, `sectionMorph`, `sectionGenome`, `sectionWindow`, `trackCost` and the stems read
it. A track with no developments builds the same map and keeps its recipe key exactly, tested
against the keys pinned before weaves. The track's fades still read the sketches' genomes: a
development is written with no fades of its own. `sectionSources` reads the map from the store
once for the recipe and the develop job.

**The manifest.** A developed section's entry adds `developmentId`, named only when set, and
records the development's seed and its fitted genome, so `rerenderTrack` renders it from the
manifest alone, tested to the same hash. Morphs and weaves into and out of a developed section
meet its genome, tested.

**The prompt** (`buildDevelopPrompt` in `src/domain/develop-prompt.js`).
- *system*: the task; the answer, one JSON object that is the whole genome, with no intent
  beside it; the rules: duration exactly the section's seconds, `fadeIn` and `fadeOut` 0, changes
  through trajectories (at most `MAX_POINTS`) and voices' start and end, at most `MAX_VOICES`,
  keep a continuing voice's id since its events are drawn from it, keep the sketch's tuning,
  scale, key, pulse and bpm unless the words ask for a change since otherwise the joins
  crossfade, keep the sketch's recordings; then `schemaText()` as `buildPrompt` gives it.
- *user*: the brief (name, brief, `constraintsText`, `targetsText`), the arc as a JSON string or
  that there is none, the section's place, seconds and where it starts on the sketch, the
  owner's words as a JSON string or that there are none, the sketch's `conciseGenome`, its
  reading and its lineage's (0078), and where the neighbors meet it, then the ask.
- *Where the neighbors meet it* (`meetingState` in `src/domain/meeting-state.js`): the previous
  section's fitted genome at its end and the next one's at its start, each the developed genome
  when there is one. Two lines: the globals a join must match and the macros away from neutral,
  as they stand there; then each voice sounding there with its type, level, a fixed root, and
  every moving parameter read at that moment. Cap `MEETING_STATE_TOKENS`, 180, 0078's budget for a
  neighbor; over it the last voices keep only their level, then are named only. A 16-voice
  genome with every trajectory full reads at 174 and 177 tokens at its two edges.
- *The budget*: half the context, 4,096. Over it, the lineage's reading is left out first, then
  the sketch's, and then it throws naming the sketch's genome's size. Measured at its largest (a
  seed-sized brief, a 200-character arc, 300 characters of words, both readings at their caps
  from `worstGenome`, both neighbors at theirs, and `field-recording.json`, the largest stored
  genome, as the sketch's): **4,033 tokens**; the test holds it under 4,096. With everything else
  that large the sketch's own genome may take about 420 tokens before a reading is left out.

**The check** (`checkDevelopment` in `src/domain/check-development.js`): a cut-off answer, no
JSON or several objects is rejected with nothing to repair (`judgeAnswer`). Then the schema
(rule `schema`), the duration equal to the seconds asked (`sectionSeconds`), each recording one
the sketch plays (`schema`), the brief's linter (0020) and the engine's `COST_BUDGET`
(`costBudget`, the render check's own). Two parts of the linter are left out: the brief's
`duration` range, since a development lasts its section, which the owner chose, and the
excerpt-length floor, since a development is never excerpted. **No locks are applied**: locks
pin values for the candidates a session makes (0035), and the sketch already passed the ones in
force when it was made; a development changes the sketch over time, which a pinned value would
forbid, and the owner's words for the section are what it follows. One repair round quotes every
finding as 0024 does.

**The shortest section.** A genome lasts at least 60 s, so a section under 60 s can't be
developed: the route refuses it with a 409 and the button is off saying why
(`DEVELOP_LEAST`). A developed section can be shortened afterwards; it then plays a window of
its development.

**Developing again** starts from the sketch, at the offset the earlier development was written
from, not from the earlier development: the prompt holds the sketch and its lineage, and the
owner's words describe the section, not a change to the last answer.

**The job and route.** `POST /api/tracks/:trackId/develop {revisionId, section}` checks the
revision is the track's and still valid, the section is one and at least 60 s, and refuses a
second unfinished develop job (a 409 naming it), then adds a `develop-section` job
(`JOB_KIND.developSection`, named in the top bar's titles). The job reads the rows, builds the
prompt, and sends through `answerWithRepair` in the request group
`vibe-<vibeId>-develop-<seed>` (operator `develop`), retrieval `none`, no session, the stream's
first sampling. A valid answer is written in one transaction (the genome row, then the
development); a cancel, a failure or an invalid answer writes none. Cancelling cancels the omlx
queue, as a proposal's does (0067). `answerWithRepair` in `generate-candidates.js` is the one
request-and-repair path for operators that write no candidate, shared with the proposal;
a brief's draft (0074) keeps its own, since its send differs.

**The timeline.** Develop this section (Z) and Play the plain sketch (/) sit in the chosen
section's panel, with a line saying which development it plays and the words it was written
from; the block's name ends "developed" and its times are on the development's timeline. Develop
is off while the timeline has unsaved changes, under 60 s, or while a develop job runs. Its
confirm (`developCostText`) states the one or two requests and their time from recent request
times, `proposeCostText`'s route. When the job is done the page reads the developments again
and places the new one by `developSwap`, which is 0066's `steerSwap`: saved as a new version
noted "Section N developed" when nothing changed or the owner saved during the run; put on the
unsaved timeline when the owner edited without saving; left out, with the reason, when another
version was opened by hand or the section's window changed or it was removed. A page closed
during the run leaves the development stored but in no section. The section's player renders the
development's window at its seed (`section-audio`), cached by sketch, development and window.
The page's raw numbers stay as they are; the sketch-reading card stays.

## Alternatives considered

- **A development stored as a sketch or a candidate** — rejected by the owner's words: it would
  appear in the session, the ranking and the map.
- **Keying the genome lookup by `{kind, id}` objects or two maps** — rejected: every caller and
  test that builds the map by sketch id would change, for one more kind of key. A string key
  next to number keys changes only the callers that have developments.
- **The answer as 0024's `{intent, genome}`** — rejected: the plan asks for one genome, and an
  intent line has nowhere to go; the bare object is shorter to repair.
- **The development's genome at `max(seconds, 60)`, playing its first seconds** — rejected: the
  check would no longer say the genome lasts the section, and a 10 s development has no room to
  change.
- **Applying the brief's live locks** — rejected for the reason above; the owner can lock a value
  by writing it in the section's words.
- **Starting a second development from the first** — rejected for now: the prompt has no slot
  for an earlier answer, and its lineage reading is the sketch's. The owner can overrule it.
- **The server saving the revision when the job ends** — rejected: what happens on a timeline
  that changed is the page's to decide, as 0066 decided for a steer, and the server can't see
  unsaved edits.
- **Trimming the neighbors before the readings** — rejected: the neighbors are what a join needs
  to match, and they are capped at 180 tokens each already.

## Consequences

- A development's genome is a row in `genomes` under the brief's vibe with no candidate, so
  nothing that lists candidates or sketches sees it. A section player's render of it is a
  `renders` row; one that happened to be exactly an excerpt's window of that genome and seed (25
  s at `excerptOffset`) would be embedded by the embed job and read by the steering scale's
  `vibeExcerptEmbeddings`. A developed section is at least 60 s and taken at offset 0, so this
  needs the owner to shorten it to 25 s at that offset.
- TD.5's bridge and TD.6's whole-track development call the same prompt and job; TD.6 reads the
  developed section before each next one through `meetingState`.
- A change to how a development is stored needs a migration over this shape.
