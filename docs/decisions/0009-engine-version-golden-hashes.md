# 0009. The engine version is an integer, checked by golden-render hashes

- **Date:** 2026-11-05
- **Status:** accepted

## Context

AGENTS.md requires that a change altering the audio an existing genome and seed render bumps the
engine version, and the spec wants old sketches to re-render the same way or warn. A rule like
that is forgotten unless a test catches it.

## Decision

By the owner's choice on 2026-11-05:

- `ENGINE_VERSION` is one integer exported from `src/engine`. Every render and export records it.
- A golden test renders a fixed set of short genomes (2–4 s each, at least one per voice type
  plus the master bus) and hashes each output with SHA-256 after quantizing to interleaved 24-bit
  PCM, the bits an export would hold.
- The expected hashes live in committed files, one per golden genome per engine version
  (`test/fixtures/golden/v<N>/<name>.json`), so two branches that add voices never edit the same
  file. Each also names the platform (`darwin-arm64`) and the node-web-audio-api version
  ([0002](0002-pin-node-web-audio-api.md)). A mismatch for the current version fails the test and
  says to bump the version.
- A script writes the entry for a version that has none and refuses to overwrite an existing
  entry, so the only way past a changed hash is a new version. Old entries stay as history.
- On a platform with no entry the test fails and names the platform; only mbp2021 renders.

## Alternatives considered

- **Compare against stored reference audio with a tolerance** — rejected because a tolerance lets
  small real changes through, and the reference files would bloat the repo.
- **A semver string** — rejected because every reader would have to know that only one part means
  "renders differ".

## Consequences

- Any change to a voice, the master bus, the macro mapping, the PRNG, or the normalizer and
  limiter (which run in `src/domain` but decide the exported samples) shows up as a failing hash.
  Refactors that keep the samples identical pass untouched.
- An old engine's code isn't kept in the tree. Each bump's commit is tagged `engine-v<N>`
  locally, so re-rendering a sketch made with an older version means a worktree at that tag; the
  UI warns instead (phase 2 onward).
- Audio the owner has rated can't be re-rendered by the current engine after a bump, so phase 2
  keeps rated excerpts as files (see the plan's phase 2 Store line).

## Amendments

- 2026-11-05: from the plan review, before any code. One hash file per golden genome per version
  instead of one shared file. The normalizer and limiter are part of what the version covers.
  Each hash file also stores coarse summaries of the render (peak, RMS, energy in 8 bands) that
  the failure message prints and that never pass or fail anything, so a failing hash shows which
  part of the sound moved. Golden genomes for the voices use a trajectory and a non-neutral macro,
  so a change to `effectiveParams` is caught.
- 2026-11-05: from the second plan review. Each hash file also records the Node version, since
  V8 may change `Math.sin`, `Math.exp` and `Math.pow` results between releases and the engine
  uses them to generate impulse responses and noise. Engine bumps are tagged `engine-v<N>`.
- 2026-11-05: from the third plan review. Hash files also record the CPU model, because the
  library's SIMD paths may differ between Apple chips. Only mbp2021's entries count; another
  machine's mismatch says so rather than failing as a changed render.
- 2026-11-06: from the fourth plan review. There are two kinds of golden hash: the raw render
  quantized to 24-bit (step 1g, before the normalizer exists), and the export's PCM after
  normalization and limiting (step 1l, through `exportRender`). Both are keyed by engine
  version, and both must match.
