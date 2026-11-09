// The brief page's words for drafting a brief from the owner's (decision 0074): the confirm,
// which says nothing is saved and how long the request takes, and the status line after; and the
// dashboard's for a suggested brief (0093).
import { expect, test } from "vitest";
import {
  draftCostText,
  draftFilledText,
  suggestCostText,
  suggestedText,
} from "../../src/web/draft-brief-text.js";

test("the confirm says what the model reads, that nothing is saved, and how long it takes", () => {
  const fresh = draftCostText(false, { seconds: 50, timed: 20 });
  expect(fresh).toMatch(/^Ask the model to fill in the brief from your words\?/);
  expect(fresh).toContain("1 or 2 requests to the model");
  expect(fresh).toContain("nothing is saved until you press Save");
  expect(fresh).toContain(
    "At 50 s a request, the median of the last 20 the model answered, that is about 1 to 2 minutes",
  );
  const rework = draftCostText(true, { seconds: null, timed: 0 });
  expect(rework).toMatch(/^Ask the model to rework the brief from your words\?/);
  expect(rework).toContain("the form as it is now, saved or not");
  expect(rework).toMatch(/No request to the model has been timed yet/);
});

test("the status line says the form is filled and not saved", () => {
  expect(draftFilledText(false)).toBe(
    "The model filled in the form. Nothing is saved yet: check it, edit it, and press Save to keep it.",
  );
  expect(draftFilledText(true)).toMatch(/^The model filled in the form, after one fix\./);
});

test("a suggestion's confirm and status line say what the model read and that Approve saves", () => {
  const cost = suggestCostText(1, { seconds: 50, timed: 20 });
  expect(cost).toMatch(/^Ask the model to suggest a new brief\? It reads your 1 brief,/);
  expect(cost).toContain("Nothing is saved until you press Approve.");
  expect(suggestCostText(3, { seconds: 50, timed: 20 })).toContain("your 3 briefs");
  expect(suggestedText({ repaired: false, briefsRead: 4, briefsTotal: 4 })).toBe(
    "The model suggested a brief from all 4 of your briefs. Nothing is saved yet: press Approve to add it as a brief.",
  );
  expect(suggestedText({ repaired: true, briefsRead: 12, briefsTotal: 30 })).toMatch(
    /^The model suggested a brief from your newest 12 of 30 briefs, all that fit, after one fix\./,
  );
});
