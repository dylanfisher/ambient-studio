// Reads the production registry only, so every voice added to it counts toward the limit.
import { describe, expect, test } from "vitest";
import { GLOBAL_PARAMS, MACROS, VOICE_PARAMS } from "../../src/engine/genome-schema.js";
import { schemaText } from "../../src/engine/schema-text.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";

describe("schemaText", () => {
  test("stays under 3,000 characters for the full schema", () => {
    // Another test file's fixture voice would make this measure more than production holds.
    expect(voiceTypeIds()).not.toContain("fixture");
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

  test("gives each tuning's key range and scales", () => {
    const text = schemaText();
    expect(text).toMatch(/^ +12-tet,just-5-limit: key 0\.\.11; scale all\|ionian\|/m);
    expect(text).toMatch(/^ +19-edo: key 0\.\.18; scale all$/m);
    expect(text).toMatch(/^ +colundi: no key; scale all\|/m);
  });

  test("says trajectory times and voice start and end are timeline seconds, and gives the caps", () => {
    const text = schemaText();
    expect(text).toMatch(/^name~ .*up to 64.*timeline seconds/m);
    expect(text).toMatch(/^voices: up to 16 /m);
    expect(text).toMatch(/^ every voice, start and end in timeline seconds:$/m);
  });
});
