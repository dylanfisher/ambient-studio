# 0005. The genome schema is one descriptor table, validated by code written here

- **Date:** 2026-11-05
- **Status:** accepted; amended by [0029](0029-sample-layer.md) (a `recording` kind)

## Context

Four consumers need to know every genome parameter: the validator, the JSDoc types, the schema
text the LLM reads (phase 2), and the bounds the linter and optimizers search (phases 2 and 5).
The validator also runs in the browser, which can't import packages ([0001](0001-stack.md)).
Genomes are irreplaceable data, so their shape changes only with a migration (AGENTS.md).

## Decision

By the owner's choice on 2026-11-05, the schema is a table of parameter descriptors in
`src/engine`. Each voice module exports the descriptors for its own parameters, and the schema
module assembles them with the global settings and macros. A descriptor holds a kind (`number`,
`int`, `enum`, `bool`), range or allowed values, unit, scale (`linear` or `log`, which the macros
and optimizers move along), default, whether the parameter may be a trajectory, and a one-line
description that goes into the LLM's schema text.

`validateGenome(value)` is written here. It returns either the normalized genome or every error,
each with a JSON path and a message, because the phase 2 repair round feeds the list back to the
LLM. Unknown keys are errors, so an invented parameter is caught rather than ignored. Omitted
parameters take the table's default, and the stored genome is the normalized one with every
default written out, so changing a default later never changes an existing genome's sound.

A genome carries `schemaVersion`, an integer. Changing the shape bumps it and ships a migration
from the previous version.

The JSDoc genome type is derived from the table with a mapped type, so the shape is written once.
If `tsc` can't express that, the builder of step 1c records what it did instead.

## Alternatives considered

- **JSON Schema validated by ajv** — rejected because the browser tiers can't import it without
  vendoring, and ranges in a parameter's own scale, trajectories and macro links would need custom
  keywords anyway.
- **zod or a similar library** — rejected for the same browser reason, and because it is a
  dependency for about 200 lines of code.
- **A hand-written `@typedef` next to a separate validator** — rejected because it is two
  definitions of one shape.

## Consequences

- One edit to a voice's descriptors changes validation, types, the LLM's schema text and the
  optimizer bounds together.
- The schema text for the LLM has to stay short (omlx contexts are short), so descriptions are one
  line each and the text generator is tested for its length.

## Amendments

- 2026-11-05: added from the plan review, before any code.
  - **Voice ids.** Each voice carries an `id`, a short string unique within the genome, not an
    array index. Seed streams, locks and crossover refer to it. The engine connects voices to the
    bus sorted by id, so reordering the list never changes the float summing order or the sound.
  - **Genome hash.** `genomeHash(genome)` is SHA-256 over canonical JSON of the normalized genome
    (sorted keys, numbers in shortest round-trip form). Stores and sidecars use it to tell when two
    sources produced the same genome, so a preference model never sees one genome as two items.
  - **Vector view.** Every descriptor has `encode(value) → [0, 1]` along its scale and the inverse
    `decode`. `toVector(genome, paths)` and `fromVector(genome, paths, vector)` give optimizers and
    preference models a fixed-length view. A trajectory is encoded as its start value, end value
    and curve; trajectories with more breakpoints are searched only through those three numbers.
  - **Adding a parameter.** A new parameter always has a default that reproduces the sound from
    before it existed. Adding one bumps `schemaVersion` with a migration that writes the default
    into stored genomes, so old genomes re-render the same.
- 2026-11-05: from the second plan review. The vector view covers `number` and `int` parameters
  only; `toVector` throws on an `enum` or `bool` path, because an optimizer stepping through an
  ordinal code for an enum produces arbitrary jumps. Enums and bools change only through the LLM
  or mutation operators, and a trajectory's curve is held fixed while its start and end values
  are searched. Every voice has `start`, `end` and a `level` that may be a trajectory, so phase 6
  can fade a voice in or out between two genomes instead of interpolating a voice one of them
  lacks.
- 2026-11-05: from the third plan review. `fromVector` moving a trajectory's start and end maps
  its interior breakpoints affinely from the old span to the new one, so the shape is kept rather
  than collapsing to two points.
- 2026-11-06: from the fourth plan review. The engine exports `canonicalGenome()`, the canonical
  JSON string; `genomeHash()` is SHA-256 of it in `src/server` through `node:crypto`. The browser
  can't hash it: `crypto.subtle` exists only in secure contexts, and the UI is served over plain
  HTTP on the LAN. Records refer to a genome by its row id, never by its hash; the hash only
  finds duplicates. A migration that writes new defaults into stored genomes recomputes their
  hash column in the same migration, and nothing else needs to change.
- 2026-11-06: from step 1c, as built. Each item is provisional: owner to confirm.
  - **Shape.** A genome is flat global keys (`duration`, `tuning`, `scale`, `key`, `pulse`,
    `bpm`, `loudness`, `ceiling`, `width`, `fadeIn`, `fadeOut`, `reverbDecay`, `reverbLevel`,
    `delayTime`, `delayFeedback`, `delayLevel`), plus `schemaVersion` (now 1), a `macros` object
    and a `voices` list. A missing `schemaVersion` is written as the current one; any other
    version is an error, since migrations run before validation. Error paths are JSONPath:
    `$.voices[0].level`.
  - **Voices.** A voice is `{id, type, ...}`. Ids match `^[a-z][a-z0-9-]{0,15}$`, so no voice
    takes the empty id that genome-wide draws use ([0003](0003-counter-based-prng.md)). Every
    voice has `start` and `end` (0–900 s, defaults 0 and 900, `end` after `start`; a voice plays
    to the end of the timeline by default), `level` (−60 to 0 dB, default −12, may be a
    trajectory) and `detune` (0–12 cents, default 3). With an unknown `type`, only these are
    checked, because the voice's own parameters can't be told from unknown keys.
  - **Pitch.** Defaults are 12-tet (`DEFAULT_TUNING` in the tuning registry), `aeolian`, key 9
    (A minor). A scale must be one of the
    chosen tuning's own; the default scale with a tuning that lacks it is an error naming the
    tuning's scales, not a silent switch. A descriptor may carry `when`, a condition on the other
    values of its object: `key` exists only with a relative tuning (an error if given with an
    absolute one, and left out of the stored genome), and is checked against that tuning's
    degree count.
  - **Pulse.** `pulse` is `none` (default) or `beat`; `bpm` (40–140, default 60) exists only
    with `beat`.
  - **Master bus.** Delay time 0.1–2 s on a log scale, default 0.75; feedback 0–0.75 (0.9 until
    step 1d; see below), default
    0.35; level −40 to −6 dB, default −24. `fadeIn + fadeOut` must not exceed `duration`. Among
    the parameters 1c defines, only `reverbLevel`, `delayFeedback`, `delayLevel`, the macros and
    voice `level` may be trajectories; the rest are fixed per genome.
  - **Macros** are named `brightness`, `density`, `motion`, `space` (depth/space), `warmth` and
    `tension`, and share one descriptor (0–1, default 0.5, may be a trajectory).
  - **Trajectories.** `src/engine/trajectory.js` holds a minimal shape,
    `{"points": [[seconds, value], ...]}` with times rising and each value checked against the
    parameter's range. Step 1d replaces the shape, its schema-text line and its check in that
    one file under decision 0007; no stored genome holds a trajectory yet.
  - **Vector view.** `encode` and `decode` are functions in `descriptor.js` that take a
    descriptor, not methods on it, so descriptors stay plain frozen data. `decode` clamps to
    the range and rounds an int.
  - **Fixture voice.** The registry exports `registerVoice` and `unregisterVoice`. Production
    voices are imported and listed in `voice-registry.js`. `test/support/fixture-voice.js`
    exports the voice object only; a test file registers it in `beforeAll` and unregisters it
    in `afterAll`, so `src/engine` never imports test code and the fixture never reaches
    another file's registry, even with Vitest's isolation off. The schema-text length test
    checks that the fixture is absent.
  - **Caps.** A genome holds at most 16 voices, and a trajectory at most 64 points. A cap added
    after genomes are stored would invalidate some of them, so they're set now: 16 is twice the
    five phase 1 voice types with room for layering, and 64 points at the 20 s minimum gap 1d
    draws covers a 900 s timeline with room to spare.
  - **Types.** `tsc` expresses the derived type: `ValuesOf<table>` maps each descriptor to its
    value type (enum values as a literal union, `boolean`, `number`, or `number | Trajectory`),
    and a parameter with `when` becomes optional. `Genome` is built from the global, macro and
    voice tables. Because the registry is open, `Voice` types the common parameters and allows
    any other key; `VoiceOf<typeof drone>` types one voice's own parameters for its module.
  - **Canonical JSON.** `canonicalGenome` validates first, so an input with omitted defaults
    gives the same text as its normalized form, and it throws on an invalid genome. Voices sort
    by id in UTF-16 code-unit order; other arrays keep their order.
  - **Schema text** is one line per parameter, `name~ range unit =default description`, with
    `~` marking a possible trajectory. Scales and the key range are listed per tuning, and
    trajectory times and voice `start` and `end` are named as timeline seconds. The global
    part is 1,519 characters, which leaves about 1,480 for the phase 1 voices, about 290 each
    across five.
- 2026-11-06: from step 1d, as built. Each item is provisional: owner to confirm.
  - **Trajectories** take the shape in [0007](0007-trajectories-time-base-excerpts.md): points
    `[seconds, value]` then `[seconds, value, curve]`, times from 0 to 900 s (`MAX_DURATION`,
    now in `timeline.js`), every curve written out in the stored form.
  - **Vector paths** are dotted strings: `width`, `macros.space`, `voices.<id>.cutoff`, and
    `.start` or `.end` after a trajectory's name. A bare path to a trajectory, `.start` on a
    number, an absent parameter (`key` with an absolute tuning) and an enum or bool path throw,
    naming the path. A one-point trajectory has `.start` only. `vectorPaths(genome)` lists every
    number and int path: globals, then macros, then voices by id, each in table order, so
    reordering voices doesn't change it.
  - **`fromVector`** collects a trajectory's start and end and maps its interior once. When the
    old start and end were equal, the affine map is undefined, so each interior point moves by
    the start's and end's moves blended by its time between the first and last point. A position
    equal to the encoding of the current value leaves the value untouched, so
    `fromVector(g, p, toVector(g, p))` returns `g` exactly. The result is validated, and an
    invalid one (fades longer than the timeline, a voice ending before it starts) throws.
    When start and end are near-equal but not equal, or interior points lie outside
    [start, end], the map scales the interior steeply and clamps it to the range: the result is
    valid, but the shape isn't kept.
  - **Delay feedback** is capped at 0.75, down from 0.9, so an excerpt's pre-roll stays under
    about 68 s ([0007](0007-trajectories-time-base-excerpts.md)). No genome is stored yet.
  - **Safe ranges.** A number or int descriptor may carry `safe: [lo, hi]`, the part of its range
    `randomGenome` draws from: stable, and dark and bass-heavy where the parameter sets tone. For
    now `delayFeedback` is 0–0.6 and voice `level` −36 to −6 dB; 1f, 1j and 1k mark their own.
- 2026-11-06: from step 1j, as built. Each item is provisional: owner to confirm.
  - **Safe ranges** for the pad and bell are in [0013](0013-pad-and-bell-voices.md): pad notes
    3–5, attack 4–20 s, release 8–30 s, tone 8–12 dB, swing 6–12 dB; bell density 0.5–8 a
    minute, decay 2–10 s, partials 4–6, fall 4.5–6 dB.
  - **Schema text** is 2,462 characters with the pad (247) and the bell (268).
  - **Registry loading.** `voice-registry.js` adds its built-in voices on first use, from a
    function that lists them, not from a list built while the module loads. A voice that reads
    `effectiveParams` imports `effective-params.js`, which imports the registry back; when that
    voice's module is the first one loaded, a list built at load time would hold it before it
    exists.
- 2026-11-06: from step 2k ([0029](0029-sample-layer.md)), provisional: owner to confirm. A fifth
  descriptor kind, `recording`, holds the SHA-256 of a field recording in lowercase hex. It has
  no default, so a voice that omits it is an error, and the schema text shows it as `required`.
  `schemaText()` leaves out the voice types with such a parameter, and the prompt adds their
  lines only when the folder holds recordings, so the base text stays 2,931 characters.
- 2026-11-06: from step 2m ([0031](0031-fewer-waits-after-first-evaluation.md)). The schema text no longer uses the
  `name~` notation described under "Schema text" above. The name is written plainly and `(T)`
  follows the default when the parameter may be a trajectory: `cutoff 100..2000 Hz =600 (T)
  low-pass`. The text is 2,982 characters, under the 3,000 this record's test holds.
