// The noise bed: white, pink or brown noise computed in JS from the seed, a buffer per event
// window, through a filter and a gain that a preset sweeps and swells into wind, rain or surf
// (decision 0014). Rain adds seeded drops to the noise. It plays at least 30 dB under a drone
// of the same level, as a bed under the other voices.
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { coloredNoise, NOISE_COLORS, PINK } from "./colored-noise.js";
import { eventCost, SWEPT_FILTER_WEIGHT } from "./cost-unit.js";
import { dbToGain } from "./decibels.js";
import { choice, number } from "./descriptor.js";
import { MACRO } from "./macro-table.js";
import { drawer, TRIGGER_SLOT } from "./prng.js";
import { WINDOW } from "./render.js";
import { CURVES } from "./trajectory.js";

const PARAMS = Object.freeze({
  color: choice({ values: NOISE_COLORS, default: PINK, description: "spectrum" }),
  preset: choice({
    values: ["wind", "rain", "surf"],
    default: "wind",
    description: "filter, swell",
  }),
  tone: number({
    min: -2,
    max: 2,
    default: 0,
    unit: "oct",
    trajectory: true,
    safe: [-2, 0.5],
    description: "filter shift",
  }),
  depth: number({
    min: 0,
    max: 1,
    default: 0.5,
    unit: "",
    trajectory: true,
    description: "sweep and swell",
  }),
  period: number({
    min: 4,
    max: 60,
    default: 10,
    unit: "s",
    scale: "log",
    description: "swell cycle",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} NoiseVoice */
/** @typedef {NoiseVoice["preset"]} Preset */

/** Slots of the noise and the drops' draws; noise is keyed by frame and drops by their slot. */
const SLOT = Object.freeze({ noise: 1, dropTime: 2, dropPitch: 3, dropPan: 4, dropGain: 5 });

/**
 * The swell's shape over a cycle, from −1 to 1, by timeline time so an excerpt plays the same
 * phase as a full render.
 * @type {Record<"gusts" | "sine" | "wave", (cycle: number) => number>}
 */
const SHAPES = {
  // Two sines at periods a golden ratio apart, so the gusts don't repeat.
  gusts: (cycle) =>
    0.6 * Math.sin(2 * Math.PI * cycle) + 0.4 * Math.sin((2 * Math.PI * cycle) / 1.618 + 1.3),
  sine: (cycle) => Math.sin(2 * Math.PI * cycle),
  // A wave rises over a quarter of the cycle and draws back over the rest, with no corner.
  wave: (cycle) => {
    const x = cycle - Math.floor(cycle);
    return x < 0.25 ? 2 * CURVES.smooth(x / 0.25) - 1 : 1 - 2 * CURVES.smooth((x - 0.25) / 0.75);
  },
};

/**
 * Each preset's filter, its swing in octaves and its swell in dB at depth 1, and its level,
 * which puts the bed at least 30 dB under a drone of the same level (a test measures it).
 * Lowpass and highpass Q are in dB in Web Audio, bandpass Q is linear.
 * @type {Record<Preset, { type: BiquadFilterType; hz: number; q: number; sweep: number;
 *   swell: number; shape: keyof typeof SHAPES; level: number; drops: boolean }>}
 */
const PRESETS = {
  wind: {
    type: "bandpass",
    hz: 500,
    q: 1.2,
    sweep: 1.5,
    swell: 12,
    shape: "gusts",
    level: -22,
    drops: false,
  },
  rain: {
    type: "highpass",
    hz: 1200,
    q: -3,
    sweep: 0.3,
    swell: 4,
    shape: "sine",
    level: -35,
    drops: true,
  },
  surf: {
    type: "lowpass",
    hz: 350,
    q: -3,
    sweep: 2,
    swell: 18,
    shape: "wave",
    level: -25,
    drops: false,
  },
};

/** Rain drops: candidates a second, the chance each falls, and their ring. */
const DROP_RATE = 60;
const DROP_CHANCE = 0.6;
const DROP_SECONDS = 0.04;
const DROP_DECAY = 0.008;
const DROP_ATTACK = 0.001;
const DROP_HZ = Object.freeze({ lo: 1000, hi: 4000 });
/** A drop's peak against the noise's RMS. */
const DROP_GAIN = 1.5;

/**
 * Adds the drops that sound in timeline frames `[first, first + frames)` to `channels`: a
 * decaying sine each, from a 1 ms ramp, so a drop that started before `first` adds its tail.
 * @param {Float32Array[]} channels
 * @param {{ seed: number; voiceId: string; first: number; sampleRate: number }} where
 */
function addDrops(channels, { seed, voiceId, first, sampleRate }) {
  const frames = /** @type {Float32Array} */ (channels[0]).length;
  const length = Math.round(DROP_SECONDS * sampleRate);
  const attack = DROP_ATTACK * sampleRate;
  const next = drawer(seed, voiceId);
  const lo = Math.max(0, Math.floor(((first - length) / sampleRate) * DROP_RATE));
  for (let k = lo; k < ((first + frames) / sampleRate) * DROP_RATE; k++) {
    /** @param {number} slot */
    const u = (slot) => next(k, slot);
    if (u(TRIGGER_SLOT) >= DROP_CHANCE) continue;
    const start = Math.ceil(((k + u(SLOT.dropTime)) / DROP_RATE) * sampleRate);
    const hz = DROP_HZ.lo * (DROP_HZ.hi / DROP_HZ.lo) ** u(SLOT.dropPitch);
    const angle = (u(SLOT.dropPan) * Math.PI) / 2;
    const gain = DROP_GAIN * u(SLOT.dropGain) ** 2;
    const [left, right] = /** @type {[Float32Array, Float32Array]} */ (channels);
    const toLeft = gain * Math.cos(angle);
    const toRight = gain * Math.sin(angle);
    // A decaying sine by the two-pole recurrence y[i] = 2r cos(w) y[i−1] − r² y[i−2], run from
    // the drop's start in every chunk so each frame gets the same value; cheaper than a sine
    // and an exponential a sample.
    const r = Math.exp(-1 / (DROP_DECAY * sampleRate));
    const w = (2 * Math.PI * hz) / sampleRate;
    const a1 = 2 * r * Math.cos(w);
    const a2 = -r * r;
    let y1 = 0;
    let y0 = r * Math.sin(w);
    for (let i = 1; i < length && start + i < first + frames; i++) {
      const out = start + i - first;
      if (out >= 0) {
        const value = Math.min(1, i / attack) * y0;
        left[out] = /** @type {number} */ (left[out]) + toLeft * value;
        right[out] = /** @type {number} */ (right[out]) + toRight * value;
      }
      const next = a1 * y0 + a2 * y1;
      y1 = y0;
      y0 = next;
    }
  }
}

/**
 * The bed's stereo source for timeline frames `[first, first + frames)`, at its preset's level,
 * the same whichever window or render computes it.
 * @param {{ seed: number; voiceId: string; color: NoiseVoice["color"]; preset: Preset;
 *   first: number; frames: number; sampleRate: number }} where
 * @returns {Float32Array<ArrayBuffer>[]} left and right
 */
export function noiseChunk({ seed, voiceId, color, preset, first, frames, sampleRate }) {
  const channels = [0, 1].map((channel) =>
    coloredNoise({ seed, voiceId, slot: SLOT.noise, color, channel, channels: 2, first, frames }),
  );
  const { drops, level } = PRESETS[preset];
  if (drops) addDrops(channels, { seed, voiceId, first, sampleRate });
  const gain = dbToGain(level);
  for (const data of channels)
    for (let i = 0; i < frames; i++) data[i] = gain * /** @type {number} */ (data[i]);
  return channels;
}

/** The filter's highest frequency, under Nyquist at 48 kHz. */
const MAX_HZ = 20000;

/**
 * Computing the noise in JS costs render time the node count doesn't show: 1.0 to 1.5 ms a
 * timeline second by preset and color, measured on mbp2021 over 120 s renders, about 12
 * node-seconds at 1.24e-4 s each (decision 0014).
 */
const NOISE_WEIGHT = 12;

/** The swept filter, the swell gain, one buffer source a window, and the noise. */
const cost = () =>
  SWEPT_FILTER_WEIGHT +
  1 +
  eventCost({ rate: 1 / WINDOW, seconds: WINDOW, nodes: 1 }) +
  NOISE_WEIGHT;

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, voice, seed, from, startFrame, at, automate }) {
  const bed = /** @type {NoiseVoice} */ (/** @type {unknown} */ (voice));
  const preset = PRESETS[bed.preset];
  const shape = SHAPES[preset.shape];
  const rate = ctx.sampleRate;

  const filter = ctx.createBiquadFilter();
  filter.type = preset.type;
  filter.Q.value = preset.q;
  const swell = ctx.createGain();
  filter.connect(swell).connect(output);
  /** @param {Record<string, unknown>} self @param {number} time */
  const swing = (self, time) => /** @type {number} */ (self.depth) * shape(time / bed.period);
  automate(filter.frequency, (self, time) => {
    const octaves = /** @type {number} */ (self.tone) + preset.sweep * swing(self, time);
    return Math.min(MAX_HZ, preset.hz * 2 ** octaves);
  });
  // The swell peaks at 0 dB and dips by `swell × depth` dB.
  automate(swell.gain, (self, time) =>
    dbToGain((preset.swell * (swing(self, time) - /** @type {number} */ (self.depth))) / 2),
  );

  return (windowFrom, windowTo) => {
    const begin = Math.max(windowFrom, bed.start);
    const end = Math.min(windowTo, bed.end);
    if (begin >= end) return;
    const first = Math.round(windowFrom * rate);
    const frames = Math.round(windowTo * rate) - first;
    const channels = noiseChunk({
      seed,
      voiceId: voice.id,
      color: bed.color,
      preset: bed.preset,
      first,
      frames,
      sampleRate: rate,
    });
    const buffer = ctx.createBuffer(2, frames, rate);
    for (const [c, data] of channels.entries()) buffer.copyToChannel(data, c);
    const player = ctx.createBufferSource();
    player.buffer = buffer;
    player.connect(filter);
    // Each window's buffer starts on the frame where the last one ended.
    player.start(at(from) + (first - startFrame) / rate);
  };
}

export const noiseBed = {
  type: "noise",
  description: "seeded noise, a preset's swept filter and swell",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([
    { macro: MACRO.brightness, param: "tone", depth: 0.25 },
    { macro: MACRO.motion, param: "depth", depth: 0.25 },
  ]),
  /** Its noise comes from timeline frames, and a drop that started earlier adds its tail. */
  longestEvent: () => 0,
  cost,
  build,
};
