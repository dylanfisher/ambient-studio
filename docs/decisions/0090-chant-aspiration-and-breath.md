# 0090. Chant aspiration reads seeded noise tables by timeline frame, and breathiness reshapes each breath

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm. Amends
  [0070](0070-chant-singers-and-breath.md) (what a breath does around the schedule, cost),
  [0088](0088-chant-growl.md) (the half-integer harmonics stop at 1.5 kHz, cost) and
  [0072](0072-prompt-room-and-low-chant.md) (the schema text's limit, now 4,100 characters).

## Context

Step CG.3. After phase CV the owner said the chant lacks "the quicker changes that come from
breathing"; it should sound like low human chanting, not an additive organ. Acceptance 3:
`aspiration` (0–1, a trajectory) adds noise shaped by the two vowel resonances, its level pulsing
at f0; at 1, with one singer at a 65 Hz root, the energy between the harmonics in 200–800 Hz
rises at least 10 dB over 0, and the noise envelope's modulation spectrum peaks within 5% of f0.
Acceptance 4: `breathiness` (0–1) shapes each breath of 0070's schedule: an inhale noise in the
gap 20–35 dB under the phrase's level, a scoop into each phrase from 20–80 cents below reaching
the note within 150 ms with a soft onset, and toward each phrase's end a sag of 1–4 dB and
5–20 cents over its last second, with the schedule, and so where breaths fall, unchanged.

Every sample has to be a function of timeline time, so an excerpt equals the same window of a
full render bit for bit (0069), and every stored genome and golden must render the same bits, so
the engine version stays 2 (0009). CG.2 left twelve singers at 65 Hz with growl, rough, flutter
and shimmer at 164.3, 4.7 node-seconds under `COST_BUDGET` beside a 15 s reverb, and the schema
text at 3,997 of its 4,000 characters (0089).

## Decision

**Noise as tables read by timeline frame.** At the start of a render with aspiration or
breathiness, the voice draws 2^17 white samples (2.7 s at 48 kHz) with its drawer at slot
`noise` (2^31 + 28), and passes them, as one period, through each of five vowels' two resonances
(vowel 0, 0.25 … 1): a bilinear band-pass of peak 1 and Q = center / width, run twice, so its
amplitude response is the power response 0069 gives the partials, the upper one 10 dB down. Each
filter first runs over the period's last 8,192 frames, so the table is the period's steady state.
Each table is scaled to an RMS of 1. A stream of noise reads the tables at timeline frame i, from
a seeded offset that changes each period (the draw at event index p, slot `noise + 1 + stream`),
and fades from the last period's reading over the first 512 frames at equal power. A frame blends
the two tables either side of its vowel and divides by the blend's RMS, from the two tables'
measured correlation (0.25, 0.08, 0.10 and −0.01 at seed 1). So each noise sample depends on the
seed, the voice and its frame alone. Building the tables takes about 12 ms a render and 5 MB.

**Aspiration.** At aspiration a the noise takes 0.1 a² of the voice's power and the partials
give it up, so the voice's RMS stays 0.9: at 1 the noise is 10 dB under the voice and the
partials 0.46 dB under where they were. The lead's stream follows the lead's gain, breaths
included, and the swell, and is multiplied by (1 + cos θ) / √1.5, θ the lead's fundamental phase,
so it pulses once a cycle with an RMS of 1; it leaves out the level wander, 0.7 dB RMS at shimmer 1.
Measured on one singer at 65 Hz, 2 s, the noise taken
as the source less the source without aspiration scaled by √0.9: −10.2 dB under the voice, the
voice's level within 0.1 dB of its level without, the energy between the harmonics in 200–800 Hz
74 dB over aspiration 0, and the noise envelope's modulation spectrum peaking at f0 to the
0.05 Hz searched, at roots 50, 65 and 100 Hz (snapped to 49, 65.4 and 98 Hz). At vowel 0 over
80% of the noise lies in 200–800 Hz, at vowel 1 over 80% in 500–1,300 Hz.

**Aspiration in the chorus.** Each chorus singer pulses at its own phase and detuned pitch, so
their pulses sum to a nearly steady level, which falls as 1/√n with n singers. Two streams, one a
channel, carry the chorus's noise without a pulse, each at the level independent noises would
sum to: √Σ (side × gain)² over singers 1 and up, each singer's gain at that frame. That sum is
steady outside breaths and corrected over each breath and its onset alone; the sags before
breaths are left out, as each moves one singer's share of a noise 10 dB under the voice by at most
2.5 dB. So a chorus costs two streams, not one a singer. With six singers the noise measures
10.3 dB under the voice, and the two channels' noises correlate 0.18 (the lead's stream is in
both).

**Aspiration at 0.** Where aspiration is 0 at both ends of a grid step nothing is added, and the
partials' scale is untouched, so a genome without aspiration, or minutes of a trajectory at 0,
render the bits they rendered before.

**Breathiness** shapes each breath of the schedule, read with `breaths`; none of its draws or
times changes, so breaths fall where they did (tested against the schedule at the commit before
this step and with breathiness on and off, twelve singers). With no breaths, `breath` 0, it does
nothing. At breathiness b, each scaling linearly:

- **Sag.** Over a phrase's last second, its level falls along x² to 2.5 b dB and its pitch to
  12 b cents, both held through the fade out. Measured at b = 1: 2.32–2.37 dB over the last
  50 ms, 10.95–11.10 cents from 60 to 20 ms before the breath, 2.94–3.01 cents halfway.
- **Scoop.** The next phrase starts 50 b cents under its note and rises to it along the smooth
  curve over 120 ms from the start of its fade in, 80 ms before the breath ends. Measured on
  harmonic 5: 37–43 cents under at 20–40 ms, 23–26 at 50–70 ms, within 0.01 cent from 150 ms.
- **Soft onset.** The fade in lasts 80 ms + 100 b ms, running past the breath's end, so at the
  breath's end the voice is 6.9–8.2 dB under its level (7.7 by design) where without breathiness
  it is within 0.05 dB.
- **Inhale.** In the breath, the singer's own stream (`inhale + s`) rises and falls along
  16x²(1 − x)², at its middle 26 dB under the singer's level less 20 log b, unpulsed and at the
  vowel of the breath's middle. Measured over each breath's middle 40%, at b = 1, 25.1 to 26.8 dB
  under, and at 0.5, 6 dB lower.

**Pitch through the wander's lag.** The scoop and sag move a singer's pitch through the same lag
the pitch wander uses (0089): their integral in cents from the middle of the breath before, times
ln 2 / 1200, at the 100 points a second, closed form for each shape. The lag goes back to 0 at
each breath's middle, where the singer is silent, so it stays under a phrase's integral (about
10 ms) and the error a bend makes through it stays negligible. A singer with breathiness takes the
wander path, so each singer, lead and chorus, scoops and sags on its own breaths. Gains (sag,
onset) multiply into each singer's gain, frame by frame from timeline time.

**Half-integer harmonics stop at 1.5 kHz** (`HALF_TOP_HZ`), not 3 kHz. At growl 1, those above
1.5 kHz hold 29 to 37 dB less power than those below, across the vowels, and 32 to 40 dB under the
whole voice, and each cost 1.1 node-seconds: 23 of 46 at the 65 Hz default root. This is 0088's
noted saving. It changes the samples of every genome with growl: `chant-growl.json` and
`chant-flutter.json` (growl 0.3), both unpushed and new on this day, get new hashes at v2. Their
summaries moved by 0.04 dB or less below 2 kHz and 0.3 to 1.0 dB in 2–4 kHz.

**Cost,** added to 0069, 0070, 0088 and 0089's: with aspiration rising above 0 anywhere, 6
node-seconds for the lead's stream, and with a chorus 5 for its streams and 0.6 a chorus singer
times its breath share; with breathiness and breaths, each singer 0.4 plus 1.7 times its breath
share. The share bounds the time in breaths and onsets: (1.25 × `breath` + 0.1 b) / (`phrase` / 2
+ 1.25 × `breath`), at most 1. Timed on mbp2021 under `nice -n 10`, the voice's JS alone, one mode
a process, 2 s windows from 20 to 30 s, median of 15, ms a timeline second:

| singers, settings | neither | aspiration 1 | breathiness 1 | both |
|---|---|---|---|---|
| 1, breath 0 | 7.38 | 8.08 | — | — |
| 12, breath 0 | 12.00 | 13.25 | — | — |
| 12, phrase 5, breath 0.6, growl, rough, flutter, shimmer | 14.40 | 15.75 | 15.22 | 16.55 |
| 12, phrase 3, breath 2 | 12.41 | 13.93 | 13.94 | 15.58 |

What each adds, measured in node-seconds (at 0.124 ms each) against what the weights price:

| singers, settings | aspiration 1 | breathiness 1 | both |
|---|---|---|---|
| 1, breath 0 | 5.7 of 6 | — | — |
| 12, breath 0 | 10.1 of 11 | — | — |
| 12, phrase 5, breath 0.6, growl, rough, flutter, shimmer | 10.9 of 12.5 | 6.6 of 10.1 | 17.4 of 22.9 |
| 12, phrase 3, breath 2 | 12.3 of 15.1 | 12.4 of 18.1 | 25.6 of 33.4 |

So the cost bounds them. "Neither" is this commit with neither on, which measures as the commit
before at 1 and 12 singers without growl (6.92 and 12.15 against 6.92 and 12.19 ms in one run);
with growl the cap below makes it faster, 14.40 against 18.42 ms. The tables' 12 ms a render is
not priced, as the phase sum before a late excerpt isn't (0069). Compare speeds only within one
run (0069): one plain singer measured 6.92 ms in one run and 7.38 in another.

Twelve singers at 65 Hz with growl, rough, flutter, shimmer, aspiration and breathiness at 1,
breathing as the bench's do (phrase 5, breath 0.6), cost 160.2, and the genome beside a 15 s
reverb 551.2, 8.8 under the budget; they fit beside up to 15.35 s. Without aspiration and
breathiness the same singers cost 137.3 (164.3 before the cap). At phrase 3 and breath 2 with
everything on, the genome beside a 15 s reverb costs 561.7, over the budget, and `randomGenome`
redraws such genomes.

**Parameters:** `aspiration` 0–1 (default 0, a trajectory, "breath noise") and `breathiness` 0–1
(default 0, "scoop, sag, inhale"), neither with a safe range; no macro moves them.

**The schema text** grows by the two lines, 79 characters; the chant's `tilt` line says "per
octave" for "per harmonic octave" (9), and the text is 4,067 characters. The other chant lines
already say no more than what each parameter does, and taking the remaining 68 from them would
leave names without meaning, which 0072 rejected. So the limit moves to 4,100 (see 0072's
amendment), and the prompt token checks pass.

## Alternatives considered

- **Counter-based noise filtered in blocks from timeline 0**, each block from silence, as
  `colored-noise.js` does — rejected: two resonances, filtered twice, are four biquads a frame
  and a stream plus each block's warm-up, where a table is two reads and a blend; and a vowel
  moving within a block would need the filters crossfaded.
- **Seeded random-phase sinusoids at the resonances** — rejected: noise that sounds like noise
  takes hundreds of them, as costly as the partials, and a few dozen sound like a fixed
  inharmonic chord.
- **One table, looped** — rejected: a 2.7 s loop of noise is heard as a loop; the seeded offset
  each period makes no two periods read alike.
- **Three vowel tables** — rejected: neighboring tables barely correlate, so a blend is two humps;
  five put the lower resonance's humps 70–90 Hz apart, about half its width.
- **A noise stream for each chorus singer, each pulsing at its phase** — rejected: the lead's
  stream measures 0.68 ms, so eleven more would be about 60 node-seconds, and their pulses sum to
  nearly steady noise anyway.
- **The chorus's noise pulsing at the lead's phase** — rejected: it would make the ensemble
  breathe at one pitch.
- **The lag accumulated from timeline 0** — rejected: over 600 phrases it grows to seconds, and
  a bend's rate times the lag would move the pitch by cents.
- **A soft onset that starts the fade in earlier** — rejected: it would eat into the breath's
  silence and move where the voice is heard to breathe.
- **The level sag in dB a frame** — rejected: a power a frame over each sag, where the amplitude
  1 − 0.25 x² is 2.5 dB at its end and within 0.1 dB of 2.5 x² dB along the way.
- **Correcting the chorus's noise for the sags** — rejected: it more than doubles the corrected
  frames for a change of at most 2.5 dB in one singer's share.
- **Another saving instead of the cap** — none was found: 0088 and 0089 measured the other weights
  at about what they price, and the cost had 4.7 node-seconds for about 23.
- **Breathiness acting with `breath` 0** — rejected: it shapes breaths, and with none there is
  nothing to shape.
- **Aspiration and breathiness as one parameter** — rejected: a breathy voice and breathy breaths
  are separate choices, and the plan names both.

## Consequences

- Genomes with growl stored since CG.1 render differently above 1.5 kHz, 29 dB or more under the
  rest of their half-integer harmonics. The owner tested growl chants after CG.1 and said on
  2026-11-09 that changing how they render doesn't matter and that they may be deleted, so the
  engine version stays 2 and both affected goldens are rewritten. Each such chant plays its
  growl a little duller and fails no check.
- An excerpt with aspiration or breathiness spends about 12 ms building its tables, 6 ms a second
  of a 2 s excerpt.
- The schema text has 33 characters left under 4,100. CG.4's lines need room found, or a further
  amendment with the prompts measured.
- Registering the parameters changes what `randomGenome` returns for existing seeds (0003's
  amendment accepts this). Every golden hash but the two above is unchanged, and
  `chant-breath.json` is new at v2: four singers breathing, aspiration a trajectory from 0.3 to
  0.8 to 0.5, breathiness 1, growl 0.2, flutter 0.6, brightness at 0.4.
- Changing the tables, the streams, the noise's share, the pulse, the chorus's level rule, the
  breath shapes or their constants, or `HALF_TOP_HZ` changes renders of a genome that uses them
  and bumps `ENGINE_VERSION` (0009).
