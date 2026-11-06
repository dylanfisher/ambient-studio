// How long an offline context a render needs, and how its buffer becomes a result (decision
// 0007). An offline context has a fixed length, and the pre-roll that sets it is engine
// knowledge, so the engine plans it and the caller builds the context from the plan.
/** @import { Genome } from "./genome-schema.js" */
import { controlTime } from "./control-grid.js";
import { effectiveParams } from "./effective-params.js";
import { ENGINE_VERSION } from "./engine-version.js";
import { requireGenome } from "./validate-genome.js";
import { requireVoiceType } from "./voice-registry.js";

/** Every render is 48 kHz. */
export const SAMPLE_RATE = 48000;
const CHANNELS = 2;
/** Frames in one Web Audio render quantum. */
const QUANTUM = 128;
/** How far the echo loop falls before the pre-roll counts it as gone, in dB. */
const ECHO_FLOOR_DB = 60;

/**
 * @typedef {object} RenderPlan
 * @property {number} sampleRate
 * @property {number} channels
 * @property {number} startFrame the timeline frame at the context's first frame: a whole number
 *   of render quanta, so an excerpt's quanta line up with a full render's
 * @property {number} trim frames of pre-roll to drop from the start of the buffer
 * @property {number} frames frames the result keeps
 * @property {number} length the context's length in frames, `trim + frames`
 */

/**
 * A render's output, which export, features and CLAP all take.
 * @typedef {object} RenderResult
 * @property {Float32Array[]} channels one array per channel
 * @property {number} sampleRate
 * @property {number} engineVersion the `ENGINE_VERSION` that rendered it
 */

/**
 * Seconds of timeline rendered before `offset` so the reverb, the echo loop and every event
 * audible at the offset have started: the reverb's decay, plus the time the echo loop takes to
 * fall 60 dB at the highest feedback it reaches before the offset, plus the longest event any
 * voice plays. 0 at offset 0, where there is nothing before.
 * @param {Genome} genome a normalized genome
 * @param {number} offset timeline seconds
 */
export function preRoll(genome, offset) {
  if (offset === 0) return 0;
  // Sampled where the render samples it, on the control grid.
  let feedback = 0;
  for (let index = 0; controlTime(index) <= offset; index++) {
    feedback = Math.max(feedback, effectiveParams(genome, controlTime(index)).delayFeedback);
  }
  const echo = feedback > 0 ? (genome.delayTime * ECHO_FLOOR_DB) / (-20 * Math.log10(feedback)) : 0;
  const events = genome.voices.map((voice) => requireVoiceType(voice.type).longestEvent(voice));
  return genome.reverbDecay + echo + Math.max(0, ...events);
}

/**
 * The context to build for a render of `duration` seconds of the timeline from `offset`.
 * @param {Genome} genome
 * @param {{ duration: number; offset: number }} window timeline seconds; the window must lie
 *   inside the genome's duration
 * @returns {RenderPlan}
 */
export function renderPlan(genome, { duration, offset }) {
  const normalized = requireGenome(genome, "renderPlan: invalid genome");
  if (!(duration > 0 && Number.isFinite(duration))) {
    throw new RangeError(`render duration must be above 0 s, got ${duration}`);
  }
  if (!(offset >= 0 && Number.isFinite(offset))) {
    throw new RangeError(`render offset must be 0 s or later, got ${offset}`);
  }
  if (offset + duration > normalized.duration) {
    throw new RangeError(
      `a ${duration} s render from ${offset} s runs past the genome's ${normalized.duration} s timeline`,
    );
  }
  const offsetFrame = Math.round(offset * SAMPLE_RATE);
  const frames = Math.round(duration * SAMPLE_RATE);
  const earliest = offsetFrame - Math.ceil(preRoll(normalized, offset) * SAMPLE_RATE);
  const startFrame = Math.max(0, Math.floor(earliest / QUANTUM) * QUANTUM);
  const trim = offsetFrame - startFrame;
  return {
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    startFrame,
    trim,
    frames,
    length: trim + frames,
  };
}

/**
 * The rendered buffer without its pre-roll. Throws on a buffer that doesn't match the plan.
 * @param {AudioBuffer} buffer
 * @param {RenderPlan} plan
 * @returns {RenderResult}
 */
export function trimToResult(buffer, plan) {
  const { length, channels, sampleRate, trim, frames } = plan;
  if (
    buffer.length !== length ||
    buffer.numberOfChannels !== channels ||
    buffer.sampleRate !== sampleRate
  ) {
    throw new Error(
      `the plan needs ${length} frames of ${channels} channels at ${sampleRate} Hz, got ${buffer.length} of ${buffer.numberOfChannels} at ${buffer.sampleRate}`,
    );
  }
  const data = Array.from({ length: channels }, (_, channel) => {
    const samples = new Float32Array(frames);
    buffer.copyFromChannel(samples, channel, trim);
    return samples;
  });
  return { channels: data, sampleRate, engineVersion: ENGINE_VERSION };
}
