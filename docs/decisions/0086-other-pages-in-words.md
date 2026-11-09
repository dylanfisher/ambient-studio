# 0086. The map, lineage, Quick A/B, references and model test pages in words

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the cell words, the played and pairs-left
  bands, and the verdicts on the model test page. Amends [0083](0083-numbers-toggle.md) (the
  map's grid, axis captions and open cell's line and the brief's ratings list leave the
  allowlist) and [0057](0057-map-elites-archive-and-map.md) (a cell's score, the axes' ends and
  the fill's settings sit behind the toggle)

## Context

The owner, 2026-11-09: "in majority of situations the parameters are hidden behind a toggle
(e.g. collapsed) and we use language in almost all contexts to describe and control
parameters. the goal is LLM language as the tool." WF.1 (0083) put each page's numbers behind
one toggle, with an allowlist for parts that still showed numbers; WF.3 (0085) said the session
and brief pages in words with `place-words.js`'s thresholds and `positionWords`'s bands. Plan
WF.4 does the same for the map, lineage, Quick A/B, references and model test pages, and says
budgets as time. Descriptions are templates, never model text (0047).

## Decision

Each page says what it shows in words outside the toggle; the numbers that said it before move
into a part marked `data-numbers` beside the words, so opening the toggle shows them as before.

**Map** (`src/domain/map-words.js`). A cell's place on each axis is read at its bin's middle
in `positionWords`'s bands (`POSITION_BANDS`, now exported): within 0.2 of an end is that end
("a lower spectral centroid", from `endWords`, the words `towardText` now builds on), within 0.4
"leaning toward" it, else "midway on" the axis. With 8 bins that is three bins at each end, one
leaning each side and two midway; with 6, two, one and two. Its verdict, with a taste model, is
its elite's score against every other filled cell's on the whole map, all layers, in
`place-words.js`'s places ("The best cell on the map by your taste model.", "Your taste model
scores it higher than most of the map's cells."); without one, the brief's ranges it misses
(none, one, or more than one). A cell button shows its intent; its score is a `data-numbers`
span inside it; its title and `aria-label` give the intent, place and verdict. The open cell's
line says the same, with its score on its own line behind the toggle. The axis captions say
"Across: from a lower spectral centroid at the left to a higher spectral centroid at the
right."; the ends are a span beside them. The third axis's slices are named by the same place
words, with "slice 2 of 6" after them, since two slices can share "midway".

**The fill as time.** `fillTimeText` gives the fill's minutes from the same `searchMinutes`
every confirm now uses (evaluations, both arms with a control, at the last search's medians or
the bench), and adds that steps asking the model take longer; it reads `GET
/api/search-estimate` on load and again at each confirm, and follows the hidden steps, share
and control fields as they change.

**Lineage.** Nothing numeric was left outside the toggle: `originText` names a search point by
its point and generation (names, as 0085 says) and the search budget fields were already
marked. Unchanged.

**Quick A/B** (`src/domain/listening-words.js`). Steer the search leads with Describe a shift
and its button, then the variation choice; the help line says so. Each side's played share is
said in five bands (`playedWords`: not played yet, a little, about half from 0.3, most from 0.7,
all from 0.95) with the percent behind the toggle. The progress line says how far through the
pairs the page is (`pairsLeftWords`: first, most still to come, about halfway, nearly done, the
last, read with `placeOf` on the share done) when the order has an end (search by ear and spot
checks), and "More pairs come after this one." when it doesn't; the count is behind the toggle.

**References.** A region is its label and note; its times stay behind the toggle. After
Analyze, `analysisWords` says what the region can now be used for (a brief's ranges, and a steer
toward it once its sound is analyzed, else why not); the windows and loudness target are a line
behind the toggle. The help lines and Play the chosen part (was Play these times) point at the
strip, and at Show the numbers for typed times. The status line names a region by its label.
The analysis carries no features, and the page has no brief, so levels relative to a brief
(`featureWords`) don't fit here.

**Model test.** Each taste model card opens with `tasteVerdict`: the held-out agreement's
interval against chance, as the optimizer test reads it (0059), "most of the time" when the
share is above most (0.7); each optimizer card with `optimizerVerdict`, the verdicts of
`modelText` and `ownerText` without counts, scores or p. The revision verdict has
`revisionVerdictWords`; `meaningText` says "Some answers were cut off" instead of the count.
The existing summaries, counts and p, a tally card's "made of asked", a result's rate in the
list and the optimizer's evaluations a search move behind the toggle.

**The brief's ratings list.** Each line is said in words ("More space, played most of it",
"Compared two excerpts: left was better") with the heard value, genome and seed, played percent
and time behind the toggle, so it leaves the allowlist.

**What stays allowlisted:** the track page whole (WF.5), and an earlier brief version's rules and
ranges, written in words by `constraintsText` and `targetsText` inside its own disclosure.

## Alternatives considered

- **A verdict word on each cell button** ("best", "high") — rejected: the cells are narrow, and a
  short word next to the intent reads as part of it. The title, `aria-label` and open line carry
  the verdict.
- **Cell verdicts against the shown layer only** — rejected: the score is one scale over the
  whole map, and changing slice would change a cell's words.
- **Levels relative to a brief for a region's analysis** — rejected above.
- **Pairs left as words with no end** ("many", "a few") — rejected: with no fixed end a count
  of 7 is many or few only against a guess.
- **Leaving the ratings list allowlisted** — rejected: each row fits a template.

## Consequences

- The cell words move as the map fills: a cell that was "the best" reads "higher than most"
  once better cells land.
- The fill time shown before any search is the bench's, as the confirm's is.
- The track page's material panel still lists the map's elites with their score, through
  `openText`; WF.5 says them in words.
