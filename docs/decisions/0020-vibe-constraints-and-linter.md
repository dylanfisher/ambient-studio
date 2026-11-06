# 0020. Vibe constraints are a table of kinds, and the linter reports without rewriting

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

A vibe holds hard constraints the linter enforces (spec, "Core concepts"): key or mode, tuning,
pulse, duration range, loudness target, voice types allowed or banned, density ceilings,
brightness range and a cost budget. The generation prompt states them, the repair round quotes
the linter's findings back to the model, the vibe page (2j) edits them, and the evaluation (2l)
counts a genome valid only when the schema and the linter both pass. The spec also asks for
floors every genome must clear, whatever its vibe: no near-silence and no lone static drone.
Excerpts are drawn between the fades ([0007](0007-trajectories-time-base-excerpts.md)), and
`excerptOffset` throws when they don't fit.

## Decision

**One table.** `CONSTRAINT_KINDS` in `src/domain/constraint-schema.js` has one entry per kind, in
the descriptor style of [0005](0005-genome-schema-table.md). Each entry has a form, the
descriptor its value is checked against (taken from the genome's own tables, with trajectories
refused), an optional check against the set's other kinds, its prompt line, and its lint rule.
`validateConstraints`, `constraintsText` and `lintGenome` all read it. Every kind is optional: a
kind the vibe leaves out constrains nothing, and an empty set is valid. The stored JSON uses the
kinds' names as camelCase keys; unknown keys are errors.

| Kind | Form | Value | Checks on the genome | Path of a finding |
|---|---|---|---|---|
| `tuning` | fixed | a tuning id | `tuning` equals it | `$.tuning` |
| `scale` | fixed | a scale; one of the fixed tuning's, when `tuning` is set | `scale` equals it | `$.scale` |
| `key` | fixed | a root degree; refused with an absolute fixed tuning | `key` equals it; a genome with no key fails | `$.key` |
| `pulse` | fixed | `none` or `beat` | `pulse` equals it | `$.pulse` |
| `bpm` | range | in `bpm`'s range; refused with `pulse: "none"` | `bpm` inside it, when the genome has a beat | `$.bpm` |
| `duration` | range | in `duration`'s range | `duration` inside it | `$.duration` |
| `loudness` | fixed | −30 to −10 LUFS | `loudness` equals it | `$.loudness` |
| `allowedVoices` | voices | registered voice types, at least one | every voice's type is listed | `$.voices[i].type` |
| `bannedVoices` | voices | registered types, none also allowed | no voice's type is listed | `$.voices[i].type` |
| `bellNotes` | ceiling | in the bell's `density` range, notes a minute | each bell's highest effective `density` | `$.voices[i].density` |
| `grains` | ceiling | in the cloud's `density` range, grains a second | each cloud's highest effective `density` | `$.voices[i].density` |
| `padChords` | ceiling | 1 to 3 chords a minute | each pad's `60 / hold` | `$.voices[i].hold` |
| `brightness` | range | 0 to 1 | `macros.brightness` from 0 s to `duration` | `$.macros.brightness` |
| `cost` | ceiling | 0 to `COST_BUDGET` (560) | `cost(genome)` | `$` |

**Fixed values and ranges in the prompt.** Tuning, scale, key, pulse and loudness are stated as
`name = value`; bpm, duration and brightness as `from min to max`; the three densities and the
cost as `at most`. The pad's ceiling is stated as the `hold` it implies (`pad hold at least 40 s
(at most 1.5 chords a minute)`), since `hold` is what the model writes. A set with every kind
takes 539 characters; a test holds it under 800.

**Report, never rewrite.** The linter returns findings and leaves the genome as it is. A value
the vibe fixes, like the loudness target, is checked, not written into the genome: the model sees
the finding and repairs it, so the evaluation measures what the model wrote, and a stored genome
is never different from the one generated without a record of why.

**Effective values.** Density ceilings use `highestValue`, the same bound the cost uses
([0010](0010-event-windows-control-grid-memory.md)): the voice's highest point with each macro
row's macro at its extreme. It can overstate what plays (points past `duration`, a macro peak
that never meets the parameter's peak), so a genome near a ceiling may fail when its render
wouldn't reach it; the bound is kept because it is the one the engine already trusts.
Brightness is read exactly: no macro offsets another, so its effective value is its raw value,
and its extremes over the timeline are at 0 s, `duration` and the points between (every curve is
monotonic).

**Floors**, applied to every genome:

- `nearSilent` (at `$.voices`): every voice's level stays at or under −50 dB while it plays,
  from `start` to `end` or `duration`, whichever comes first. A voice that starts at or after
  `duration` plays nothing, and a genome with no voices fails. −50 dB is 10 dB above the level
  descriptor's floor and 14 dB under the bottom of its safe range. A drone, pad, bell and cloud
  all at −50 dB measured −54.2 LUFS (60 s, seed 1, on mbp2021), so reaching −16 takes 38 dB of
  the 40 dB normalize allows ([0011](0011-normalize-true-peak-limiter.md)); one voice at that
  level, about 6 dB quieter by estimate, would not reach it. No macro row moves `level` today, so the raw level is the one that plays. 2e's near-silence
  check measures the render; this floor catches the genome before it is rendered.
- `loneStaticDrone` (at `$.voices[0]`): the genome's only voice is a drone, nothing in the genome
  (globals, macros or the voice) is a trajectory, and the drone's highest effective `sweep` is 0.
  The motion macro raises the sweep, so a lone drone with `sweep` 0 and `motion` above 0.5 passes.
- `excerptLength` (at `$.duration`): `duration − fadeIn − fadeOut` is at least
  `EXCERPT_SECONDS`. The test is `excerptRoom` in `src/engine/excerpt-offset.js`, the same
  subtraction `excerptOffset` throws on (2026-11-06; a different order of subtraction passed
  lint and threw on 122.8 s with fades of 8.1 s and 89.7 s).

**`EXCERPT_SECONDS` is 25**, in `src/domain/excerpt-seconds.js`. 0007 sized the worst pre-roll
(about 68 s) against a 25 s excerpt, and 25 s holds a 20 s pad attack or a full bell decay with
room left, while keeping an A/B pair under a minute of listening. 20 s would cut most pad chords
mid-swell; 30 s adds a fifth to every render and every rating.

**The result type** is `LintResult` in `src/domain/lint-result.js`: `{ok, findings}`, each finding
`{path, rule, message}`. The rule is the constraint kind or the floor's name; 2e's render checks
return the same type with their own rule names.

**Cross-kind checks** run only on kinds that passed their own checks: a scale against a fixed
tuning, a key against a fixed tuning's degrees (or its absence), a tempo range against a fixed
`pulse: "none"`, and a type both allowed and banned. A tempo range with no fixed pulse is
allowed: it constrains genomes that have a beat and passes those that don't. An empty voice list
is refused: an empty allowed list would reject every genome, and an empty banned list says
nothing. The cost kind is a vibe's own, lower ceiling; the engine's `COST_BUDGET` on every genome
is checked by 2e's render checks, not repeated here.

## Alternatives considered

- **Writing fixed values into the genome before rendering** — rejected because the evaluation
  would then count genomes as valid that the model got wrong, and the repair round would never
  teach the model the constraint.
- **Ranges for every kind, fixed values as `min = max`** — rejected because tuning, scale and
  pulse are names, and a range of one value is longer in the prompt than `= value`.
- **Sampling effective densities on the control grid** — rejected for now because the cost
  already trusts `highestValue`, and two readings of one ceiling would disagree near it.
- **A ceiling on the pad's `hold` in seconds** — rejected because the spec names a chord rate,
  and the rate stays the right number if the pad later gains a rate parameter; the prompt states
  the hold.
- **Floors as kinds a vibe may turn off** — rejected because the spec makes them hold for every
  vibe.

## Consequences

- A new kind is one table entry plus a row in the lint test's table, which fails until every kind
  has a passing and a failing fixture (phase 2's acceptance check 2).
- A new voice type with a density parameter gets no ceiling until a kind is added for it.
- The table reads voice descriptors from the voice modules, so a change to a density range
  changes what a ceiling may be; a stored vibe whose ceiling falls outside a narrowed range then
  fails validation and needs a migration.
- Constraints are irreplaceable data (AGENTS.md): a shape change to this table ships with a
  migration of stored vibes.
