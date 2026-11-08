// What the struck voices share (decisions 0013, 0071): hit candidates on a grid from timeline 0,
// each firing at the effective density of its time (decision 0003) and moved later by a drawn
// share of its step; a cap on hits sounding at once that cuts the oldest; and each hit a buffer
// computed in JS from the seed, played by one AudioBufferSource and a gain through long-lived
// slot gains, created in the window that holds its start.
/** @import { NumberDescriptor } from "./descriptor.js" */
/** @import { Resolved } from "./effective-params.js" */
/** @import { Genome, Voice } from "./genome-schema.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
/** @import { VoiceType } from "./voice-registry.js" */
import { shapeNote } from "./bell-notes.js";
import { eventCost } from "./cost-unit.js";
import { dbToGain } from "./decibels.js";
import { effectiveParams } from "./effective-params.js";
import { eventSlots } from "./event-slots.js";
import { highestValue } from "./highest-value.js";
import { draw, fires } from "./prng.js";
import { DENSITY_ROW, JITTER_SLOT } from "./struck-params.js";

/** Seconds the oldest hit takes to fade when a new one would go over the cap. */
const CUT_FADE = 0.05;

/**
 * Where a voice's candidates sit and how many of its hits may sound at once.
 * @typedef {object} StrikeGrid
 * @property {number} step seconds between candidates
 * @property {number} jitter the share of a step a hit may start after its candidate's time
 * @property {number} most hits sounding at once
 */

/**
 * One hit on the timeline.
 * @typedef {object} Strike
 * @property {number} index the candidate slot on the voice's grid
 * @property {number} frame the timeline frame it starts on
 * @property {number} end the timeline frame it ends on: its ring's end, or where the cap cuts it
 * @property {boolean} cut whether the cap cuts it
 */

/**
 * Frames a hit rings.
 * @param {number} decay seconds
 * @param {number} rate
 */
export const ringFrames = (decay, rate) => Math.ceil(decay * rate);

/**
 * Finds the voice's hits from the seed and the density at each candidate's time. Candidate k sits
 * at `k × step` from timeline 0, fires with probability `density × step / 60`, and starts a drawn
 * share of up to `jitter` of the step later, on the next whole frame, inside the voice's start
 * and end. Every hit rings the voice's `decay`, fixed per genome, so the hits sounding are always
 * the latest ones, and a hit is cut where the `most`-th one after it starts.
 * @param {Genome} genome
 * @param {Voice} voice
 * @param {number} seed
 * @param {number} rate
 * @param {StrikeGrid} grid
 * @returns {(from: number, to: number) => Strike[]} the hits starting from `from` to before `to`,
 *   timeline seconds
 */
export function strikeFinder(genome, voice, seed, rate, { step, jitter, most }) {
  const index = genome.voices.indexOf(voice);
  const ring = ringFrames(/** @type {number} */ (voice.decay), rate);
  const start = /** @type {number} */ (voice.start);
  const end = /** @type {number} */ (voice.end);
  /** @type {Map<number, number | undefined>} candidate → its frame, if it fires */
  const fired = new Map();
  /** @param {number} k */
  function onset(k) {
    if (fired.has(k)) return fired.get(k);
    const { density } = /** @type {{ density: number }} */ (
      /** @type {unknown} */ (effectiveParams(genome, k * step).voices[index])
    );
    const probability = Math.min(1, (density * step) / 60);
    let frame;
    if (fires(seed, voice.id, k, probability)) {
      const time = (k + jitter * draw(seed, voice.id, k, JITTER_SLOT)) * step;
      // Whole frames, so an excerpt starts a hit where a full render does.
      const first = Math.ceil(time * rate);
      if (first >= start * rate && first < end * rate) frame = first;
    }
    fired.set(k, frame);
    return frame;
  }
  /** @param {number} fromFrame @param {number} toFrame @returns {{ index: number; frame: number }[]} */
  function onsets(fromFrame, toFrame) {
    const found = [];
    for (
      let k = Math.max(0, Math.floor(fromFrame / rate / step) - 1);
      k * step * rate < toFrame;
      k++
    ) {
      const frame = onset(k);
      if (frame !== undefined && frame >= fromFrame && frame < toFrame)
        found.push({ index: k, frame });
    }
    return found;
  }
  return (from, to) =>
    onsets(from * rate, to * rate).map(({ index: k, frame }) => {
      const pusher = onsets(frame + 1, frame + ring)[most - 1];
      return pusher
        ? { index: k, frame, end: pusher.frame, cut: true }
        : { index: k, frame, end: frame + ring, cut: false };
    });
}

/**
 * Each hit is a buffer source and a gain from its start to its end (decision 0010), at the
 * highest density the voice reaches, plus the slot gains alive through the render, plus
 * `weight` node-seconds for each second of ring a hit computes in JS. The cap only shortens
 * hits, so it isn't counted.
 * @param {Voice} voice
 * @param {Genome} genome
 * @param {VoiceType} type
 * @param {{ most: number; weight: number }} counts
 */
export function strikeCost(voice, genome, type, { most, weight }) {
  const decay = /** @type {number} */ (voice.decay);
  const density = /** @type {NumberDescriptor} */ (type.params.density);
  const rate = highestValue(genome, voice, DENSITY_ROW.param, density, type.macros) / 60;
  return most + eventCost({ rate, seconds: decay, nodes: 2 }) + weight * rate * decay;
}

/**
 * A hit's samples, peak at most 1, and its equal-power pan from −1 to 1.
 * @typedef {{ samples: Float32Array; pan: number }} Hit
 */

/**
 * How a voice shapes a computed tone into a hit.
 * @typedef {object} HitShape
 * @property {number} attack seconds of linear attack
 * @property {number} peak the loudest a hit gets, before the level of the voice
 * @property {number} velocityDb how many dB down from the loudest velocities spread
 * @property {number} panSpread how far either side of the center pans spread
 */

/**
 * A tone scaled to a drawn velocity, given its attack and an end fade (`shapeNote`), and a
 * drawn pan.
 * @param {Float64Array} tone
 * @param {HitShape} shape
 * @param {{ velocity: number; pan: number }} drawn two draws in [0, 1)
 * @param {number} rate
 * @returns {Hit}
 */
export const shapeHit = (tone, { attack, peak, velocityDb, panSpread }, drawn, rate) => ({
  samples: shapeNote(tone, { attack, gain: peak * dbToGain(-velocityDb * drawn.velocity), rate }),
  pan: (drawn.pan * 2 - 1) * panSpread,
});

/**
 * Builds a struck voice: in each window, every hit that starts in it is computed by `hit` from
 * the voice's effective values at its start and played through one of `grid.most` slots.
 * @template V
 * @param {VoiceSetup} setup
 * @param {StrikeGrid} grid
 * @param {(settings: Resolved<V>, index: number) => Hit} hit
 * @returns {VoiceWindow}
 */
export function buildStrikes(
  { ctx, output, genome, voice, seed, from, startFrame, at },
  grid,
  hit,
) {
  const index = genome.voices.indexOf(voice);
  const rate = ctx.sampleRate;
  const strikes = strikeFinder(genome, voice, seed, rate, grid);
  /** @param {number} frame a timeline frame */
  const frameTime = (frame) => at(from) + (frame - startFrame) / rate;
  const fade = Math.round(CUT_FADE * rate);
  const connect = eventSlots(ctx, output, grid.most);

  return (windowFrom, windowTo) => {
    for (const strike of strikes(windowFrom, windowTo)) {
      if (strike.frame < startFrame) continue;
      const self = /** @type {Resolved<V>} */ (
        /** @type {unknown} */ (effectiveParams(genome, strike.frame / rate).voices[index])
      );
      const { samples, pan } = hit(self, strike.index);
      // Equal-power pan, computed into the buffer's two channels rather than by a panner node.
      const angle = ((pan + 1) * Math.PI) / 4;
      const buffer = ctx.createBuffer(2, samples.length, rate);
      [Math.cos(angle), Math.sin(angle)].forEach((share, channel) => {
        const data = new Float32Array(samples.length);
        for (let n = 0; n < samples.length; n++) data[n] = (samples[n] ?? 0) * share;
        buffer.copyToChannel(data, channel);
      });
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      if (strike.cut) {
        // Faded out by the time the hit over the cap starts, so `most` at most ever sound.
        gain.gain.setValueAtTime(1, frameTime(Math.max(strike.frame, strike.end - fade)));
        gain.gain.linearRampToValueAtTime(0, frameTime(strike.end));
      }
      source.connect(gain);
      connect(gain, strike.frame, strike.end);
      source.start(frameTime(strike.frame));
      source.stop(frameTime(strike.end));
    }
  };
}
