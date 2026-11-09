# 0080. A weave is a morph whose split voices hand over one after another, each side across the whole move

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the two sequences running together rather
  than leaving voices first, the half overlap, the register order, and the button's three-step
  order. Amends [0064](0064-morph-transitions.md) (a third transition kind built on the morph;
  the fallback reasons name their kind; `Morph` lists a weave's order)

## Context

Step TD.4 adds a transition that blends two sections "in unique ways ... not just crossfade". A
morph (0064) moves every parameter both sections hold, but every voice that must split (and
every voice only one side has) falls or rises across the whole move at once. Acceptance 4 asks
for a `weave` that hands voices over one at a time in a stated order, a voice both sides hold
with equal fixed numbers playing through unbroken, checked at each voice's handover, with the
render before the weave equal to the outgoing section's within 0007's tolerance. The plan
proposed leaving voices first, highest first, then entering voices, lowest first, or a measured
alternative. No stored genome or arrangement may render differently, so the engine version
stays 2.

## Decision

**The arrangement.** `TRANSITION_KIND.weave` is stored as a morph is, `{kind: "weave", seconds,
curve, text}` (`TRANSITION_KEYS`), with a morph's limits: at least `MORPH_LEAST` and at most half
the shorter section. `morphs(kind)` in `arrangement-schema.js` says whether a kind is a morph or
a weave, for the validator, `sectionMorph`, the edits and the page. Stored arrangements hold no
weave, so there is no migration.

**The genome** (`morphGenome(outgoing, incoming, seconds, curve, {weave: true})`). A weave is the
morph with one change: each split voice's level moves on its own stretch of the move instead of
across all of it. Everything else is the morph's: matched voices and the globals and macros
move across the whole move, the fixed globals hand over in the last `MORPH_HANDOVER` crossfade,
renamed instances take `--in`, and the fallbacks and their order are the morph's, each reason
naming the kind ("which a weave can't move between"). A leaving voice holds its own level until
its stretch, falls to the floor by the curve across it and ends where it reaches the floor; an
entering voice starts where its stretch starts and reaches its level, held from the handover,
where it ends. The result lists the stretches in `order` (`{id, leaves, from, to}`), empty for
a morph.

**The order and the stretches.** Two sequences run together across the whole move: the leaving
voices fall one after another, highest register first, while the entering voices rise one after
another, lowest first, ties in the genomes' order. With `n` voices on a side and a step of the
moving time over `n + 1`, voice `i` of that side moves from step `i` to step `i + 2`: each
overlaps the next by half, the first starts where the move starts and the last ends at the
handover, so the last entering voice is at its level by then. A lone voice on a side takes the
whole move, so a weave with at most one split voice a side, or none, is exactly the morph's
genome (tested); the top of the outgoing section thins while the floor of the incoming one
arrives, register by register.

**Only a voice that sounds through the whole move takes a stretch.** A split voice that starts
or ends inside the move (an outgoing voice starting after the move starts or ending before it
ends, an incoming one placed to start after it starts or to end before it ends) takes no
stretch: it falls or rises across the whole move with its own start and end, exactly as in the
morph, and the stretches are shared among the rest. So a stretch never lies outside its voice's
life (which would give an end before the start, and a genome that doesn't validate), and a
side's sequence has no gap where a voice ends early. Every input a morph accepts, a weave
accepts.

**A voice's register** (`register` in `morph-genome.js`): its root or center in Hz at the
transition (drone, chant, drum, granular, cymbal), the log middle of its band for a pad
(100–500 Hz) and a bell (150–1100 Hz), whose `BAND`s their engine files now export, and 0 for a
noise bed or a recording, which have no pitch and sit under every pitched voice. A voice type
with none of these throws, so a new voice type gets a register before it can weave.

**Where it plugs in.** `sectionMorph` builds a weave for a `weave` transition, so
`sectionGenome`, `sectionWindow`, `sectionInstances`, `trackCost` and the stems (0063) read it
as a morph. `renderedTransition` keeps the kind: the manifest's transition is `{kind: "weave",
seconds: 4, morphSeconds, curve}`, read by `recipePlan`, the seam preview and `rerenderTrack` by
its seconds as they read a morph. A track with only crossfades and morphs keeps its recipe and
cache key, tested against the keys computed before this change.

**The page.** The transition line says what a weave does in plain words: the sounds both play
move, the others hand over one at a time, the outgoing section's from the highest down as the
incoming one's come in from the lowest up, then the named voices in order on each side (or that
none hands over on its own, so it plays as a morph would), and why a weave plays as a
crossfade. M and its button step crossfade, morph, weave, crossfade, keeping seconds and text; a
morph becoming a weave keeps its curve. K steps the curve of a morph or a weave.

## Alternatives considered

- **The plan's order: leaving voices first, then entering voices, in one sequence** — rejected
  by measurement. Summing the voices' power across the move, with no voice playing through, the
  hinge where the last leaving voice falls while the first entering one rises dips to −49.5 dB
  (`smooth`) for every count of voices, 17 to 24 dB under the morph's lowest point. Lowest power
  sum, all voices at −12 dB, `smooth` (`linear` in brackets):

  | Split voices (leaving + entering) | Morph | One sequence | Alternating | Two sequences |
  |---|---|---|---|---|
  | 1 + 1 | −33.0 (−33.0) | −49.5 (−45.0) | −49.5 (−45.0) | −33.0 (−33.0) |
  | 2 + 1 | −31.5 (−31.5) | −49.5 (−45.0) | −16.5 (−21.0) | −26.0 (−28.3) |
  | 1 + 3 | −30.6 (−30.6) | −49.5 (−45.0) | −49.5 (−45.0) | −21.7 (−25.2) |
  | 3 + 3 | −28.2 (−28.2) | −49.5 (−45.0) | −10.7 (−11.5) | −10.7 (−11.5) |
  | 5 + 5 | −26.0 (−26.0) | −49.5 (−45.0) | −6.7 (−7.0) | −6.7 (−7.0) |

  The two sequences are never quieter than the morph, and match it where each side has one
  voice. The level moves in dB, so a voice halfway through its stretch is already 24 dB down;
  any order that lets the incoming side start only after the outgoing one has mostly gone leaves
  a hole.
- **Alternating, one leaving then one entering, in one sequence** — rejected: as quiet as one
  sequence whenever a side has one voice (1 + 1, 1 + 3 above).
- **Stretches that don't overlap, or a fixed length per voice** — rejected: each voice would
  reach the floor before the next rose, and a fixed length would not fit a short weave with
  many voices.
- **A separate `weaveGenome` beside `morphGenome`** — rejected: it would repeat the matching,
  the renames, the fallbacks and the trajectory rules, which must stay the morph's.
- **A register on every voice type in the engine** — rejected for now: it touches every voice
  module and the test fixture for one use; the rule above reads parameters the voices already
  have.
- **Keeping a weave with no split voice named as a morph in the manifest** — rejected: the
  manifest says what the owner chose; such a weave renders the same samples under another key.

## Consequences

- Measured by test (`test/domain/morph-genome.test.js`): each split voice's level at 0, a
  quarter, the middle and the end of its stretch within 1e-12 of the curve in the encoded space,
  for the four curves; the order; the matched drone equal to the morph's; the weave's quietest
  moment louder than the morph's for each curve; the render of the 6 s before the weave equal to
  the outgoing genome's within 0007's tolerance; the fallbacks with their words; a voice on
  either side starting or ending inside the move taking no stretch and moving as in the morph.
  Through the routes (`test/server/track-render-routes.test.js`), a weave of two split voices a
  side renders and re-renders from its manifest to the same hash; its stems sum to its mix
  within the tolerance (`test/server/render-stem.test.js`).
- A weave costs what the morph costs: the same voices, the entering ones starting later.
- The proposal (0067) doesn't offer weaves yet; a weave the model writes anyway is checked like
  any transition.
- A weave with no split voice, or one a side, plays the morph's samples under another cache key.
- `./scripts/bench --track` with its first transition a weave (example into drone, 10 s), on
  mbp2021 2026-11-09, one run each, load average 3.6–4.9 with another builder's tests running:
  the 20-minute track (peak cost 442.4, 299k node-seconds) rendered at 26.9x, peak RSS 541 MiB,
  and with export at 18.1x, 552 MiB; the 10-minute one at 25.2x, 502 MiB, and 17.2x, 555 MiB.
  The 10-minute render's peak is 7.1% from the 20-minute one's, within 0062's 10%. These match
  0064's morph run (27.2x, 523 MiB).
