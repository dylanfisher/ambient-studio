# 0072. The prompt shows genomes without their defaults; a low chant starting point

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm. Amends
  [0005](0005-genome-schema-table.md) (the schema text's limit, now 4,000 characters),
  [0024](0024-prompt-parse-repair-generation.md), [0038](0038-explore.md) and
  [0058](0058-breeding.md) (examples, the base and the parents written without their defaults),
  and [0030](0030-seed-vibes-and-evaluation.md) (a fourth seed vibe); amended by
  [0090](0090-chant-aspiration-and-breath.md) (the limit, now 4,100 characters).

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

**The bench's chant case** (`./scripts/bench --chant`): the chant golden with twelve singers,
breathing as the golden does, beside the cymbal's and the drum's golden voices at 4 hits a
minute, on a 900 s timeline. A genome is at most 900 s, so acceptance 6's 20 minutes are a track
of two 605 s sections of it with a 10 s crossfade, mixed by `mixTrack` as the track job mixes.
Three timed runs in one child, with no warm-up, keep it under 5 minutes. On mbp2021 with omlx
serving (load average 1.1–1.4): peak cost 465.5, render median 27.2x, runs 27.2x to 27.4x (44.1,
44.1, 43.8 s), peak RSS 634 MiB.

## Alternatives considered

- **Shorter descriptions until the text is under 3,000** — rejected: about 90% of the
  descriptions would go, and the model would read names and ranges with no meaning.
- **List only the voice types the vibe allows** — rejected: a vibe that allows every voice gains
  nothing, and the plan asks for the prompt to fit with every voice listed.
- **Fewer examples a side (`EXAMPLES_PER_SIDE` 2)** — rejected: it drops the owner's ratings,
  the one part of the prompt that carries their taste, to keep text the schema already says.
- **Concise lock values** — rejected for now: a whole-voice lock is rare, and its value is the
  one the model must copy exactly.
- **A 1,200 s genome for the bench** — rejected: the schema caps `duration` at 900 s, and a
  20-minute piece is a track (0062).

## Consequences

- Each example is about half its old length, so more of them fit, and a model that copies their
  form writes shorter answers, with fewer cut off at `max_tokens`.
- A prompt logged for phase 8 from this commit on holds concise genomes; one logged before holds
  canonical ones. Both are verbatim, as 0024 requires.
- A default that changes changes what an omitted key means in a logged prompt, as it changes the
  render; that already bumps the engine version (0009).

## Amendments

- 2026-11-09: from step CG.3 ([0090](0090-chant-aspiration-and-breath.md)), provisional: owner
  to confirm. The limit moves to 4,100 characters. The chant's `aspiration` and `breathiness`
  lines take 79 characters, the `tilt` line gives back 9, and the text is 4,067; the chant's other
  lines say no more than what each parameter does. Every prompt token check passes, measured
  after the change: six examples 3,278 tokens and every voice locked 3,488, both of 4,096; a base
  with six examples 3,554 of 4,506 and its revision 4,372 of 5,734; two parents 3,647 and 4,464;
  a base with two references 5,049 and 5,867; the first develop prompt at its largest 4,019 of
  4,096; the words prompt 3,122 and the brief draft 2,776 at their largest. The develop prompt
  has the least room left, 77 tokens, so CG.4's lines need measuring against it.
