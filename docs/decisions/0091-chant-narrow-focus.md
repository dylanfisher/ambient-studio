# 0091. The chant's `narrow` narrows its upper resonance and keeps its area

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm. Amends [0069](0069-chant-voice.md) (the
  upper resonance's width and peak).

## Context

Step CG.4. Phase CG's acceptance 5: at high `focus` the upper resonance also narrows, to about
40 Hz wide at 1, so the focused partial stands at least 6 dB further over its neighbors than it
does today. Every stored genome must render the same bits and every golden keep its hash, so the
engine version stays 2 (0009), and `focus` keeps its meaning: 0–18 dB of lift on the harmonic
nearest the upper resonance (0069). The schema text had 33 characters left under its 4,100
(0072, amended by 0090), and the develop prompt about 77 tokens under its 4,096.

At a 65 Hz root the lower resonance passes more at the focused partial's neighbors than the
upper one does at its center: at vowel 0.2 the lower one gives a neighbor 0.13 of its peak, the
upper one 0.1 at its own center. So narrowing the upper resonance at the same peak only takes
its share away from the neighbors, and computed from the amplitudes it stands the focused partial
3.1 to 7.0 dB further over them across the vowels, under 6 at most of them.

## Decision

**A new parameter, `narrow`** (0–1, default 0, fixed for the track, "sharper focus"). At narrow
n the upper resonance's width moves geometrically from the vowel's to `NARROW_HZ` 40 Hz,
w = w₀ (40 / w₀)ⁿ, and its peak rises by w₀ / w, so its area, and the power a flat spectrum
passes through it, stays the same. A resonance with less damping rings louder at its center in
the same way. The center, the lower and chest resonances, the focus lift and the source's RMS
rule are unchanged. At narrow 0 the power is exactly 1, so the width and peak are bit for bit
the vowel's, and every genome without narrow renders as before (tested on the five chant
goldens with narrow 0 written out).

From the partials' amplitudes, one singer at a 65 Hz root, focus 12, the focused partial taken as the one
focus lifts most without narrow: at narrow 1 it stands 14.4, 7.5 and 7.6 dB further over its
neighbors than at 0 at vowels 0, 0.2 and 1 (the test measures the render at the same three). Across vowels where the upper resonance lies within
a quarter of the harmonic spacing of a harmonic, at least 9.3 dB. Where it lies halfway between
two harmonics they share it, as they share focus's lift, and neither stands over the other.

**The aspiration noise keeps the vowel's widths.** Its tables are built once a render at five
vowels (0090); narrowing them would need a table set for each narrow value, and the noise sits
10 dB under the voice.

**Not a trajectory,** so its schema line is 31 characters, `narrow 0..1 =0 sharper focus`; the
`(T)` mark would take 4 of the 2 left. Focus, which it sharpens, still moves.

**Cost:** none. It adds a power and a division to each grid sample's amplitudes, ten a second.
Timed on mbp2021 under `nice -n 10`, the voice's JS alone, one mode a process, twelve singers at
65 Hz with growl, rough, flutter, shimmer, aspiration and breathiness at 1, focus 18, phrase 5,
breath 0.6, the vowel moving from 0 to 1 over 60 s, 2 s windows from 20 to 30 s, median of 15:
narrow 0 measured 16.62, 16.60 and 16.56 ms a timeline second in three processes, narrow 1
16.66, 16.67 and 16.56. The same singers beside a 15 s reverb cost 551.2 either way, 8.8 under
`COST_BUDGET`.

**The schema text** is 4,098 characters of 4,100 with the line; no other line changed. Every
prompt check passes, measured before and after: six examples 3,278 and 3,286 tokens; every voice
locked 3,488 and 3,497, both of 4,096; a base with six examples 3,554 and 3,563 of 4,506; two
parents 3,647 and 3,656; a base with two references 5,049 and 5,058; the develop prompt at its
largest 4,019 and 4,028 of 4,096; the bridge's at its largest 4,031 and 4,040 of 4,096, and with
eight long voices a side 3,612 and 3,636; the proposal 3,661 and 3,661 of 3,700; the words
prompt 3,122 and the brief draft 2,776, both unchanged. The words sets' largest prompt for the
worst genome went from 4,092 to 3,969 of 4,096: `fitWordsPrompt` narrows what a set lists until
it fits, and with the longer chant it took one more step.

**The low chant starting point** (`low-chant.json`) sets no parameters, so it already allows
these; its brief now asks for them: a rough growl under the note, each breath heard drawn in, a
scoop into each phrase and a sag at its end. A test holds its genome with every phase CG
parameter at its most, twelve singers breathing, to the vibe's linter and the budget.

**The bench** (`./scripts/bench --chant`) turns growl, rough, flutter, shimmer, aspiration,
breathiness and narrow to 1 on its twelve singers. On mbp2021 with omlx serving (load average
1.33 to 1.16): render median 23.1x, runs 22.8x to 23.2x (52.7, 51.8, 51.9 s), peak RSS 535 MiB.
The track's peak cost it prints, 579.4, is two sections at once in the crossfade, as
`trackCost` counts it; each section's genome costs 289.7.

## Alternatives considered

- **Narrowing at the same peak** — rejected: 3.1 to 7.0 dB across the vowels, under the 6 dB
  acceptance 5 asks at most of them (see Context).
- **Narrowing tied to focus,** the width following focus / 18 — rejected: focus would change
  meaning for stored genomes, and at the default focus 6 the resonance would reach only a third
  of the way to 40 Hz.
- **Focus's range extended past 18 dB,** the narrowing on the part no stored value reaches —
  rejected: one number for two things, and the safe range and macro rows read focus as dB.
- **Moving the center onto the nearest harmonic,** as an overtone singer tunes it — rejected
  for now: the center would jump as the vowel moved past the midpoint, which 0069 rejected for
  the lift.
- **Narrowing the noise tables too** — rejected: a table set for each narrow value, about 12 ms
  and 5 MB each, for noise 10 dB under the voice.

## Consequences

- With narrow near 1 and the vowel moving, the focused overtone swells and fades as the upper
  resonance passes each harmonic, more than with focus alone. The owner's A/B pair says whether
  that reads as a whistle over the vowel.
- `chant-focus.json` is a new golden at v2: three singers breathing, focus and the vowel as
  trajectories, narrow 0.8, brightness 0.35. Every other golden hash is unchanged.
- The schema text has 2 characters left under 4,100. The next parameter needs room found or the
  limit amended with the prompts measured.
- Registering the parameter changes what `randomGenome` returns for existing seeds (0003's
  amendment accepts this).
- Changing `NARROW_HZ`, the geometric move or the peak's rise changes renders of a genome with
  narrow and bumps `ENGINE_VERSION` (0009).
