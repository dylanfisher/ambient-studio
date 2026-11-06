# 0006. Macros are bounded offsets on top of raw parameters

- **Date:** 2026-11-05
- **Status:** accepted

## Context

The spec gives the engine six macros (brightness, density, motion, depth/space, warmth, tension)
that the vibe, track automation and optimizers mostly act on, to keep the search space small. The
LLM still writes raw voice parameters, and the owner locks raw parameters and voices (phase 3).

## Decision

By the owner's choice on 2026-11-05, each macro is a number from 0 to 1 stored in the genome, with
0.5 as neutral, and may be a trajectory like any automatable parameter. A mapping table in
`src/engine` lists, for each macro, the raw parameters it moves and a signed depth. The effective
value of a parameter is its raw value shifted along the parameter's own scale (linear or log) by
the sum of `depth × (macro − 0.5) × 2` over the macros that touch it, then clamped to the
parameter's range. At 0.5 for every macro, effective values equal raw values exactly.

## Alternatives considered

- **Macros replace the parameters they cover** — rejected because the LLM loses fine control over
  those parameters and a lock on one means nothing.
- **Macros exist only in the UI and optimizers, and are baked into raw values on save** — rejected
  because macro history is lost, and track automation in phase 6 is defined on macros.

## Consequences

- Optimizers search six numbers plus the raw parameters a step selects, with bounds taken from the
  schema table ([0005](0005-genome-schema-table.md)).
- Whether a locked raw parameter still follows the macros is decided in phase 3. Raw and macro
  values are stored apart, so either answer works without a migration.
- A change to the mapping table changes renders, so it bumps the engine version
  ([0009](0009-engine-version-golden-hashes.md)).

## Amendments

- 2026-11-05: from the third plan review. The optimizer vector holds raw values and macro values,
  never effective values. Where offsets push a parameter against its clamp, the effective value
  stops changing, and optimizers see a flat region there; that is accepted as the cost of
  keeping raw and macro values separate.
- 2026-11-06: from step 1d, as built. Each item is provisional: owner to confirm.
  - **Depth** is in units of the parameter's whole range along its scale: a macro at 1 moves a
    row's parameter by `depth × (max − min)` on a linear scale, or by that share of its octaves
    on a log one. Depths are from −1 to 1 and not 0. A zero total shift returns the raw value
    itself, so neutral macros don't even change the last bit. An int is rounded after the shift.
  - **Rows name only parameters that may be trajectories.** Any macro may be a trajectory, so a
    moved parameter changes over time, and the engine holds the others fixed for a render.
    `reverbDecay` sets the impulse response, so `space` moves `reverbLevel` (depth 0.25) and
    `delayLevel` (0.2) instead of the decay step 1r suggested.
  - **Where rows live.** `src/engine/macro-table.js` holds the global rows and `checkMacroRows`.
    Each voice type lists its rows in `macros` (its own parameters or the common ones, such as
    `level`); `registerVoice` checks them and throws on an unknown macro or parameter, a
    parameter that can't be a trajectory, a bad depth, or a macro and parameter listed twice.
    `effectiveParams(genome, t)` in `effective-params.js` is the one reader of both.
- 2026-11-06: from step 1j, provisional: owner to confirm. `MACRO` in `macro-table.js` maps each
  macro's name to itself, derived from `MACROS`, and voice types name a row's macro through it
  (`MACRO.brightness`), so the name is written once.
