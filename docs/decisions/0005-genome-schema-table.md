# 0005. The genome schema is one descriptor table, validated by code written here

- **Date:** 2026-11-05
- **Status:** accepted

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
