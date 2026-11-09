// Reads the production registry only, so every voice added to it counts toward the limit.
import { describe, expect, test } from "vitest";
import { GLOBAL_PARAMS, MACROS, VOICE_PARAMS } from "../../src/engine/genome-schema.js";
import { recordingVoiceText, schemaText } from "../../src/engine/schema-text.js";
import { selfContainedVoiceTypeIds, voiceTypeIds } from "../../src/engine/voice-registry.js";

describe("schemaText", () => {
  // The token checks in build-prompt.test.js guard the prompt's room; this limit makes the next
  // voice that grows the text say why (decision 0072).
  test("stays under 4,100 characters for the full schema", () => {
    // Another test file's fixture voice would make this measure more than production holds.
    expect(voiceTypeIds()).not.toContain("fixture");
    expect(schemaText().length).toBeLessThan(4100);
  });

  test("says what the chant, cymbal and drum are for", () => {
    const text = schemaText();
    expect(text).toMatch(/^ type "chant": a chant's low sung drone: /m);
    expect(text).toMatch(/^ type "cymbal": sparse bright accents: /m);
    expect(text).toMatch(/^ type "drum": sparse low accents: /m);
  });

  // Phase CG's acceptance 7: the model can use the chant's growl and breath.
  test("lists phase CG's chant parameters on the chant's lines", () => {
    const [, chant = ""] = schemaText().split(/^ type "chant".*$/m);
    const lines = chant.split(/^ type /m)[0] ?? "";
    for (const name of [
      "growl",
      "rough",
      "flutter",
      "shimmer",
      "aspiration",
      "breathiness",
      "narrow",
    ])
      expect(lines).toMatch(new RegExp(`^ {2}${name} 0\\.\\.1 =0 `, "m"));
  });

  test("names every global parameter, macro, voice parameter and voice type", () => {
    const text = schemaText();
    const names = [
      ...Object.keys(GLOBAL_PARAMS),
      ...Object.keys(MACROS),
      ...Object.keys(VOICE_PARAMS),
      ...selfContainedVoiceTypeIds(),
    ];
    for (const name of names)
      expect(text).toMatch(new RegExp(`(^ *(type )?"?|[{,])${name}\\b`, "m"));
  });

  test("gives each parameter's range, unit and default, and marks trajectories", () => {
    const text = schemaText();
    expect(text).toMatch(/^loudness -30\.\.-10 LUFS =-16 /m);
    expect(text).toMatch(/^reverbLevel -30\.\.-6 dB =-12 \(T\) reverb wet level$/m);
    expect(text).toMatch(/^macros\.\{brightness,[a-z,]+\} 0\.\.1 =0\.5 \(T\) /m);
    expect(text).toMatch(/^ {2}cutoff 100\.\.2000 Hz =600 \(T\) low-pass$/m);
    expect(text).toMatch(/^\(T\) = may be a trajectory: /m);
    expect(text).toMatch(/^pulse none\|beat =none /m);
  });

  // A model wrote `"cutoff": [[0,120],[300,250]]`, a bare array, for a trajectory.
  test("shows a trajectory as an object with a points key, never a bare array", () => {
    const text = schemaText();
    expect(text).toContain('"cutoff": {"points": [[0, 400], [300, 900]]}');
    expect(text).toMatch(/^\(T\) .*never a bare array/m);
  });

  test("gives each tuning's key range and scales, naming each tuning once", () => {
    const text = schemaText();
    expect(text).toMatch(/^tuning =12-tet, one of:$/m);
    expect(text.match(/bohlen-pierce/g)).toHaveLength(1);
    expect(text).toMatch(/^ +12-tet,just-5-limit: key 0\.\.11; scale all\|ionian\|/m);
    expect(text).toMatch(/^ +19-edo: key 0\.\.18; scale all$/m);
    expect(text).toMatch(/^ +colundi: no key; scale all\|/m);
  });

  test("says trajectory times and voice start and end are timeline seconds, and gives the caps", () => {
    const text = schemaText();
    expect(text).toMatch(/^\(T\) .*up to 64.*timeline seconds/m);
    expect(text).toMatch(/^voices: up to 16 /m);
    expect(text).toMatch(/^ every voice, start and end in timeline seconds:$/m);
  });

  // A model copied a `~` written after the key into the key (`cutoff~`), so the trajectory mark
  // stands apart from the name, after the default.
  test("joins no mark to a parameter's name", () => {
    for (const text of [schemaText(), recordingVoiceText()]) {
      expect(text).not.toContain("~");
      for (const row of text.split("\n")) expect(row).not.toMatch(/^ *[\w.{},]+\(T\)/);
    }
  });

  test("leaves out the recording voice, whose lines come apart for the prompt to add", () => {
    expect(voiceTypeIds()).toContain("recording");
    expect(schemaText()).not.toMatch(/"recording"/);
    const text = recordingVoiceText();
    expect(text).toMatch(/^ type "recording": /);
    expect(text).toMatch(/^ {2}recording sha256 required /m);
    expect(text).toMatch(/^ {2}cutoff 100\.\.20000 Hz =20000 \(T\) /m);
    // The prompt adds these lines and the list to the base text's 4,100.
    expect(text.length).toBeLessThan(600);
  });
});
