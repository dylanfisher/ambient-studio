# 0011. Normalization runs gain, a look-ahead true-peak limiter and a re-measure loop

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm; amended by
  [0060](0060-streaming-meters-limiter-writers.md) (the limiter takes chunks, and normalize runs
  over a source)

## Context

Every export is brought to a loudness target from −30 to −10 LUFS with true peak at or under
−1.0 dBTP ([0018](0018-default-loudness-target.md)), measured by our BS.1770-4 meter
([0008](0008-loudness-written-here.md)). The renders are bass-heavy drones whose peaks sit well
above their loudness, so at the louder targets some limiting is needed, and limiting lowers
loudness. The meter's true peak reads up to 0.31 dB under the band-limited peak on Tech 3341's
cases. The normalizer and limiter decide the exported samples, so they are covered by the engine
version ([0009](0009-engine-version-golden-hashes.md)) and must be deterministic.

## Decision

`normalize(channels, sampleRate, { target, ceiling })` in `src/domain` returns new buffers and
the measured loudness, true peak and gain. `target` is required and throws when missing, since
every caller passes one (step 1l); `ceiling` defaults to −1.0 dBTP.

- **Loop.** Gain to the target from the input's integrated loudness, limit, re-measure, and add
  the remaining error to the gain. Passes stop within 0.1 LU of the target. When 8 passes run out,
  or the next gain would pass the cap, a result within 0.5 LU is accepted and anything further off
  throws with the final loudness and its error in LU. The input is never changed, so each pass
  limits the original signal at the new gain.
- **Gain cap: +40 dB.** Input whose gain to the target is over the cap throws, naming the gain.
  Input with loudness `-Infinity` throws. A −30 LUFS target from a −70 LUFS render would need 40 dB,
  and the descriptor range needs at least +35.
- **Limiter.** Gain is linked across channels. The detector is the meter's own 4× interpolation
  filter (`interpolatedPeaks`, shared with `truePeak`), so the limiter and the meter read the same
  peaks. Look-ahead and attack are 5 ms (240 samples): the needed gain is held at its minimum over
  the next 240 + 11 samples, so the reduction covers every sample the filter reads for that peak,
  then averaged over 240 samples, which makes the attack a linear ramp that reaches the needed gain
  at the peak. Release is a one-pole in dB with a 250 ms time constant, so a deep reduction comes
  back at the same rate in dB as a shallow one. A peak in the first 5 ms starts the gain already
  reduced. Where no peak crosses the threshold, every output sample is exactly input × gain.
- **True-peak margin.** The limiter holds the meter's reading at the ceiling less 0.4 dB
  (−1.4 dBTP at the default). This covers the meter's 0.31 dB under-read, plus 0.09 dB for the gain
  ramp and float32 rounding. After limiting, a reading above the ceiling less 0.31 dB throws rather
  than exporting. In every test and run the limited reading was −1.400 dBTP, within 0.000001 dB.

## Alternatives considered

- **Gain only, no limiter** — rejected because bass-heavy drones at −9 to −12 LUFS have true
  peaks over −1 dBTP.
- **Holding the meter's reading at the ceiling itself** — rejected because the band-limited peak
  could then sit 0.3 dB over it.
- **A separate, more finely oversampled detector** — rejected because it would be a second
  interpolation filter to own. Sharing the meter's filter plus a 0.4 dB margin meets the ceiling
  on Tech 3341's cases. The 0.31 dB figure covers content up to 8 kHz (case 17); content near
  20 kHz can read further under, and the dark renders this project makes have little there.
- **Release linear in gain** — rejected after testing: a −40 dB reduction recovered to −10 dB
  within 100 ms, so dense transients barely held the gain down.
- **Stopping at 0.5 LU, as the plan first wrote it** — rejected because a heavily limited −9 LUFS
  render stopped at −9.46, leaving no room for the ±0.2 LU difference allowed against ffmpeg.
- **A default target** — rejected because a silent default would hide a caller that forgot to
  pass the vibe's or genome's target.

## Consequences

- Measured on mbp2021 (nice 10, Node 26): 300 s stereo of a swelling bass tone with transients,
  to −16 LUFS, took 1.6 s over 2 passes; to −9 LUFS, 3.9 s over about 5 passes. 900 s to −9 took
  8.4 s. Memory is one output buffer per channel (115 MB at 300 s stereo, 346 MB at 900 s), plus
  small fixed rings; the input is not copied.
- Splitting the meter's filter out of `truePeak` into `interpolatedPeaks`, which works in 4096-sample
  blocks, left its readings bit-identical and took a 300 s stereo true peak from 336 ms to 269 ms.
- The gain moves at most 1/240 of its range per sample during an attack: 0.0037 a sample for an
  18 dB reduction in the tests.
- A signal whose transients hold the limiter down, such as full-scale bursts every 100 ms under a
  quiet tone, throws instead of exporting: "can't reach −9 LUFS: after 3 passes … −6.9 LU from the
  target".
- Changing any number here changes exported samples and needs an engine version bump once step 1l
  adds the normalized golden hashes.

## Amendments

- 2026-11-06: from step 2b. The target range tops out at −10 LUFS
  ([0018](0018-default-loudness-target.md)); the −9 figures above are the measurements that led
  there.
- 2026-11-07: from step 6a ([0060](0060-streaming-meters-limiter-writers.md), provisional: owner
  to confirm). The limiter is `createLimiter(gain, threshold, sampleRate)`, which takes chunks
  and returns each output frame once its 250-frame look-ahead has arrived; `limitTruePeak` is a
  one-chunk call of it with the same bits. The pass loop is `normalizePasses`, which `normalize`
  and the new `normalizeStream` both drive: the latter reads a re-readable source once to
  measure and once a pass, holds no output, and returns the gain, loudness, true peak and
  threshold. The parameters and decisions above are unchanged. The limiter's whole-array time
  rose about 10%.
