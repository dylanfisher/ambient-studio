# 0094. Retune: a candidate's child in another tuning, scale or key, with no model request

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the nearest-root key, that a retune makes
  one child, and that the control sits on session cards only. Amends
  [0053](0053-search-space-ask-tell.md) (`proposeWritten` beside `proposeGenome`)

## Context

The owner asked whether an existing brief's candidates can be heard in another scale or tuning.
Nudge, search and steer move only vector paths (0037), and tuning, scale and key are choices
with none, so none of them can. Explore can, through a direction, but it costs a model request
and the model rewrites other values too. Lock-then-nudge works only when some candidate of the
brief already has the wanted value, since a lock takes its value from a candidate (0035), and it
moves the numbers as well. Candidates are irreplaceable (0021), so the old ones can't be changed
in place.

## Decision

**A retune** (`src/domain/retune.js`, operator `retune`, source `mutation`, as a nudge's) makes
one child of a base: the base's genome with `tuning`, `scale` and `key` set to the owner's
choice, `key` left out for an absolute tuning, and nothing else changed. It runs through
`proposeWritten`, the chain `proposeGenome` already ran after decoding its vector (validate,
apply the locks, check for a repeat of the base, lint against the brief), so a retune holds to
the same rules as every other operator. The child keeps the base's render seed, so an A/B of
the two compares the pitch alone. `operatorParams` is the pitch. No engine change: a stored
genome renders as before.

**The route** is `POST /api/sessions/:sessionId/retunes {candidateId, tuning, scale, key?}`.
`tuning` is a known tuning, `scale` one of its scales, and `key` an integer below its degree
count when it is relative and absent when it is absolute: a 400 otherwise, and a 400 when the
base already plays that pitch. The base is checked as a nudge's is. A live lock on `tuning`,
`scale` or `key` is a 409, since applying it would undo the retune; the owner removes the lock
first. The retune is then run once against the brief's current revision, and one the brief
refuses (a fixed scale or key) is a 409 quoting the findings, telling the owner to revise the
brief first, with nothing stored. The job reads the revision and locks again when it starts, and
stores what it gets, rejected only if they changed in between. One job per action, as 0037's:
the same base and pitch while one is unfinished is a 409.

**The control** is a row on each session card: a tuning select, a scale select, a key select
showing each key's root in Hz, and **Retune**, off while the choice is the candidate's own.
Choosing another tuning offers the candidate's scale when the new tuning has one by that name,
else `all`, and the key whose root is nearest the candidate's root in any period (`nearestKey`),
so a retune keeps the music where it was: 12-TET D (key 2) becomes 19-EDO key 3, 189 cents above
C. An absolute tuning's "root" is its scale's first note.

## Alternatives considered

- **Lock-then-nudge only** — rejected: the value has to exist on a candidate first, and the
  nudge moves numbers too, so the child is not the same piece in a new pitch.
- **Explore with a direction** — kept as it is, but not the answer: it costs a model request and
  the model changes other values.
- **Keeping the key's degree number across tunings** — rejected: key 9 is A in 12-TET and about
  F♯ in 19-EDO, so the root would jump.
- **Several children in several scales at once** — rejected for now: one child per press is the
  smallest thing that answers the request, and a second press queues.
- **Storing a refused retune as a rejected candidate**, as a nudge draw is — rejected: a retune
  is one deterministic request, so the refusal goes back to the owner at once.
- **The control on the lineage page and the map too** — left out: those pages don't load each
  candidate's genome, which the control reads to start from the candidate's own pitch.

## Consequences

- Hearing a candidate in another scale costs one excerpt render, a few seconds, and no omlx time.
- A brief that fixes `scale` or `key` refuses every retune away from them until it is revised.
- The noise bed, field recording and cymbal read no pitch (`KEYLESS`, 0081), so a genome of
  only those sounds the same after a retune. The drone keeps its `root` in Hz and plays the
  scale note nearest it, so its fundamental moves only as far as the new scale's nearest note.
- The lineage page labels a retune child "retuned", and the lineage reading names its pitch.
