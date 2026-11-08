// The chant voice: a low sung drone. Harmonics of a root, up to about 3 kHz and falling `tilt` dB
// an octave, are shaped by a vowel's resonances and swell in level at `pulse` Hz. The partials
// are computed in JS and mixed into one stereo buffer per event window, as the granular cloud
// does (decision 0014), with their phase taken from timeline time (decision 0069). Up to 12
// detuned, panned singers sing it, breathing on seeded schedules from timeline 0 (decision 0070).
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Resolved } from "./effective-params.js" */
/** @import { Genome, Voice, VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { CONTROL_RATE, controlTime } from "./control-grid.js";
import { eventCost } from "./cost-unit.js";
import { dbToGain } from "./decibels.js";
import { int, number } from "./descriptor.js";
import { drone, droneFundamental } from "./drone.js";
import { effectiveParams } from "./effective-params.js";
import { MACRO } from "./macro-table.js";
import { resolvePitch } from "./pitch.js";
import { drawer } from "./prng.js";
import { WINDOW } from "./render.js";
import { centsToRatio } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";
import { playWindowBuffer } from "./window-buffer.js";

const PARAMS = Object.freeze({
  // The drone's register, because the root snaps to a scale note as the drone's does.
  root: number({
    min: drone.params.root.min,
    max: drone.params.root.max,
    default: 65,
    unit: "Hz",
    scale: "log",
    safe: [50, 85],
    description: drone.params.root.description,
  }),
  vowel: number({
    min: 0,
    max: 1,
    default: 0.2,
    unit: "",
    trajectory: true,
    description: "oo 0, oh 0.5, ah 1",
  }),
  focus: number({
    min: 0,
    max: 18,
    default: 6,
    unit: "dB",
    trajectory: true,
    safe: [0, 12],
    description: "boost at upper formant",
  }),
  tilt: number({
    min: 0,
    max: 12,
    default: 3,
    unit: "dB",
    safe: [2, 6],
    description: "per harmonic octave",
  }),
  bend: number({
    min: -200,
    max: 200,
    default: 0,
    unit: "cents",
    trajectory: true,
    safe: [-100, 100],
    description: "pitch drift",
  }),
  pulse: number({
    min: 0.1,
    max: 1.5,
    default: 0.38,
    unit: "Hz",
    scale: "log",
    safe: [0.2, 0.8],
    description: "swell rate",
  }),
  depth: number({
    min: 0,
    max: 1,
    default: 0.5,
    unit: "",
    trajectory: true,
    description: "swell depth",
  }),
  singers: int({ min: 1, max: 12, default: 1, unit: "", safe: [1, 8], description: "in unison" }),
  spread: number({
    min: 0,
    max: 50,
    default: 12,
    unit: "cents",
    safe: [4, 25],
    description: "singers detuned within ±this",
  }),
  pan: number({
    min: 0,
    max: 1,
    default: 1,
    unit: "",
    safe: [0.5, 1],
    description: "singers panned within ±this",
  }),
  phrase: number({
    min: 3,
    max: 30,
    default: 8,
    unit: "s",
    scale: "log",
    safe: [5, 16],
    description: "sung between breaths",
  }),
  breath: number({
    min: 0,
    max: 2,
    default: 0,
    unit: "s",
    safe: [0.3, 1],
    description: "0 never breathes",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} ChantVoice */

/** Harmonics of the snapped root up to this; a bend of +200 cents takes the top one to 3.4 kHz. */
const TOP_HZ = 3000;

/**
 * The two vowel resonances at vowel 0, 0.5 and 1, a dark "oo", an "oh" and an open "ah" of a low
 * voice: centers and bandwidths in Hz. Between targets, centers and bandwidths move
 * geometrically. At a 65 Hz root the lower one lifts harmonic 5 at vowel 0, 7 at 0.5 and 10 at 1.
 */
const VOWELS = Object.freeze([
  { lower: { hz: 300, width: 160 }, upper: { hz: 650, width: 200 } },
  { lower: { hz: 460, width: 180 }, upper: { hz: 780, width: 220 } },
  { lower: { hz: 650, width: 200 }, upper: { hz: 1000, width: 240 } },
]);
/** The upper resonance's peak against the lower one's. */
const UPPER_DB = -10;
/**
 * A third, broad and weak resonance at the bottom of the register, fixed for every vowel. It sets
 * the fundamental at about 19 dB under the strongest partial at the default tilt.
 */
const CHEST = Object.freeze({ hz: 100, width: 140, db: -25 });
/**
 * The source's RMS before the voice's level and pan, whatever the vowel. A default chant measures
 * 0.3 LU under a default drone at the same level (seed 1, 1 s reverb).
 */
const SOURCE_RMS = 0.9;
/** The swell's dip at depth 1, dB. */
const SWELL_DB = 12;

/**
 * The power response of a band-pass resonance at `hz`, 1 at its center and falling 12 dB an
 * octave far from it, so the partials between and beyond the resonances drop away quickly.
 * @param {number} f Hz
 * @param {{ hz: number; width: number }} resonance
 */
function resonance(f, { hz, width }) {
  const off = (hz / width) * (f / hz - hz / f);
  return 1 / (1 + off * off);
}

/**
 * The vowel's resonances at `vowel`, between its two nearest targets.
 * @param {number} vowel 0 to 1
 */
function vowelResonances(vowel) {
  const at = vowel * (VOWELS.length - 1);
  const i = Math.min(VOWELS.length - 2, Math.floor(at));
  const u = at - i;
  const a = /** @type {(typeof VOWELS)[number]} */ (VOWELS[i]);
  const b = /** @type {(typeof VOWELS)[number]} */ (VOWELS[i + 1]);
  /** @param {"lower" | "upper"} which */
  const blend = (which) => ({
    hz: a[which].hz * (b[which].hz / a[which].hz) ** u,
    width: a[which].width * (b[which].width / a[which].width) ** u,
  });
  return { lower: blend("lower"), upper: blend("upper") };
}

/**
 * Fills `out` with the amplitudes of harmonics 1 to `out.length` of `hz`, scaled so their sum of
 * sines has an RMS of `SOURCE_RMS`. `focus` lifts the harmonic nearest the upper resonance, or
 * shares the lift between the two either side of it, so it moves smoothly as the vowel does.
 * @param {Float64Array} out
 * @param {{ hz: number; vowel: number; focus: number; tilt: number }} at
 */
function partialAmplitudes(out, { hz, vowel, focus, tilt }) {
  const { lower, upper } = vowelResonances(vowel);
  const upperGain = dbToGain(UPPER_DB);
  const chestGain = dbToGain(CHEST.db);
  let power = 0;
  for (let i = 0; i < out.length; i++) {
    const n = i + 1;
    const f = n * hz;
    const near = Math.max(0, 1 - Math.abs(f - upper.hz) / hz);
    const shape =
      resonance(f, lower) + upperGain * resonance(f, upper) + chestGain * resonance(f, CHEST);
    const amplitude = dbToGain(-tilt * Math.log2(n) + focus * near) * shape;
    out[i] = amplitude;
    power += (amplitude * amplitude) / 2;
  }
  const scale = SOURCE_RMS / Math.sqrt(power);
  for (let i = 0; i < out.length; i++) out[i] = /** @type {number} */ (out[i]) * scale;
}

/**
 * @typedef {object} ChantControl
 * @property {number} hz the bent fundamental
 * @property {number} vowel
 * @property {number} focus
 * @property {number} depth
 */

/**
 * @typedef {object} Singer
 * @property {number} cents detune from the track's pitch
 * @property {number} pan -1 to 1, equal-power
 * @property {number} phase cycles added to the fundamental's, so singers don't start in phase
 */

/** @typedef {{ start: number; end: number }} Breath timeline seconds */

/**
 * @typedef {object} ChantTrack
 * @property {number} sampleRate
 * @property {number} count harmonics a singer sings
 * @property {number} tilt
 * @property {number} pulse
 * @property {readonly Singer[]} singers the lead first
 * @property {(k: number) => ChantControl} control the effective values at control-grid sample k
 * @property {(k: number) => number} turns cycles the fundamental, before a singer's detune,
 *   has turned from timeline 0 to grid sample k
 * @property {(singer: number, until: number) => Breath[]} breaths the singer's breaths that
 *   start before `until` seconds
 */

/** The lead singer, undetuned and centered, sings as the chant of one singer always has. */
const LEAD = Object.freeze({ cents: 0, pan: 0, phase: 0 });

/**
 * Each singer's draws (decision 0003), at its index as the event index: its detune, how far to
 * its side it stands, its phase, and where in its first phrase timeline 0 falls. From `phrases`
 * on, two a phrase: phrase j's length at `phrases + 2j`, the breath after it at `phrases + 2j + 1`.
 */
const SLOT = Object.freeze({ cents: 1, pan: 2, phase: 3, stagger: 4, phrases: 5 });

/** A breath's fade out, and its fade back in, at most; a shorter breath halves its length. */
const BREATH_RAMP = 0.08;

/**
 * The singers' breaths, from timeline 0. Each sings phrases of `phrase` × 2^(±1), each followed
 * by a breath of `breath` × 0.75 to 1.25, its first phrase cut short by a seeded fraction so the
 * singers start out of step. Singer s takes a breath only while fewer than ⌈(s + 1) / 2⌉ of the
 * singers before it breathe during it, so of any first n singers at least ⌊n / 2⌋ are singing;
 * otherwise it holds its note until one of them has breathed in, for at most another `phrase`
 * seconds, and then breathes anyway. A singer depends only on those before it, so adding singers
 * moves no one's breaths. Breaths are drawn as they are first asked for and kept.
 * @param {(eventIndex: number, slot: number) => number} u the voice's draws
 * @param {number} count singers
 * @param {{ phrase: number; breath: number }} lengths
 * @returns {(singer: number, until: number) => Breath[]}
 */
function breathSchedules(u, count, { phrase, breath }) {
  /** @type {Breath[][]} */
  const lists = Array.from({ length: count }, () => []);
  /** @param {number} s @param {number} j */
  const phraseLength = (s, j) => phrase * 2 ** (2 * u(s, SLOT.phrases + 2 * j) - 1);
  /** Where each singer's next phrase ends. */
  const next = Array.from({ length: count }, (_, s) => phraseLength(s, 0) * u(s, SLOT.stagger));
  /**
   * The breaths of the singers before `s` that overlap `[start, end)`, and the most of them at
   * once.
   * @param {number} s @param {number} start @param {number} end
   */
  const crowd = (s, start, end) => {
    /** @type {Breath[]} */
    const overlapping = [];
    /** @type {[number, number][]} */
    const edges = [];
    for (let r = 0; r < s; r++) {
      const list = extend(r, end);
      // A singer's breaths are in order and apart, so only its last few can overlap.
      for (let i = list.length - 1; i >= 0; i--) {
        const b = /** @type {Breath} */ (list[i]);
        if (b.end <= start) break;
        if (b.start >= end) continue;
        overlapping.push(b);
        edges.push([Math.max(b.start, start), 1], [b.end, -1]);
      }
    }
    // An end and a start at one time don't overlap.
    edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let now = 0;
    let most = 0;
    for (const [, step] of edges) {
      now += step;
      most = Math.max(most, now);
    }
    return { overlapping, most };
  };
  /** @param {number} s @param {number} until */
  const extend = (s, until) => {
    const list = /** @type {Breath[]} */ (lists[s]);
    while (breath > 0 && /** @type {number} */ (next[s]) < until) {
      const j = list.length;
      const length = breath * (0.75 + 0.5 * u(s, SLOT.phrases + 2 * j + 1));
      const due = /** @type {number} */ (next[s]);
      let start = due;
      for (;;) {
        const { overlapping, most } = crowd(s, start, start + length);
        if (most < Math.ceil((s + 1) / 2) || start >= due + phrase) break;
        start = Math.min(...overlapping.map((b) => b.end));
      }
      list.push({ start, end: start + length });
      next[s] = start + length + phraseLength(s, j + 1);
    }
    return list;
  };
  return (s, until) => extend(s, until).filter((b) => b.start < until);
}

/**
 * The voice's control values on the 0.1 s grid, and its fundamental's phase, both from timeline
 * 0. The phase sums the fundamental's frequency over the grid from 0 in one order, so a track
 * that starts late, as an excerpt's does, reaches the same value at each sample bit for bit.
 * Samples are computed as they are first asked for and kept.
 * @param {Genome} genome
 * @param {Voice} voice
 * @param {number} sampleRate a whole number of frames a control-grid step
 * @param {number} seed
 * @returns {ChantTrack}
 */
export function chantTrack(genome, voice, sampleRate, seed) {
  if (!Number.isInteger(sampleRate / CONTROL_RATE)) {
    throw new Error(`chant: ${sampleRate} Hz is not a whole number of frames a control step`);
  }
  const index = genome.voices.findIndex((v) => v.id === voice.id);
  if (index === -1) throw new Error(`chant: the genome has no voice "${voice.id}"`);
  const self = /** @type {ChantVoice} */ (/** @type {unknown} */ (voice));
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const fundamental = droneFundamental(pitch, self.root);
  const u = drawer(seed, voice.id);
  // The others alternate sides, each between half the `pan` width and all of it.
  const singers = Array.from({ length: self.singers }, (_, s) =>
    s === 0
      ? LEAD
      : {
          cents: self.spread * (2 * u(s, SLOT.cents) - 1),
          pan: (s % 2 === 1 ? 1 : -1) * self.pan * (1 - u(s, SLOT.pan) / 2),
          phase: u(s, SLOT.phase),
        },
  );
  /** @type {ChantControl[]} */
  const controls = [];
  const turns = [0];
  /** @param {number} k */
  const control = (k) => {
    while (controls.length <= k) {
      const values = /** @type {Resolved<ChantVoice>} */ (
        /** @type {unknown} */ (effectiveParams(genome, controlTime(controls.length)).voices[index])
      );
      controls.push({
        hz: fundamental * centsToRatio(values.bend),
        vowel: values.vowel,
        focus: values.focus,
        depth: values.depth,
      });
    }
    return /** @type {ChantControl} */ (controls[k]);
  };
  return {
    sampleRate,
    count: Math.floor(TOP_HZ / fundamental),
    tilt: self.tilt,
    pulse: self.pulse,
    singers,
    control,
    turns: (k) => {
      // The frequency ramps linearly between grid samples, so each step adds its mean.
      while (turns.length <= k) {
        const j = turns.length - 1;
        const step = (control(j).hz + control(j + 1).hz) / (2 * CONTROL_RATE);
        turns.push(/** @type {number} */ (turns[j]) + step);
      }
      return /** @type {number} */ (turns[k]);
    },
    breaths: breathSchedules(u, singers.length, self),
  };
}

/**
 * A singer's gain at each of timeline frames `[first, first + frames)`: `scale`, faded to 0 and
 * back in each breath along a raised cosine, from the frame's time alone.
 * @param {ChantTrack} track
 * @param {number} s
 * @param {number} first
 * @param {number} frames
 * @param {number} scale
 */
function singerGain(track, s, first, frames, scale) {
  const rate = track.sampleRate;
  const gain = new Float64Array(frames).fill(scale);
  for (const { start, end } of track.breaths(s, (first + frames) / rate)) {
    if (end * rate <= first) continue;
    const ramp = Math.min(BREATH_RAMP, (end - start) / 2);
    const from = Math.max(first, Math.ceil(start * rate));
    const to = Math.min(first + frames, Math.ceil(end * rate));
    for (let i = from; i < to; i++) {
      const t = i / rate;
      const into = Math.min(t - start, end - t) / ramp;
      const fade = into >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * into);
      gain[i - first] = /** @type {number} */ (gain[i - first]) * fade;
    }
  }
  return gain;
}

/** Points in a cycle of the chorus's waveform table. */
const TABLE = 2048;
/** sin(2πj / TABLE) and cos(2πj / TABLE), for building the table. */
const TABLE_SIN = Float64Array.from({ length: TABLE }, (_, j) =>
  Math.sin((2 * Math.PI * j) / TABLE),
);
const TABLE_COS = Float64Array.from({ length: TABLE }, (_, j) =>
  Math.cos((2 * Math.PI * j) / TABLE),
);

/**
 * Fills `table` with one cycle of the sum of harmonics at `amplitudes`, TABLE points and a
 * last that repeats the first, for reading with linear interpolation. Half a cycle is summed,
 * by the recurrence `addLead` uses, and the other half is its negative.
 * @param {Float64Array} table TABLE + 1 points
 * @param {Float64Array} amplitudes
 */
function fillTable(table, amplitudes) {
  const count = amplitudes.length;
  table[0] = 0;
  table[TABLE / 2] = 0;
  table[TABLE] = 0;
  for (let j = 1; j < TABLE / 2; j++) {
    const twoCos = 2 * /** @type {number} */ (TABLE_COS[j]);
    let below = 0;
    let sine = /** @type {number} */ (TABLE_SIN[j]);
    let sum = 0;
    for (let n = 0; n < count; n++) {
      sum += /** @type {number} */ (amplitudes[n]) * sine;
      const above = twoCos * sine - below;
      below = sine;
      sine = above;
    }
    table[j] = sum;
    table[TABLE - j] = -sum;
  }
}

/**
 * The voice's stereo sound for timeline frames `[first, first + frames)`, before its level. Each
 * frame's value depends only on the track and the frame: amplitudes are interpolated between
 * grid samples from the frame's place between them, not accumulated, so any window computes the
 * same bits.
 *
 * The lead sums its harmonics directly: harmonic n's sine comes from the recurrence
 * sin((n+1)θ) = 2cos θ sin(nθ) − sin((n−1)θ), one sine and one cosine a frame for all of them.
 * The others, the chorus, share the lead's harmonic amplitudes: at each grid sample they are
 * summed once into a table of one cycle, and each singer reads the tables either side of the
 * frame at its own phase and blends them by the frame's place between them, which is the same
 * linear blend of amplitudes. Every singer is scaled by 1/√singers, so the ensemble's power
 * stays about the lead's alone.
 * @param {ChantTrack} track
 * @param {number} first
 * @param {number} frames
 * @returns {Float32Array<ArrayBuffer>[]} left and right
 */
export function chantChunk(track, first, frames) {
  const { sampleRate, count, tilt, pulse, singers } = track;
  const step = sampleRate / CONTROL_RATE;
  const end = first + frames;
  const scale = 1 / Math.sqrt(singers.length);
  const gains = singers.map((_, s) => singerGain(track, s, first, frames, scale));
  const sides = singers.map(({ pan }) => {
    const angle = ((pan + 1) * Math.PI) / 4;
    return { toLeft: Math.cos(angle), toRight: Math.sin(angle) };
  });
  const ratios = singers.map(({ cents }) => centsToRatio(cents));
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  const swell = new Float64Array(frames);
  const chorus = singers.length > 1;
  let from = new Float64Array(count);
  let to = new Float64Array(count);
  const slope = new Float64Array(count);
  let near = new Float64Array(chorus ? TABLE + 1 : 0);
  let far = new Float64Array(chorus ? TABLE + 1 : 0);
  /** @param {Float64Array} out @param {ChantControl} c */
  const amplitudes = (out, c) =>
    partialAmplitudes(out, { hz: c.hz, vowel: c.vowel, focus: c.focus, tilt });
  const k0 = Math.floor(first / step);
  amplitudes(from, track.control(k0));
  if (chorus) fillTable(near, from);
  for (let k = k0; k * step < end; k++) {
    const a = track.control(k);
    const b = track.control(k + 1);
    amplitudes(to, b);
    for (let n = 0; n < count; n++)
      slope[n] = /** @type {number} */ (to[n]) - /** @type {number} */ (from[n]);
    const turns = track.turns(k);
    const rise = b.hz - a.hz;
    const lo = Math.max(first, k * step);
    const hi = Math.min(end, (k + 1) * step);
    const lead = /** @type {Float64Array} */ (gains[0]);
    const { toLeft, toRight } = /** @type {(typeof sides)[number]} */ (sides[0]);
    for (let i = lo; i < hi; i++) {
      const u = (i - k * step) / step;
      const tau = u / CONTROL_RATE;
      // The phase of a frequency ramping from a.hz to b.hz over the step.
      const cycles = turns + a.hz * tau + (rise * tau * u) / 2;
      const theta = 2 * Math.PI * (cycles - Math.floor(cycles));
      const twoCos = 2 * Math.cos(theta);
      let below = 0;
      let sine = Math.sin(theta);
      let sum = 0;
      for (let n = 0; n < count; n++) {
        const amplitude = /** @type {number} */ (from[n]) + /** @type {number} */ (slope[n]) * u;
        sum += amplitude * sine;
        const above = twoCos * sine - below;
        below = sine;
        sine = above;
      }
      const depth = a.depth + (b.depth - a.depth) * u;
      const dip = 0.5 + 0.5 * Math.cos((2 * Math.PI * pulse * i) / sampleRate);
      const out = i - first;
      const level = dbToGain(-SWELL_DB * depth * dip);
      swell[out] = level;
      const value = sum * level * /** @type {number} */ (lead[out]);
      left[out] = /** @type {number} */ (left[out]) + toLeft * value;
      right[out] = /** @type {number} */ (right[out]) + toRight * value;
    }
    if (chorus) {
      fillTable(far, to);
      for (let s = 1; s < singers.length; s++) {
        const ratio = /** @type {number} */ (ratios[s]);
        const { phase } = /** @type {Singer} */ (singers[s]);
        const gain = /** @type {Float64Array} */ (gains[s]);
        const side = /** @type {(typeof sides)[number]} */ (sides[s]);
        for (let i = lo; i < hi; i++) {
          const u = (i - k * step) / step;
          const tau = u / CONTROL_RATE;
          const cycles = ratio * (turns + a.hz * tau + (rise * tau * u) / 2) + phase;
          const x = (cycles - Math.floor(cycles)) * TABLE;
          const j = Math.floor(x);
          const f = x - j;
          const n0 = /** @type {number} */ (near[j]);
          const n1 = /** @type {number} */ (near[j + 1]);
          const f0 = /** @type {number} */ (far[j]);
          const f1 = /** @type {number} */ (far[j + 1]);
          const now = n0 + f * (n1 - n0);
          const next = f0 + f * (f1 - f0);
          const out = i - first;
          const value =
            (now + u * (next - now)) *
            /** @type {number} */ (swell[out]) *
            /** @type {number} */ (gain[out]);
          left[out] = /** @type {number} */ (left[out]) + side.toLeft * value;
          right[out] = /** @type {number} */ (right[out]) + side.toRight * value;
        }
      }
      [near, far] = [far, near];
    }
    [from, to] = [to, from];
  }
  return [Float32Array.from(left), Float32Array.from(right)];
}

/**
 * Computing the voice in JS costs render time the node count doesn't show, in node-seconds at
 * 1.24e-4 s each. Measured on mbp2021 over 120 s renders beside a noise bed's known cost, the
 * lead took 0.94 to 7.4 ms a timeline second for 22 to 81 partials: about 0.11 ms a partial
 * (0.9 node-seconds) and 2.9 ms for the frame's sine, cosine and swell and the control samples
 * (23 node-seconds) (decision 0069). The chorus's tables take about 0.016 ms a partial (0.15),
 * and each chorus singer about 0.3 ms whatever its partials (3) (decision 0070).
 */
const PARTIAL_WEIGHT = 0.9;
const LEAD_WEIGHT = 23;
const TABLE_PARTIAL_WEIGHT = 0.15;
const CHORUS_WEIGHT = 3;

/**
 * One buffer source a window, the JS mixing of every partial the lead sings, and with more than
 * one singer, the chorus's tables and each singer's reading of them.
 * @param {Voice} voice
 * @param {Genome} genome
 */
function cost(voice, genome) {
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const { root, singers } = /** @type {ChantVoice} */ (/** @type {unknown} */ (voice));
  const count = Math.floor(TOP_HZ / droneFundamental(pitch, root));
  const chorus = singers > 1 ? TABLE_PARTIAL_WEIGHT * count + CHORUS_WEIGHT * (singers - 1) : 0;
  return (
    eventCost({ rate: 1 / WINDOW, seconds: WINDOW, nodes: 1 }) +
    LEAD_WEIGHT +
    PARTIAL_WEIGHT * count +
    chorus
  );
}

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, genome, voice, seed, from, startFrame, at }) {
  const rate = ctx.sampleRate;
  const track = chantTrack(genome, voice, rate, seed);
  return (windowFrom, windowTo) => {
    if (Math.max(windowFrom, voice.start) >= Math.min(windowTo, voice.end)) return;
    const first = Math.round(windowFrom * rate);
    const channels = chantChunk(track, first, Math.round(windowTo * rate) - first);
    playWindowBuffer({ ctx, channels, first, startFrame, startTime: at(from), into: output });
  };
}

export const chant = {
  type: "chant",
  description: "low sung voice: harmonics, vowel formants, swell",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([
    { macro: MACRO.brightness, param: "vowel", depth: 0.25 },
    { macro: MACRO.motion, param: "depth", depth: 0.25 },
  ]),
  /** Its partials' phase comes from timeline time. */
  longestEvent: () => 0,
  cost,
  build,
};
