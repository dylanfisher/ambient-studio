# 0064. A morph is the outgoing section's genome moving into the next one's, then a short crossfade

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the 4 s handover, the `smooth` default
  curve, the 8 s shortest morph, splitting a voice whose fixed numbers differ, and the instance
  suffix. Amends [0062](0062-track-render-and-export.md) (section windows, the manifest's
  transitions, the cost) and [0063](0063-stems-by-voice-id.md) (stems by section); amended by
  [0080](0080-weave-transitions.md) (a weave is this morph with each split voice on its own
  stretch; a fallback's reason names its kind; the result lists a weave's order)

## Context

Step 6e adds a second kind of transition beside 6c's crossfade (0062): one section's sound
moves into the next one's, so the owner hears one piece changing rather than two overlapping.
Acceptance 6 asks that every numeric parameter both sketches hold moves along its encoded scale
(0005) by the transition's curve, checked at the start, middle and end; that a voice whose type,
choices or flags differ plays as two crossfaded instances; and that the render before the morph
starts equals the outgoing section's within 0007's tolerance. `reverbDecay` and `delayTime` set
the impulse response and the delay and can't follow a trajectory (0006). A voice id is part of
every PRNG key (0003), so a renamed voice plays other events. No stored genome and seed may
render differently, so the engine version stays.

## Decision

**The arrangement.** `TRANSITION_KIND.morph` is `{kind: "morph", seconds, curve}`, `curve` one of
0007's `CURVES`, written out; a crossfade still has no `curve`, so stored arrangements keep their
shape and need no migration. A morph is at least `MORPH_LEAST`, 8 s, and like a crossfade at most
half the shorter of its sections; the track's length counts it as a crossfade. A new morph takes
`MORPH_CURVE`, `smooth`, which has no corner where it starts or ends.

**The morph** (`morphGenome(outgoing, incoming, seconds, curve)` in
`src/domain/morph-genome.js`). Each side is `{genome, at}`: the section's fitted genome (0062)
and where the transition starts on that genome's timeline, the outgoing section's end less the
transition's seconds, and the incoming section's offset. The signature takes `at` beside each
genome because the plan's four arguments don't say where the morph sits. The morph's genome is
the outgoing one, on its own timeline. It moves for the transition's seconds less
`MORPH_HANDOVER` (4 s, `src/engine/morph.js`), and over those last 4 s the track crossfades from
the morph's genome to the incoming section's own render, with 0062's equal-power law, which also
hands the voices' events from the morph's seed and ids to the incoming section's. Until the
handover the incoming voices play the morph genome's events, drawn with the outgoing section's
seed; at the handover they change to the incoming section's own, and the equal-power crossfade
is what hides that change.

- **Moving.** Every parameter that may be a trajectory and that both hold (`reverbLevel`,
  `delayFeedback`, `delayLevel`, the six macros, and each matched voice's) becomes a trajectory
  from its value at the morph's start to the incoming value where the morph ends on the incoming
  timeline, with the transition's curve. A trajectory evaluates along its descriptor's scale
  (0007), so the move is linear in the encoded space by the curve. A number equal to its target is
  left a number. A trajectory keeps every point before the morph and its value at the start; a
  segment the start falls inside is cut there when its curve cuts exactly (`linear` and `late`,
  whose left part is the same curve), and kept whole when it is `smooth` or `early`, so the move
  starts at that segment's end, or not at all if that end is past the morph's. Values before the
  morph are always the outgoing section's.
- **Fixed globals** (`width`, `reverbDecay`, `delayTime`, `loudness`, `ceiling`) stay at the
  outgoing values; the handover brings the incoming ones.
- **Two instances.** A voice is matched when both sides hold its id with the same type, every
  choice, flag, recording and fixed number equal (its `start` and `end` aside), the outgoing one
  playing through the morph and the incoming one where it ends. Any other voice plays as two
  instances: the outgoing one's level moves to the floor, −60 dB, by the curve and it ends where
  the morph ends; the incoming one starts where the morph starts, its level rising from the floor
  to its level at the handover, its other trajectories held at their handover values, its times
  moved onto the outgoing timeline. A voice only one side has does the same. An outgoing voice
  that would start after the morph, and an incoming one that would start after it or end before
  it, are left out: they never sound in it.
  A voice whose fixed numbers differ (a drone's `root`, a pad's `notes`) splits too: a fixed number
  can't move, and jumping it at the handover would be a crossfade of the two pitches at the end.
- **Ids.** An incoming instance whose id an outgoing voice in the morph's genome holds is
  renamed `<id>--in` (`MORPH_SUFFIX`); any other keeps its id. The morph lists its renamed
  instances (`instances`), and `voiceOfInstance(id)` in the same engine file strips the suffix
  from a listed one.
- **Fallbacks.** The morph plays as a crossfade of its seconds when the two differ in `tuning`,
  `scale`, `key`, `pulse` or `bpm`; when the morph would hold more than `MAX_VOICES`; when a
  trajectory would pass `MAX_POINTS`; when a renamed id would pass `VOICE_ID`'s 16 characters
  (an outgoing id over 12); or when a voice of either sketch already ends in `--in`, so an
  instance never takes a sketch voice's id. Each gives its reason in words.

**Where it plugs in** (`src/domain/section-genome.js`). `sectionMorph(arrangement, i, genomes)`
is the morph after section `i`, or null for a crossfade; `sectionGenome` returns the morph's
genome when it holds; `sectionWindow` starts a section a morph leads into at the handover, its
offset moved by the morph's seconds less 4, since before then the morph plays its voices;
`renderedTransition` gives the transition as the mix renders it; `sectionInstances` gives a
morph's renamed instances. The mix (`mixTrack`) is
unchanged: a morph is a 4 s crossfade between the morph's genome and the shortened incoming
window, and the track's length is the same as a crossfade's of the morph's seconds.

**The manifest.** A morph's transition is `{kind: "morph", seconds: 4, morphSeconds, curve}`,
`seconds` being what the mix crossfades, so `recipePlan`, the seam preview and `rerenderTrack` read
it as they read a crossfade; a fallback is recorded as the crossfade it plays. Section windows
are the rendered ones, each section's genome is the morph's, which holds the rest of the rules
(the floor, the ids, the trajectories), and a morph's section lists its `instances`. A crossfade-only track's recipe, and so its cache
key, is unchanged. Changing `MORPH_HANDOVER`, `MORPH_SUFFIX` or what a morph writes changes a
track's samples and bumps the engine version (0009).

**Cost.** `trackCost` reads `sectionGenome` and `sectionWindow`, so the peak during a morph's
handover is the morph genome's cost, which holds both sketches' voices, plus the incoming
section's, and the incoming section's work starts at the handover.

**Stems.** `stemsOf` in `src/server/stem-voices.js` maps each voice of a section to its stem:
a listed instance to `voiceOfInstance` of its id, any other voice to its own id, so a sketch's
own `x--in` beside an `x` keeps its own stem (0063). `mixTrack`'s `voices` reads the planned
section, which carries the instances from the manifest.

**The page.** The timeline's transition line says what the chosen transition does
(`transition-text.js`): a crossfade, a morph with its curve and how long it moves and hands over,
a morph under 8 s and how much longer it must be, or a morph that plays as a crossfade and why, from `sectionMorph` over the sketches' genomes, which
`GET /api/tracks/:id` now lists with each sketch. M turns the chosen transition into a morph or
back, keeping its seconds; K steps a morph's curve through 0007's order, the button naming its
shape in plain words. 6d added V for the export
with stems in the same table.

## Alternatives considered

- **The morph's full seconds of movement, then a crossfade after them** — rejected: the track
  would run 4 s longer than the arrangement says, and `arrangementLength` would need a kind.
- **Rendering the incoming section through the whole morph and crossfading as 0062 does** —
  rejected: both renders over the whole transition for 4 s of handover, and the incoming
  section's own voices would double its instances.
- **A trajectory's point at the morph's start for every curve** — rejected: cutting a `smooth` or
  `early` segment there changes its shape before the morph, which acceptance 6 forbids.
- **Fixed numbers stay outgoing, as the globals do** — rejected for voices: a drone's root
  would jump at the handover; for the globals there is one bus, so they can't split.
- **Instance ids cut to fit and numbered** (`abcdefghijkl-in2`) — rejected: the stem's name
  couldn't be read back from the id.
- **Telling an instance by its suffix alone** — rejected: a sketch may name its own voice
  `x--in`, and its stem would merge into `x`'s.
- **A morph shorter than 8 s that only crossfades** — rejected: the validator says why, as for a
  crossfade longer than half a section.
- **Interpolating fixed globals and `reverbDecay` in steps** — rejected as 0006 rejects it: each
  step would be a new impulse response, and a jump.

## Consequences

- **A stated exception to acceptance 6.** A parameter whose `smooth` or `early` segment starts
  before the morph and runs past its end doesn't move at all: it follows its own segment through
  the morph and jumps to the incoming value at the handover, under the crossfade. Moving it would
  change the segment before the morph, which acceptance 6 forbids too. A test holds the branch.
- Measured by test on scripted pairs (`test/domain/morph-genome.test.js`): every shared
  parameter, for each of the four curves, at 0, a quarter, the middle and the end within 1e-12
  of the curve in the encoded space; the render of the
  6 s before the morph against the outgoing genome's within 0007's tolerance; a three-section
  track through the routes renders and re-renders from its manifest to the same hash; a morph
  track's stems sum to its mix within the tolerance.
- `./scripts/bench --track` with its first transition a morph (example into drone, 10 s), on
  mbp2021 2026-11-07, one run each, load average 1.3–1.6: the 20-minute track (peak cost 442.4,
  299k node-seconds) rendered at 27.2x, peak RSS 523 MiB, and with export at 17.2x, 572 MiB;
  the 10-minute one at 25.3x, 489 MiB, and 16.5x, 531 MiB. The 10-minute render's peak is 6.6%
  from the 20-minute one's, within 0062's 10%, in this one run.
- A morph's genome costs both sketches' voices for the whole outgoing section, since `cost()`
  bounds every window; the estimate overstates the outgoing section's work.
- The seam preview of a morph centers on its handover, so a morph longer than about 26 s is heard
  only in part.
- A sketch voice whose id ends in `--in` makes every morph with it fall back. The LLM's ids so
  far are words and numbers.
- A morph across a chunk boundary is a trajectory like any other; chunks render it as 0062 says.
- 6f's `applyLanes` runs on `sectionGenome`'s result, a morph's genome included.
