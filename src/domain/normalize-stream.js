/** @import { NormalizeOptions, NormalizeResult } from "./normalize-passes.js" */
import { createLimiter } from "./limiter.js";
import { createLoudnessMeter } from "./loudness-meter.js";
import { normalizePasses } from "./normalize-passes.js";
import { createTruePeakMeter } from "./true-peak-meter.js";

/**
 * Chunks of every channel, in order; a new iterable each call, starting again from the first
 * frame, since every pass reads the whole input.
 * @typedef {() => Iterable<Float32Array[]> | AsyncIterable<Float32Array[]>} ChunkSource
 */

/**
 * `normalize` over a source too long to hold: the same passes and decisions, reading the
 * source once to measure it and once a pass, and holding no output. The result's gain,
 * loudness and true peak have the bits `normalize` gives for the whole input (0060), and
 * `createLimiter(10 ** (gainDb / 20), threshold, sampleRate)` over the source again gives the
 * output that was measured.
 * @param {ChunkSource} source one or two channels of equal length
 * @param {number} sampleRate must be 48000
 * @param {NormalizeOptions} options LUFS and dBTP
 * @returns {Promise<NormalizeResult>}
 */
export async function normalizeStream(source, sampleRate, options) {
  const start = normalizePasses(options);
  const input = createLoudnessMeter(sampleRate);
  for await (const chunk of source()) input.push(chunk);
  const passes = start(input.integratedLoudness());
  let step = passes.next();
  while (!step.done) {
    const { gainDb, threshold } = step.value;
    const limiter = createLimiter(10 ** (gainDb / 20), threshold, sampleRate);
    const loudness = createLoudnessMeter(sampleRate);
    const peak = createTruePeakMeter(sampleRate);
    /** @param {Float32Array[]} output */
    const measure = (output) => {
      loudness.push(output);
      peak.push(output);
    };
    for await (const chunk of source()) measure(limiter.push(chunk));
    measure(limiter.finish());
    step = passes.next({ loudness: loudness.integratedLoudness(), truePeak: peak.truePeak });
  }
  return step.value;
}
