// The repair round's prompt: the first prompt, the model's answer, and every error quoted
// (decision 0024).
import { expect, test } from "vitest";
import { buildRepairPrompt } from "../../src/domain/build-repair-prompt.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };

const messages = /** @type {const} */ ([
  { role: "system", content: "the system message" },
  { role: "user", content: "the vibe" },
]);
const answer = { intent: "a drone", genome: droneGenome };

test("keeps the first prompt, quotes the answer as compact JSON, then lists every error", () => {
  const repair = buildRepairPrompt({ messages: [...messages], answer }, [
    { path: "$.voices[0].level", message: "must be from -60 to 0 dB, got 3" },
    { path: "$.loudness", rule: "loudness", message: "must be -16 LUFS, got -20" },
  ]);
  expect(repair.slice(0, 2)).toEqual(messages);
  expect(repair[2]).toEqual({ role: "assistant", content: JSON.stringify(answer) });
  expect(repair[3]?.role).toBe("user");
  const asked = repair[3]?.content ?? "";
  expect(asked).toContain("- $.voices[0].level: must be from -60 to 0 dB, got 3");
  expect(asked).toContain("- $.loudness (loudness): must be -16 LUFS, got -20");
  expect(asked).toContain('{"intent":');
  expect(repair).toHaveLength(4);
});

test("refuses to build a repair with no errors to quote", () => {
  expect(() => buildRepairPrompt({ messages: [...messages], answer }, [])).toThrow(
    "a repair prompt needs at least one error to quote",
  );
});
