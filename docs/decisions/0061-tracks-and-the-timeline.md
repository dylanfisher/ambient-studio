# 0061. Tracks are append-only revisions of a checked arrangement, edited on a timeline page

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm one brief per track, extending a section
  past its sketch, the keys and the section player; amended by
  [0065](0065-macro-lanes.md) (`lanes` hold macro lanes, under the timeline) and
  [0077](0077-section-and-transition-text.md) (`text` on every section and transition, two text
  fields in the chosen section's panel, the start of the text on each block). Amends
  [0021](0021-store-tables-and-append-only.md) (the track tables) and
  [0032](0032-plain-language-pages.md) (the timeline page and its keys)

## Context

Phase 6 puts sketches together into 3–20 minute tracks. Step 6b stores tracks and lets the owner
arrange one by hand; 6c renders and exports them, 6e adds morph transitions, 6f macro lanes and
6h a proposed arrangement from the model. A sketch's genome is 3–15 minutes (`MAX_DURATION`
900 s) and renders exactly in any window (0007), so a section is a window of one sketch's
timeline. The plan left two choices to the owner and asked each builder to take the
recommendation and say so: one brief per track, and a section longer than its sketch extends
the sketch.

## Decision

**Tables** (`0011-tracks.sql`, all irreplaceable, functions in `track-store.js`):

| Table | Holds |
|---|---|
| `tracks` | the vibe and the name; removed by mark (`removed`), never deleted |
| `track_revisions` | the track, the arrangement as JSON, the owner's note; one row per save, the newest current, as `vibe_revisions` |
| `track_exports` | the revision, `kind` (`mix` or `stems`), the folder under `exports/`, the manifest's SHA-256; written by 6c and 6d |

Making a track writes its first revision with an empty arrangement in the same transaction, so
every track has one. A track's name doesn't change: renaming would be an update. A removed track
keeps every revision and export row, and its routes answer 404.

**The arrangement** (`src/domain/arrangement-schema.js`, checked by `validateArrangement` in the
descriptor style of 0005 and 0020; every key is present in a stored one):

```json
{
  "length": null, "arc": null,
  "sections": [{ "sketchId": 4, "offset": 30, "seconds": 240 }],
  "transitions": [],
  "lanes": [], "proposal": null
}
```

- `length` (180–1200 s) and `arc` (one line, at most 200 characters) are what the owner asks a
  proposal for; both null on a hand-made track. `proposal` is the generation id 6h's arrangement
  came from, or null. `lanes` holds at most one macro lane per macro (0065).
- A section names a live sketch of the track's own vibe, `offset` where it starts on the
  sketch's timeline, from 0 to under the sketch's duration, and `seconds`, at least 10.
- `transitions` holds one between each pair of neighbors: `kind` `crossfade` (6e adds `morph`)
  and `seconds`, 1 s at least, at most half the shorter of its two sections. A new one is 8 s
  (`TRANSITION_SECONDS.default`). The validator fills no default: a stored transition names its
  seconds.
- The track's length is the sections' seconds less each transition's (`arrangementLength`): a
  crossfade overlaps the end of one section and the start of the next. A track is at most
  1200 s, the length phase 6's memory ceiling is set for.
- Each error has the JSON path of the value it is about (`$.sections[1].offset`), the form 6h's
  repair round quotes back to the model. The validator takes the sketches through a lookup
  (`ArrangementContext`), since only the server reads the store; the page runs the same
  function on its list of sketches as the owner edits.

**One brief per track** (the owner's recommended default). A track belongs to one vibe and its
sections are that vibe's sketches, so it has one loudness target and one brief for a proposal.
A sketch of another vibe is refused at `$.sections[i].sketchId`. The owner can overrule this.

**Extending a section** (the owner's recommended default). A section may run past its sketch's
duration: `offset + seconds` may reach `MAX_DURATION`, 900 s, and no further. 6c's
`sectionGenome` makes the extended genome; 6b only allows and stores it. The owner can overrule
this by refusing sections longer than the sketch.

**Routes** (`track-routes.js`): `GET` and `POST /api/vibes/:vibeId/tracks` (list, make with a
name), `GET /api/tracks/:trackId` (the track, its vibe's name, every revision with its length,
and the vibe's live sketches with intent, notes, tags, duration and cached excerpt),
`POST …/revisions` (`{arrangement, note}`, a 400 listing every error, nothing stored),
`POST …/remove`, and `POST …/section-audio`.

**The section's player.** `POST /api/tracks/:trackId/section-audio` takes one section, checks it
as an arrangement of one, and starts an owner-started job (`section-audio`, one at a time, a
409 naming a running one) that renders that window of the sketch at its seed, normalized to the
vibe's current loudness target, through `renderExcerpt` with a window. It is cached like an
excerpt in `renders`, so playing it again is immediate, and played through 4i's excerpt player.
The window stops at the sketch's end; the extended part plays once 6c renders section genomes.
`renderExcerpt`'s cached file name now holds the offset, so two windows of one genome, seed and
length don't share a file; a row cached under the older name still resolves, since a row names
its own file. A window not inside the genome's duration throws. Section renders share the
derived `renders` table with excerpts, with no new column and no migration: whatever reads
excerpts only tells them apart exactly, with `isExcerptWindow` (`candidate-excerpt.js`), true
when the window is `EXCERPT_SECONDS` long at `excerptOffset` for the render's genome and seed.
The embed job is the one reader of every render, and skips the rest, so a section never gets
an embedding; the taste model, ranking and the taste test read excerpts by their exact window
or through rated audio already.

**The timeline page** (`track.html`, `track.js`), opened from the brief page's Tracks card,
where a track is made by name:

- Sections are buttons placed and sized by their time on the track (`timeline-layout.js`), on
  two alternating rows so each crossfade shows as the overlap of two blocks, with the overlap
  shaded (`timeline-view.js`). Clicking a block chooses it.
- The chosen section has fields for where it starts and how long it plays, and its crossfade
  (the one after it, or before the last). Each block's edges can be dragged: the end changes the
  seconds; the start moves where it starts in its sketch and keeps where it ends.
- Every action has a key and a button showing it (`timeline-keys.js`, bound as Quick A/B's
  are, 0048): ← and → choose the previous or next section, `,` and `.` move it, `−` and `=`
  make it 10 s shorter or longer, `[` and `]` start it 10 s earlier or later, `;` and `'` make
  its crossfade 1 s shorter or longer, A adds the chosen sketch after it, X removes it with its
  crossfade, Space plays it, S saves. No key fires while a field you type in has the focus.
- An edit changes only what it names (`timeline-edits.js`). One that leaves the arrangement
  invalid, such as shortening a section under twice its crossfade, shows each error under the
  timeline with its path and turns Save off; nothing changes a value the owner didn't touch.
- Save appends a revision with an optional note. Versions are listed newest first; Open puts one
  on the timeline (asking first over unsaved edits), and saving it makes it the newest, with
  "From version N" as its note unless the owner writes another. Leaving with unsaved edits asks
  first.

## Alternatives considered

- **Any sketches, with the owner setting the track's target** — the plan's alternative to one
  brief per track; not taken, as recommended. It needs a loudness target and constraints of its
  own, and 6h's proposal would have no single brief.
- **Refusing sections longer than the sketch** — the alternative to extending; not taken, as
  recommended. Short sketches would then cap a section at 3 minutes.
- **Filling a transition's default in the validator** — rejected: a stored arrangement would
  then differ from what was sent, with no record of why (0020's report, don't rewrite).
- **Clamping a crossfade when an edit shrinks its section** — rejected for now: an edit would
  change a value the owner didn't touch. The error under the timeline says what to fix.
- **A track's name in its revisions, so it can be renamed** — rejected for now: the plan puts it
  on `tracks`, and nothing asks for renaming yet.
- **Rendering a section's window on a GET, as a reference span is** — rejected: a window can be
  15 minutes, about 90 s of rendering, which belongs in the job runner (0026) so it never
  overlaps an omlx request.
- **Playing the sketch's 25 s excerpt as the section's player** — rejected: it plays a window
  the section may not include.
- **Drag only** — rejected: the plan asks for every action on a key and a button.

## Consequences

- 6c reads `Arrangement` and `arrangementLength`, and writes `track_exports`; 6e adds `morph` to
  `TRANSITION_KIND`, and 6f lets `lanes` hold lanes, each with its own checks in
  `validateArrangement` and its test cases.
- The section job renders a window up to 900 s, which holds about 0.8 GiB at its peak (0010).
- A section of a sketch that is later removed makes the newest revision invalid, so it can't be
  saved again until the section is removed; earlier revisions keep it.
- Space on a focused button plays the section rather than pressing the button, as on Quick A/B;
  Enter still presses it.

## Amendments

- 2026-11-08: from step 6f ([0065](0065-macro-lanes.md)), provisional: owner to confirm.
  `lanes` holds macro lanes, checked by `checkLanes` with paths such as
  `$.lanes[0].points[2][1]`; stored arrangements hold `[]`, so none needs a migration. A Macro
  lanes card under the timeline edits them by fields, drags and their own keys (↑ ↓ H L U O Q
  W Y N D), none of which is a timeline key.
