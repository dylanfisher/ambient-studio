# 0034. Feature ranges as soft targets: a table on 3a's names, in every first prompt

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0024](0024-prompt-parse-repair-generation.md) (the ranges enter the first prompt),
  [0027](0027-session-api-and-ratings.md) (soft targets are checked on every save) and
  [0030](0030-seed-vibes-and-evaluation.md) (the seed vibes have ranges). Amended by
  [0051](0051-region-analysis-and-ranges.md) (a reference region can fill the ranges form) and
  [0052](0052-references-in-the-prompt.md) (attached regions, directions and axes live outside
  `softTargets`) and [0056](0056-directions-sliders-reference-target.md) (CLAP directions are
  attachments).

## Context

Phase 3 revises a candidate whose excerpt misses its vibe's feature ranges (step 3d), and 3h
tests whether revising with the measurements beats revising without them. Both need ranges the
code can check: until this step `softTargets` was a free JSON object on each vibe revision,
stored and checked by nothing, and every seed vibe had `{}`. 3a's `FEATURE_NAMES`
([0033](0033-low-end-width-flatness.md)) lists the nine features a range may name, each with a
label, a unit and the digits the prompt rounds to. Revisions are irreplaceable data (AGENTS.md),
and phase 5's CLAP directions are meant to sit in `softTargets` beside the ranges (spec, "Core
concepts"). The owner settled on 2026-11-06 that the owner writes a vibe's ranges on the brief
page, each optional, blank meaning none.

## Decision

**Shape.** The ranges live at `softTargets.features`, an object from feature name to
`[low, high]`. Both ends are included, and either may be `null` for an open end, but not both: a
feature with no range is left out, so there is one way to say "none". Other keys of
`softTargets` are kept as the owner saved them and not checked. `{}` stays valid and means no
ranges, so no stored revision changes shape and no migration is needed.

**The table.** `TARGET_FEATURES` in `src/domain/target-schema.js` has one entry per feature a
range may name, in `FEATURE_NAMES` order, each holding its 3a entry and the bounds an end may
take: 0 to 1 for the three shares, at least 0 for the centroid, its spread, the onset rate and
the loudness range. `RANGE_BOUNDS` decides every entry of `FEATURE_NAMES`, and its type fails
`tsc` when 3a's list gains a feature this table hasn't decided. `validateTargets`,
`targetsText`, `checkTargets` and the brief page's form read it, as 0020's readers read
`CONSTRAINT_KINDS`.

**The two raw levels take no range.** `shortTermMax` and `truePeak` are measured on the raw
render, whose level is the sum of the voices' levels: the engine doesn't render to the genome's
`loudness`, and normalize then moves every heard excerpt to the vibe's target. A range on either
would ask the model to change a level the owner never hears. A range naming one is refused with
that reason. The loudness range is a difference of levels, so it stays. Integrated loudness and
normalize's gain have no range for the same reason 0033 left them out of `FEATURE_NAMES`: the
heard loudness is the target by construction.

**Validation** (`validateTargets` in `src/domain/validate-targets.js`) returns `{ok, softTargets,
ranges}`, `ranges` being `features` or `{}`, or every error with its path, as
`validateConstraints` does: `$.features.<name>` for an unknown feature, a raw level, a value that
isn't a pair, both ends open, or low above high, and `$.features.<name>[i]` for an end that isn't
a number or null or is outside its bounds. `POST /api/vibes` and `POST /api/vibes/:id/revisions`
refuse bad soft targets with a 400 `the soft targets are invalid: <path>: <message>`, so the
error names the feature. `generateCandidates` validates the revision it reads, as it does the
constraints, and throws naming the revision when its stored ranges don't validate.

**In every first prompt.** `targetsText(ranges)` writes a header line and one line a range, in
the table's order: `spectral centroid at most 400 Hz`, `onset rate from 0.1 to 0.5 a second`,
`low-end share at least 0.3`, each end as the owner wrote it and the unit from 3a's entry.
`buildPrompt` puts it after `constraintsText`, and leaves it out when there are no ranges
(`targetsText` returns `""`). The header says the ranges are measured on each excerpt after it is
normalized, and that a genome outside one is kept: the first try already knows the ranges, so
3d's revision adds only the measurements and 3h's control arm restates the same text. A range on
every feature in the table, with 0024's seed-sized vibe and six examples, stays under half the
budget (0024's test).

**Checking** (`checkTargets(features, ranges)` in `src/domain/check-targets.js`) returns 0020's
`LintResult`, one finding per miss in the table's order, with path `features.<name>`, rule
`target`, and a message naming the value and the range: `spectral centroid is 1244 Hz; the vibe
asks for a value at most 900 Hz`. A value is compared after rounding to its entry's digits, the
rounding `featuresText` writes, so a miss is always one the model can read in the prompt: 0.3149
is 0.31, which a range ending at 0.31 holds. A value that couldn't be measured is a miss, and
when normalize couldn't run, every heard feature is one: a range describes what the owner
hears, and a render too quiet to hear meets none of them.

**The brief page.** The soft-targets JSON field is replaced by a ranges form built from the
table by `src/web/target-fields.js`, DOM-free like the rules form: two number inputs a feature
(lowest and highest), an empty end open, both empty no range. The page shows `targetsText`'s
line as "What the model is told", lists any other saved keys read-only, and keeps them when it
saves. Each earlier version lists its ranges under its rules. A saved revision whose ranges don't
validate (one saved before this step with a hand-written `features`) leaves the form empty and
says so; saving replaces them.

**Seed ranges, calibrated.** Before writing each seed vibe's ranges, its spread was measured on
genomes that pass its linter, rendered as excerpts through `renderExcerpt` in a temp data root:
the golden 2l adapted to the vibe (`test/support/seed-genomes.js`) at seed 1, and lint-passing
`randomGenome` draws. A raw draw never passes a seed's linter, since the vibe fixes the loudness
to −16 LUFS and a draw's is continuous, so each draw first took the vibe's fixed values (tuning,
scale, key, pulse, loudness), lost the voices of types the vibe doesn't allow, and was then
validated and linted; 1 in 16 passed for cold dorian, 1 in 15 for bell field and 1 in 28 for
tidal noise. Each vibe's run was capped at five minutes under `nice -n 10` (agent rule 9) and
rendered what fit, at seed 1000 + the draw's seed: 154 of 200
draws for cold dorian and 188 for bell field before the cap, all 200 for tidal noise.

Spread over the draws whose excerpt normalized, as 10th / 50th / 90th percentiles (nearest
rank); the loudness range is raw, so it counts every draw with one measurable (150 for tidal
noise). Flatness read 0.000 at all three for cold dorian and bell field, which allow no noise
voice.

| Feature | Cold dorian (138) | Bell field (159) | Tidal noise (115) |
|---|---|---|---|
| loudness range, LU | 1.5 / 5.0 / 10.8 | 1.0 / 5.2 / 13.4 | 1.0 / 3.7 / 8.4 |
| spectral centroid, Hz | 82 / 130 / 420 | 212 / 326 / 503 | 94 / 162 / 3611 |
| centroid spread, Hz | 9 / 20 / 42 | 13 / 38 / 75 | 14 / 27 / 355 |
| onset rate, a second | 0 / 0 / 0.88 | 0 / 0 / 0.08 | 0 / 0 / 0.52 |
| low-end share | 0.01 / 0.88 / 0.99 | 0.00 / 0.25 / 0.87 | 0.13 / 0.87 / 0.99 |
| stereo width | 0.01 / 0.03 / 0.09 | 0.01 / 0.03 / 0.09 | 0.01 / 0.05 / 0.18 |
| flatness | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0.27 |

Near-silent draws, whose excerpt normalize couldn't take and so miss every heard range: 16 of
154 for cold dorian, 29 of 188 for bell field, and 85 of 200 for tidal noise, whose draws often
hold only quiet noise and cloud voices.

The ranges, each read from the brief and set where the spread puts about half the draws
outside at least one:

| Seed | Ranges | Why, from the brief | Draws missing one | Of those heard |
|---|---|---|---|---|
| `cold-dorian` | centroid at most 400 Hz; onset rate at most 0.2 a second; low-end share at least 0.3 | "keep the high end down", "a dim, cold room"; slow, chords 40 s or more apart; "a low drone holds the root" | 77 of 154 (0.50) | 61 of 138 (0.44) |
| `bell-field` | centroid at least 250 Hz; onset rate at most 0.1 a second; low-end share at most 0.6; stereo width at least 0.02 | the bells, not the bed, carry it; "a few bell notes a minute at most"; the pad or drone underneath "may" be there; bells "scattered" across the field, so not mono | 99 of 188 (0.53) | 70 of 159 (0.44) |
| `tidal-noise` | loudness range at least 2 LU; centroid at most 1500 Hz; onset rate at most 0.1 a second; low-end share at least 0.5 | "swells and recedes like a tide"; "filtered dark, with the highs rolled off"; "calm enough to sleep to"; "warm" | 146 of 200 (0.73) | 61 of 115 (0.53) |

Tidal noise is set to about half of its heard draws rather than of all of them: 85 of its 200
draws are near silent and miss whatever the ranges say, a share that comes from random voice levels rather
than from what a model writes to a brief; 3h's run shows the model's own share. No seed has a flatness range. Tidal noise is "a bed of
noise", but 90% of its lint-passing draws read under 0.28 and three quarters under 0.01, so
any floor that says "noise" misses nearly every draw. The golden genomes pass their vibe's
ranges, except tidal noise's: the noise-bed golden measures a 6710 Hz centroid, bright for a
brief that asks for dark.

**The ranges are fixed here.** 3h's builder may not change them, and neither may a later step
tuning them to its evaluation: a range set after seeing how revisions do against it would bias
the test toward the arm it was tuned on. The calibration reads first tries' spread only, so it
sets how often a first try misses and says nothing about whether a revision fixes one. The owner
may still edit a vibe's ranges on the brief page; 3h's report names the ranges each run used.

## Alternatives considered

- **`{min, max}` objects, as 0020's ranges** — rejected: the plan writes a range as
  `[low, high]`, and an open end is a `null` in place; with `{min, max}` an open end would be a
  missing key, which 0020's validator reports as an error.
- **Ranges on the two raw levels** — rejected, as above. A level-free form of the loudest 3 s
  (the loudest 3 s less the integrated loudness) would say how much the level swells, but it is
  a new feature for `FEATURE_NAMES`, not a range on an old one.
- **Comparing the unrounded value** — rejected: 0.304 against a range ending at 0.30 would be a
  miss the prompt shows as 0.30, inside it, and the revision would be asked to fix nothing it
  can see.
- **An unmeasurable value as no miss** — rejected, following the plan: a near-silent render
  would then pass every heard range.
- **Refusing other keys of `softTargets`** — rejected: revisions are irreplaceable, an owner may
  have saved something in the old JSON field, and phase 5's CLAP directions go there.
- **Calibrating on raw `randomGenome` draws** — rejected: none of 5,000 draws passed any seed's
  linter.
- **Leaving the ranges out of the first prompt and giving them only to the revision** — rejected:
  the revision would then add two things at once, the ranges and the measurements, and 3h could
  not tell which helped.

## Consequences

- 3d calls `checkTargets` on each rendered first try and quotes `targetsText` and the findings'
  messages in the revision ask; 3g's card readout reads the same table.
- A new feature in `FEATURE_NAMES` fails `tsc` until `RANGE_BOUNDS` decides it.
- The seed vibes' files changed, so each is a new seed to 0030's check: the vibes the owner loaded
  before keep `{}` and stay as they are, and the seeds list shows each seed as not loaded until
  the owner loads it again or edits a loaded vibe's ranges by hand.
- The calibration draws are lint-passing random genomes, not model answers. How often the model's
  first tries miss shows only in 3h's run; if it is far from half, the minimum of 20 revised first
  tries needs a larger count, not new ranges.

## Amendments

- 2026-11-07: from step 5b ([0051](0051-region-analysis-and-ranges.md)). On a saved brief, "Set
  ranges from a region" fills the ranges form from a reference region's measured windows: the
  10th to 90th percentile of each feature in the table, widened to `MIN_RANGE_WIDTH` and kept
  inside the bounds here, never the two raw levels. Beside each filled range the page says what
  is saved now. Nothing is saved until the owner presses Save, which makes a new revision as any
  edit does. The seed ranges stay fixed, as above.
- 2026-11-07: from step 5c ([0052](0052-references-in-the-prompt.md)). The owner settled that a
  brief's attached regions, and 5g's directions and 5h's axes, live in `vibe_attachments`, an
  append-only table keyed by vibe, not in `softTargets`, so attaching or detaching makes no new
  revision. `softTargets` keeps the ranges and any other key the owner saved; nothing in phase 5
  writes a new key there. Attached regions are written in the first prompt right after the
  ranges, with their medians in the range table's features, and say they were measured the same
  way.
- 2026-11-07: from step 5g ([0056](0056-directions-sliders-reference-target.md)). Phase 5's CLAP
  directions, which this record expected beside the ranges in `softTargets`, are
  `vibe_attachments` rows of kind `direction` instead, as the owner settled for 5c. No direction
  is ever written to `softTargets`, and adding or removing one makes no revision. The ranges stay
  the only key the studio writes there.
