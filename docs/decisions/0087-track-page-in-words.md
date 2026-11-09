# 0087. The track page in words: the timeline said in words, a section's length, a transition and a lane asked in words

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the 30 s lane grid, how a lane answer
  holds the lane on either side, the Keep that an edit makes, and what stays outside the
  toggle. Amends [0061](0061-tracks-and-the-timeline.md) (the timeline leads with words; the
  offset, seconds and crossfade fields and step buttons sit behind the toggle; the offset's
  label names a development), [0065](0065-macro-lanes.md) (a lane is said in words and asked in
  words; its point fields, step buttons and point line sit behind the toggle; `withLanePoints`
  moves to `lane-schema.js`), [0084](0084-words-operator.md) (a `track` scope, the route's
  `trackId`, `arrangement` and `target`, a set's own reading, and a request's own check),
  [0083](0083-numbers-toggle.md) (the track page leaves the allowlist) and
  [0066](0066-material-panel-and-arc-target.md) (the material panel says positions, a cell's
  place and its verdict in words, with the numbers behind the toggle)

## Context

The owner, 2026-11-09: "in majority of situations the parameters are hidden behind a toggle
(e.g. collapsed) and we use language in almost all contexts to describe and control
parameters. the goal is LLM language as the tool." WF.1 to WF.4 (0083–0086, 0092) did this for
every page but the track page, which phase TD was still changing. Plan WF.5: the timeline leads
with each section's and transition's text and its development; offsets, seconds, crossfades and
lanes sit behind the toggle; a section's length, its transition and a lane are asked in words
through the words operator and fill the timeline unsaved; the page leaves 0083's allowlist.

A developed section plays its development's own timeline from offset 0 (0079), but its offset
field still said "Starts at, in seconds of its sketch".

## Decision

**What leads.** Under the timeline's blocks, a list says the track in words: each section's
name, the owner's words for it (or that there are none yet) and `developedText`'s line for its
development, and after it the join into the next by kind and curve ("Then section 1 morphs
into section 2, easing in and out.") with the owner's words for the join. The chosen section's
card says what it plays (`playsWords`: its sketch, development or bridge, from the start or
partway in, and whether it runs past that end) and its join in the same words. The seconds,
offsets, crossfade seconds, curve names and `transitionText` line, the step buttons (Shorter,
Start earlier, Crossfade longer, Curve) and the bridge's seconds move behind the toggle; Move,
Make it a morph and Remove stay. Their keys still work with the toggle closed. Clock times
stay outside: the track's length on its line, a development's length in its name, a lane
point's place on the track. They say where on the track, as a listener reads a running time,
not a value to set.

**The offset's label** names what the section plays: "Starts at, in seconds of its sketch",
"of its development" or "of its bridge".

**Lanes.** Each lane is said by `laneWords`: each point's time and the way it moves the macro,
by a little (at most 0.15), plainly, or by a lot (at least 0.35) ("Brightness: as each section
has it at 8:00, darker by a lot at 10:00."). The strips stay in view, as the blocks do; the
point fields, step buttons and point line move behind the toggle.

**Three sets of a new `track` scope** (`WORDS_SETS`, rules in `src/domain/track-words.js`).
The page sends `{set, words, trackId, arrangement, target}`: the timeline as it is now,
unsaved, and the part the set changes. The route checks the track is a live one of the brief,
checks the arrangement as Save does (`checkedArrangement`), checks the target against
`trackTargets`, and reads the values now from the arrangement with the set's `current`. A body
with `current`, or with `candidateId`, is a 400, and any other set refuses the three track
keys. The route resolves each section's name from its ids (its sketch, and whether its
development is a bridge) for the reading. Only the saved revision by id was rejected: the
owner changes the timeline unsaved, and the values and reading would then be of another
timeline.

| Set | Target | Fields | Reading |
|---|---|---|---|
| `length` | a section's index | `seconds`, `SECTION_FIELDS.seconds` | the track, the section and its neighbors with their words, the joins either side |
| `transition` | a transition's index | `kind` (crossfade, morph, weave, each described) and `seconds`, `TRANSITION_SECONDS` | the track, the two sections, the join |
| `lane` | a macro's name | `at<t>` for every 30 s of the track and its end, `LANE_OFFSET`'s range | the track, the macro's two ends in words, every section in as much detail as fits |

A crossfade made a morph or a weave takes `MORPH_CURVE`, as the kind button gives it; a morph
made a weave keeps its curve; a crossfade has none. The curve is not a field: the plan names a
transition's kind and seconds, and a curve on a crossfade has no value now to send.

**A lane answer.** The model gives the offset at each grid time where a change starts, turns
and ends. Those times become points, joined by even (linear) segments. Before the first and
after the last the lane stays as it was: a point at the grid time on either side holds the
lane's value there, exact, unless one of the owner's points is already at that time. The
owner's points between those two held times are replaced, and the change lines name each one
("Replaces your point at 1:40."); the others keep their curves. An answer that gives every time
its value now changes nothing. A segment the held point splits keeps both ends, but a curved
one is drawn again over the shorter span, so it moves a little between them; the values at the
grid times are kept exactly. The grid is 30 s, at most 41 fields on a 20-minute track: a
minute was too coarse for "the last 30 seconds", and the model reads times better than shares.

**The arrangement validator checks every answer.** On the server, a request may carry a
`check` of its own; for a track set it applies the answer and runs `validateArrangement` with
the store's sketches and developments. Its findings join the fields' findings in the one
repair, quoted as `$.changes (timeline): with these changes the timeline is invalid at
$.transitions[1].seconds: …`. On the page, the answer is applied with the same `apply` and
checked by the page's validator before it is shown; one it refuses fills nothing and the status
says why. A value is never rounded on the way: the fields' values now are exact, and `exactText`
writes the reading's seconds.

**On the page.** The chosen section's card has one Change it field with a select (Its length,
How it becomes the next) and Set from these words; the lanes card has its own field for the
chosen lane. The job runs in the words lane with the top bar's Cancel (0092); the buttons are
off while the timeline has errors or an answer is open. If the timeline changed while the
model read, the answer is not filled in, and the status says to ask again. Otherwise the
answer fills the timeline unsaved, and a box lists each change in words from templates
(`trackChangeLines`) under the model's `said`, with Keep (closes the box; Save still keeps a
version) and Undo (puts the timeline back). Any other edit while the box is open keeps the
answer and closes the box, so Undo never throws away an edit the owner made after it; opening
or saving a version closes it too.

**Sizes**, with a 4 000-character brief, 300 characters of words and every text at 300
characters, on the longest track the validator allows (133 sections of 10 s, 1 198 s, each
playing a development): `length` about 2 155 of 4 096 tokens, `transition` about 2 007, `lane`
about 2 340 after narrowing its reading to the track alone (17 894 with every section's words,
5 354 with their places). A 12-section track keeps every section's words at about 3 742. The
first two read only the part they change and its neighbors, so they don't narrow. A test holds
each under 4 096.

**The material panel** says a sketch's positions with `positionsWords`, a map cell by
`cellPlaceWords` and its verdict by `cellVerdictWords`, as the map page does (0086); the
positions' numbers and the cell's stretch and score are lines behind the toggle. `openText`,
used only here, is gone.

## Alternatives considered

- **The saved revision by id, with the values now from the page** — rejected above.
- **A lane field per breakpoint** — rejected: the model can't add a point, and a lane with no
  points has no fields.
- **A lane as one trajectory field** — rejected: a descriptor's trajectory times stop at
  `MAX_DURATION` (900 s), and a track runs to 1 200 s.
- **Every grid time rewritten on any change** — rejected: it replaces every point of the
  owner's, where the words spoke of a part of the track.
- **Checking the answer on the page only** — rejected: an answer the validator refuses then
  gets no repair, and the owner asks again by hand.
- **The curve as a field of the transition set** — rejected above.
- **Undo after another edit, putting back the timeline from before the answer** — rejected: it
  would throw the later edit away without saying so.

## Consequences

- The track page has no entry in 0083's allowlist. What remains there is an earlier brief
  version's rules and ranges.
- A new track set is a registry entry with a `target`, `current`, `apply` and `reading`, and
  its words in `trackChangeLines`.
- A track words request sends the whole arrangement, at most a few tens of kilobytes on the
  longest track.
