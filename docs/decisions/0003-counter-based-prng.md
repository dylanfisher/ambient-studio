# 0003. Seeded randomness is a hash of each draw's key, and triggers use thinning

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

A render must be identical for the same genome and seed (AGENTS.md, [0009](0009-engine-version-golden-hashes.md)).
Beyond that, the optimizers (phase 5) and morphing (phase 6) move parameters a little at a time
and need the sound to move a little too. With one running random stream, every draw depends on
how many draws came before it: adding a voice, or one more event early in a track, shifts every
later value and changes the whole render. The engine also runs unbuilt in the browser, so the
generator has to be plain JS with no package, and give the same bits in V8, JavaScriptCore and
any later Node.

## Decision

`src/engine/prng.js` exports `draw(seed, voiceId, eventIndex, slot)`, a value in [0, 1) that is a
pure function of its key, and `fires(seed, voiceId, eventIndex, density)` for triggers.

- **Hash.** A 32-bit state starts at `0x9e3779b9` and absorbs one 32-bit word at a time as
  `state = lowbias32(state XOR word)`. lowbias32 is Chris Wellons' integer finalizer
  (`x ^= x >>> 16; x *= 0x7feb352d; x ^= x >>> 15; x *= 0x846ca68b; x ^= x >>> 16`, multiplies
  through `Math.imul`), a bijection with low bias. The result divided by 2^32 is the draw, so
  draws have a resolution of 2^-32. Only integer operations are used, so every JS engine agrees.
- **Key layout,** absorbed in this order: the seed; the voice id's length; each UTF-16 code unit
  of the voice id; the event index; the slot. The length goes first so `"a"` and `"a\0"` differ.
  Seed, event index and slot must be integers in [0, 2^32 − 1], and anything else throws.
- **Event index** is a candidate slot on the voice's own time grid, never a count of the events
  that fired. That way an event's other draws (pitch, velocity, pan) stay with that candidate when
  the density changes.
- **Slots.** `TRIGGER_SLOT` (0) is the trigger draw. A voice numbers its per-event draws from 1,
  with named constants in its own module.
- **Thinning.** `fires` is `draw(seed, voiceId, eventIndex, TRIGGER_SLOT) < density`, with the
  density taken at the candidate's time. Raising the density keeps every event that fired and
  adds new ones; lowering it removes events and moves none.
- **Accepted weakness.** A voice's prefix (seed and id) ends in one 32-bit state. If two voices'
  states differ by a small XOR `d`, then `mix(a ^ e) = mix(b ^ (e ^ d))`, so one voice's draws
  are a shifted copy of the other's. The chance is about 2^-22 per voice pair, accepted for
  audio.
- `Math.random` and `Date.now` are banned in `src/engine` by `scripts/arch.js`, planted in
  `scripts/arch-test`.

## Alternatives considered

- **A seeded stream (mulberry32, xorshift) per voice** — rejected because a draw still depends on
  how many came before it in that voice, so one more event shifts every later one.
- **A stream re-seeded per event** — rejected because it's a counter-based hash with extra steps.
- **64-bit state through BigInt** — rejected as slower for no gain the engine needs; 2^-32 is
  finer than any density or parameter the voices set.
- **A cryptographic hash** — rejected because `crypto.subtle` is async and missing on plain HTTP
  ([0005](0005-genome-schema-table.md)), and a voice may draw thousands of times per render.
- **Keying events by the count of fired events** — rejected for the reason under Event index.

## Consequences

- Adding or removing a voice, reordering voices, or changing one voice's parameters never changes
  another voice's draws. Voice ids ([0005](0005-genome-schema-table.md)) are part of the key, so
  renaming a voice changes its draws.
- Draws not tied to a voice (an excerpt offset, a genome-wide choice) need an id no voice can
  take. The empty string is the natural one; step 1c's voice-id rule should forbid it for voices.
- Changing the hash, the initial state or the key layout changes renders and bumps the engine
  version (0009).

## Amendments

- 2026-11-06: from step 1d, provisional: owner to confirm. Draws under voice id "" take their
  slot from `GENOME_SLOT` in `prng.js` (`excerpt` 1, `randomGenome` 2), one list so two uses
  never share a key. `randomGenome` numbers its draws in order, as event indices 0, 1, 2…; it
  isn't a render, so a draw moving when the registry gains a voice type doesn't matter.
- 2026-11-06: from step 1f, provisional: owner to confirm. `GENOME_SLOT.reverb` (3) draws the
  reverb's impulse-response noise, at event index `frame × 2 + channel`
  ([0010](0010-event-windows-control-grid-memory.md)).
- 2026-11-06: from step 1k, provisional: owner to confirm. `drawer(seed, voiceId)` absorbs the
  seed and voice id once and returns `(eventIndex, slot) => draw(seed, voiceId, eventIndex,
  slot)`, the same values about 3 times faster for many draws under one id, as noise at every
  frame ([0014](0014-granular-cloud-noise-bed.md)); `draw` is built on it.
