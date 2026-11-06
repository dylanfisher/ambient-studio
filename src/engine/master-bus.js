// The bus every voice feeds (decision 0010). The voice sum plays dry, through a reverb whose
// impulse response comes from the seed, and through a feedback delay; then the side/mid width
// and the master fades. It is linear throughout, so stems sum to the mix; normalization and
// the limiter run on the summed render, outside the engine.
/** @import { ControlValue } from "./render.js" */
/** @import { Genome } from "./genome-schema.js" */
import { CONTROL_RATE, controlTime } from "./control-grid.js";
import { dbToGain } from "./decibels.js";
import { GLOBAL_PARAMS } from "./genome-schema.js";
import { impulseResponse } from "./impulse-response.js";
import { CURVES } from "./trajectory.js";

/**
 * The master gain at a timeline time: the fade-in from 0, times the fade-out. The fade-out ends
 * on the last control-grid time before the timeline's end, so a render's final 0.1 s or less is
 * exact zeros; with no fade-out, the gain falls to 0 over that last grid step.
 * @param {Genome} genome
 * @param {number} time timeline seconds
 */
function fadeGain({ duration, fadeIn, fadeOut }, time) {
  const end = controlTime(Math.ceil(duration * CONTROL_RATE) - 1);
  if (time >= end) return 0;
  const rise = fadeIn > 0 ? CURVES.smooth(Math.min(1, time / fadeIn)) : 1;
  const fall = fadeOut > 0 ? CURVES.smooth(Math.min(1, (end - time) / fadeOut)) : 1;
  return rise * fall;
}

/**
 * Side/mid width: each output channel keeps its own side at `(1 + g) / 2` and takes the other's
 * at `(1 − g) / 2`, which scales the side by g and leaves the mid alone at every frequency.
 * @param {BaseAudioContext} ctx
 * @param {number} widthDb the side's level against its unchanged level, 0 or below
 */
function widthStage(ctx, widthDb) {
  const g = dbToGain(widthDb);
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  for (const [from, to] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]) {
    const gain = ctx.createGain();
    gain.gain.value = from === to ? (1 + g) / 2 : (1 - g) / 2;
    splitter.connect(gain, from);
    gain.connect(merger, 0, to);
  }
  return { input: splitter, output: merger };
}

/**
 * Builds the bus into `ctx.destination` and returns the node voices connect to.
 * @param {BaseAudioContext} ctx
 * @param {Genome} genome a normalized genome
 * @param {number} seed
 * @param {(param: AudioParam, value: ControlValue) => void} automate makes a parameter follow a
 *   value sampled on the control grid
 * @returns {AudioNode}
 */
export function masterBus(ctx, genome, seed, automate) {
  const input = ctx.createGain();
  const width = widthStage(ctx, genome.width);
  const fade = ctx.createGain();
  automate(fade.gain, (_, time) => fadeGain(genome, time));
  width.output.connect(fade).connect(ctx.destination);
  input.connect(width.input);

  const reverbSend = ctx.createGain();
  automate(reverbSend.gain, (params) => dbToGain(params.reverbLevel));
  const convolver = ctx.createConvolver();
  // Set before the buffer, which is when it applies. The default scales the response by its own
  // energy; impulseResponse already scales it, so reverbLevel means the same at every decay.
  convolver.normalize = false;
  const channels = impulseResponse(seed, genome.reverbDecay, ctx.sampleRate);
  const ir = ctx.createBuffer(channels.length, channels[0]?.length ?? 0, ctx.sampleRate);
  channels.forEach((data, channel) => {
    ir.copyToChannel(data, channel);
  });
  convolver.buffer = ir;
  input.connect(reverbSend).connect(convolver).connect(width.input);

  const delaySend = ctx.createGain();
  automate(delaySend.gain, (params) => dbToGain(params.delayLevel));
  const delay = ctx.createDelay(GLOBAL_PARAMS.delayTime.max);
  delay.delayTime.value = genome.delayTime;
  const feedback = ctx.createGain();
  automate(feedback.gain, (params) => params.delayFeedback);
  input.connect(delaySend).connect(delay).connect(feedback).connect(delay);
  delay.connect(width.input);
  return input;
}
