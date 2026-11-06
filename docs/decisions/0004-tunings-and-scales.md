# 0004. Tunings are data modules of two kinds, with Scala import and scales as subsets

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

The spec asks for tunings as data files: relative ones (any equal division, just intonation,
custom cents, any period, octave or not) and absolute ones, a fixed set of frequencies with no
root, such as the Colundi sequence. Scala `.scl` files should load directly, since most published
tunings come in that format. Voices need notes and partials from the same set (step 1j), and the
genome schema (step 1c) validates a genome's tuning, scale and key against what exists.

The engine runs unchanged in Node and in the browser, including Safari on macOS 12, with no
build step and only relative imports ([0001](0001-stack.md)). It can't list a folder or read a
file, and JSON import attributes aren't supported in that Safari.

## Decision

**Two kinds.** A **relative** tuning has a period (a ratio above 1: 2/1, 3/1, anything) and
degrees as ratios above degree 0, rising and below the period. It has a **reference**, the
frequency of one degree in one octave (`{ degree, octave, hz }`), which fixes every other
frequency. An **absolute** tuning is a rising list of frequencies in Hz with no period, no root
and no reference.

**Files.** Each tuning is one module in `src/engine/tunings/<id>.js` whose default export is a
plain object, written as JSON would be. The file name is the id.

- Relative: `name`, `period`, then one of `steps` (equal divisions of the period), `degrees`
  (the degrees above 0, without the period) or `scala`; plus `reference` and `scales`.
- Absolute: `name`, then `frequencies` or `scala` with `baseHz`; plus `scales`.
- A pitch value in `period` or `degrees` is cents when it's a number and a ratio when it's a
  string (`"3/2"`, or `"2"` for 2/1).
- The kind isn't written: a file with `frequencies` or `baseHz` is absolute, any other is
  relative. The two kinds share no defining field (an absolute tuning can't have a period,
  degrees or reference, and a relative one can't have frequencies or a base), so the fields
  decide the kind on their own. A `kind` field would only be a second statement of it, one that
  could disagree with the fields and would need its own check.
- Unknown keys throw. So does a missing field: every field is required, including an empty
  `scales: {}`.

**How the engine reads them.** `src/engine/tuning-registry.js` imports each file, one line per
tuning, and validates every one through `loadTuning(id, file)` in `src/engine/tuning.js` when it
is first imported, so a bad file fails at startup. A test lists `src/engine/tunings/` with `fs`
and fails when the folder and the registry disagree. 1c and later steps use `getTuning(id)` and
`tuningIds()`; a tuning carries its `kind`, and `isAbsolute(tuning)` narrows the type. Its
scale names are `Object.keys(tuning.scales)`, and for a relative tuning the valid keys are
`0 … degrees.length − 1`.

**Scala import.** A file's `scala` field holds the `.scl` text, read as the format says: `!`
lines are comments, the first other line is the description, the next is the count, then one
pitch per line, cents if it has a period and a ratio otherwise, with text after the value
ignored. Blank lines among the pitch lines are skipped. A count that doesn't match, a negative
or zero ratio, or a line that isn't a pitch throws with its line number. For a relative tuning
the last pitch is the period, as in Scala. For an absolute tuning, `baseHz` is degree 0, which
the file doesn't write, so a file of N lines gives N + 1 frequencies. Trying a published tuning
means pasting its text into a new module with a name, a reference or base, and scales.

**Scales** are named subsets of a tuning's degrees. In a relative tuning they're degree indices
from 0, rising, below the degree count; 0 is the key. Modes are named scales. The seven diatonic
modes and two pentatonics are written once in `src/engine/modes.js`, as degrees of a 12-degree
chromatic layout, and 12-TET and the 12-note just table both spread them into their scales. In an absolute tuning they're written in Hz, for
reading, and each value must be one of the tuning's frequencies exactly; they're stored as
indices. Every tuning also has an `all` scale of every degree, which a file can't redefine.

**Key.** A relative pitch has a key, a degree index of the tuning that scale degree 0 lands on.
It's an integer, not a note name, because only 12-TET has the usual names. An absolute pitch has
no key, and passing one throws.

**Frequency.** `resolvePitch(tuning, scaleName, key)` gives a pitch. `frequency(pitch, degree,
octave)`:

- Relative: the scale degree wraps past either end into the next or previous octave (period),
  the key is added, and steps past the period carry into the next octave too, so A minor's third
  degree in octave 4 is C5. The result is `reference.hz × degrees[d] / degrees[reference.degree]
  × period^(octave − reference.octave)`, so a ratio in the file is exact relative to degree 0 in
  the same octave: a just fifth is exactly 3/2 times its root.
- Absolute: the degree indexes the scale; an octave argument or a degree outside the scale
  throws.

`tuningFrequencies(pitch, loHz, hiHz)` lists every frequency of the scale inside the band,
inclusive and rising. With an absolute tuning, voices pick notes only through it, over a
register band in Hz: drone 33–135, pad 100–500, bell/pluck 150–1100.

**Reference pitch.** It lives in each relative tuning's file. 12-TET puts A4 at 440 Hz (degree 0
is C). 19-EDO and the 5-limit just table put degree 0 at 12-TET's C4, 261.6255653005986 Hz, so
their tonic matches 12-TET's C. Bohlen-Pierce (13 equal steps over 3/1) puts degree 0 of period
0 at 12-TET's C3; its "octave" counts periods of 3/1. The just table's ratios are fixed to degree
0, so another key moves the same table rather than retuning it.

**What ships.** `12-tet`, `19-edo`, `bohlen-pierce`, `just-5-limit`, and `colundi`: the Colundi
sequence's 128 frequencies from 10.8 Hz to 12 kHz as the exact decimal values, not recomputed
from cents, with the scales `subset38`, `core36` and `core18`.

**Detune.** `centsToRatio(cents)` in `src/engine/tuning.js` is the one cents-to-ratio helper; a
voice's `detune` (1c) multiplies a frequency by it.

## Alternatives considered

- **`.json` and `.scl` files read at runtime** (the server with `fs`, the browser with `fetch`) —
  rejected because the engine would need an injected registry before it could validate or
  render anything, and every caller from the validator to the renderer would carry it.
- **JSON import attributes** (`with { type: "json" }`) — rejected because Safari on macOS 12
  doesn't support them.
- **A generated index of the folder** — rejected because there's no build step.
- **Raw `.scl` files in the folder** — rejected for the same reasons as runtime JSON; a `.scl`
  also lacks the reference, base frequency and scales the engine needs.
- **Storing every degree as cents** — rejected because a ratio from cents isn't exact, and the
  Colundi values are exact decimals.
- **Absolute scales as indices in the file** — rejected because a list of Hz can be checked
  against the source by eye, and the loader rejects a value that isn't a member.
- **A key as a note name** — rejected because names exist only for 12-TET; a UI can name 12-TET
  degrees for display.
- **A genome-wide reference pitch** — rejected for now; no step asks to retune A4, and a tuning
  file can be copied with another reference.

## Consequences

- Adding a tuning is a new file in `src/engine/tunings/` and one import line in the registry.
  The registry test fails if the line is missed.
- A tuning file is JS, so a stray expression in one would run; the loader still validates the
  value it exports. Files hold data only.
- Changing a tuning file's values, a reference or the frequency formula changes renders and
  bumps the engine version ([0009](0009-engine-version-golden-hashes.md)). Adding a tuning or a
  scale doesn't.
- Validation throws on the first problem in a file, because files are written by hand and fixed
  one at a time; genomes, which 1c validates, list every error instead.
