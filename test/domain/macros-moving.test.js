// Which macros move a locked value (decision 0035), read from the macro rows (0006), for the
// lock control's offer to lock them too.
import { describe, expect, test } from "vitest";
import { macrosMoving } from "../../src/domain/macros-moving.js";
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import { GLOBAL_MACRO_ROWS } from "../../src/engine/macro-table.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { requireVoiceType } from "../../src/engine/voice-registry.js";

const genome = requireGenome(exampleGenome, "example genome");

describe("macrosMoving", () => {
  test("a global parameter: the global rows that name it", () => {
    expect(GLOBAL_MACRO_ROWS.some((row) => row.param === "reverbLevel")).toBe(true);
    expect(macrosMoving("reverbLevel", genome)).toEqual(["space"]);
    expect(macrosMoving("reverbDecay", genome)).toEqual([]);
  });

  test("a voice parameter: its type's rows that name it", () => {
    expect(requireVoiceType("drone").macros.map((r) => [r.macro, r.param])).toContainEqual([
      "brightness",
      "cutoff",
    ]);
    expect(macrosMoving("voices.drone.cutoff", genome)).toEqual(["brightness"]);
    expect(macrosMoving("voices.pad.swing", genome)).toEqual(["motion"]);
    expect(macrosMoving("voices.pad.hold", genome)).toEqual([]);
  });

  test("a whole voice: every macro its type's rows name, in the macros' order", () => {
    const rows = requireVoiceType("bell").macros;
    const expected = ["brightness", "density", "motion", "space", "warmth", "tension"].filter(
      (macro) => rows.some((row) => row.macro === macro),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(macrosMoving("voices.bell", genome)).toEqual(expected);
  });

  test("a macro moves nothing but itself", () => {
    expect(macrosMoving("macros.space", genome)).toEqual([]);
  });

  test("throws on a path the genome has no voice for", () => {
    expect(() => macrosMoving("voices.choir.level", genome)).toThrow(/no voice "choir"/);
  });
});
