# 0065. A macro lane is an offset on each section's own macro, sampled into its genome

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm the 10 s sampling, the 62-point lane, the
  lanes' keys and their steps. Amends [0006](0006-macros-bounded-offsets.md) (track
  automation on macros) and [0061](0061-tracks-and-the-timeline.md) (`lanes` hold lanes)

## Context

Step 6f adds automation across a track. 0006 defined track automation on the six macros, and
0061 reserved the arrangement's `lanes`, empty. Acceptance 7 asks that under a lane each
section's effective macro equals its own value plus the lane's offset at every breakpoint,
clamped to 0–1. A section's genome may already move a macro (0007's trajectories, or a morph's
move, 0064), and a trajectory holds at most `MAX_POINTS`, 64. A track with no lanes must render,
and keep its cache key, exactly as before, and the engine version stays.

## Decision

**The lane** (`src/domain/lane-schema.js`, checked by `checkLanes` in `validate-lanes.js`, which
`validateArrangement` calls). `lanes` holds at most one lane per macro,
`{"macro": "brightness", "points": [[0, 0], [90, 0.3, "smooth"]]}`: times in track seconds from
0 to 1200, rising, each offset from −0.5 to 0.5 (`LANE_OFFSET`, 0 is no change), every point
after the first naming the curve into it, written out, and the first naming none, as 0007's
trajectories. A lane may hold no points, and changes nothing then. A lane holds at most
`LANE_MOST_POINTS`, 62, so the section's two ends fit beside every breakpoint of a lane inside
one section. A time past the track's end is kept and never reached, as 0007 keeps one past a
genome's duration. A stored lane needs no migration: stored arrangements hold `[]`.

**Offsets, not replacement.** `applyLanes(genome, lanes, span)` (`src/domain/apply-lanes.js`)
writes each laned macro as the section's own value plus the lane's offset, clamped to 0–1, so a
sketch's own macro motion is kept. The span says where the genome plays on the track: its
timeline from the section's `offset` to `offset + seconds` plays from the section's start
(`sectionStarts`).

**Sampling.** The laned macro is a trajectory with a point at:

1. the section's two ends and every lane breakpoint inside it, exact (acceptance 7);
2. the section's own breakpoints inside it;
3. every `LANE_SAMPLE_SECONDS`, 10 s, of the track, counted from the track's start, so two
   sections overlapping in a crossfade sample at the same track times.

Points within 1e-9 s of one already kept are the same point. Each value is computed exactly
there; between points the line is `LANE_CURVE`, `linear`, since the sum of two curves is
neither of them. When every value is the same the macro is a number. Before the section's start
the first value holds, so a pre-roll (0007) hears the section's start value, not the sketch's
own motion before it.

**The cap.** A laned macro holds at most `LANE_POINTS`, 64. Groups are kept in the order above;
when one doesn't fit, its points are spread evenly over what room is left, so a dense lane drops
the grid and then the sketch's own breakpoints, never its own.

**With morphs.** `sectionGenome` calls `applyLanes` last, on the fitted genome or on a morph's
(0064). The morph's genome is the outgoing section's timeline across its span and the
transition, so the same span holds; the lane adds to the morph's move, and the incoming section,
from the handover, adds the same lane at the same track times.

**The manifest.** When a lane has points, the recipe names `laneRule`:
`{sampleSeconds: 10, points: 64, curve: "linear"}`, the constants in `src/engine/macro-lane.js`,
and `recipeKey` hashes it. The lanes themselves are in each section's genome. With no lane
points there is no `laneRule` and every genome is as before, so the recipe and its key are
unchanged. Changing a constant changes the genomes a laned track renders, which the genome
hashes in the key already catch; no stored genome and seed renders differently, so the engine
version stays.

**The page.** A Macro lanes card under the timeline draws one strip per macro, as wide as the
timeline, its line and points placed by track time and offset, +0.5 at the top
(`lane-layout.js`), drawn by `lane-panel.js`. A lane and its point are chosen by clicking them.
The chosen point has fields for its time and offset; a point is dragged across to move it in
time and up or down for its offset, and the drag makes its one edit when let go. Every action
has a key and a button showing it (`lane-keys.js`, its own table, sharing no key with the timeline's or the material panel's, 0066; a test checks all three): ↑ and
↓ choose the lane above or below, H and L the previous or next point, U and O move it 5 s
earlier or later, Q and W lower or raise its offset by 0.05, Y steps the curve into it, N adds a
point, D removes it. The edits (`lane-edits.js`) follow `timeline-edits.js`: a typed value is
kept as typed and the validator's errors say what to fix; a step or a drag stops at the point's
neighbors and the offset's range. A new point goes halfway to the next one, or 30 s past the
last, at the lane's offset there, so nothing sounds different until it moves; a lane's first
point is at 0 s with no change. A lane goes with its last point, and lanes are kept in the
schema's order of macros. Lanes save with the rest of the arrangement.

## Alternatives considered

- **A lane replaces the section's macro** — rejected: a sketch's own swell would be lost, and a
  lane over two sketches would flatten their difference.
- **A lane in the engine, read by `effectiveParams` beside the genome** — rejected: the engine
  version would move, the manifest's genomes alone would no longer say what a section plays,
  and the excerpt and chunk windows would need the track's time.
- **Sampling every control-grid step** — rejected: 64 points across a 15-minute section allow
  one about every 14 s, and the grid is 0.1 s.
- **The grid on each genome's timeline** — rejected: two sections in a crossfade would sample at
  different track times, so their offsets would differ between points.
- **A lane of 64 points** — rejected: a section's ends then may not fit beside them, and
  acceptance 7 would fail at the cap.
- **Refusing a section whose laned macro would pass 64 points** — rejected: the owner would
  have to thin a sketch's trajectory to add a lane.
- **Drag only** — rejected, as 0061 rejects it.

## Consequences

- Between points a laned macro is a line, so a sketch's `smooth` swell under a lane is exact at
  its breakpoints and every 10 s, and straight between them.
- A section's pre-roll holds its laned macros at their start values.
- A lane changes the genome hashes of the sections it touches, so a revision that adds one
  renders again; one whose lanes hold no points shares the cached render.
- Measured by test: `test/domain/apply-lanes.test.js` (acceptance 7 at every breakpoint with a
  clamp, the seam, no points, a 62-point lane at the cap, a morph), and
  `test/server/track-render-routes.test.js` (a laned track renders, names its rule, and
  re-renders from its manifest to the same hash; a lane with no points keeps the cache key).
- 6h's proposal writes `lanes`; its repair round quotes `checkLanes`' paths.
