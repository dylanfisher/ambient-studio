/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { NumberDescriptor } from "../../src/engine/descriptor.js" */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { encode } from "../../src/engine/descriptor.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { GLOBAL_PARAMS, MACROS, VOICE_PARAMS } from "../../src/engine/genome-schema.js";
import { GLOBAL_MACRO_ROWS } from "../../src/engine/macro-table.js";
import { validateGenome } from "../../src/engine/validate-genome.js";
import { registerVoice, unregisterVoice } from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

beforeAll(() => registerVoice(fixtureVoice));
afterAll(() => unregisterVoice(fixtureVoice.type));

/** @param {unknown} value @returns {Genome} */
function valid(value) {
  const result = validateGenome(value);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.genome;
}

/** @param {Record<string, unknown>} macros @param {Record<string, unknown>} [voice] */
const genome = (macros, voice = {}) =>
  valid({ macros, voices: [{ id: "a", type: "fixture", ...voice }] });

const voiceTable = /** @type {Record<string, NumberDescriptor>} */ (
  /** @type {unknown} */ ({ ...VOICE_PARAMS, ...fixtureVoice.params })
);
const globalTable = /** @type {Record<string, NumberDescriptor>} */ (
  /** @type {unknown} */ (GLOBAL_PARAMS)
);

describe("effectiveParams", () => {
  test("with every macro at 0.5, effective values equal raw values exactly", () => {
    const raw = genome({}, { cutoff: 731.3, level: -17.25 });
    expect(effectiveParams(raw, 0)).toEqual(raw);
    expect(effectiveParams(raw, 450)).toEqual(raw);
  });

  test("evaluates trajectories at the time given", () => {
    const raw = genome(
      {},
      {
        cutoff: {
          points: [
            [0, 200],
            [100, 800],
          ],
        },
      },
    );
    expect(effectiveParams(raw, 0).voices[0]?.cutoff).toBe(200);
    expect(effectiveParams(raw, 50).voices[0]?.cutoff).toBeCloseTo(400, 9);
    expect(effectiveParams(raw, 300).voices[0]?.cutoff).toBe(800);
  });

  test("a macro at 1 moves each parameter it maps by its depth along the parameter's scale", () => {
    const rows = [
      ...GLOBAL_MACRO_ROWS.map((row) => ({ ...row, voice: false })),
      ...fixtureVoice.macros.map((row) => ({ ...row, voice: true })),
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const macro of Object.keys(MACROS)) {
      const raw = genome({});
      const moved = effectiveParams(genome({ [macro]: 1 }), 0);
      for (const name of new Set(rows.filter((r) => r.macro === macro).map((r) => r.param))) {
        const onVoice = rows.some((r) => r.param === name && r.voice);
        const descriptor = (onVoice ? voiceTable : globalTable)[name];
        if (!descriptor) throw new Error(`no descriptor for ${name}`);
        const depth = rows
          .filter((r) => r.macro === macro && r.param === name)
          .reduce((sum, r) => sum + r.depth, 0);
        const read = (/** @type {unknown} */ values) =>
          /** @type {number} */ (/** @type {Record<string, unknown>} */ (values)[name]);
        const before = read(onVoice ? raw.voices[0] : raw);
        const after = read(onVoice ? moved.voices[0] : moved);
        const expected = Math.min(1, Math.max(0, encode(descriptor, before) + depth));
        expect(encode(descriptor, after)).toBeCloseTo(expected, 9);
      }
    }
  });

  test("a macro at 0 moves the other way, and offsets from several macros add", () => {
    const cutoff = fixtureVoice.params.cutoff;
    const at = (/** @type {Record<string, number>} */ macros) =>
      encode(cutoff, /** @type {number} */ (effectiveParams(genome(macros), 0).voices[0]?.cutoff));
    const raw = encode(cutoff, 600);
    expect(at({ brightness: 0 }) - raw).toBeCloseTo(-0.25, 9);
    expect(at({ brightness: 0.75 }) - raw).toBeCloseTo(0.125, 9);
    expect(at({ brightness: 1, warmth: 1 }) - raw).toBeCloseTo(0.15, 9);
  });

  test("clamps at the range", () => {
    const top = effectiveParams(genome({ brightness: 1 }, { cutoff: 1900 }), 0);
    expect(top.voices[0]?.cutoff).toBe(2000);
    const loud = effectiveParams(genome({ density: 1 }, { level: -6 }), 0);
    expect(loud.voices[0]?.level).toBe(0);
    const quiet = effectiveParams(genome({ density: 0 }, { level: -55 }), 0);
    expect(quiet.voices[0]?.level).toBe(-60);
  });

  test("a macro trajectory moves its parameters over time", () => {
    const brightness = {
      points: [
        [0, 0.5],
        [100, 1],
      ],
    };
    const g = genome({ brightness });
    expect(effectiveParams(g, 0).voices[0]?.cutoff).toBe(600);
    const later = /** @type {number} */ (effectiveParams(g, 100).voices[0]?.cutoff);
    expect(encode(fixtureVoice.params.cutoff, later)).toBeCloseTo(
      encode(fixtureVoice.params.cutoff, 600) + 0.25,
      9,
    );
    expect(effectiveParams(g, 100).macros.brightness).toBe(1);
  });

  test("a time before 0 or not finite throws", () => {
    expect(() => effectiveParams(genome({}), -1)).toThrow(/time/);
    expect(() => effectiveParams(genome({}), Number.NaN)).toThrow(/time/);
  });
});
