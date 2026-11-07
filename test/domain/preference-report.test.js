// Held-out agreement's numbers (decision 0045): the credit a call earns and the session
// bootstrap's interval, checked against counts made by hand.
import { describe, expect, test } from "vitest";
import { agreement, credit } from "../../src/domain/preference-report.js";

describe("credit", () => {
  test("a higher winner agrees, a lower one doesn't, and no call is half", () => {
    expect(credit(2, 1)).toBe(1);
    expect(credit(1, 2)).toBe(0);
    expect(credit(1, 1)).toBe(0.5);
    expect(credit(null, 1)).toBe(0.5);
  });
});

describe("agreement", () => {
  test("is the pooled share of credit over the scored pairs", () => {
    // By hand: 7 + 3.5 + 9 = 19.5 of 10 + 10 + 10.
    const found = agreement([
      { sessionId: 1, agreed: 7, scored: 10 },
      { sessionId: 2, agreed: 3.5, scored: 10 },
      { sessionId: 3, agreed: 9, scored: 10 },
    ]);
    expect(found).toMatchObject({ agreed: 19.5, scored: 30, share: 0.65 });
  });

  test("resamples whole sessions: two even sessions give an interval from one to the other", () => {
    // Each resample of two sessions is both of one (a quarter of the time each) or one of
    // each (half), so its share is 0.4, 0.6 or 0.8: the 2.5th and 97.5th percentiles are the
    // two sessions' own shares.
    const found = agreement([
      { sessionId: 1, agreed: 4, scored: 10 },
      { sessionId: 2, agreed: 8, scored: 10 },
    ]);
    expect(found).toMatchObject({ share: 0.6, low: 0.4, high: 0.8 });
  });

  test("sessions that agree alike give no width, whatever their pair counts", () => {
    const found = agreement([
      { sessionId: 1, agreed: 3, scored: 4 },
      { sessionId: 2, agreed: 15, scored: 20 },
      { sessionId: 3, agreed: 6, scored: 8 },
    ]);
    expect(found).toMatchObject({ share: 0.75, low: 0.75, high: 0.75 });
  });

  test("is seeded: the same tallies give the same interval", () => {
    const tallies = [
      { sessionId: 1, agreed: 5, scored: 9 },
      { sessionId: 2, agreed: 11, scored: 14 },
      { sessionId: 3, agreed: 2, scored: 7 },
      { sessionId: 4, agreed: 8, scored: 10 },
    ];
    const first = agreement(tallies);
    expect(agreement(tallies)).toEqual(first);
    expect(first?.low).toBeLessThan(/** @type {number} */ (first?.share));
    expect(first?.high).toBeGreaterThan(/** @type {number} */ (first?.share));
  });

  test("is null with nothing scored", () => {
    expect(agreement([])).toBeNull();
    expect(agreement([{ sessionId: 1, agreed: 0, scored: 0 }])).toBeNull();
  });
});
