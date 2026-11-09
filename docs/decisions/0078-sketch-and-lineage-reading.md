# 0078. A sketch and its lineage read in short lines, each under its own token cap

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the card's words and place on the
  timeline page, and that the readings say enough for step TD.3's develop prompt

## Context

Phase TD develops a sketch inside a track: the model writes a section's genome from the
sketch, the owner's text for the section, the track's arc and the neighbors' states. Before
that request exists (step TD.3), step TD.2 builds what the model reads about the sketch beside
its `conciseGenome` (0072): which voices it has and what moves in it, and how the owner got to
it. The owner sees the same reading on the timeline, so what the model is told can be checked
by eye.

The develop prompt is a first prompt, so it gets half of omlx's 8 192-token context and the
repair the other half (0024). The genome's JSON says every number but not what moves, over
which seconds, or what each step of its lineage was asked. Candidates store `parentIds`,
`operator` and `operatorParams` (0039), and an unchanged revision is folded into its first try
on the lineage page.

## Decision

**Three pure functions in `src/domain`.**

- `sketchReading(genome, features)` (`sketch-reading.js`) gives, in order:
  1. the whole piece: duration, tuning, scale, key (with a relative tuning), and pulse with its
     bpm on a beat;
  2. the globals written as trajectories, when any are (`Moves across the piece: …`);
  3. one line per voice, in the genome's order: id, type and the type's description in
     brackets, the voice level when it is fixed, when it plays (`plays throughout`,
     `enters (40 s)`, `leaves (200 s)`), its `root` when its type has one and holds it fixed,
     its choices (`model fm`, `preset rain`), and `moves:` with each trajectory as
     `cutoff, low-pass (250 → 900 Hz over 0–3 s, ranging 200 to 1200, 12 points)`. A field
     recording's hash is left out: it means nothing to a reader;
  4. the macros in their own words from `macroWords`: `brightness brighter (0.7)`, a moving one
     as `motion from stay stiller to move more (…)`, and the rest named as neutral;
  5. the excerpt's ranged features (`TARGET_FEATURES`, labels and digits from
     `FEATURE_NAMES`), or `The sketch hasn't been measured yet, so no features are given.`
- `genomeChanges(parent, child)` (`genome-changes.js`) lists every path that differs in the
  path form locks use (0035): globals, then macros, then voices the child dropped, then the
  child's voices in order, each a whole voice added or a parameter changed from → to. A
  trajectory is compared whole. A voice that keeps its id but changes type is removed and
  added. `changesText` groups them: `scale dorian → aeolian, reverbDecay (2 → 6 s); macros:
  space (0.5 → 0.8); voice drone: root (37 → 55 Hz); added voice chords, a pad`.
- `lineageReading(lineage, nameOf)` (`lineage-reading.js`) gives a header, then one line per
  step from the first ancestor to the sketch: the candidate, the operator's word from
  `operatorLabel` (moved down to `src/domain/operator-label.js` for this, since domain can't
  import web), what the step was asked (an explore's direction and whether its base was read,
  a nudge's step size, a steer's directions with each slider's setting and its regions, a
  breed's two parents or its nudge), its intent, and `Changed: …` against the step before, at
  most 8 changes then `and N more`. The owner's and the model's words are quoted as JSON
  (`quoted`, as 0038 quotes a direction), so none can break a line of the prompt. A steer names
  a direction with `axisName` (`“dry” to “wet”`) and a region by its label; the route looks
  them up, and an attachment no longer stored is said by its id.

**Numbers in parentheses.** Every raw number in a reading sits in parentheses after the words
that name it, and nowhere else (names such as `12-tet` and a type's description in brackets
aside), so the page can hide them and the line still reads: `voice level (-10 dB); plays
throughout` becomes `voice level; plays throughout`.

**The chain.** The route walks it as the lineage route does (0039): along each first parent,
an unchanged revision skipped so a step made from one reads its first try, the sketch's own
candidate always kept. A parent that isn't stored, or is marked removed, ends the chain, and
the header says so: `… candidate 7's parent, candidate 5, isn't in the studio, so the chain
stops there and what candidate 7 changed isn't known.` A parent with a later id than its child
throws, since that chain would loop.

**The caps, and what is cut first.** `SKETCH_READING_TOKENS` is 800 and
`LINEAGE_READING_TOKENS` 500, by `estimateTokens`. `fitReading` makes the cuts one at a time
until the lines fit, and throws if they still don't with every cut made.

- The sketch: first the last voice is written brief (id, type, level, when it plays, and only
  the names of what moves), then the one before it, up to the first; then voices are left out
  from the last, named on one line (`Left out for room: 3 voices, a, b, c.`). The piece, the
  macros and the features are never cut.
- The lineage: first the oldest step after the first ancestor loses its change values (paths
  only), then each later step; then the steps between the first ancestor and the sketch are
  left out, oldest first, as one line (`Steps 2–4 left out for room.`). The first ancestor and
  the sketch's own step stay.

**The arithmetic** for TD.3's first prompt, in tokens of the 4 096 it gets (a test,
`sketch-reading.test.js`, adds them up and holds the rest above 300):

| Part | Tokens |
|---|---|
| The generation prompt's system turn (task, answer format, `schemaText`) and a seed-sized brief: every constraint kind, a range on every feature, a 600-character description, the ask line | 1 653 |
| The arc, at its most (`MAX_ARC_CHARS`, 200) | 58 |
| The section's text, at its most (`MAX_TEXT_CHARS`, 300) | 86 |
| The sketch's `conciseGenome` and two neighbors' states, each the size of the largest stored genome (`field-recording.json`, 630 characters) | 3 × 180 = 540 |
| The sketch's reading, at its cap | 800 |
| The lineage's reading, at its cap | 500 |
| Left for the develop prompt's headings, the seconds asked and its ask | 459 |

Measured: `example.json`'s reading is 330 tokens, in full. A 16-voice genome with every
trajectory at 64 points is 2 152 tokens in full and 795 at the cap, with the first voice in
full, the other 15 brief and none left out. A 12-step chain of such genomes, each step a
nudge, is 3 739 tokens in full and 494 at the cap: the first ancestor, `Steps 2–4 left out for
room.`, and steps 5 to 12 with their changed paths.

**The route.** `GET /api/sketches/:sketchId/reading` in `rating-routes.js`, the file that keeps
sketches, returns `{ sketch: string[], lineage: string[] }`. It reads stored rows only: the
sketch, its candidate chain, their genomes, the attachments a steer names, and the excerpt's
render row when it is cached (`currentExcerpt`). It renders nothing and asks neither the
sidecar nor omlx. A sketch that doesn't exist, is marked removed, or whose brief was removed is
a 404 `there is no sketch N`.

**The card.** On the track page, under the chosen section, "What the model reads about this
sketch" lists both readings. `src/web/sketch-reading-card.js` reads them again whenever the
chosen section's sketch changes, and ignores a reply for a sketch no longer chosen. It wraps
each parenthesized group holding a digit in a span marked `data-numbers` (0083). Until step
WF.5 gives the track page its numbers toggle, those spans stay hidden, so the card shows the
words only.

## Alternatives considered

- **One cap for both readings** — rejected: a long chain would then crowd out the voices, which
  the develop request needs more than old steps.
- **Every point of every trajectory** — rejected: a full trajectory is 64 points, and the
  sketch's `conciseGenome` already holds them all. The reading says where it starts and ends,
  how far it swings and over which seconds.
- **Cutting whole voices first** — rejected: a voice cut to its name and what moves still tells
  the model it is there; dropping it hides it.
- **`originText`'s sentences for each step** — rejected: they are written for the owner ("your
  taste model", a search point's place in its run), carry a search score the chain doesn't
  have, and are longer. The lineage reading keeps `operatorLabel`'s words, the one part both
  need.
- **The route in `track-routes.js`** — rejected: it reads a sketch, not a track, and the rating
  routes already keep sketches.
- **Showing the card's numbers until WF.5** — rejected: 0083 marks raw numbers on every page,
  and a card-only toggle is what it rejected.

## Consequences

- TD.3's prompt reads both readings as they are and must still trim its own parts (a larger
  sketch genome, longer neighbors) to its budget; the caps here don't move with them.
- A new global, voice type or parameter is read with no change here: the reading walks the
  descriptor tables. A new operator needs words in `operator-label.js` and a clause in
  `lineageReading`, or the reading throws.
- The card shows the words only until WF.5's toggle reveals the numbers.
