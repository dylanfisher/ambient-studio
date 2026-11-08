# 0072. The prompt shows genomes without their defaults; a low chant starting point

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm. Amends
  [0005](0005-genome-schema-table.md) (the schema text's limit, now 4,000 characters),
  [0024](0024-prompt-parse-repair-generation.md), [0038](0038-explore.md) and
  [0058](0058-breeding.md) (examples, the base and the parents written without their defaults),
  and [0030](0030-seed-vibes-and-evaluation.md) (a fourth seed vibe).

## Context

Step CV.4 has to fit the chant, cymbal and drum into the generation prompt. After CV.3 the
schema text was 3,923 characters against `schema-text.test.js`'s 3,000 (0071's 3,717 was measured
before CV.2's five chant lines), and the three seed-sized checks in `build-prompt.test.js` were
over: six examples 4,145 tokens and every voice locked 4,356, both of 4,096 (half the 8,192
budget, the room a repair needs), and a base with six examples 4,571 of 4,506. omlx is shared
with a live site, so the budget, the context and the 3.5 characters a token stay as they are.

Where the schema text's characters went, by section: the header 1,411 (the trajectory line 277,
the 12-tet scale line 134), the lines every voice shares 277, chant 551, drone 294, bell 275,
noise 255, pad 254, granular 231, drum 194, cymbal 182. The parameter descriptions are 1,007
characters over 70 lines and the eight `type` lines 414. With every description removed the
text would still be about 2,900 characters, so no edit of the descriptions brings nine voices
under 3,000 and leaves the model what each parameter does.

The rest of the every-voice-locked prompt was 14,500 characters, 6,709 of them the six examples.
`canonicalGenome` writes every default out, and the schema text already gives each default:
`example.json` is 1,105 characters canonical and 548 with its defaults left out, `colundi.json`
1,100 and 561.

## Decision

**Genomes in the prompt leave out their defaults.** `conciseGenome` (in
`src/engine/canonical-genome.js`) is the canonical JSON with every value equal to its
descriptor's default left out, and `macros` with it when every macro is; `schemaVersion`, `id`,
`type` and `voices` stay. It validates back to the same genome. The prompt writes the examples,
an explore's base and breeding's parents with it. Hashing and duplicate checks keep
`canonicalGenome`. Lock values are written as stored, since the model keeps them exactly.

**The schema text.** Tunings are named once, on the lines that give each one's keys and scales
(`tuning =12-tet, one of:`), instead of also on the `tuning` line. The three new voices' lines
say what they are for: the chant is "a chant's low sung drone", the cymbal and the drum "sparse
bright accents" and "sparse low accents". Two chant lines lose "within". The text is 3,900
characters.

**The limit moves to 4,000 characters.** The token checks are what guard the room for examples
and a repair, and they pass at their budgets. The limit stays 100 characters above the text, so
the next voice, at 180–550 characters, has to argue for its room again.

After the change: the schema text 3,900 of 4,000; six examples 3,230 tokens and every voice
locked 3,441, both of 4,096; a base with six examples 3,507 of 4,506, and its revision 4,325 of
5,734. Acceptance 7's prompt (a seed-sized brief allowing only chant, cymbal, drum and noise,
six rated four-voice examples) went from 4,149 to 3,500 tokens.

**The low chant starting point** (`src/domain/vibes/low-chant.json`): allowed voices `chant`,
`noise`, `bell`, `cymbal`, `drum`; `pulse` none; 300–900 s; −16 LUFS; `cymbalHits` 3 and
`drumHits` 3; `brightness` 0.1–0.4. No tuning, scale or key, so the model picks the root. Its
feature ranges, from a 30 s excerpt at 60 s and at 200 s of the test's seed genome (a twelve-
singer chant, a cymbal at 2 a minute, a drum at 3, a brown noise bed): `centroidMean` at most
700 Hz (measured 467), `onsetRate` at most 0.15 a second (0 and 0.03, so the swell isn't counted
as onsets), `stereoWidth` at least 0.15 (0.21 and 0.26). `lowEndShare` is left out: the chant's
fundamental is weak, so its share under 150 Hz is about 0.02, and a floor would push the model
toward the `drone` voice, which the vibe doesn't allow. It sets no `bellNotes`: that kind is the only one `bell-field`
sets alone, and 0030 has each seed set a kind no other does, so the brief keeps the bell rare
instead.

## Alternatives considered

- **Shorter descriptions until the text is under 3,000** — rejected: about 90% of the
  descriptions would go, and the model would read names and ranges with no meaning.
- **List only the voice types the vibe allows** — rejected: a vibe that allows every voice gains
  nothing, and the plan asks for the prompt to fit with every voice listed.
- **Fewer examples a side (`EXAMPLES_PER_SIDE` 2)** — rejected: it drops the owner's ratings,
  the one part of the prompt that carries their taste, to keep text the schema already says.
- **Concise lock values** — rejected for now: a whole-voice lock is rare, and its value is the
  one the model must copy exactly.
## Consequences

- Each example is about half its old length, so more of them fit, and a model that copies their
  form writes shorter answers, with fewer cut off at `max_tokens`.
- A prompt logged for phase 8 from this commit on holds concise genomes; one logged before holds
  canonical ones. Both are verbatim, as 0024 requires.
- A default that changes changes what an omitted key means in a logged prompt, as it changes the
  render; that already bumps the engine version (0009).
