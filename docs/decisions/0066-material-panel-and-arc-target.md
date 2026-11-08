# 0066. The timeline's material panel places elites as sketches, steers a section, and draws a region as the arc

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm the steer's step, saving a steer as a new
  version, the arc as a page choice rather than part of the arrangement, and the keys. Amends
  [0057](0057-map-elites-archive-and-map.md) (the timeline reads the archive and places its
  elites)

## Context

Step 6g brings phase 5's material onto the timeline (0061): the map's elites (0057), the
brief's directions and the steer job (0056), and attached reference regions with their
per-window features (0051, 0052). A section names a sketch, so anything placed or swapped in
must be a sketch first. The track's sections are measured only when their player renders their
window (the `section-audio` job); 6c's track render measures loudness, not features. Step 6f
runs alongside, adding macro lanes under the timeline and its own keys, and both edit
`track.js`.

## Decision

**The material card** (`material-panel.js` with no DOM, drawn by `material-card.js`) lists:

- **the brief's live sketches**, each with its position on every direction, read from its
  candidate's excerpt: the steering route's position for that excerpt's render, which is 0056's
  `scaledPosition(projection(excerpt, direction), vibeScale(…))`. The track route's material now
  gives each sketch's excerpt its `renderId` for this. A sketch with no excerpt, or an excerpt
  not yet analyzed, says "not placed yet".
- **the map's elites**, one per filled cell of `GET /api/vibes/:id/archive`, each with the
  cell's place on each axis in words: the axis's name (`axisName`) and its bin's stretch between
  the ends, "up to" for the first bin and "or more" for the last, since a value past an end lands
  in the edge bin. An elite whose candidate is already a sketch names that sketch.
- **the brief's directions** to steer along, each with its reason when it can't be steered by.
- **the attached regions** to draw as the arc.

A brief with no map, directions or regions lists its sketches alone, with the map's reason in
words.

**Placing an elite** (Place after the chosen section, I) keeps its candidate as a sketch through
the session sketch route (`POST /api/sessions/:id/sketches`, the map's Keep as sketch), in the
brief's newest open session, then reads the sketches again and adds it after the chosen section
as Add does. An elite already kept places that sketch, so placing twice keeps one sketch. With
no open session, an elite not yet kept can't be placed, and the button says why. The section
waits for Save like any other edit.

**Steering a section** (Steer toward the far end, T; Steer back from the far end, G) runs 0056's
steer job from the section's sketch's candidate along the chosen direction, owner-started after
`steerCostText`'s confirm, at the default budget (32). Its setting is the sketch's position plus
or minus `STEER_STEP`, **0.25** of the brief's spread, held in 0 to 1; a sketch with no position
aims at the end itself. When the job is done, its best point (`result.best`, the highest score)
is kept as a sketch by its excerpt, as placing does, and swapped into the section with its
offset and seconds unchanged, since a steer moves only macros and keeps the duration. The swap
is saved as a new version noted "Section N steered along …". The steer buttons are off while the
timeline has unsaved changes, so the saved version is the one steered; if the owner edits during
the run, the swap is put on the timeline unsaved instead. A section that moved is found by its
window; one that changed is left, and the sketch is listed to add by hand.

**The arc target** is an attached region the owner chooses (Next region, J), drawn under the
timeline: its analysis windows at the brief's loudness, each `startSeconds` and length scaled by
the track's length over the region's (the last window's end), so window `i` sits at
`start_i · T/L` to `(start_i + 25 s) · T/L` of the track (`arcLayout`). Beside them each section
is drawn across its block at the value its measures give. One measure is drawn at a time (Next
measure, F), from the features a brief's ranges name (`TARGET_FEATURES`), first first; the raw
levels are left out, since every window and section is normalized to the brief's loudness. Both
share one height scale, the least value at the bottom and the most at the top. When no section
has been measured the line says so and says to play one.

**Section measures** are a read: `GET /api/tracks/:id/measures?sections=<JSON list>` gives each
section's cached window render's features, at the vibe's current loudness under this server's
producer, or null. The window is the section player's, cut at the sketch's end (`sectionWindow`,
shared with `section-audio`), so playing a section is what measures it. Each section is checked
as an arrangement of one, as the player's body is, and a malformed one is a 400 with its path. It
renders nothing and asks the sidecar nothing.

**The arc is a page choice**, not part of the arrangement: the region and measure drawn are not
saved, and the arrangement's `arc` stays the owner's words for 6h.

**Keys.** `MATERIAL_KEYS` (`material-keys.js`), a table apart from `TIMELINE_KEYS`, bound the
same way: I places the chosen elite, T steers toward the far end, G back from it, F draws the
next measure, J the next region. A test holds that none is a timeline key. The elite, direction,
region and measure are chosen with selects, as Add's sketch is, and no key fires while one has
the focus.

**Reads.** The card reads the brief (for its open session), its attachments, its steering and its
map once when the page opens, and again after a steer, each on its own so a slow or failing read
(the map and the steering can ask the sidecar) leaves the rest drawn. It reads a region's
analysis once, and the measures when the valid timeline's sections change or a section's player
finishes.

## Alternatives considered

- **The arc target saved in the arrangement** — rejected: an arrangement's keys are all present
  in a stored one (0061), so a new key is a shape change of irreplaceable rows with a migration,
  and 6f changes the arrangement's validation at the same time. Saving it can follow once the
  owner wants the choice kept.
- **A new route that places an elite or keeps a steer's result** — rejected: the step allows
  reads only, and the sketch route already checks the render and keeps the heard copy.
- **Steering to the end of the scale (setting 0 or 1)** — rejected: the slider is a target on
  the vibe's scale (0056), so aiming at its end asks for the brief's most every time; a step from
  where the section sits is "a little more", repeatable.
- **Swapping the steer's result into the unsaved timeline every time** — rejected: the plan asks
  for a new revision, and a steer takes minutes, during which unsaved edits would ride along in
  a save the owner didn't press.
- **Measuring sections from the track render** — rejected for now: 6c's render measures
  loudness only, over the mixed track; the section player's window is already rendered and
  measured once and cached.
- **The arc drawing every measure at once** — rejected: the measures have different units and a
  shared height scale would mean nothing.
- **The material keys added to `TIMELINE_KEYS`** — rejected: 6f adds lane keys to that table
  and its test at the same time; a table of its own keeps the two merges apart, and the test
  across both tables still catches a clash.

## Consequences

- An owner-started steer from the timeline leaves its points as candidates of the session and
  one more sketch of the brief; the session page shows them as any steer's.
- A section is drawn on the arc only after its player has rendered it, so the arc fills as the
  owner listens.
- A region's windows read 25 s each and hop 12.5 s, so the arc of a short region over a long
  track has few, wide marks.
- A steer followed on the timeline isn't picked up again after a reload; its candidates are
  still in the session.
- The step, the saved swap and the drawn measures are guesses until the owner has used them.
