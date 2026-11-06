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
- The expected hashes live in a committed JSON file keyed by engine version, each entry also
  naming the platform (`darwin-arm64`) and the node-web-audio-api version
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

- Any change to a voice, the master bus, the macro mapping or the PRNG shows up as a failing hash.
  Refactors that keep the samples identical pass untouched.
- An old engine's code isn't kept in the tree. Re-rendering a sketch made with an older version
  means checking out the commit that bumped past it; the UI warns instead (phase 2 onward).
