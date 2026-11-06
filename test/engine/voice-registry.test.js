import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { number } from "../../src/engine/descriptor.js";
import {
  findVoiceType,
  registerVoice,
  unregisterVoice,
  voiceTypeIds,
} from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

const gain = number({ min: 0, max: 1, default: 0.5, unit: "", description: "x" });
const swell = number({
  min: 0,
  max: 1,
  default: 0.5,
  unit: "",
  trajectory: true,
  description: "x",
});

// What every voice type needs to render, taken from the fixture for the ad hoc types below.
const { longestEvent, cost, build } = fixtureVoice;

beforeAll(() => registerVoice(fixtureVoice));
afterAll(() => unregisterVoice(fixtureVoice.type));

describe("the voice registry", () => {
  test("a registered voice is found by its type", () => {
    expect(voiceTypeIds()).toContain("fixture");
    expect(findVoiceType("fixture")).toBe(fixtureVoice);
    expect(findVoiceType("nope")).toBeUndefined();
  });

  test("a type registered twice throws", () => {
    expect(() => registerVoice({ ...fixtureVoice })).toThrow(/"fixture" is already registered/);
  });

  test("a parameter named like a common one or a voice key throws", () => {
    for (const name of ["level", "id"]) {
      const voice = {
        type: `bad-${name}`,
        description: "x",
        params: { [name]: gain },
        macros: [],
        longestEvent,
        cost,
        build,
      };
      expect(() => registerVoice(voice)).toThrow(`"${name}" is a parameter every voice has`);
    }
  });

  test("an unregistered voice is gone, and unregistering an unknown type throws", () => {
    const voice = {
      type: "passing",
      description: "x",
      params: { gain },
      macros: [],
      longestEvent,
      cost,
      build,
    };
    registerVoice(voice);
    unregisterVoice("passing");
    expect(findVoiceType("passing")).toBeUndefined();
    expect(() => unregisterVoice("passing")).toThrow(/"passing" is not registered/);
  });

  test.each([
    [
      "an unknown macro",
      { macro: "sparkle", param: "gain", depth: 0.2 },
      /unknown macro "sparkle"/,
    ],
    ["an unknown parameter", { macro: "space", param: "nope", depth: 0.2 }, /no parameter "nope"/],
    [
      "a parameter that can't be a trajectory",
      { macro: "space", param: "detune", depth: 0.2 },
      /"detune" can't be a trajectory/,
    ],
    ["a depth over 1", { macro: "space", param: "gain", depth: 1.5 }, /depth must be/],
    ["a depth of 0", { macro: "space", param: "gain", depth: 0 }, /depth must be/],
  ])("a macro row with %s throws", (_, row, message) => {
    const voice = { type: "rows", description: "x", params: { gain: swell }, macros: [row] };
    expect(() => registerVoice(/** @type {any} */ (voice))).toThrow(message);
    expect(findVoiceType("rows")).toBeUndefined();
  });

  test("two rows for the same macro and parameter throw", () => {
    const row = { macro: /** @type {const} */ ("space"), param: "level", depth: 0.2 };
    const voice = {
      type: "twice",
      description: "x",
      params: { gain },
      macros: [row, row],
      longestEvent,
      cost,
      build,
    };
    expect(() => registerVoice(voice)).toThrow(/"space" → "level" is listed twice/);
  });
});
