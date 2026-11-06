import { describe, expect, test } from "vitest";
import { number } from "../../src/engine/descriptor.js";
import { findVoiceType, registerVoice, voiceTypeIds } from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

const gain = number({ min: 0, max: 1, default: 0.5, unit: "", description: "x" });

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
      const voice = { type: `bad-${name}`, description: "x", params: { [name]: gain } };
      expect(() => registerVoice(voice)).toThrow(`"${name}" is a parameter every voice has`);
    }
  });
});
