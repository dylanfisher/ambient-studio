import { expect, test } from "vitest";
import { lockChoices } from "../../src/domain/lock-choices.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { MACROS } from "../../src/engine/genome-schema.js";
import pad from "../../src/engine/genomes/pad.json" with { type: "json" };
import { validateGenome } from "../../src/engine/validate-genome.js";

const checked = validateGenome(pad);
if (!checked.ok) throw new Error("the pad example genome is invalid");
const genome = checked.genome;

test("lists the whole piece's values, the macros, and each voice whole and by parameter", () => {
  const groups = lockChoices(genome);
  expect(groups.map((group) => group.label)).toEqual([
    "The whole piece",
    "Macros",
    ...genome.voices.map((voice) => `Voice ${voice.id} (a ${voice.type} voice)`),
  ]);
  const [piece, macros, firstVoice] = groups;
  expect(piece?.choices.map((choice) => choice.path)).toContain("reverbDecay");
  expect(macros?.choices.map((choice) => choice.path)).toEqual(
    Object.keys(MACROS).map((name) => `macros.${name}`),
  );
  const voice = /** @type {any} */ (genome.voices[0]);
  expect(firstVoice?.choices[0]).toEqual({
    path: `voices.${voice.id}`,
    label: `the whole ${voice.id} voice, every parameter`,
  });
  expect(firstVoice?.choices.map((choice) => choice.path)).toContain(`voices.${voice.id}.level`);
});

test("every path offered can be locked on the genome it was listed from", () => {
  for (const { choices } of lockChoices(genome)) {
    for (const { path, label } of choices) {
      expect(lockOn(genome, path).ok, path).toBe(true);
      expect(label.length, path).toBeGreaterThan(0);
    }
  }
});
