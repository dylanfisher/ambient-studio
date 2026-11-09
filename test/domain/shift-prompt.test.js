import { expect, test } from "vitest";
import { buildShiftPrompt, readShift } from "../../src/domain/shift-prompt.js";

const PATHS = ["macros.brightness", "macros.space"];
const answer = (/** @type {string} */ text) => ({ text, finishReason: "stop" });

test("the prompt lists each path with where the best sits, then the words", () => {
  const [system, user] = buildShiftPrompt({
    brief: "a cold drone",
    paths: PATHS,
    positions: [0.3, 0.75],
    words: "darker and bigger",
  });
  expect(system?.role).toBe("system");
  expect(system?.content).toMatch(/from -1\s+\(less of it\) to 1/);
  expect(user?.content).toBe(
    [
      "The brief: a cold drone",
      "The controls, and where the best so far sits on each:",
      "- macros.brightness: now 0.30 of 0 to 1",
      "- macros.space: now 0.75 of 0 to 1",
      "The listener's words: darker and bigger",
    ].join("\n"),
  );
});

test("an answer's shift is read, fenced or bare, its zeros dropped", () => {
  expect(
    readShift(
      answer('```json\n{"shift": {"macros.brightness": -0.5, "macros.space": 0}}\n```'),
      PATHS,
    ),
  ).toEqual({ ok: true, shift: { "macros.brightness": -0.5 } });
});

test.each([
  ['{"shift": {"macros.warmth": 1}}', /names macros.warmth/],
  ['{"shift": {"macros.space": 3}}', /from -1 to 1, got 3/],
  ['{"shift": {}, "why": "x"}', /the answer has why/],
  ["no object here", /./],
])("an answer %s is refused", (text, message) => {
  const read = readShift(answer(text), PATHS);
  expect(!read.ok && read.error).toMatch(message);
});

test("a cut-off answer is refused", () => {
  expect(readShift({ text: "{", finishReason: "length" }, PATHS)).toEqual({
    ok: false,
    error: "the answer was cut off",
  });
});
