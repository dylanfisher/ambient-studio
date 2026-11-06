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
