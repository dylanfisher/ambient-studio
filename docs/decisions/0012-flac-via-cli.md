# 0012. Export writes WAV here and FLAC through the flac CLI

- **Date:** 2026-11-05
- **Status:** accepted

## Context

The spec exports WAV (48 kHz / 24-bit) and FLAC. WAV is a header and interleaved samples. FLAC
needs a real encoder, which Node doesn't have.

## Decision

By the owner's choice on 2026-11-05, `src/server` writes WAV itself: PCM, 48 kHz, 24-bit, rounding
from float with no dither, because dither at 24 bits sits below any playback chain's noise floor
and would need its own seeded randomness. FLAC is encoded by spawning the reference `flac`
encoder (`brew install flac`) with the WAV on stdin, `--best`, and its stderr surfaced in the error
when it exits non-zero. `./scripts/setup` checks that `flac` is installed, as it does for pnpm and
uv. A test decodes the FLAC with `flac -d` and compares samples with the WAV bit for bit.

## Alternatives considered

- **ffmpeg** — rejected though it is installed: it is a much larger tool for one job, and its
  version moves with every Homebrew upgrade.
- **An encoder written here** — rejected as about 400 lines to own, plus a decoder to test it.
- **A WASM or native npm package** — rejected as a dependency, and native ones rebuild on every
  Node upgrade.

## Consequences

- One more system tool for setup to check. FLAC is lossless, so the flac version never affects
  reproducibility and isn't recorded.
