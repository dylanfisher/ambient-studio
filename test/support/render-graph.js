// Renders one fixed graph that uses every node type the engine relies on, for the renderer
// spike in test/server/offline-context.test.js. Run as a script it prints the render's
// SHA-256, so the test can compare renders from separate processes.
import { createHash } from "node:crypto";
import { OfflineAudioContext } from "node-web-audio-api";
import { retryOnSuspendRace } from "../../src/server/render-offline.js";

export const SAMPLE_RATE = 48000;
export const FRAMES = SAMPLE_RATE;
/** Off the 128-frame render quantum on purpose: 4801 = 37 * 128 + 65. */
export const LATE_START_FRAME = 4801;
/** The suspend that creates the late source sits on the quantum boundary before it. */
export const SUSPEND_FRAME = 37 * 128;

/**
 * Fills a buffer from a fixed linear congruential sequence, so the graph needs no seed plumbing.
 * @param {OfflineAudioContext} ctx
 * @param {number} channels
 * @param {number} frames
 * @param {number} seed
 */
function noiseBuffer(ctx, channels, frames, seed) {
  const buffer = ctx.createBuffer(channels, frames, SAMPLE_RATE);
  let state = seed >>> 0;
  for (let c = 0; c < channels; c++) {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      // Decay so the buffer works as an impulse response as well as a source.
      data[i] = (state / 2 ** 32 - 0.5) * Math.exp((-6 * i) / frames);
    }
    buffer.copyToChannel(data, c);
  }
  return buffer;
}

/**
 * @param {OfflineAudioContext} ctx
 * @param {AudioNode} destination
 */
function startLateSource(ctx, destination) {
  const late = ctx.createBufferSource();
  late.buffer = noiseBuffer(ctx, 1, 2400, 7);
  late.connect(destination);
  late.start(LATE_START_FRAME / SAMPLE_RATE);
}

/**
 * Renders 1 s at 48 kHz stereo through an oscillator with a PeriodicWave, BiquadFilter, Gain,
 * Delay in a feedback loop, Convolver, StereoPanner, AudioBufferSource, ChannelSplitter and
 * ChannelMerger.
 * @param {{ suspend: boolean }} options when true, the late buffer source is created in a
 *   suspend callback instead of up front
 * @returns {Promise<Float32Array[]>} one array per channel
 */
export function renderEveryNode({ suspend }) {
  return retryOnSuspendRace(() => renderEveryNodeOnce({ suspend }));
}

/** @param {{ suspend: boolean }} options */
async function renderEveryNodeOnce({ suspend }) {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: FRAMES,
    sampleRate: SAMPLE_RATE,
  });

  const osc = ctx.createOscillator();
  osc.setPeriodicWave(
    ctx.createPeriodicWave(
      new Float32Array([0, 0.3, 0.1, 0.05]),
      new Float32Array([0, 1, 0.5, 0.25]),
    ),
  );
  osc.frequency.value = 220;
  osc.frequency.linearRampToValueAtTime(330, 0.8);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  filter.Q.value = 4;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, 0);
  amp.gain.linearRampToValueAtTime(0.5, 0.05);
  amp.gain.setTargetAtTime(0.2, 0.4, 0.1);

  const sum = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.0371;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.6;

  const convolver = ctx.createConvolver();
  convolver.buffer = noiseBuffer(ctx, 2, 12000, 3);

  const panner = ctx.createStereoPanner();
  panner.pan.value = -0.4;
  panner.pan.linearRampToValueAtTime(0.6, 1);

  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);

  osc.connect(filter).connect(amp).connect(sum);
  sum.connect(delay).connect(feedback).connect(sum);
  sum.connect(convolver).connect(panner).connect(splitter);
  sum.connect(panner);
  // Swap the channels so the splitter and merger do something a broken pair would show.
  splitter.connect(merger, 0, 1);
  splitter.connect(merger, 1, 0);
  merger.connect(ctx.destination);

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 2, 9600, 11);
  source.loop = true;
  source.playbackRate.value = 0.75;
  source.connect(sum);
  source.start(0.25, 0.01);
  source.stop(0.9);

  /** @type {Promise<void> | undefined} */
  let suspended;
  if (suspend) {
    suspended = ctx.suspend(SUSPEND_FRAME / SAMPLE_RATE).then(() => {
      startLateSource(ctx, sum);
      return ctx.resume();
    });
  } else {
    startLateSource(ctx, sum);
  }

  osc.start(0);
  // Awaited together, so a refused suspend rejects here instead of silently dropping the source.
  const [rendered] = await Promise.all([ctx.startRendering(), suspended]);
  return [0, 1].map((c) => {
    const data = new Float32Array(rendered.length);
    rendered.copyFromChannel(data, c);
    return data;
  });
}

/**
 * @param {Float32Array[]} channels
 * @returns {string} SHA-256 of the channels' bytes, in order
 */
export function hashChannels(channels) {
  const hash = createHash("sha256");
  for (const data of channels)
    hash.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return hash.digest("hex");
}

if (import.meta.main) {
  console.log(hashChannels(await renderEveryNode({ suspend: process.argv[2] === "--suspend" })));
}
