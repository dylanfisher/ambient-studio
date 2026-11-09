// The check on the words operator's answer (decision 0084): only `changes` and `said`, each
// change naming a field asked about with a value its descriptor allows, and `said` a sentence;
// every finding with its JSON path. A cut-off answer, or one with no single object, is rejected
// with nothing to repair.
import { expect, test } from "vitest";
import { checkWords, judgeWords } from "../../src/domain/check-words.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { choice, int, number } from "../../src/engine/descriptor.js";

const FIELDS = [
  {
    name: "level",
    descriptor: number({ min: 0, max: 1, default: 0.5, unit: "", description: "how loud" }),
    current: 0.5,
  },
  {
    name: "voices",
    descriptor: int({ min: 1, max: 6, default: 2, unit: "", description: "how many" }),
    current: 2,
  },
  {
    name: "pulse",
    descriptor: choice({ values: ["none", "beat"], default: "none", description: "the pulse" }),
    current: "none",
  },
];

const answer = (/** @type {unknown} */ value) => ({
  text: JSON.stringify(value),
  finishReason: "stop",
});

test("a valid answer passes as it was given, fenced or bare", () => {
  const given = { changes: { level: 0.8, pulse: "beat" }, said: "Louder, with a beat." };
  expect(checkWords(given, FIELDS)).toEqual({
    ok: true,
    changes: given.changes,
    said: given.said,
  });
  const fenced = { text: `\`\`\`json\n${JSON.stringify(given)}\n\`\`\``, finishReason: "stop" };
  expect(judgeWords(fenced, 100, FIELDS)).toMatchObject({ ok: true });
  expect(checkWords({ changes: {}, said: "Nothing to change." }, FIELDS)).toMatchObject({
    ok: true,
    changes: {},
  });
});

test("an unknown field, a value out of range, a bad choice and a bad said are each a finding", () => {
  const given = {
    changes: { loud: 1, level: 3, voices: 2.5, pulse: "swing" },
    said: 4,
    why: "x",
  };
  const checked = checkWords(given, FIELDS);
  if (checked.ok) throw new Error("passed");
  expect(checked).toMatchObject({ reason: REJECT_REASON.schemaErrors, answer: given });
  expect(checked.errors).toEqual([
    {
      path: "$",
      rule: "answer",
      message: 'the answer has "why"; give only "changes", "said"',
    },
    {
      path: "$.changes.loud",
      rule: "changes",
      message: "unknown field; give only level, voices, pulse",
    },
    { path: "$.changes.level", rule: "changes", message: "must be from 0 to 1, got 3" },
    { path: "$.changes.voices", rule: "changes", message: "must be a whole number, got 2.5" },
    {
      path: "$.changes.pulse",
      rule: "changes",
      message: 'must be one of "none", "beat", got "swing"',
    },
    { path: "$.said", rule: "said", message: "must be a non-empty string, got 4" },
  ]);
});

test("missing or misshapen changes and said are findings", () => {
  const checked = checkWords({ changes: [1] }, FIELDS);
  if (checked.ok) throw new Error("passed");
  expect(checked.errors.map(({ path, message }) => `${path}: ${message}`)).toEqual([
    "$.changes: must be an object of fields, got [1]",
    "$.said: missing",
  ]);
});

test("a cut-off answer, prose and several objects are rejected with nothing to repair", () => {
  const cut = judgeWords({ text: '{"changes": {', finishReason: "length" }, 100, FIELDS);
  expect(cut).toMatchObject({ ok: false, reason: REJECT_REASON.truncated, answer: null });
  expect(judgeWords({ text: "Louder.", finishReason: "stop" }, 100, FIELDS)).toMatchObject({
    ok: false,
    answer: null,
  });
  const two = judgeWords(
    { text: '{"said": "a"} {"said": "b"}', finishReason: "stop" },
    100,
    FIELDS,
  );
  expect(two).toMatchObject({ ok: false, answer: null });
  expect(judgeWords(answer({ changes: { level: 1 }, said: "Up." }), 100, FIELDS)).toMatchObject({
    ok: true,
  });
});
