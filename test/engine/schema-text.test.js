// Reads the production registry only, so every voice added to it counts toward the limit.
import { describe, expect, test } from "vitest";
import { GLOBAL_PARAMS, MACROS, VOICE_PARAMS } from "../../src/engine/genome-schema.js";
import { schemaText } from "../../src/engine/schema-text.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";

describe("schemaText", () => {
  test("stays under 3,000 characters for the full schema", () => {
    expect(schemaText().length).toBeLessThan(3000);
  });

  test("names every global parameter, macro, voice parameter and voice type", () => {
    const text = schemaText();
    const names = [
      ...Object.keys(GLOBAL_PARAMS),
      ...Object.keys(MACROS),
      ...Object.keys(VOICE_PARAMS),
      ...voiceTypeIds(),
    ];
    for (const name of names)
      expect(text).toMatch(new RegExp(`(^ *(type )?"?|[{,])${name}\\b`, "m"));
  });

  test("gives each parameter's range, unit and default, and marks trajectories", () => {
    const text = schemaText();
    expect(text).toMatch(/^loudness -30\.\.-9 LUFS =-16 /m);
    expect(text).toMatch(/^reverbLevel~ -30\.\.-6 dB =-12 /m);
    expect(text).toMatch(/^pulse none\|beat =none /m);
  });
});
