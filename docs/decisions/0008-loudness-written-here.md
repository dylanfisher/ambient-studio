# 0008. Loudness and true peak are measured by code written here

- **Date:** 2026-11-05
- **Status:** accepted

## Context

Export normalizes to the vibe's loudness target and limits true peak (spec, phase 1). Phase 3's
"ears" report loudness to the LLM, and the UI may show the same readouts. The measurement has to
be exact enough to trust and available to both the server and the browser.

## Decision

By the owner's choice on 2026-11-05, ITU-R BS.1770-4 integrated loudness and true peak are
written here as pure functions over per-channel `Float32Array`s in `src/domain`: K-weighting as
two biquads, 400 ms blocks with 75% overlap, the −70 LUFS absolute gate and the −10 LU relative
gate, and true peak by 4× oversampling with the standard's interpolation filter. Momentary and
short-term loudness come from the same block code when phase 3 needs them. The limiter that uses
the meter is governed by its own record (step 1h).

Tests synthesize the EBU Tech 3341 test signals in code and require each to read within ±0.1 LU,
and the true-peak cases within the tolerances Tech 3341 gives. A manual script compares our
readings on a real render with `ffmpeg -af ebur128=peak=true`; ffmpeg is installed on mbp2021,
but nothing in the gate or tests needs it.

## Alternatives considered

- **An npm loudness package** — rejected because it adds a dependency of unknown accuracy that
  the browser can't import, and no maintained package offers a true-peak limiter.
- **ffmpeg's `ebur128` and `loudnorm` filters** — rejected because they put a system binary in
  the render path and the tests, and phase 3 still needs loudness in JS.

## Consequences

- About 300 lines of DSP to own, held to published test signals.
- The ffmpeg cross-check is a manual step at the end of phase 1, listed in its gate.

## Amendments

- 2026-11-05: from the plan review. The K-weighting coefficients are the standard's 48 kHz values,
  and a different sample rate throws rather than recomputing them; every render is 48 kHz. A
  signal with no block above the absolute gate has integrated loudness `-Infinity`, and anything
  that normalizes to a target throws on it.
