# 0018. The default loudness target is −16 LUFS

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

Phase 1's plan set the example genome and the owner's listening check at −20 LUFS. Step 1r
measured the kind of music the generator aims at: integrated loudness from −18.5 to −11.9 LUFS,
median −14.7, with true peaks about −1 dBTP. At −20 LUFS an export plays about 5 LU quieter than
that music, so a side-by-side check would judge loudness rather than sound.

## Decision

The genome's loudness-target descriptor ranges from −30 to −10 LUFS with a default of −16, and
`example.json` and `colundi.json` use the default. The ceiling stays −1.0 dBTP. The phase 1
acceptance (±0.5 LU of the genome's target) is unchanged; only the number moves.

## Alternatives considered

- **Keep −20 LUFS** — rejected for now because the owner check compares against music that sits
  near −15. To overrule: set the descriptor's default and the two example genomes back to −20; no
  other code reads the number.
- **−14 LUFS, the streaming norm** — rejected because quieter material in the measured set sits
  near −18, and −16 leaves the limiter less to do on bass-heavy drones.

## Consequences

- The limiter works harder than at −20 on dense genomes; 1h's tests cover −30 to −10.
- Phase 2 vibes carry their own target, so this is only the default when no vibe sets one.

## Amendments

- 2026-11-06: by the owner's decision, from step 2b. The range tops out at −10 LUFS, not −9:
  normalize can't bring the drone golden to −9 (it stops at −9.82 after 8 passes, while −10
  reaches −10.13), so a valid genome could fail to export, and the loudest reference track 1r
  measured sits at −11.9. No golden or example genome uses −9, so no render changes and the
  engine version stays 2. `randomGenome` draws a different loudness for a given seed, since the
  range it decodes into is narrower; no test pins a drawn value, only that the same seed draws
  the same genome.
