// A follow-up turn on a sent prompt (decision 0036): the repair and the revision both add one.
import { expect, test } from "vitest";
import { followUp } from "../../src/domain/follow-up.js";

const messages = /** @type {const} */ ([
  { role: "system", content: "the system message" },
  { role: "user", content: "the vibe" },
]);

test("keeps the prompt's turns, adds the answer as compact JSON, then the ask", () => {
  const answer = { intent: "a drone", genome: { loudness: -16 } };
  const turns = followUp([...messages], answer, "Change one thing.");
  expect(turns).toEqual([
    ...messages,
    { role: "assistant", content: '{"intent":"a drone","genome":{"loudness":-16}}' },
    { role: "user", content: "Change one thing." },
  ]);
});

test("leaves the prompt it was given as it was", () => {
  const prompt = [...messages];
  followUp(prompt, {}, "Again.");
  expect(prompt).toEqual(messages);
});
