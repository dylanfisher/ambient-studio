// The check on the model's drafted brief (decision 0074): the four fields and no other, the
// name and description held to the save route's limits, and the constraints and ranges checked
// by the validators Save uses, every finding under its field.
import { expect, test } from "vitest";
import { checkDraftBrief, judgeDraftBrief } from "../../src/domain/check-draft-brief.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";

const limits = { name: 20, brief: 80 };

const draft = Object.freeze({
  name: "Underwater drone",
  brief: "A slow, dark drone heard from under water.",
  constraints: { pulse: "none", bellNotes: 2 },
  softTargets: { features: { centroidMean: [null, 700] } },
});

test("a valid draft passes as it was given", () => {
  expect(checkDraftBrief({ ...draft }, limits)).toEqual({ ok: true, draft });
  const none = { ...draft, constraints: {}, softTargets: {} };
  expect(checkDraftBrief(none, limits)).toEqual({
    ok: true,
    draft: { ...none, softTargets: { features: {} } },
  });
});

test("every finding is under its field, the field naming the rule", () => {
  const given = {
    name: "x".repeat(21),
    brief: "",
    constraints: { bellNotes: 90, tempo: 3 },
    softTargets: { features: { flatness: [0.5, 0.2] }, kept: 1 },
    intent: "a drone",
  };
  const checked = checkDraftBrief(given, limits);
  if (checked.ok) throw new Error("passed");
  expect(checked).toMatchObject({ reason: REJECT_REASON.schemaErrors, answer: given });
  expect(checked.errors.map(({ path, rule }) => `${path} ${rule}`)).toEqual([
    "$ answer",
    "$.name name",
    "$.brief brief",
    "$.constraints.tempo constraints",
    "$.constraints.bellNotes constraints",
    "$.softTargets.features.flatness softTargets",
  ]);
  expect(checked.errors[1]?.message).toBe("must be at most 20 characters, got 21");

  const kept = checkDraftBrief({ ...draft, softTargets: { features: {}, kept: 1 } }, limits);
  if (kept.ok) throw new Error("passed");
  expect(kept.errors).toEqual([
    {
      path: "$.softTargets.kept",
      rule: "softTargets",
      message: 'unknown key; give only "features"',
    },
  ]);
});

test("a missing field is a finding", () => {
  const checked = checkDraftBrief({ name: draft.name }, limits);
  if (checked.ok) throw new Error("passed");
  expect(checked.errors.map(({ path, message }) => `${path}: ${message}`)).toEqual([
    "$.brief: missing",
    "$.constraints: missing",
    "$.softTargets: missing",
  ]);
});

test("a cut-off or unparsed answer has nothing to repair", () => {
  const cut = judgeDraftBrief({ text: '{"name": "U', finishReason: "length" }, 100, limits);
  expect(cut).toMatchObject({ ok: false, reason: REJECT_REASON.truncated, answer: null });
  const prose = judgeDraftBrief({ text: "a slow drone", finishReason: "stop" }, 100, limits);
  expect(prose).toMatchObject({ ok: false, reason: REJECT_REASON.noJson, answer: null });
  const fenced = { text: `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``, finishReason: "stop" };
  expect(judgeDraftBrief(fenced, 100, limits)).toEqual({ ok: true, draft });
});
