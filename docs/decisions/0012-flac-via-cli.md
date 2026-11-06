# 0012. Export writes WAV here and FLAC through the flac CLI

- **Date:** 2026-11-05
- **Status:** accepted

## Context

The spec exports WAV (48 kHz / 24-bit) and FLAC. WAV is a header and interleaved samples. FLAC
needs a real encoder, which Node doesn't have.

## Decision

By the owner's choice on 2026-11-05, `src/server` writes WAV itself: PCM, 48 kHz, 24-bit, rounding
from float to the nearest step with no dither, because dither at 24 bits sits below any playback
chain's noise floor and would need its own seeded randomness. FLAC is encoded by spawning the
reference `flac` encoder (`brew install flac`) with the WAV on stdin, `--best`, and its stderr
surfaced in the error when it exits non-zero. `./scripts/setup` checks that `flac` is installed, as
it does for pnpm and uv. A test decodes the FLAC with `flac -d` and compares samples with the WAV
bit for bit.

## Alternatives considered

- **ffmpeg** — rejected though it is installed: it is a much larger tool for one job, and its
  version moves with every Homebrew upgrade.
- **An encoder written here** — rejected as about 400 lines to own, plus a decoder to test it.
- **A WASM or native npm package** — rejected as a dependency, and native ones rebuild on every
  Node upgrade.

## Consequences

- One more system tool for setup to check. FLAC is lossless, so the flac version never affects
  reproducibility and isn't recorded.

## Amendments

- 2026-11-06: from step 1i. Float maps to 24-bit as `Math.round(x * 2^23)`, clipped to
  −8388608…8388607: −1.0 is −8388608, +1.0 clips to 8388607, and a value already on the 24-bit
  grid round-trips exactly. A tie rounds toward +infinity. NaN throws, naming the channel and
  frame; ±Infinity clips. One function, `encodePcm24` in `src/server`, owns this, and the golden
  hashes (0009) hash its output. The WAV header is the plain 44-byte PCM form (format tag 1), not
  WAVE_FORMAT_EXTENSIBLE; `flac` reads it for 24-bit stereo. `writeFlac` streams the written WAV
  file into flac's stdin rather than taking the samples again, so the FLAC holds exactly the
  WAV's bytes and a long render isn't held in memory twice. It runs `flac --best --silent` found
  on PATH, the same lookup `./scripts/setup` checks, with no injected binary path: the failure
  test points flac at an output folder that doesn't exist, which makes flac itself exit 1 with
  its message on stderr. A missing binary rejects with Node's spawn error. flac refuses to
  overwrite an existing output file, and that failure is left loud. On mbp2021, 300 s of stereo
  encoded to PCM in 0.16 s, wrote as WAV in 0.01 s and as FLAC in 1.3 s.
- 2026-11-06: from step 1l. `writeWav` opens its file exclusively and throws `EEXIST` rather than
  overwrite, matching flac, so an export never replaces an earlier one
  ([0015](0015-export-sidecar-json.md)).
- 2026-11-06: **a zero exit from flac is a success even if the pipe closed first** (step 1i,
  provisional: owner to confirm). flac exits 0 once it has read every sample the WAV header
  declares, which can be before Node's `pipeline` has seen the writable side finish, so the
  pipeline rejected with `ERR_STREAM_PREMATURE_CLOSE` or `EPIPE` and `writeFlac` threw for a
  complete FLAC. It failed once in about ten full gate runs. After a zero exit, those two codes
  from the input are ignored; any other input error, such as a read error on the WAV, still
  throws, and a non-zero exit still throws with flac's stderr.
  The test puts a `flac` stub on PATH that reads one byte and exits 0 against an 8 MB WAV, so
  the write is always still pending; it failed with EPIPE before the change.
