# 0057. The MAP-Elites archive, its fill job and the map view

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the axes, the bins, the elite rule and the
  control's starts. Amends [0031](0031-fewer-waits-after-first-evaluation.md) (the fill's
  conflict rule and progress steps), [0032](0032-plain-language-pages.md) (the map page, with
  arrow keys) and [0052](0052-references-in-the-prompt.md) (the `axis` kind's details);
  amended by [0066](0066-material-panel-and-arc-target.md) (the timeline lists the elites and
  places them as sketches)

## Context

Phase 5's acceptance 5 asks that the archive fill and play: on two or three axes the owner
chooses, a fill job reports its coverage (filled cells over cells) beside that of the same
budget of nudges from the same starts; every filled cell plays its elite on click or Enter; and
descriptors are read from the excerpt windows the owner rates. The plan put the axes in
`softTargets.axes`; the owner overrode that on 2026-11-07: "A brief's attached regions,
directions and axes live in their own append-only table keyed by vibe, not in `softTargets`, so
changing them makes no new brief revision." 5c built that table (0052) and its CHECK already
admits `axis`. The nudge's chain and free-path rule live in `proposeGenome` and `searchPaths`
(0053), 5e's job shape gives the budget, estimate and control (0054), and 5g's directions and
regions give the CLAP values an axis can read (0056).

## Decision

**An axis** is a `vibe_attachments` row of kind `axis`, oldest first. Its `details` are
`{source, …, ends, bins}`, checked by `addAttachment`:

| `source` | What names it | Its value for an excerpt |
|---|---|---|
| `feature` | `name`, one of `TARGET_FEATURES` (the raw levels take none) | the feature as measured on the excerpt |
| `macro` | `name`, a macro | its mean over the excerpt's window (`macroWindow`) |
| `direction` | `directionId`, a direction attachment | the excerpt's projection on the direction |
| `region` | the row's `regionId`, a region attached to the brief | the excerpt's cosine similarity to the region |

`ends` is `[low, high]`, either null for the default; `bins` a whole number from 2 to 16. The
features and macros are the window `excerptTerms` reads for the taste model, the excerpt the
owner hears and rates, so the map places a sound where the owner would.

**Choosing axes** (`POST /api/vibes/:id/axes`, `{axes: [{source, name?, directionId?,
regionId?, low?, high?}]}`) takes two or three different axes and, in one transaction, marks the
live axes removed (`axes replaced`) and adds the new rows, with **8 bins** a side for two axes
and **6** for three (`AXIS_BINS`), so a map is 64 or 216 cells, at most 256
(`MAX_ARCHIVE_CELLS`). A direction must be live on the brief and a region attached to it, or a
400. No revision is made. `GET /api/vibes/:id/attachments` lists `axes`. The brief page's card
"Axes for the map" has three selects (the third optional) over every ranged feature, macro,
direction and attached region, and starts on dark to bright by static to evolving, spectral
centroid by loudness range, until the owner saves a choice. The page sets no ends; the route
takes them.

**The archive** (`buildArchive`, `src/domain/build-archive.js`) is derived and rebuilt on every
`GET /api/vibes/:id/archive` (`readArchive`, `src/server/vibe-archive.js`). Its candidates are
the live, valid ones of the brief's sessions, one per excerpt, with a current excerpt under this
server's producer; removed, rejected and 3h's control revisions are left out, and a candidate
missing a value on an axis (a feature not measured, or no sound analysis for a CLAP axis) is
counted as `unplaced`. A value past an end lands in the edge bin. **The elite** of a cell is the
best by `searchScore` under the brief's current taste model (an excerpt the model scored beats
one it couldn't); with no model, the one with the fewest misses of the brief's current ranges;
a tie goes to the newest. **Ends** default per end: the owner's, else a feature's range from the
current revision, else the 10th and 90th percentile (nearest rank) of the placed excerpts'
values. An axis with no ends (fewer than two values apart) or one that can't be read (its
direction or region gone, no sound analysis) gives the map its reason and no cells. Each cell
gives its elite's id, excerpt URL, intent (its own, or its nearest parent's for a nudge), score
and misses, and how many candidates it holds. Phase 6 and phase 7's gap filling read this route.

**The fill job** (`fillJob`, `src/server/fill-job.js`, operator `elite`, source `mutation`) takes
`{budget, exploreShare, control}` on `POST /api/sessions/:id/fills`: budget in steps, default
**200**, at most 400; share 0 by default; control **on** by default, since acceptance 5 needs
it. It reads the axes, the map and its ends once, when it starts, so its own children don't move
the ends under it (0056's rule for scales). Each step lists every elite beside an empty cell, one
bin along one axis (`besideEmpty`), and picks one by the job's seed; an elite that can't take
the live locks is skipped. It makes one medium nudge child (`nudge`, so `proposeGenome`, at most
`NUDGE_DRAWS` draws), stores every draw, renders the child, and places it, so the next step
reads the map with it. Each child stores `{run, seed, step, stepSize, to}`, `to` the empty cell
it aimed at. A step counts whether or not its draws passed. The fill stops early when no elite
is beside an empty cell.

**The explore share.** Step `i` asks the model instead when `⌊(i + 1)·share⌋ > ⌊i·share⌋`
(`isExploreStep`), so the share is spread through the run. It runs the candidates job's explore
for one child of the elite, with the direction toward the empty side (`towardText`, as "Toward
a higher spectral centroid" or "Toward less motion"). The confirm (`fillCostText`) gives 5e's
estimate for every step and the control's, and states the number of requests to the language
model, which wait their turn.

**The control** runs after the fill: as many medium nudges as the fill took steps, shared out in
turn over the elites that were beside an empty cell when the fill began, stored outside any
session (operator `elite-control`), rendered and placed on a copy of the starting map. "The same
starts" is read as the starting map's starts: the fill's later starts are its own children, which
the control doesn't have, and that difference is what the comparison measures. Both coverages,
and the starting one, are in the job's result and in `fill.json` in the run's folder under
`paths().search`, numbered with the searches, with each child's render and analysis seconds, for
5j to read (`readFillResults`).

**The map view** (`map.html`, opened as Map from the brief and session pages) is a table of cell
buttons, the first axis across and the second up, low to high, a third chosen as a slice with a
select. Each filled cell shows its elite's intent and score (or misses), and its title says it in
full. One cell takes Tab; the arrow keys move one cell at a time and stop at the edges
(`arrowMove`, `src/web/map-grid.js`, no DOM). Click or Enter opens a cell: it plays the elite
through 4i's excerpt player and offers the shared explore, nudge and search controls and Keep as
sketch. Fill the map has its steps, the share in percent and the control switch, asks first, and
follows its job, reading the map again as its count moves: one read at a time, and one
more after the last call (`latestOnly`), since a read can ask the sidecar to score every
excerpt. Each opened cell keeps its controls, so a job it started still holds its button after
another cell opens. An end the owner or the range gives that meets the excerpts' percentile end
says so, apart from the reason for too few or alike excerpts.

## Alternatives considered

- **`softTargets.axes` in a new revision** — overruled by the owner (0052).
- **Adding axes one at a time** — rejected: the bins depend on how many axes there are, and a
  third axis would leave the first two at 8 bins, 384 cells. Choosing the set replaces it.
- **A stored archive updated by each job** — rejected by the plan: derived from the candidates,
  it can't disagree with them, and any rule change applies to every brief at once.
- **Clamping out a value past an end** — rejected: the excerpt is still a sound of the brief, and
  the edge cell is where a listener would put it.
- **Ends read again each step** — rejected: percentile ends move as the fill adds excerpts, so a
  cell the fill aimed at would shift under it.
- **The control from each of the fill's starts in order** — rejected: those include the fill's
  own children, so the control would copy the emitter it is meant to test.
- **Hidden candidates left off the map** — rejected for now: hiding tidies a session's table
  (0049); a hidden candidate is still a sound of the brief.
- **A nudge aimed at the empty cell, moving the axis's macro only** — rejected: features and
  directions aren't genome paths, and MAP-Elites' plain emitter is a random step from the elite.
- **Keys on the map page beyond the arrows** — rejected: Enter and Space are the buttons' own.

## Consequences

- A fill of 200 steps with its control renders about 400 excerpts, about 15 minutes at the
  bench's 2.2 s; the page asks first.
- The map asks the sidecar on each read when the brief has a model file (to predict) or a CLAP
  axis (to embed the direction's ends once, through the cache).
- An axis whose direction is removed, or whose region is detached, leaves the map empty with the
  reason until the axes are chosen again.
- A cancelled fill keeps its rows but writes no `fill.json`.
- The bins, the elite rule and the control's starts are guesses until the owner has filled a map:
  if neighboring cells don't differ the way their axes say, widen the ends or lower the bins.

## Amendments

- 2026-11-08: phase 6 reads the archive on the timeline page (0066): each filled cell's elite is
  listed with its place on each axis in words, from the route's `low`, `high` and `bins`, and
  placing one keeps it as a sketch through the session sketch route before it becomes a section,
  as the map's Keep as sketch does. The archive route is unchanged.
