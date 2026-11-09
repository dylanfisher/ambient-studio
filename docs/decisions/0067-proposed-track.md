# 0067. The model proposes a new track as its first revision, held to the length within 5%

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm the material's order and cap, keeping a
  named elite as a sketch with no heard copy, the 5% rule's wording, and where the share is
  shown. Amends [0024](0024-prompt-parse-repair-generation.md) (a second operator through the same
  request path, `extractObject`, `RETRIEVAL_METHOD.none`); amended by
  [0074](0074-draft-brief-from-words.md) (`judgeProposal`'s parse step shared as `judgeAnswer`)
  and [0077](0077-section-and-transition-text.md) (empty text on each section and transition of
  the answer before it is checked)

## Context

Step 6h adds phase 6's "Proposal, then edit" (acceptance 8): the owner gives a length (3 to 20
minutes) and an arc in words, and one model request proposes sections, transitions and lanes
from the brief's material, which the owner then reorders, resizes and retimes on the timeline.
The arrangement's shape and `validateArrangement` are 0061's, its `proposal` field reserved for
the generation id; morphs are 0064's and lanes 0065's. The material panel (0066) shows sketches
and the map's elites, and places an elite by keeping it as a sketch first, since a section names
a sketch. omlx serves a live site: one request at a time through the queue, short contexts
(0022). Acceptance 8 asks for the share of proposals valid after at most one repair, logged
over the owner's run of at least five requests.

## Decision

**Propose** sits on the brief page's Tracks card: the new track's name, its length in minutes,
the arc, and optionally an attached region to follow. A confirm states the request (one or two
requests to the model, nothing rendered) and its time from the median of recent request times,
the breed estimate's route (`proposeCostText`). `POST /api/vibes/:id/proposals {name, length,
arc, regionId}` checks the length and the arc with `validateArrangement`'s own rules (a 400),
checks the region is attached and measured at the brief's loudness (a 409), refuses a second
unfinished proposal (a 409 naming it), and adds a `propose` job. The job's result names the new
track, and the page opens its timeline. Propose is a plain button, not a form's submit, so the
browser never holds the minutes field to its min and max; the page checks for whole minutes
within `TRACK_LENGTH` before the confirm, and the route checks again.

**Cancelling** a proposal cancels the omlx queue, as the candidates job does. The job runner
runs one job at a time (0026), so while a proposal runs no candidates, breed, evaluation or other
omlx job is running, and the queue holds only the proposal's requests; a cancel can't reach
another job's. A proposal added while another job runs waits its turn in the runner. A cancel
while the model answers ends the job cancelled, with no track or sketch written.

**The prompt** (`buildArrangePrompt` in `src/domain/arrange-prompt.js`) is two messages.
- *system*: the task, the answer format, and the rules, each number read from the arrangement's
  descriptors (section offset and seconds, `MAX_DURATION`, transition seconds, `MORPH_LEAST`,
  the track's most, lanes' points, offsets and curves, the macros).
- *user*: `Brief: <name>` and the brief; the length and the span it must land in; the arc as a
  JSON string; for a chosen region, its windows stretched over the track as the timeline draws
  them (0066), and for each of 8 even spans of the track the median of each ranged feature over
  the windows whose middle falls there; then the material, one line each: `sketch <id>` or
  `elite <candidate id>`, its genome's duration, its intent, the owner's notes and tags (each
  quoted as a JSON string and clipped to 60 characters), its excerpt's ranged features as
  values only, and each macro's value over the whole genome, or its least and most when it
  moves. The heading names the values once, so a line stays short. No genome is sent.
- *The material* is at most 24 lines (`MAX_MATERIAL_LINES`): the live sketches newest first,
  then the map's elites not yet kept, by search score highest first (none after every scored
  one), then fewest ranges missed, then newest. A map that can't be read gives no elites.
- *The budget*: the first prompt gets half the context budget (4 096 of 8 192), leaving the
  other half for the repair, as 0024 does; over it, material is trimmed from the end. Measured:
  24 lines with every clipped field full, a 600-character brief, a 200-character arc and a
  40-window region is 3 544 tokens by `estimateTokens`; the test holds it under **3 600**. 24
  plain lines (a short intent, no notes or tags) are about 2 400.

**The answer** is `{"sections": […], "transitions": […], "lanes": […]}` and nothing else; the
server fills in the owner's length and arc and the generation's id. A section names a sketch by
`sketchId`, or a listed elite by `eliteId` (its candidate id) in its place.
`response_format` is a loose schema of the three lists, sent when the config asks (0024).

**The check** (`judgeProposal` in `src/domain/check-proposal.js`): an answer cut off at
`max_tokens`, with no JSON, invalid JSON or several objects gets a reject reason and no repair,
as 0024's genomes do. A parsed one is checked for its keys (rule `answer`), then filled out and
checked by `validateArrangement` (rule `arrangement`), an elite's section under a stand-in
sketch id that carries the elite's duration, so its offset and seconds are held to the elite's
genome. An unlisted elite, or a section naming both, is an `answer` finding. **The length
rule**: once it validates, a track that plays more than 5% from the length asked for
(`LENGTH_TOLERANCE`) is a finding with rule `length` at `$.sections`, saying what it plays, as
"every section's seconds less every transition's", and the span asked for.

**The repair**: one round, for a parsed answer with findings: the first prompt, the parsed
answer as compact JSON, and every finding as `- path (rule): message`, asking for the whole
corrected object, with the same sampling (0024). A repair over the context budget isn't sent,
and the job fails saying so. When the proposal is still invalid, or had nothing to repair, the
job fails listing every finding, and no track or sketch is made.

**Requests and storage.** The two requests go through `sendRequest`, the path every operator's
generations take (0024, amended): one `generations` row each, round 0 and round 1 naming the
first in `repairsId`, with the exact prompt, under the request group
`vibe-<vibeId>-arrange-<seed>`, which names operator `arrange` as an explore's names its
operator, since a proposal makes no candidate to store it on. `exampleIds` is empty,
`retrievalMethod` is `none`, `attachmentIds` holds the region's attachment when one is followed,
and `sessionId` is null. The sampling is the stream's first draw.

**Elites become sketches on acceptance**: the proposal is checked with stand-in ids for its
elites, and only once it is valid is anything written. Then, in one transaction, each elite it
names is kept as a sketch (`addSketch`, notes and tags empty, as 6g's placing leaves them), once
however many sections name it, its sections name that sketch, the arrangement is checked again
against the real sketches, and the track and its first revision are written (`addTrack`, which
`createTrack` wraps in its own transaction). A throw anywhere in that rolls all of it back, so no
sketch is left without its track. The heard copy the sketch route keeps is left out: the owner hasn't
heard the elite, and capturing it renders the excerpt again, which proposing doesn't do. An
elite already kept is listed as its sketch, not as an elite.

**Stored as a revision**: the new track's first revision is the proposal, `proposal` holding the
last generation's id (the repair's when there was one), noted "Proposed by the model" or "…, after
one repair". It opens on the timeline like any version; nothing renders until the owner starts a
render. Edits save new revisions as before (0061) and the first is never changed; a later
revision keeps the `proposal` id it was edited from, so the lineage to the generation stays.

**The share** (`GET /api/vibes/:id/proposals`, `proposalShare`), per brief: each of the brief's
`arrange` request groups, found by `requestGroupPattern` beside `requestGroupName`, is valid when
a track revision names one of its generations (and first try when that is round 0), failed when
its last request failed in the queue, and invalid otherwise. The brief page shows it under
Propose: valid of those the model answered, the percent, first tries, still invalid, and failures
apart. It is read from the rows, so the owner's run is logged by making it.

## Alternatives considered

- **Keeping elites as sketches on save, from the page** — rejected: the proposal must be stored
  as a valid revision when it is accepted, which a section naming an elite isn't, and a page
  closed before saving would lose the proposal and its place in the share.
- **Keeping an elite through the sketch route, with its heard copy** — rejected: the capture
  renders the excerpt again, and proposing renders nothing; the owner keeps a heard copy by
  keeping it from the map.
- **A proposal stored apart from tracks until accepted** — rejected: the plan stores it as the
  track's first revision, and the timeline already edits and keeps versions.
- **Each feature and macro named on every line** — rejected: 24 lines took about 4 000 tokens;
  values in the heading's order take about 1 300 fewer.
- **Material by line number in the answer** — rejected: ids are what the arrangement stores and
  what the page shows, so a finding's path and message read the same everywhere.
- **The length as a validator error for every arrangement** — rejected: a hand-made track has
  no length to hold to; only a proposal is checked against what was asked.
- **A `generations` operator column** — rejected: it is a migration of irreplaceable rows for one
  value the request group already names.

## Consequences

- A proposal's sketches of elites appear on the brief page and in the map as kept, with empty
  notes; the owner can keep a heard copy from the map, which keeps a second sketch.
- The prompt changes as the material does, and every proposal's exact prompt is stored for
  phase 8.
- A share over the owner's run reads only rows; a deleted track revision would lower it, but
  revisions are never deleted.
- The material's order, the cap and the 5% wording are guesses until the owner's run.

## Amendments

- 2026-11-08: the owner's first three proposals failed after their repair. Two played 280 s of
  the 300 s asked for: the sections added to 300 s and the crossfades' overlap was never taken
  off, and the repair round made the same mistake. A proposal that validates but plays more than
  `LENGTH_TOLERANCE` from the length now has its sections scaled by one factor to play the
  length exactly (`fitArrangementLength` in `src/domain/fit-arrangement-length.js`). Each
  section is rounded to whole seconds, with the remainder on the last. The transitions stay as
  the model gave them, and each lane's times scale with the track. The result is checked by
  `validateArrangement` again. The `length` finding, and the repair, remain for an answer whose
  sections would scale by more than `LENGTH_FIT_MOST` (25%) either way, and for one the
  validator refuses once scaled, such as a section pushed under 10 s. The track's first note
  says so: "its sections scaled from 280 s to play 300 s". This doesn't hide a missing value.
  The model chose the material, order, proportions and transitions; only the subtraction is done
  here. Rejected: stating the sum the sections must reach in the prompt, since the repair
  already named the span and the model still missed it; asking for track start times in place
  of seconds, a new answer shape for a problem the server can solve exactly.
