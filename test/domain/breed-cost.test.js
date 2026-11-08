// A breed's confirm (decision 0058): the model requests it sends and their time, from the
// median of recent request times.
import { expect, test } from "vitest";
import { breedCostText } from "../../src/domain/breed-cost.js";

test("the confirm states the requests, their time from recent requests, and the renders", () => {
  expect(breedCostText(4, { seconds: 48, timed: 20 })).toBe(
    "Breed these two sketches into 4 children? The model writes each child from both parents, and each child is then nudged once with no model request. " +
      "That is 4 to 12 requests to the model: one a child, another when an answer needs fixing, and another when a child misses a range and is revised. " +
      "At 48 s a request, the median of the last 20 the model answered, and 2 s to render each excerpt, that is about 3 to 10 minutes, longer while the live site keeps the model busy.",
  );
});

test("one child, timed by one request, reads in the singular", () => {
  expect(breedCostText(1, { seconds: 7.4, timed: 1 })).toContain(
    "into 1 child? The model writes the child from both parents, and the child is then nudged once",
  );
  expect(breedCostText(1, { seconds: 7.4, timed: 1 })).toContain(
    "That is 1 to 3 requests to the model",
  );
  expect(breedCostText(1, { seconds: 7.4, timed: 1 })).toContain(
    "At 7 s a request, the last one the model answered,",
  );
});

test("with no request timed yet, it says the time can't be estimated", () => {
  expect(breedCostText(4, { seconds: null, timed: 0 })).toMatch(
    /requests to the model: .*\. No request to the model has been timed yet, so the time can't be estimated\.$/,
  );
});
