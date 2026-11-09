// The chant voice: a low sung drone. Harmonics of a root, up to about 3 kHz and falling `tilt` dB
// an octave, are shaped by a vowel's resonances and swell in level at `pulse` Hz. The partials
// are computed in JS and mixed into one stereo buffer per event window, as the granular cloud
// does (decision 0014), with their phase taken from timeline time (decision 0069). Up to 12
// detuned, panned singers sing it, breathing on seeded schedules from timeline 0 (decision 0070).
// `growl` adds the half-integer harmonics and `rough` makes alternate cycles uneven (decision
// 0088). `flutter` and `shimmer` give each singer its own seeded wander in pitch and level
// (decision 0089).
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
import { highestValue } from "./highest-value.js";
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
  growl: number({
    min: 0,
    max: 1,
    default: 0,
    unit: "",
    trajectory: true,
    description: "undertones",
  }),
  rough: number({
    min: 0,
    max: 1,
    default: 0,
    unit: "",
    description: "uneven cycles",
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
    description: "singers detuned ±this",
  }),
  pan: number({
    min: 0,
    max: 1,
    default: 1,
    unit: "",
    safe: [0.5, 1],
    description: "singers panned ±this",
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
  flutter: number({
    min: 0,
    max: 1,
    default: 0,
    unit: "",
    description: "pitch wander",
  }),
  shimmer: number({
    min: 0,
    max: 1,
    default: 0,
    unit: "",
    description: "level wander",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} ChantVoice */

/** Harmonics of the snapped root up to this; a bend of +200 cents takes the top one to 3.4 kHz. */
const TOP_HZ = 3000;
/**
 * How many half-integer harmonics, 0.5, 1.5 … of `hz`, lie under `TOP_HZ`.
 * @param {number} hz
 */
const halfHarmonics = (hz) => Math.floor(TOP_HZ / hz + 0.5);

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
 * The swing in level from one cycle to the next at rough 1: cycles alternate between 1.5 and
 * 0.5 of the level at their pulse, 9.5 dB apart.
 */
const ROUGH_SWING = 0.5;

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
 * The power that 1 + swing·cos α adds to the voice, where α is half the fundamental's phase.
 * In multiples of α, harmonic n is a sine at 2n and half-integer harmonic m + 0.5 a cosine at
 * 2m + 1; the swing lends each `side` = swing / 2 of itself at one multiple either side. So the
 * multiple k gains a sine from the integer harmonics if k is odd, a cosine from the half-integer
 * ones if it is even, at right angles to what it holds, and their powers add. A cosine at α lends
 * to 0 a constant, whose power is its square.
 * @param {Float64Array} out the integer harmonics' amplitudes
 * @param {Float64Array} half the half-integer harmonics' amplitudes
 * @param {number} side
 */
function swingPower(out, half, side) {
  /** @param {Float64Array} list @param {number} i */
  const at = (list, i) => (i >= 0 && i < list.length ? /** @type {number} */ (list[i]) : 0);
  let power = (side * at(half, 0)) ** 2;
  // Odd k = 2m + 1 from harmonics m and m + 1, even k = 2n from half-integer n − 0.5 and n + 0.5.
  for (let m = 0; m <= out.length; m++) power += (side * (at(out, m - 1) + at(out, m))) ** 2 / 2;
  for (let n = 1; n <= half.length; n++) power += (side * (at(half, n - 1) + at(half, n))) ** 2 / 2;
  return power;
}

/**
 * Fills `out` with the amplitudes of harmonics 1 to `out.length` of `hz`, and `half` with those
 * of harmonics 0.5 to `half.length - 0.5`, scaled so the voice has an RMS of `SOURCE_RMS`
 * whatever its growl and rough. `focus` lifts the harmonic nearest the upper resonance, or
 * shares the lift between the two either side of it, so it moves smoothly as the vowel does.
 * A half-integer harmonic takes the tilt and resonances at its own frequency and no focus, times
 * `growl`, so at growl 1 it sits on the integer harmonics' spectral envelope. With growl and rough
 * at 0 the integer amplitudes are computed as they were before either existed, bit for bit.
 * @param {Float64Array} out
 * @param {Float64Array} half
 * @param {{ hz: number; vowel: number; focus: number; tilt: number; growl: number; swing: number }} at
 */
function partialAmplitudes(out, half, { hz, vowel, focus, tilt, growl, swing }) {
  const { lower, upper } = vowelResonances(vowel);
  const upperGain = dbToGain(UPPER_DB);
  const chestGain = dbToGain(CHEST.db);
  /** @param {number} f */
  const shape = (f) =>
    resonance(f, lower) + upperGain * resonance(f, upper) + chestGain * resonance(f, CHEST);
  let power = 0;
  for (let i = 0; i < out.length; i++) {
    const n = i + 1;
    const f = n * hz;
    const near = Math.max(0, 1 - Math.abs(f - upper.hz) / hz);
    const amplitude = dbToGain(-tilt * Math.log2(n) + focus * near) * shape(f);
    out[i] = amplitude;
    power += (amplitude * amplitude) / 2;
  }
  if (growl > 0) {
    for (let i = 0; i < half.length; i++) {
      const n = i + 0.5;
      const amplitude = growl * dbToGain(-tilt * Math.log2(n)) * shape(n * hz);
      half[i] = amplitude;
      power += (amplitude * amplitude) / 2;
    }
  } else half.fill(0);
  if (swing > 0) power += swingPower(out, half, swing / 2);
  const scale = SOURCE_RMS / Math.sqrt(power);
  for (let i = 0; i < out.length; i++) out[i] = /** @type {number} */ (out[i]) * scale;
  if (growl > 0)
    for (let i = 0; i < half.length; i++) half[i] = /** @type {number} */ (half[i]) * scale;
}

/**
 * @typedef {object} ChantControl
 * @property {number} hz the bent fundamental
 * @property {number} vowel
 * @property {number} focus
 * @property {number} depth
 * @property {number} growl
 */

/**
 * @typedef {object} Singer
 * @property {number} cents detune from the track's pitch
 * @property {number} pan -1 to 1, equal-power
 * @property {number} phase cycles added to the fundamental's, so singers don't start in phase
 * @property {readonly WanderPart[]} flutter its pitch wander in cents, empty at flutter 0
 * @property {readonly WanderPart[]} shimmer its level wander in dB, empty at shimmer 0
 */

/**
 * @typedef {object} WanderPart one sinusoid of a wander
 * @property {number} hz
 * @property {number} amplitude
 * @property {number} phase cycles at timeline 0
 */

/** @typedef {{ start: number; end: number }} Breath timeline seconds */

/**
 * @typedef {object} ChantTrack
 * @property {number} sampleRate
 * @property {number} count harmonics a singer sings
 * @property {number} halves half-integer harmonics a singer sings when it growls
 * @property {number} tilt
 * @property {number} swing the level's swing from cycle to cycle, from `rough`
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
 * A wander is a sum of this many sinusoids, part i in the hertz from `WANDER_LOW_HZ + i`, so
 * from 1 to 8 Hz, with power falling as 1/f: one part a hertz at an amplitude of 1/√f is a 1/f
 * spectrum (decision 0089).
 */
const WANDER_PARTS = 7;
const WANDER_LOW_HZ = 1;
/** The pitch wander's RMS at flutter 1, cents. */
const FLUTTER_CENTS = 5;
/** The level wander's RMS at shimmer 1, dB. */
const SHIMMER_DB = 0.7;
/**
 * Singer s's part i sits at `s` times this fraction past the voice's seeded place for part i,
 * wrapped into [0, 1) and scaled into the first `WANDER_SPAN` of its hertz. The golden ratio's
 * fraction spreads any 12 singers' places at least 0.056 apart, and the unused 0.2 Hz at the top
 * of each hertz keeps one singer's part i from another's part i + 1, so two singers' wanders
 * correlate under 0.2 over 20 s.
 */
const GOLDEN_FRACTION = (Math.sqrt(5) - 1) / 2;
const WANDER_SPAN = 0.8;
/** The phase's lag in seconds a cent of pitch held for a second gives. */
const LAG_PER_CENT = Math.LN2 / 1200;

/**
 * Each singer's draws (decision 0003), at its index as the event index: its detune, how far to
 * its side it stands, its phase, and where in its first phrase timeline 0 falls. From `phrases`
 * on, two a phrase: phrase j's length at `phrases + 2j`, the breath after it at `phrases + 2j + 1`.
 * The wanders' slots start at 2^31, past any phrase's: a phrase lasts at least 1.5 s, so 900 s
 * holds at most 600. Part i's place is the lead's draw, at event index 0 and slot `flutter + i`
 * (or `shimmer + i`), shared by every singer; singer s's phase for it is at slot
 * `flutter + WANDER_PARTS + i`.
 */
const SLOT = Object.freeze({
  cents: 1,
  pan: 2,
  phase: 3,
  stagger: 4,
  phrases: 5,
  flutter: 2 ** 31,
  shimmer: 2 ** 31 + 2 * WANDER_PARTS,
});

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
 * Singer s's wander of RMS `rms` over a long time, from the draws at `slot`; none at 0.
 * @param {(eventIndex: number, slot: number) => number} u the voice's draws
 * @param {number} s
 * @param {number} slot
 * @param {number} rms
 * @returns {WanderPart[]}
 */
function wanderParts(u, s, slot, rms) {
  if (rms === 0) return [];
  const parts = Array.from({ length: WANDER_PARTS }, (_, i) => {
    const hz = WANDER_LOW_HZ + i + WANDER_SPAN * ((u(0, slot + i) + s * GOLDEN_FRACTION) % 1);
    return { hz, amplitude: 1 / Math.sqrt(hz), phase: u(s, slot + WANDER_PARTS + i) };
  });
  const scale = rms / Math.sqrt(parts.reduce((sum, p) => sum + (p.amplitude * p.amplitude) / 2, 0));
  return parts.map((p) => ({ ...p, amplitude: p.amplitude * scale }));
}

/**
 * A wander's value at timeline time `t`: cents for `flutter`, dB for `shimmer`.
 * @param {readonly WanderPart[]} parts
 * @param {number} t seconds
 */
export function wanderAt(parts, t) {
  let sum = 0;
  for (const { hz, amplitude, phase } of parts) {
    const x = hz * t + phase;
    sum += amplitude * Math.sin(2 * Math.PI * (x - Math.floor(x)));
  }
  return sum;
}

/**
 * A wander is computed at this many points a control-grid step, 200 a second, and the frames
 * between two points take the straight line between them, so they cost no `Math.sin` each.
 */
const WANDER_SEGMENTS = 20;

/**
 * The first frame of segment m of grid step k: the frame at or after the segment's start.
 * @param {number} k
 * @param {number} step frames a grid step
 * @param {number} m 0 to `WANDER_SEGMENTS`
 */
const segmentStart = (k, step, m) => k * step + Math.ceil((m * step) / WANDER_SEGMENTS);

/**
 * Fills `points` with a wander at grid step k's segment points, from the step's start to its
 * end: `wanderAt`, or with `lag`, how many seconds the pitch wander has moved the singer's phase
 * ahead, its integral times `LAG_PER_CENT`, so a singer at `hz` is `hz` × this many cycles
 * ahead. Each part's sine and cosine are taken at the step's start from timeline time and turned
 * through the segments by a fixed rotation, so a step costs four `Math.sin` or `Math.cos` a part
 * and its points depend on the step alone.
 * @param {Float64Array} points `WANDER_SEGMENTS` + 1
 * @param {number} k
 * @param {readonly WanderPart[]} parts
 * @param {boolean} lag
 */
function wanderPoints(points, k, parts, lag) {
  points.fill(0);
  const t = k / CONTROL_RATE;
  for (const { hz, amplitude, phase } of parts) {
    const x = hz * t + phase;
    const angle = 2 * Math.PI * (x - Math.floor(x));
    let sine = Math.sin(angle);
    let cosine = Math.cos(angle);
    const turn = (2 * Math.PI * hz) / (WANDER_SEGMENTS * CONTROL_RATE);
    const turnCos = Math.cos(turn);
    const turnSin = Math.sin(turn);
    // The integral of a sin(2π hz t + φ) is −a cos(2π hz t + φ) / (2π hz).
    const weight = lag ? -(LAG_PER_CENT * amplitude) / (2 * Math.PI * hz) : amplitude;
    for (let m = 0; m <= WANDER_SEGMENTS; m++) {
      points[m] = /** @type {number} */ (points[m]) + weight * (lag ? cosine : sine);
      const next = sine * turnCos + cosine * turnSin;
      cosine = cosine * turnCos - sine * turnSin;
      sine = next;
    }
  }
}

/**
 * The line through segment m's two points as α + β u, where u is a frame's place in the grid
 * step from 0 to 1, so a frame's value takes one multiply-add.
 * @param {Float64Array} points
 * @param {number} m
 */
function segmentLine(points, m) {
  const lo = /** @type {number} */ (points[m]);
  const rise = /** @type {number} */ (points[m + 1]) - lo;
  return { alpha: lo - m * rise, beta: WANDER_SEGMENTS * rise };
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
  const singers = Array.from({ length: self.singers }, (_, s) => ({
    ...(s === 0
      ? LEAD
      : {
          cents: self.spread * (2 * u(s, SLOT.cents) - 1),
          pan: (s % 2 === 1 ? 1 : -1) * self.pan * (1 - u(s, SLOT.pan) / 2),
          phase: u(s, SLOT.phase),
        }),
    flutter: wanderParts(u, s, SLOT.flutter, FLUTTER_CENTS * self.flutter),
    shimmer: wanderParts(u, s, SLOT.shimmer, SHIMMER_DB * self.shimmer),
  }));
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
        growl: values.growl,
      });
    }
    return /** @type {ChantControl} */ (controls[k]);
  };
  return {
    sampleRate,
    count: Math.floor(TOP_HZ / fundamental),
    halves: halfHarmonics(fundamental),
    tilt: self.tilt,
    swing: ROUGH_SWING * self.rough,
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
 * Fills `table` with two cycles of the growling voice, TABLE points and a last that repeats the
 * first: at point j, with α = 2πj / TABLE, the harmonics' sines at 2α, plus the half-integer
 * harmonics' cosines at odd multiples of α, all times 1 + swing·cos α. A quarter of the table is
 * summed, by the recurrences the lead uses, and the rest follows from symmetry: the integer sum
 * I repeats each cycle and I(TABLE/2 − j) = −I(j); the half-integer sum H is even and flips each
 * cycle, H(TABLE/2 − j) = −H(j).
 * @param {Float64Array} table TABLE + 1 points
 * @param {Float64Array} amplitudes
 * @param {Float64Array} half the half-integer harmonics' amplitudes, or empty when they are all 0
 * @param {number} swing
 */
function fillDoubleTable(table, amplitudes, half, swing) {
  const count = amplitudes.length;
  for (let j = 0; j <= TABLE / 4; j++) {
    const twoCos = 2 * /** @type {number} */ (TABLE_COS[2 * j]);
    let below = 0;
    let sine = /** @type {number} */ (TABLE_SIN[2 * j]);
    let integer = 0;
    for (let n = 0; n < count; n++) {
      integer += /** @type {number} */ (amplitudes[n]) * sine;
      const above = twoCos * sine - below;
      below = sine;
      sine = above;
    }
    const cosAlpha = /** @type {number} */ (TABLE_COS[j]);
    let lower = cosAlpha;
    let cosine = cosAlpha;
    let halves = 0;
    for (let m = 0; m < half.length; m++) {
      halves += /** @type {number} */ (half[m]) * cosine;
      const above = twoCos * cosine - lower;
      lower = cosine;
      cosine = above;
    }
    const up = 1 + swing * cosAlpha;
    const down = 1 - swing * cosAlpha;
    table[j] = (integer + halves) * up;
    table[TABLE / 2 - j] = -(integer + halves) * down;
    table[TABLE / 2 + j] = (integer - halves) * down;
    table[TABLE - j] = -(integer - halves) * up;
  }
}

/**
 * The chorus's waveform at `cycles` turns of the tables, read from the table either side of the
 * frame with linear interpolation and blended from `near` to `far` by the frame's place u.
 * @param {Float64Array} near
 * @param {Float64Array} far
 * @param {number} cycles
 * @param {number} u
 */
function tableAt(near, far, cycles, u) {
  const x = (cycles - Math.floor(cycles)) * TABLE;
  const j = Math.floor(x);
  const f = x - j;
  const n0 = /** @type {number} */ (near[j]);
  const n1 = /** @type {number} */ (near[j + 1]);
  const f0 = /** @type {number} */ (far[j]);
  const f1 = /** @type {number} */ (far[j + 1]);
  const now = n0 + f * (n1 - n0);
  const next = f0 + f * (f1 - f0);
  return now + u * (next - now);
}

/** The line of a singer without shimmer: a gain of exactly 1. */
const NO_LINE = Object.freeze({ alpha: 1, beta: 0 });

/**
 * Fills `terms` with q0, q1 and q2, so that q0 + u (q1 + u q2) is a singer's turns, divided by
 * `span`, at place u of a grid step, within one wander segment. The fundamental ramps linearly
 * over the step, from `hz` by `rise`, and turns `turns` + hz u / CONTROL_RATE + rise u² /
 * (2 CONTROL_RATE) cycles; the pitch wander adds its lag, α + β u over the segment, times the
 * frame's frequency. The rate of change of that product differs from the wander by the lag, at
 * most about 1 ms, times the bend's rate: 0.001 cents for a bend of 100 cents over two minutes.
 * @param {Float64Array} terms
 * @param {{ turns: number; hz: number; rise: number }} at the grid step
 * @param {{ alpha: number; beta: number }} line the lag over the segment
 * @param {{ ratio: number; phase: number; span: number }} singer its detune, phase and the span
 */
function phaseTerms(terms, { turns, hz, rise }, { alpha, beta }, { ratio, phase, span }) {
  terms[0] = (ratio * (turns + hz * alpha) + phase) / span;
  terms[1] = (ratio * (hz / CONTROL_RATE + hz * beta + rise * alpha)) / span;
  terms[2] = (ratio * (rise / (2 * CONTROL_RATE) + rise * beta)) / span;
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
 *
 * A grid step where the voice growls at either end, or any step of a rough voice, repeats every
 * two cycles: there the lead also sums the half-integer harmonics' cosines at odd multiples of
 * half its phase, α, by the same recurrence, and swings its level by 1 + swing·cos α; the
 * chorus's tables hold two cycles. Every other step computes the bits it would without growl.
 * @param {ChantTrack} track
 * @param {number} first
 * @param {number} frames
 * @returns {Float32Array<ArrayBuffer>[]} left and right
 */
export function chantChunk(track, first, frames) {
  const { sampleRate, count, halves, tilt, swing, pulse, singers } = track;
  const step = sampleRate / CONTROL_RATE;
  const end = first + frames;
  const scale = 1 / Math.sqrt(singers.length);
  const gains = singers.map((_, s) => singerGain(track, s, first, frames, scale));
  // Each singer's pitch wander's lag and level wander's gain at the step's segment points, filled
  // step by step, or null without the wander.
  const lags = singers.map(({ flutter }) =>
    flutter.length > 0 ? new Float64Array(WANDER_SEGMENTS + 1) : null,
  );
  const levels = singers.map(({ shimmer }) =>
    shimmer.length > 0 ? new Float64Array(WANDER_SEGMENTS + 1) : null,
  );
  /** The phase's three terms over a segment, from `phaseTerms`. */
  const terms = new Float64Array(3);
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
  let fromHalf = new Float64Array(halves);
  let toHalf = new Float64Array(halves);
  const slopeHalf = new Float64Array(halves);
  const noHalves = new Float64Array(0);
  let near = new Float64Array(chorus ? TABLE + 1 : 0);
  let far = new Float64Array(chorus ? TABLE + 1 : 0);
  /** Cycles the `near` table holds: 0 before it is filled. */
  let nearSpan = 0;
  /** @param {Float64Array} out @param {Float64Array} half @param {ChantControl} c */
  const amplitudes = (out, half, c) =>
    partialAmplitudes(out, half, {
      hz: c.hz,
      vowel: c.vowel,
      focus: c.focus,
      tilt,
      growl: c.growl,
      swing,
    });
  /**
   * @param {Float64Array} table
   * @param {Float64Array} amplitude
   * @param {Float64Array} half
   * @param {number} span
   * @param {boolean} growls
   */
  const fill = (table, amplitude, half, span, growls) =>
    span === 1
      ? fillTable(table, amplitude)
      : fillDoubleTable(table, amplitude, growls ? half : noHalves, swing);
  const k0 = Math.floor(first / step);
  amplitudes(from, fromHalf, track.control(k0));
  for (let k = k0; k * step < end; k++) {
    const a = track.control(k);
    const b = track.control(k + 1);
    amplitudes(to, toHalf, b);
    for (let n = 0; n < count; n++)
      slope[n] = /** @type {number} */ (to[n]) - /** @type {number} */ (from[n]);
    const growls = a.growl > 0 || b.growl > 0;
    const span = growls || swing > 0 ? 2 : 1;
    const halfCount = growls ? halves : 0;
    for (let m = 0; m < halfCount; m++)
      slopeHalf[m] = /** @type {number} */ (toHalf[m]) - /** @type {number} */ (fromHalf[m]);
    const turns = track.turns(k);
    const rise = b.hz - a.hz;
    const lo = Math.max(first, k * step);
    const hi = Math.min(end, (k + 1) * step);
    const lead = /** @type {Float64Array} */ (gains[0]);
    const { toLeft, toRight } = /** @type {(typeof sides)[number]} */ (sides[0]);
    singers.forEach(({ flutter, shimmer }, s) => {
      const lag = lags[s];
      const level = levels[s];
      if (lag) wanderPoints(lag, k, flutter, true);
      if (level) {
        wanderPoints(level, k, shimmer, false);
        for (let m = 0; m <= WANDER_SEGMENTS; m++)
          level[m] = dbToGain(/** @type {number} */ (level[m]));
      }
    });
    const leadLag = lags[0];
    const leadLevel = levels[0];
    const step0 = { turns, hz: a.hz, rise };
    // A singer without either wander sings the step in one piece.
    const leadPieces = leadLag || leadLevel ? WANDER_SEGMENTS : 1;
    for (let m = 0; m < leadPieces; m++) {
      if (leadLag)
        phaseTerms(terms, step0, segmentLine(leadLag, m), { ratio: 1, phase: 0, span: 1 });
      const [q0, q1, q2] = /** @type {[number, number, number]} */ (/** @type {unknown} */ (terms));
      // Without shimmer the wander's gain is 1 + 0u, exactly 1, so it changes no bits.
      const { alpha: g0, beta: g1 } = leadLevel ? segmentLine(leadLevel, m) : NO_LINE;
      const pieceEnd = leadPieces === 1 ? hi : Math.min(hi, segmentStart(k, step, m + 1));
      for (
        let i = leadPieces === 1 ? lo : Math.max(lo, segmentStart(k, step, m));
        i < pieceEnd;
        i++
      ) {
        const u = (i - k * step) / step;
        const out = i - first;
        let cycles;
        if (leadLag) cycles = q0 + u * (q1 + u * q2);
        else {
          const tau = u / CONTROL_RATE;
          // The phase of a frequency ramping from a.hz to b.hz over the step.
          cycles = turns + a.hz * tau + (rise * tau * u) / 2;
        }
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
        if (span === 2) {
          // cos((m+2)α) = 2cos 2α cos(mα) − cos((m−2)α), and 2α is θ.
          const pair = cycles / 2;
          const cosAlpha = Math.cos(2 * Math.PI * (pair - Math.floor(pair)));
          let lower = cosAlpha;
          let cosine = cosAlpha;
          for (let m = 0; m < halfCount; m++) {
            const amplitude =
              /** @type {number} */ (fromHalf[m]) + /** @type {number} */ (slopeHalf[m]) * u;
            sum += amplitude * cosine;
            const above = twoCos * cosine - lower;
            lower = cosine;
            cosine = above;
          }
          sum *= 1 + swing * cosAlpha;
        }
        const depth = a.depth + (b.depth - a.depth) * u;
        const dip = 0.5 + 0.5 * Math.cos((2 * Math.PI * pulse * i) / sampleRate);
        const level = dbToGain(-SWELL_DB * depth * dip);
        swell[out] = level;
        const value = sum * level * /** @type {number} */ (lead[out]) * (g0 + g1 * u);
        left[out] = /** @type {number} */ (left[out]) + toLeft * value;
        right[out] = /** @type {number} */ (right[out]) + toRight * value;
      }
    }
    if (chorus) {
      // `near` was filled for the step before; a step of another span refills it.
      if (nearSpan !== span) fill(near, from, fromHalf, span, growls);
      fill(far, to, toHalf, span, growls);
      for (let s = 1; s < singers.length; s++) {
        const ratio = /** @type {number} */ (ratios[s]);
        const { phase } = /** @type {Singer} */ (singers[s]);
        const gain = /** @type {Float64Array} */ (gains[s]);
        const side = /** @type {(typeof sides)[number]} */ (sides[s]);
        const lag = lags[s];
        const level = levels[s];
        if (!lag && !level) {
          for (let i = lo; i < hi; i++) {
            const u = (i - k * step) / step;
            const tau = u / CONTROL_RATE;
            // Turns of the table: a span of 1 divides exactly, leaving the cycles' bits as they are.
            const cycles = (ratio * (turns + a.hz * tau + (rise * tau * u) / 2) + phase) / span;
            const out = i - first;
            const value =
              tableAt(near, far, cycles, u) *
              /** @type {number} */ (swell[out]) *
              /** @type {number} */ (gain[out]);
            left[out] = /** @type {number} */ (left[out]) + side.toLeft * value;
            right[out] = /** @type {number} */ (right[out]) + side.toRight * value;
          }
          continue;
        }
        for (let m = 0; m < WANDER_SEGMENTS; m++) {
          if (lag) phaseTerms(terms, step0, segmentLine(lag, m), { ratio, phase, span });
          const [q0, q1, q2] = /** @type {[number, number, number]} */ (
            /** @type {unknown} */ (terms)
          );
          const { alpha: g0, beta: g1 } = level ? segmentLine(level, m) : NO_LINE;
          const pieceEnd = Math.min(hi, segmentStart(k, step, m + 1));
          for (let i = Math.max(lo, segmentStart(k, step, m)); i < pieceEnd; i++) {
            const u = (i - k * step) / step;
            const tau = u / CONTROL_RATE;
            const cycles = lag
              ? q0 + u * (q1 + u * q2)
              : (ratio * (turns + a.hz * tau + (rise * tau * u) / 2) + phase) / span;
            const out = i - first;
            const value =
              tableAt(near, far, cycles, u) *
              /** @type {number} */ (swell[out]) *
              /** @type {number} */ (gain[out]) *
              (g0 + g1 * u);
            left[out] = /** @type {number} */ (left[out]) + side.toLeft * value;
            right[out] = /** @type {number} */ (right[out]) + side.toRight * value;
          }
        }
      }
      [near, far] = [far, near];
      nearSpan = span;
    }
    [from, to] = [to, from];
    [fromHalf, toHalf] = [toHalf, fromHalf];
  }
  return [Float32Array.from(left), Float32Array.from(right)];
}

/**
 * Computing the voice in JS costs render time the node count doesn't show, in node-seconds at
 * 1.24e-4 s each. Measured on mbp2021 over 120 s renders beside a noise bed's known cost, the
 * lead took 0.94 to 7.4 ms a timeline second for 22 to 81 partials: about 0.11 ms a partial
 * (0.9 node-seconds) and 2.9 ms for the frame's sine, cosine and swell and the control samples
 * (23 node-seconds) (decision 0069). The chorus's tables take about 0.016 ms a partial (0.15),
 * and each chorus singer about 0.3 ms whatever its partials (3) (decision 0070). Timed alone,
 * the lead's half-integer harmonics take about 0.14 ms a partial (1.1), and its half phase's
 * cosine and swing a frame about 0.5 ms (4); a table of two cycles costs what one of one cycle
 * does for the same partials (decision 0088). A singer's shimmer, its points and a multiply-add
 * a frame, took about 0.017 ms (0.15); its flutter's points about 0.005 ms (0.05), and its phase
 * a frame, a quadratic with no division, took less than the plain phase, which isn't credited
 * (decision 0089).
 */
const PARTIAL_WEIGHT = 0.9;
const LEAD_WEIGHT = 23;
const TABLE_PARTIAL_WEIGHT = 0.15;
const CHORUS_WEIGHT = 3;
const HALF_PARTIAL_WEIGHT = 1.1;
const DOUBLE_WEIGHT = 4;
const FLUTTER_WEIGHT = 0.05;
const SHIMMER_WEIGHT = 0.15;

const MACROS = /** @type {MacroRow[]} */ ([
  { macro: MACRO.brightness, param: "vowel", depth: 0.25 },
  { macro: MACRO.motion, param: "depth", depth: 0.25 },
]);

/**
 * One buffer source a window, the JS mixing of every partial the lead sings, and with more than
 * one singer, the chorus's tables and each singer's reading of them, and each singer's wanders. A
 * voice whose growl rises above 0 anywhere is priced as growling throughout, so the cost bounds
 * its densest window.
 * @param {Voice} voice
 * @param {Genome} genome
 */
function cost(voice, genome) {
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const self = /** @type {ChantVoice} */ (/** @type {unknown} */ (voice));
  const fundamental = droneFundamental(pitch, self.root);
  const count = Math.floor(TOP_HZ / fundamental);
  const growls = highestValue(genome, self, "growl", PARAMS.growl, MACROS) > 0;
  const halves = growls ? halfHarmonics(fundamental) : 0;
  const doubled = growls || self.rough > 0;
  // A table of two cycles sums a quarter of its points for both kinds of harmonic, where one of
  // one cycle sums half its points for the integer ones alone.
  const tablePartials = doubled ? (count + halves) / 2 : count;
  const chorus =
    self.singers > 1
      ? TABLE_PARTIAL_WEIGHT * tablePartials + CHORUS_WEIGHT * (self.singers - 1)
      : 0;
  return (
    eventCost({ rate: 1 / WINDOW, seconds: WINDOW, nodes: 1 }) +
    LEAD_WEIGHT +
    PARTIAL_WEIGHT * count +
    HALF_PARTIAL_WEIGHT * halves +
    (doubled ? DOUBLE_WEIGHT : 0) +
    chorus +
    self.singers *
      ((self.flutter > 0 ? FLUTTER_WEIGHT : 0) + (self.shimmer > 0 ? SHIMMER_WEIGHT : 0))
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
  description: "a chant's low sung drone: harmonics, vowel formants, swell, breaths",
  params: PARAMS,
  macros: MACROS,
  /** Its partials' phase comes from timeline time. */
  longestEvent: () => 0,
  cost,
  build,
};
