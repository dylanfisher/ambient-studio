import { interpolatedPeaks } from "./interpolated-peaks.js";

// Parameters from 0011.
const LOOKAHEAD_SECONDS = 0.005;
const RELEASE_SECONDS = 0.25;
// interpolatedPeaks' value at n is a weighted sum of x[n - 11] to x[n].
const FILTER_SPAN = 11;
const BLOCK = 4096;

/**
 * Writes `input` times `gain` into `output`, with a look-ahead limiter holding every channel's
 * 4x-interpolated peak at or under `threshold`. The gain is linked across channels, so the
 * stereo image doesn't shift. Where no peak would cross the threshold, the output sample is
 * exactly the input times `gain`.
 * @param {Float32Array[]} input channels of equal length
 * @param {Float32Array[]} output as many channels as `input`, of the same length
 * @param {number} gain linear
 * @param {number} threshold linear
 * @param {number} sampleRate
 */
export function limitTruePeak(input, output, gain, threshold, sampleRate) {
  const length = input[0]?.length ?? 0;
  const attack = Math.round(LOOKAHEAD_SECONDS * sampleRate);
  // The reduction a peak needs must be reached on every sample its filter reads, so the
  // window looks that far further ahead than the attack.
  const window = attack + FILTER_SPAN;
  const release = Math.exp(-1 / (RELEASE_SECONDS * sampleRate));
  // A peak above this level, before the gain, needs reducing.
  const level = threshold / gain;
  const peaksEnd = length + FILTER_SPAN;

  const peaks = new Float64Array(BLOCK);
  const linked = new Float64Array(BLOCK);
  // Sliding minimum of the needed gain over the next `window` values: a ring of indices whose
  // values only increase from front to back.
  const dequeIndex = new Float64Array(window + 1);
  const dequeValue = new Float64Array(window + 1);
  let front = 0;
  let size = 0;
  // The last `attack` held gains, averaged so a reduction ramps in over `attack` samples.
  const held = new Float64Array(attack).fill(1);
  let heldSum = attack;
  let heldReduced = 0;
  let released = 1;

  const total = peaksEnd + window - 1;
  for (let blockStart = 0; blockStart < total; blockStart += BLOCK) {
    const blockEnd = Math.min(total, blockStart + BLOCK);
    const detectEnd = Math.min(blockEnd, peaksEnd);
    linked.fill(0);
    if (blockStart < detectEnd) {
      for (const channel of input) {
        interpolatedPeaks(channel, blockStart, detectEnd, peaks);
        for (let i = 0; i < detectEnd - blockStart; i++) {
          linked[i] = Math.max(linked[i] ?? 0, peaks[i] ?? 0);
        }
      }
    }
    for (let n = blockStart; n < blockEnd; n++) {
      const peak = linked[n - blockStart] ?? 0;
      const reduction = peak > level ? level / peak : 1;
      while (size > 0 && (dequeValue[(front + size - 1) % dequeValue.length] ?? 1) >= reduction) {
        size--;
      }
      const slot = (front + size) % dequeValue.length;
      dequeIndex[slot] = n;
      dequeValue[slot] = reduction;
      size++;

      const m = n - window + 1;
      if (m < 0) continue;
      while ((dequeIndex[front] ?? 0) < m) {
        front = (front + 1) % dequeValue.length;
        size--;
      }
      const needed = dequeValue[front] ?? 1;
      if (m === 0 && needed < 1) {
        // A peak in the first window has no earlier samples to ramp over, so the gain starts
        // reduced.
        held.fill(needed);
        heldSum = attack * needed;
        heldReduced = attack;
        released = needed;
      }
      // The release is a one-pole in dB: the reduction in dB decays by `release` a sample.
      released = Math.min(needed, released < 1 ? released ** release : 1);

      const ring = m % attack;
      const leaving = held[ring] ?? 1;
      if (leaving < 1) heldReduced--;
      if (released < 1) heldReduced++;
      held[ring] = released;
      heldSum += released - leaving;
      // Reset the sum when nothing is reduced, so rounding left over from a reduction can't
      // change the gain of the samples after it.
      if (heldReduced === 0) heldSum = attack;
      const smoothed = heldReduced === 0 ? 1 : heldSum / attack;

      if (m < length) {
        for (let c = 0; c < input.length; c++) {
          const out = output[c];
          if (out) out[m] = (input[c]?.[m] ?? 0) * gain * smoothed;
        }
      }
    }
  }
}
