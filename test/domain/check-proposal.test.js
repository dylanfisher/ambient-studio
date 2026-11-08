// The check on the model's proposed arrangement (decision 0067): the answer's own shape, the
// arrangement's validator, elites named in place of sketches, and the length rule.
/** @import { ArrangementContext } from "../../src/domain/validate-arrangement.js" */
import { describe, expect, test } from "vitest";
import { checkProposal, judgeProposal, PROPOSAL_RULE } from "../../src/domain/check-proposal.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";

/** @type {ArrangementContext} */
const context = {
  vibeId: 1,
  sketch: (id) => (id === 7 ? { vibeId: 1, removedReason: null, duration: 300 } : undefined),
};
const elites = new Map([[40, 240]]);
const ask = { context, elites, length: 600, arc: "emerge, plateau, dissolve" };

/**
 * Two sections of sketch 7 and an 8 s crossfade, playing `first` + 300 − 8 seconds.
 * @param {number} first the first section's seconds
 */
const answer = (first) => ({
  sections: [
    { sketchId: 7, offset: 0, seconds: first },
    { sketchId: 7, offset: 0, seconds: 300 },
  ],
  transitions: [{ kind: "crossfade", seconds: 8 }],
  lanes: [],
});

describe("the length rule", () => {
  test("a track within 5% of the length passes, with the owner's length and arc filled in", () => {
    const checked = checkProposal(answer(278), ask);
    expect(checked).toEqual({
      ok: true,
      arrangement: { ...answer(278), length: 600, arc: ask.arc, proposal: null },
      elites: new Map(),
    });
    // 570 s, above, and 630 s are the edges: 5% either side of 600.
    expect(checkProposal(answer(338), ask).ok).toBe(true);
    expect(checkProposal(answer(339), ask).ok).toBe(false);
  });

  test("more than 5% off is a finding naming what it plays and the span asked for", () => {
    const checked = checkProposal(answer(277), ask);
    expect(checked).toMatchObject({ ok: false, reason: REJECT_REASON.schemaErrors });
    if (checked.ok) throw new Error("passed");
    expect(checked.errors).toEqual([
      {
        path: "$.sections",
        rule: PROPOSAL_RULE.length,
        message:
          "the track plays 569 s (every section's seconds less every transition's); the owner asked for 600 s, so it must play from 570 to 630 s",
      },
    ]);
    expect(checked.answer).toEqual(answer(277));
  });
});

test("the validator's errors and the answer's own are findings with their rules", () => {
  const given = { ...answer(278), length: 600 };
  given.sections[1] = { sketchId: 9, offset: 0, seconds: 300 };
  const checked = checkProposal(given, ask);
  if (checked.ok) throw new Error("passed");
  expect(checked.errors).toEqual([
    expect.objectContaining({ path: "$", rule: PROPOSAL_RULE.answer }),
    {
      path: "$.sections[1].sketchId",
      rule: PROPOSAL_RULE.arrangement,
      message: "there is no sketch 9",
    },
  ]);
});

describe("elites", () => {
  test("a listed elite stands in for a sketch, checked against its own duration", () => {
    const given = answer(278);
    given.sections[1] = /** @type {any} */ ({ eliteId: 40, offset: 0, seconds: 300 });
    const checked = checkProposal(given, ask);
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
    expect(checked.elites).toEqual(new Map([[1, 40]]));
    const late = answer(278);
    late.sections[1] = /** @type {any} */ ({ eliteId: 40, offset: 250, seconds: 300 });
    const refused = checkProposal(late, ask);
    if (refused.ok) throw new Error("passed");
    expect(refused.errors).toEqual([
      expect.objectContaining({
        path: "$.sections[1].offset",
        message: "must be under its sketch's 240 s, got 250",
      }),
    ]);
  });

  test("an unlisted elite, or a section naming both, is refused", () => {
    const given = answer(278);
    given.sections[0] = /** @type {any} */ ({ eliteId: 41, offset: 0, seconds: 278 });
    given.sections[1] = /** @type {any} */ ({ eliteId: 40, sketchId: 7, offset: 0, seconds: 300 });
    const checked = checkProposal(given, ask);
    if (checked.ok) throw new Error("passed");
    expect(checked.errors).toEqual([
      {
        path: "$.sections[0].eliteId",
        rule: PROPOSAL_RULE.answer,
        message: "there is no elite 41 in the material; name a listed one",
      },
      expect.objectContaining({ path: "$.sections[1]", rule: PROPOSAL_RULE.answer }),
    ]);
  });
});

test("a cut-off or unparsed response is rejected with no answer to repair", () => {
  const cut = judgeProposal({ text: '{"sections": [', finishReason: "length" }, 100, ask);
  expect(cut).toMatchObject({ ok: false, reason: REJECT_REASON.truncated, answer: null });
  const prose = judgeProposal({ text: "here is a plan", finishReason: "stop" }, 100, ask);
  expect(prose).toMatchObject({ ok: false, reason: REJECT_REASON.noJson, answer: null });
  const fenced = judgeProposal(
    { text: `\`\`\`json\n${JSON.stringify(answer(278))}\n\`\`\``, finishReason: "stop" },
    100,
    ask,
  );
  expect(fenced.ok).toBe(true);
});
