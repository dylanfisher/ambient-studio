# 0060. Streaming meters, limiter and WAV writers, held bit-equal to the whole-array forms

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0008](0008-loudness-written-here.md) (the meters take chunks),
  [0011](0011-normalize-true-peak-limiter.md) (the limiter takes chunks, and normalize runs over a
  source) and [0012](0012-flac-via-cli.md) (the WAV is written header first, and a 32-bit float
  WAV for stems)

## Context

Phase 6 renders tracks up to 20 minutes in chunks and keeps peak memory under 1 GiB, so the
loudness meter, the true-peak meter, the limiter, normalize and the WAV writer can no longer hold
a whole render. Every excerpt the owner has rated and every cached feature row was measured and
limited by the whole-array functions, and the golden hashes (0009) cover the normalized PCM.
Stems, unlimited at the mix's gain, can pass 0 dBFS, which 24-bit integer PCM clips.

## Decision

**Equality is the rule.** Each streaming form gives the bits its whole-array form gives for the
same input, for any split into chunks, and the whole-array function is a one-chunk call of the
streaming one, so there is one copy of each piece of DSP. The engine version doesn't move.

- **Meters** (`src/domain`). `createLoudnessMeter(sampleRate)` has `push(channels)` and
  `integratedLoudness()`; `createTruePeakMeter(sampleRate)` has `push(channels)` and
  `truePeak()`. Reading a result doesn't end the stream. The K-weighting (`createKWeightedPower`)
  carries each channel's biquad state and its sum over the unfinished 10 ms sub-block; the window
  sums (`createWindowPowers`) keep the last `size` sub-block powers and add them in the same
  order. The loudness meter keeps one number per 400 ms gating block, since the relative gate
  needs them all: 80 kB an hour. The true-peak meter keeps each channel's last 11 samples, which
  `interpolatedPeaks` now takes as `before`, and reads the 11 outputs past the end when asked.
  The channel count is fixed by the first push, and a later chunk with another count throws.
- **Limiter.** `createLimiter(gain, threshold, sampleRate)` has `push(input, output?)` and
  `finish(output?)`. It carries the detector history, the sliding minimum, the attack ring, the
  release and the last `window − 1` input frames (250 at 48 kHz), so `push` returns all but the
  last 250 frames of everything pushed and `finish` returns the rest. Given `output`, it writes
  there and throws when `output` is too short; otherwise it allocates. Nothing can be pushed
  after `finish`.
- **Normalize.** The pass loop (gain, accept, cap, peak check) moved into `normalizePasses`, a
  generator both forms drive, so the decisions are written once. `normalizeStream(source,
  sampleRate, options)` takes a function that returns a fresh iterable, sync or async, of chunks
  from the first frame; it reads the source once to measure it and once a pass, measures each
  pass's loudness and true peak as it limits, and holds no output. It returns `normalize`'s
  `gainDb`, `loudness` and `truePeak` plus the limiter's `threshold`, and
  `createLimiter(10 ** (gainDb / 20), threshold, sampleRate)` over the source again gives the
  output that was measured. A missing target throws before the source is read.
- **WAV** (`src/server`). `createWavWriter(path, {channelCount, sampleRate, frames,
  sampleFormat})` opens the file exclusively, writes a header for `frames`, and takes interleaved
  bytes in chunks with `append`. A chunk past the stated total, or a short total at `close`,
  closes and removes the file and throws, so no file's header disagrees with its data; `abort`
  does the same for a caller's own failure. `writeWav` is one `append`, with the same bytes as
  before. `sampleFormat` is `PCM24` (0012's 44-byte header) or `FLOAT32`: format tag 3, an
  18-byte fmt chunk and a fact chunk with the frame count, as the WAV format asks of a non-PCM
  tag, 58 bytes of header. `encodeFloat32` interleaves little-endian floats as they are, past
  full scale included, and throws on NaN or ±Infinity.

## Alternatives considered

- **Streaming forms written beside the old functions** — rejected because two copies of the DSP
  can drift, and equality would rest on a test instead of on one code path.
- **Equality within a tolerance** — rejected because a difference of one float32 step in the
  limiter changes the export's PCM hash, and the owner has rated audio made by these functions.
- **A sync-only streaming normalize** — rejected because a 20-minute source read from disk on
  every pass would block the server for the whole normalize; the async form yields between
  chunks and takes sync iterables too.
- **Keeping the normalized output of the passes** — rejected because the caller doesn't know which
  pass is accepted until it ends; rerunning the limiter from the returned gain is one more pass.
- **A 44-byte header with format tag 3** — rejected because the WAV format asks a non-PCM tag
  for the fmt extension size and a fact chunk, and a strict reader may refuse the file without
  them.

## Consequences

- Measured on mbp2021 on every Tech 3341 signal the meter tests build and on every golden genome's
  raw windows, fed in chunks of 1, 127, 4,096 and 48,000 frames: identical bits for loudness,
  true peak and the limiter's output. A script recorded integrated, momentary and short-term
  loudness, true peak, the limiter's output hash, normalize's result and the raw features on those
  inputs before the change and found them identical after; the golden raw and normalized hashes
  pass.
- One-frame chunks cost about 4 µs a frame in call overhead, so the limiter's test runs them over
  the first 5 s of each signal; 127 frames and up run the full signals.
- The limiter's whole-array time on 120 s of stereo rose about 10% (2.46 s to 2.69 s for six
  passes, process start included), from reading input across the chunk edge.
- `loudness-meter.js` and `true-peak-meter.js` join `FEATURE_EXTRACTOR`, and the meter files
  changed, so the `producer` key (0023) changes: cached excerpts render again the first time
  they're needed, with the same features, and one cached before the change renders again before
  it can be rated. Rated audio already captured is unaffected.
