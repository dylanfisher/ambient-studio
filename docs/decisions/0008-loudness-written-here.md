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
- 2026-11-06: from step 1e, choices the builder made (provisional, owner to confirm).
  - **Channels.** The loudness functions take one or two channels and throw on more, since
    weights beyond stereo depend on speaker position, which an array of channels doesn't carry.
    Mono is one channel at weight 1.0, so it reads 3.01 dB below the same signal on both
    stereo channels; there is no dual-mono compensation. True peak takes any channel count and
    reports the loudest.
  - **Windows.** K-weighted power is summed into 10 ms sub-blocks, and every window is a whole
    number of them: gating blocks are 40 with a hop of 10, starting at the first sample;
    momentary is 40 and short-term 300, both with a hop of 1. The momentary and short-term
    series have one value per 10 ms, element j for the window starting at j × 10 ms, and only
    complete windows. A 10 ms hop puts a window exactly on every segment boundary in Tech 3341
    cases 10, 11, 13 and 14; a 100 ms hop would read case 13 up to 0.46 LU low.
  - **True peak** is the largest output of the standard's four filter phases, run 11 samples
    past the end of the input, and doesn't also take the sample peak. It reads up to 0.31 dB
    under the band-limited peak (case 17), inside Tech 3341's −0.4 dB, so a limiter whose
    ceiling this meter checks can let the analog peak exceed the ceiling by that much.
  - **Cases not tested.** Case 6 is 5.0 surround, which the meter doesn't take. Cases 7 and 8 are
    recorded programme, not synthesizable; the manual ffmpeg comparison stands in for them.
  - **Case 20–23 synthesis.** The 4× signal is low-passed with a 1023-tap Blackman windowed sinc
    at 22 kHz before decimation. A gentler 20 kHz, 255-tap filter takes 0.25 dB off the peak
    before the meter sees it and puts case 22 at −0.41 dBTP, just outside tolerance.
  - **Measured.** Integrated: cases 1 and 2 +0.007 LU, 3 and 4 −0.014, 5 +0.021. Momentary and
    short-term: cases 1 and 2 +0.007, 9 +0.014, 10 and 11 +0.007 in every segment, 12 +0.040,
    13 and 14 +0.006 in every segment. True peak: cases 15 to 19 −0.217, +0.024, −0.313, −0.026,
    +0.029 dB; 20 to 23 −0.168, −0.119, −0.232, −0.119 dB. On a 300 s stereo signal, integrated
    loudness takes about 95 ms and true peak about 270 ms on mbp2021.
