// The pad: chords of 3 to 7 notes from the genome's scale, each note one oscillator whose few
// harmonic partials sit in one PeriodicWave, shaped by an ADSR on its gain, and the whole voice
// swelling up and down on a slow cycle. A new chord starts every `hold` seconds on a grid from
// timeline 0 and crossfades with the last one's release. A render that starts while chords
// sound starts them on its first frame with the phase and gain they have reached by then, as
// the drone does, so an excerpt needs no pre-roll for them (decision 0013).
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Resolved } from "./effective-params.js" */
/** @import { Genome, Voice, VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { Pitch } from "./pitch.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { eventCost } from "./cost-unit.js";
import { dbToGain } from "./decibels.js";
import { int, number } from "./descriptor.js";
import { effectiveParams } from "./effective-params.js";
import { MACRO } from "./macro-table.js";
import { phasedOscillator } from "./phased-wave.js";
import { resolvePitch, tuningFrequencies } from "./pitch.js";
import { draw } from "./prng.js";
import { centsToRatio } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";

const PARAMS = Object.freeze({
  notes: int({ min: 3, max: 7, default: 5, unit: "", safe: [3, 5], description: "per chord" }),
  hold: number({
    min: 20,
    max: 60,
    default: 30,
    unit: "s",
    scale: "log",
    description: "chord length",
  }),
  attack: number({
    min: 2,
    max: 20,
    default: 8,
    unit: "s",
    scale: "log",
    safe: [4, 20],
    description: "rise",
  }),
  release: number({
    min: 4,
    max: 30,
    default: 12,
    unit: "s",
    scale: "log",
    safe: [8, 30],
    description: "fade",
  }),
  tone: number({
    min: 3,
    max: 12,
    default: 9,
    unit: "dB",
    trajectory: true,
    safe: [8, 12],
    description: "per harmonic octave",
  }),
  swell: number({
    min: 20,
    max: 90,
    default: 45,
    unit: "s",
    scale: "log",
    description: "cycle",
  }),
  swing: number({
    min: 0,
    max: 20,
    default: 10,
    unit: "dB",
    trajectory: true,
    safe: [6, 12],
    description: "depth",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} PadVoice */

/** The register chord notes come from, in Hz. */
export const BAND = Object.freeze({ lo: 100, hi: 500 });
/** Harmonics in each note's PeriodicWave. */
const HARMONICS = 4;
/** Each note's level after the decay, against its peak. */
const SUSTAIN = 0.7;
/** The decay from the peak to the sustain lasts this share of the attack. */
const DECAY_SHARE = 0.5;
/** Long-lived panners; note j of chord k plays through panner (j + k) mod 3. */
const PANS = Object.freeze([-0.5, 0, 0.5]);
/** Per-chord draws (decision 0003): the chord's lowest note, then one detune per note. */
const SLOT = Object.freeze({ root: 1, detune: 2 });

/**
 * The notes of chord `index`: `notes` scale notes from 100 to 500 Hz, stacked on every other
 * scale note (thirds in a seven-note scale) from a root drawn from the seed, or on neighbors
 * when the band holds too few for that. A band with fewer than `notes` scale notes plays all
 * of them.
 * @param {Pitch} pitch
 * @param {number} notes
 * @param {number} seed
 * @param {string} voiceId
 * @param {number} index the chord's slot on the voice's grid
 * @returns {number[]} Hz, rising
 */
export function padChord(pitch, notes, seed, voiceId, index) {
  const band = tuningFrequencies(pitch, BAND.lo, BAND.hi);
  if (band.length === 0) {
    throw new Error(`pad: the scale has no note from ${BAND.lo} to ${BAND.hi} Hz`);
  }
  const count = Math.min(notes, band.length);
  const step = band.length >= 2 * count - 1 ? 2 : 1;
  const span = step * (count - 1) + 1;
  const root = Math.floor(draw(seed, voiceId, index, SLOT.root) * (band.length - span + 1));
  return Array.from({ length: count }, (_, j) => /** @type {number} */ (band[root + step * j]));
}

/**
 * A note's gain as breakpoints `[seconds from its start, gain]`, joined by straight lines: up
 * to 1 over `attack`, down to the sustain over half the attack, held to `hold`, and to 0 over
 * `release`. When the chord ends before the decay does, the release starts from wherever the
 * gain has reached.
 * @param {number} attack
 * @param {number} hold
 * @param {number} release
 * @returns {[number, number][]}
 */
export function padEnvelope(attack, hold, release) {
  /** @type {[number, number][]} */
  const rise = [
    [0, 0],
    [attack, 1],
    [attack * (1 + DECAY_SHARE), SUSTAIN],
  ];
  const kept = rise.filter(([time]) => time < hold);
  const [t0, v0] = /** @type {[number, number]} */ (kept.at(-1));
  const next = rise[kept.length];
  const atHold = next ? v0 + ((next[1] - v0) * (hold - t0)) / (next[0] - t0) : v0;
  return [...kept, [hold, atHold], [hold + release, 0]];
}

/**
 * The envelope's gain `time` seconds after the note's start.
 * @param {readonly [number, number][]} envelope breakpoints from `padEnvelope`
 * @param {number} time
 */
function envelopeAt(envelope, time) {
  const next = envelope.findIndex(([t]) => t > time);
  // Before the first point and after the last, the note is silent.
  if (next <= 0) return 0;
  const [t0, v0] = /** @type {[number, number]} */ (envelope[next - 1]);
  const [t1, v1] = /** @type {[number, number]} */ (envelope[next]);
  return v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
}

/**
 * The sine amplitudes of harmonics 1 to 4 at indices 1 to 4, falling `tone` dB per octave and
 * summing to 1.
 * @param {number} tone
 */
function harmonicGains(tone) {
  const gains = Array.from({ length: HARMONICS }, (_, i) => dbToGain(-tone * Math.log2(i + 1)));
  const total = gains.reduce((sum, g) => sum + g, 0);
  return Float32Array.of(0, ...gains.map((g) => g / total));
}

/**
 * The swell's gain: 0 dB at timeline 0, down `swing` dB half a cycle later.
 * @param {number} swing dB
 * @param {number} period seconds
 * @param {number} time timeline seconds
 */
const swellGain = (swing, period, time) =>
  dbToGain((-swing * (1 - Math.cos((2 * Math.PI * time) / period))) / 2);

/**
 * The groups of envelope gains a pad's chords take turns on: enough that a group is free again
 * by the time its next chord starts, rounded up to a multiple of the pan count.
 * @param {PadVoice} pad
 */
function chordGroups(pad) {
  const overlapping = Math.ceil((pad.hold + pad.release) / pad.hold);
  return PANS.length * Math.ceil(overlapping / PANS.length);
}

/**
 * The note whose envelope gain note `j` shares: notes `j` and `j + PANS.length` share one when
 * `j / PANS.length` rounds down to an even number, so a gain carries one note or two, panned
 * the same.
 * @param {number} j
 */
const sharedWith = (j) => j - PANS.length * (Math.floor(j / PANS.length) % 2);

/**
 * The envelope gains in a group: one for each note that doesn't share another's.
 * @param {PadVoice} pad
 */
const gainsPerGroup = (pad) =>
  Array.from({ length: pad.notes }, (_, j) => j).filter((j) => sharedWith(j) === j).length;

/**
 * The swell gain, the panners and the envelope gains live through the render; each chord's
 * notes are an oscillator each, from the chord's start to the end of its release (decision
 * 0010).
 * @param {Voice} voice
 */
function cost(voice) {
  const pad = /** @type {PadVoice} */ (/** @type {unknown} */ (voice));
  const chord = eventCost({
    rate: 1 / pad.hold,
    seconds: pad.hold + pad.release,
    nodes: pad.notes,
  });
  return 1 + PANS.length + chordGroups(pad) * gainsPerGroup(pad) + chord;
}

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, genome, voice, seed, from, startFrame, at, automate }) {
  const pad = /** @type {PadVoice} */ (/** @type {unknown} */ (voice));
  const index = genome.voices.indexOf(voice);
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const rate = ctx.sampleRate;

  const swell = ctx.createGain();
  automate(swell.gain, (self, time) =>
    swellGain(/** @type {number} */ (self.swing), pad.swell, time),
  );
  swell.connect(output);
  const panners = PANS.map((pan) => {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(swell);
    return panner;
  });
  const envelope = padEnvelope(pad.attack, pad.hold, pad.release);
  const length = pad.hold + pad.release;
  // Chord c's notes play through group c % groups of envelope gains that live through the
  // render, which carry its envelope. A group carries one chord at a time, and each gain at
  // most two notes, whose sum doesn't depend on the order the library adds them in (see
  // event-slots.js for why that order can change). `groups` is a multiple of the pan count, so
  // a gain feeds the one panner every chord it carries pans its notes to.
  const groups = chordGroups(pad);
  const envelopeGains = Array.from({ length: groups }, (_, group) =>
    Array.from({ length: pad.notes }, (_, j) => {
      if (sharedWith(j) !== j) return undefined;
      const gain = ctx.createGain();
      gain.connect(/** @type {AudioNode} */ (panners[(j + group) % PANS.length]));
      return gain;
    }),
  );
  /** @param {number} frame a timeline frame */
  const frameTime = (frame) => at(from) + (frame - startFrame) / rate;

  /**
   * Plays chord `chord` from its first frame, or from the render's first frame with the phase
   * and gain it has reached when it started before the render.
   * @param {number} chord
   * @param {number} frame the chord's first timeline frame
   */
  function play(chord, frame) {
    const self = /** @type {Resolved<PadVoice>} */ (
      /** @type {unknown} */ (effectiveParams(genome, frame / rate).voices[index])
    );
    const gains = harmonicGains(self.tone);
    const notes = padChord(pitch, pad.notes, seed, voice.id, chord);
    const begin = Math.max(frame, startFrame);
    const elapsed = (begin - frame) / rate;
    const start = frameTime(frame);
    const group = /** @type {(GainNode | undefined)[]} */ (envelopeGains[chord % groups]);
    for (const gain of group) {
      if (!gain) continue;
      gain.gain.setValueAtTime(envelopeAt(envelope, elapsed) / notes.length, frameTime(begin));
      for (const [time, value] of envelope) {
        if (time > elapsed) gain.gain.linearRampToValueAtTime(value / notes.length, start + time);
      }
    }
    notes.forEach((hz, j) => {
      const cents = (draw(seed, voice.id, chord, SLOT.detune + j) * 2 - 1) * pad.detune;
      const oscillator = phasedOscillator(ctx, gains, hz * centsToRatio(cents), elapsed);
      oscillator.connect(/** @type {GainNode} */ (group[sharedWith(j)]));
      oscillator.start(frameTime(begin));
      oscillator.stop(start + length);
    });
  }

  return (windowFrom, windowTo) => {
    // The render's first window also plays the chords still sounding from before it.
    const earliest = windowFrom === from ? windowFrom - length : windowFrom;
    for (let chord = Math.max(0, Math.ceil(earliest / pad.hold) - 1); ; chord++) {
      // Chords start on whole frames, so an excerpt places them where a full render does.
      const frame = Math.ceil(chord * pad.hold * rate);
      const time = frame / rate;
      if (time >= windowTo) break;
      if (time < earliest || time + length <= Math.max(windowFrom, pad.start)) continue;
      if (time >= pad.end) continue;
      play(chord, frame);
    }
  };
}

export const pad = {
  type: "pad",
  description: "sine chords, ADSR, swell",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([
    { macro: MACRO.brightness, param: "tone", depth: -0.25 },
    { macro: MACRO.motion, param: "swing", depth: 0.25 },
  ]),
  /** Chords sounding at a render's start start there, with their phase from timeline time. */
  longestEvent: () => 0,
  cost,
  build,
};
