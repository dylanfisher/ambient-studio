# 0085. The session and brief pages in words: descriptions from templates, and a candidate's change asked in words

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the thresholds, the reference set, the
  select beside the Change it field and the Keep / Undo box. Amends
  [0039](0039-lineage-and-steering-controls.md) (the direction field is the card's Change it
  field; a search point's origin line drops its score; `lockChoices` moves to `src/domain`),
  [0056](0056-directions-sliders-reference-target.md) (a card's positions are said in words,
  and its steer settings can be set from words), [0083](0083-numbers-toggle.md) (the allowlist
  loses `originText`) and [0084](0084-words-operator.md) (a `candidate` scope, `candidateId`
  on the words route, and sets that narrow to fit)

## Context

The owner, 2026-11-09: "in majority of situations the parameters are hidden behind a toggle
(e.g. collapsed) and we use language in almost all contexts to describe and control
parameters. the goal is LLM language as the tool." WF.1 (0083) hid the numbers; WF.2 (0084)
and WF.2b (0092) built one words operator, with field sets named in a registry and a words
lane beside the main job. Plan WF.3 asks the session and brief pages to say a candidate in
words (acceptance 2, from templates as 0047, never the model) and to ask a candidate's locks,
macro choices and steer setting in words (acceptance 4). omlx serves a live site, so a words
request starts only from the owner's button (acceptance 5).

## Decision

**Where a value sits, in words.** `src/domain/place-words.js` places a value by the share of
the others below it, each tie counting half (`shareBelow`), in five places (`placeOf`): at
least 0.9 is above "nearly all", at least 0.7 above "most", and the same mirrored below (a
share of at most 0.1, at most 0.3); between 0.3 and 0.7 is the middle. Every description below
reads these. They are guesses until the owner reads them: the middle holds about 40% of excerpts on
each feature, so a candidate names three or four of the seven ranged features on average.

**Features against the brief** (`featureWords`, `src/domain/feature-words.js`). The reference
set is every live excerpt of the brief, across its sessions, hidden ones included (hiding says
nothing about the sound, 0049), rejected ones and unchanged revisions left out, each excerpt
once; the candidate's own excerpt is left out. A session alone was rejected: a new session has
few excerpts, and the brief is what the owner names. `GET /api/vibes/:vibeId/excerpt-features`
gives `{excerpts: [{renderId, features}]}` from the stored render rows, no render or sidecar;
the session page reads it on load and when a job ends. Each ranged feature (`TARGET_FEATURES`)
is compared at the prompt's rounding, so excerpts that read the same to the model tie, and
only with at least 4 other measured values (`MIN_OTHERS`: with 3, one excerpt moves the share
by a third). Only features above or below most are named, each by its own words
(`FEATURE_WAYS`: brighter / darker, wider / narrower, swells and recedes more / is steadier in
level, …): "Against the rest of this brief, it is brighter than most and is narrower than
nearly all; the rest sit about the middle." A candidate too quiet to hear, or a brief with too
few others, says so instead.

**Positions in words** (`positionsWords`, `src/domain/position-words.js`), on the brief's own
scale (0056): within 0.2 of an end is "close to" it, within 0.4 "leaning toward" it, between
0.4 and 0.6 "midway between", and past 0 or 1 "past" that end, "further than any excerpt of
this brief so far". The positions line with its numbers stays behind the toggle.

**Rank and score as verdicts** (`src/domain/verdict-words.js`). `rankWords` says where the
taste model ranks the excerpt among the session's ranked ones (best, least, more or less than
most or nearly all, the middle), read from the rank's share. `searchScoreWords` says a shown
search or steer point's score against the other scored points of its run on the page ("The
best point this search found.", "Scores higher than most of this steer's points."). The rank
badge and a new score line (`Score in its run: 1.23.`) sit behind the toggle, and `originText`
no longer prints the score, so the session and lineage pages' `origin` leaves 0083's
allowlist: the point and generation it counts are names, not settings.

**The Change it field.** The explore direction field is the card's one words field. Beside
Explore from here (unchanged: the words as a direction, new candidates), a select and Set from
these words read the same words into one of the card's field sets. The owner picks the set;
the model doesn't. Asking the model to pick would be a second request for every change, and
one prompt holding every set's fields would not fit beside a full reading: a full genome's
locks alone fill the budget. The lineage page shares the `steer-controls` template (0039) and
gets no sets, so the select is hidden there.

**Three sets of a new `candidate` scope** (`WORDS_SETS`, `src/domain/words-sets.js`). The page
sends the values now, as for `page`, and names the candidate; the route never takes fields or
a reading from the page.

| Set | Fields | Values | Values now, from the page |
|---|---|---|---|
| `locks` | each path `lockChoices` lists for the candidate (the piece's values, the macros, each voice whole and each parameter) | `locked` / `free` | locked where a live lock of the brief has that path |
| `macros` | each macro, described "less is darker, more is brighter" | `less` / `none` / `more` | the card's live Less / More choice, or none |
| `steer` | `direction<id>` for each live direction of the brief | 0 to 1, the brief's scale | each slider's setting now |

**The route.** `POST /api/vibes/:vibeId/words {set, words, current, candidateId}`. For a
candidate set it needs `candidateId`, checked by `vibeCandidate` (a 400 for one that doesn't
exist, is removed, has no genome or is of another brief); a page set refuses one. It reads the
candidate's genome for the fields, the brief's directions, and the candidate's
`sketchReading` (0078, through `sketchReadings`) as the prompt's reading, and stores the
requests under the candidate's session. A steer set with no direction is a 400. The values now
are checked against the widest fields, and `fitWordsPrompt` builds the prompt, asking the
set's `narrower` for fewer fields while it is over half the context budget. Only `locks`
narrows: voices lose their parameters from the last voice first and keep the whole voice.

**Sizes**, with a 4 000-character brief, 300 characters of words and a reading at its
800-token cap: `locks` on the largest genome the schema allows (16 voices, about 210 paths)
narrows to 95 fields at about 4 055 of 4 096 tokens; on the pad example it keeps all 28 at
about 2 760; `macros` about 2 430; `steer` with 4 directions of 100-character ends about
2 590. A test holds each under 4 096.

**The answer on the card.** The words job runs in the card's own job box and the top bar's
words entry with its Cancel (0092); there is no confirm. Its changes fill the card unsaved:
the Less / More buttons show the new choices pressed, the sliders move and count as moved, and
a box lists each change in words from templates (`changeLines`: "Lock the whole drone voice,
every parameter", "space: more (sound more spacious)", "Steer aims close to “wet” on “dry” to
“wet”") under the model's `said`. Keep sends each lock and unlock, or each macro choice as the
buttons would, or leaves the sliders for Steer from here, and empties the field; Undo puts the
buttons and sliders back. A pending answer holds the card's pair swap, as an offer does. When
the server names another words job already running, the page follows it and leaves the card
alone, as 0092's shift does. The edits are pure functions in `src/web/words-edits.js`.

**The brief page** already led with the draft from words (0074) and kept the rules form and
ranges behind the toggle (0083); nothing more moved. Its ratings list still shows heard values
and play times, and stays on the allowlist.

## Alternatives considered

- **The model picks the set** — rejected above: a request more per change, or one prompt too
  large for the context.
- **A Change it field apart from the direction** — rejected: two words fields on a card, where
  the plan asks for one.
- **Values now read on the server** (the locks and choices are stored) — rejected: the sliders
  are not stored, and one shape for every set keeps 0084's check; the route still checks every
  value against the descriptors.
- **Whole voices only in the locks set** — rejected: "keep the drone's filter" needs the
  parameter, and most genomes fit with every one.
- **The reference set as this session's excerpts** — rejected above.
- **A wider middle, 0.2 to 0.8** — not taken: it names fewer features, but "most" then means
  four in five, and the line says nothing for a candidate in the second fifth. The owner can
  move the thresholds in `place-words.js`.
- **Printing the score inside the origin line behind the toggle** — rejected: the line is one
  text node and stays in view; the score has its own line.

## Consequences

- A new field set for a card is a registry entry with a `label` and the page's values now in
  `wordsCurrent` and its words in `changeLines`.
- The feature words move as the brief gains excerpts: the same candidate can read "brighter
  than most" and later "about the middle".
- A Keep of macro choices records each as heard now, with the card's played share, as a click
  would.
- The lineage page's origin line no longer gives a search score; WF.4 decides what it shows.
