import { carryHistory, INTERPOLATION_SPAN, interpolatedPeaks } from "./interpolated-peaks.js";

// Parameters from 0011.
const LOOKAHEAD_SECONDS = 0.005;
const RELEASE_SECONDS = 0.25;
const BLOCK = 4096;
const EMPTY = new Float32Array(0);

/**
 * @typedef {object} Limiter
 * @property {(input: Float32Array[], output?: Float32Array[]) => Float32Array[]} push takes
 *   the next chunk of every channel, the count fixed by the first push, and returns the output
 *   frames whose look-ahead it now has: all but the last 250 frames (at 48 kHz) of everything
 *   pushed. They are written into `output` from its start when it is given, and it throws if
 *   `output` is too short; otherwise into new arrays.
 * @property {(output?: Float32Array[]) => Float32Array[]} finish returns the frames still held,
 *   reading silence past the end, as `push` returns them. Nothing can be pushed after it.
 */

/**
 * A look-ahead limiter over a stream read in chunks of any length: the output is the input
 * times `gain`, with every channel's 4x-interpolated peak held at or under `threshold`. The
 * gain is linked across channels, so the stereo image doesn't shift. Where no peak would cross
 * the threshold, the output sample is exactly the input times `gain`. The output joined across
 * chunks has the bits `limitTruePeak` gives for the whole input (0060): the detector's history,
 * the sliding minimum, the attack ring, the release and the input not yet output all carry
 * between chunks.
 * @param {number} gain linear
 * @param {number} threshold linear
 * @param {number} sampleRate
 * @returns {Limiter}
 */
export function createLimiter(gain, threshold, sampleRate) {
  const attack = Math.round(LOOKAHEAD_SECONDS * sampleRate);
  // The reduction a peak needs must be reached on every sample its filter reads, so the
  // window looks that far further ahead than the attack.
  const window = attack + INTERPOLATION_SPAN;
  const release = Math.exp(-1 / (RELEASE_SECONDS * sampleRate));
  // A peak above this level, before the gain, needs reducing.
  const level = threshold / gain;

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

  // Each channel's last `window - 1` input frames, which are output only after the next chunk
  // gives their look-ahead, and its detector's last 11, newest last.
  /** @type {Float32Array[] | undefined} */
  let tails;
  /** @type {Float32Array[]} */
  let histories = [];
  // Frames pushed so far.
  let received = 0;
  let finished = false;

  /**
   * Runs the gain computer for detector positions `from` to `to - 1`, whose linked peaks are
   * in `linked`, writing output frame m to `out[c][m - outStart]`. Frame m of the input is
   * `chunk[c][m - chunkStart]`, or in the tail when it came before the chunk.
   * @param {number} from
   * @param {number} to
   * @param {Float32Array[]} out
   * @param {number} outStart
   * @param {Float32Array[]} chunk
   * @param {number} chunkStart
   */
  function run(from, to, out, outStart, chunk, chunkStart) {
    const tail = /** @type {Float32Array[]} */ (tails);
    const tailStart = chunkStart - (window - 1);
    const end = received;
    // The state in locals for the loop, written back after it: V8 can keep locals in
    // registers, and the loop ran about 30% slower writing the closure's variables directly.
    const slots = dequeValue.length;
    let f = front;
    let s = size;
    let sum = heldSum;
    let reduced = heldReduced;
    let rel = released;
    for (let n = from; n < to; n++) {
      const peak = linked[n - from] ?? 0;
      const reduction = peak > level ? level / peak : 1;
      while (s > 0 && (dequeValue[(f + s - 1) % slots] ?? 1) >= reduction) s--;
      const slot = (f + s) % slots;
      dequeIndex[slot] = n;
      dequeValue[slot] = reduction;
      s++;

      const m = n - window + 1;
      if (m < 0) continue;
      while ((dequeIndex[f] ?? 0) < m) {
        f = (f + 1) % slots;
        s--;
      }
      const needed = dequeValue[f] ?? 1;
      if (m === 0 && needed < 1) {
        // A peak in the first window has no earlier samples to ramp over, so the gain starts
        // reduced.
        held.fill(needed);
        sum = attack * needed;
        reduced = attack;
        rel = needed;
      }
      // The release is a one-pole in dB: the reduction in dB decays by `release` a sample.
      rel = Math.min(needed, rel < 1 ? rel ** release : 1);

      const ring = m % attack;
      const leaving = held[ring] ?? 1;
      if (leaving < 1) reduced--;
      if (rel < 1) reduced++;
      held[ring] = rel;
      sum += rel - leaving;
      // Reset the sum when nothing is reduced, so rounding left over from a reduction can't
      // change the gain of the samples after it.
      if (reduced === 0) sum = attack;
      const smoothed = reduced === 0 ? 1 : sum / attack;

      if (m < end) {
        for (let c = 0; c < tail.length; c++) {
          const o = out[c];
          const x = m >= chunkStart ? chunk[c]?.[m - chunkStart] : tail[c]?.[m - tailStart];
          if (o) o[m - outStart] = (x ?? 0) * gain * smoothed;
        }
      }
    }
    front = f;
    size = s;
    heldSum = sum;
    heldReduced = reduced;
    released = rel;
  }

  /**
   * @param {Float32Array[] | undefined} output
   * @param {number} count frames to be written
   * @param {number} channelCount
   */
  function outputFor(output, count, channelCount) {
    if (!output) return Array.from({ length: channelCount }, () => new Float32Array(count));
    if (output.length !== channelCount) {
      throw new Error(`the limiter has ${channelCount} channels, the output ${output.length}`);
    }
    return output.map((channel) => {
      if (channel.length < count) {
        throw new Error(`the limiter's output needs ${count} frames, got ${channel.length}`);
      }
      return channel.subarray(0, count);
    });
  }

  /**
   * Checks a chunk against the stream so far, and returns its length.
   * @param {Float32Array[]} input
   */
  function lengthOf(input) {
    if (finished) throw new Error("the limiter is finished; nothing can be pushed after it");
    if (!tails) {
      tails = input.map(() => new Float32Array(window - 1));
      histories = input.map(() => new Float32Array(INTERPOLATION_SPAN));
    }
    if (input.length !== tails.length) {
      throw new Error(`the limiter was given ${tails.length} channels, then ${input.length}`);
    }
    const length = input[0]?.length ?? 0;
    for (const channel of input) {
      if (channel.length !== length) {
        throw new Error(`channel length ${channel.length} differs from ${length}`);
      }
    }
    return length;
  }

  return {
    push(input, output) {
      const length = lengthOf(input);
      const start = received;
      const outStart = Math.max(0, start - window + 1);
      const count = Math.max(0, start + length - window + 1) - outStart;
      const out = outputFor(output, count, input.length);
      received = start + length;
      for (let blockStart = 0; blockStart < length; blockStart += BLOCK) {
        const blockEnd = Math.min(length, blockStart + BLOCK);
        linked.fill(0, 0, blockEnd - blockStart);
        for (const [c, channel] of input.entries()) {
          interpolatedPeaks(channel, blockStart, blockEnd, peaks, histories[c]);
          for (let i = 0; i < blockEnd - blockStart; i++) {
            linked[i] = Math.max(linked[i] ?? 0, peaks[i] ?? 0);
          }
        }
        run(start + blockStart, start + blockEnd, out, outStart, input, start);
      }
      for (const [c, channel] of input.entries()) {
        carryHistory(/** @type {Float32Array} */ (histories[c]), channel);
        carryHistory(/** @type {Float32Array} */ (tails?.[c]), channel);
      }
      return out;
    },

    finish(output) {
      if (finished) throw new Error("the limiter is finished; nothing can be pushed after it");
      finished = true;
      tails ??= [];
      const outStart = Math.max(0, received - window + 1);
      const out = outputFor(output, received - outStart, tails.length);
      // Detector outputs run 11 samples past the input; the gain computer then runs a window
      // further, so the last frames get their look-ahead.
      const detectEnd = received + INTERPOLATION_SPAN;
      const total = detectEnd + window - 1;
      for (let blockStart = received; blockStart < total; blockStart += BLOCK) {
        const blockEnd = Math.min(total, blockStart + BLOCK);
        const end = Math.min(blockEnd, detectEnd);
        linked.fill(0, 0, blockEnd - blockStart);
        if (blockStart < end) {
          for (const history of histories) {
            interpolatedPeaks(EMPTY, blockStart - received, end - received, peaks, history);
            for (let i = 0; i < end - blockStart; i++) {
              linked[i] = Math.max(linked[i] ?? 0, peaks[i] ?? 0);
            }
          }
        }
        // Every frame still to be output is in the tails.
        run(blockStart, blockEnd, out, outStart, tails, received - (window - 1));
      }
      return out;
    },
  };
}
