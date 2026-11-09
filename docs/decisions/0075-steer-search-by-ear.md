# 0075. Steering a search by ear: a variation and a shift, changed between pairs

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm the four variations and the default.
  Amends [0055](0055-search-by-ear.md) (the draws' reach, a drift, and a spec rewritten mid-run).

## Context

The owner, after hearing runs of 0055's search by ear: "they were all sounding the same". 0055
drew every new point within the medium nudge's step (0.12) of the best, over the free macros,
and said the step would grow if pairs sounded too alike. The owner also asked to describe
shifts in words, and for the controls to be on the search-by-ear page itself.

## Decision

The Quick A/B page in search-by-ear mode has a **Steer the search** panel: a variation, and a
slider from less to more for each path the search moves. **Use from the next pair** sends both
to `POST /api/sessions/:id/ear-search/steering {variation, shift}`; the pair on screen stays.

- **Variation** (`EAR_VARIATION`): Subtle 0.05, Medium 0.12, Wide 0.25 (the three nudge
  steps) and Very wide 0.4. A run starts **Wide**, since Medium sounded too alike.
- **Shift**: each path from -1 to 1, 0 where unnamed. The draws' ball moves from the best by
  `reach × shift` in each dimension, so every new point leans that way while the owner keeps
  choosing ones that do.
- **The GP is unchanged.** Preferential BO's spec settings gain `reach` and `drift`; `sigma`
  still sets the length scale alone, so a change of variation doesn't change what earlier
  choices mean. The server rewrites the run's spec, by a rename, before the next draw; the
  sidecar reads the spec at every call. A copy made to render ahead keeps the spec it was
  copied with, so the first pair after a change is drawn and rendered after the answer.
- **Words for a shift.** A line of the owner's words, such as "darker and more spacious",
  goes to `POST …/ear-search/shift-words`: one model request through the queue (operator
  `shift`, a request group of its own, stored as a generation), holding the brief, each
  searched path with where the best sits on it, and the words. The answer, `{"shift": {path:
  number}}`, is checked as the page's steering is, and only sets the sliders: the owner sees
  what the model understood and sends it with Use from the next pair. An answer that can't be
  read is a 502 with the reason; there is no repair round, since asking again costs the owner
  one click and the sliders are there to set by hand.
- Each stored point's `operatorParams.steering` records the steering it was drawn under.
- On the page, the sliders keep the arrow keys while focused (`OWN_KEYS`), since the page's
  arrows play a side.

## Alternatives considered

- **Changing `sigma` itself** — rejected: it sets the GP's length scale too, and a length
  scale that moved mid-run would reread every earlier choice at another distance.
- **A new `optimizer_ask` parameter for the reach and drift** — rejected: every optimizer's
  ask would carry it, CMA-ES's included, for one optimizer's use.
- **Steering only when a run starts** — rejected: the owner learns what they want by hearing
  pairs, and asked for the controls on the page where they listen.
- **Applying the model's reading at once** — rejected: a misread would steer the next pairs
  before the owner could see it.
- **Reading the words with the sound analysis (CLAP) instead of the model** — rejected: it
  scores rendered audio, so it would need renders of many points to say which way a path
  moves the words, where the model reads the paths' names directly.
- **A fresh seed for each new point** — not taken now: it would make pairs differ more, but
  each comparison would then mix the genome with the seed's events, which the GP can't tell
  apart. Reopen if Very wide still sounds too alike.

## Consequences

- After each change of steering, one pair waits for its render, 1.5 to 3 s.
- A wide variation with a strong shift reaches the cube's edges sooner; clipping keeps points
  inside, and the linter's chain rejects what breaks the brief, as before.
