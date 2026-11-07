// What a rendered excerpt misses (decision 0036): its range misses, then its failed render checks.
import { expect, test } from "vitest";
import { excerptMisses } from "../../src/domain/excerpt-misses.js";

const raw = { loudness: -23.4, shortTermMax: -20.1, loudnessRange: 4.2, truePeak: -3.1 };
const heard = {
  gainDb: 7.4,
  centroidMean: 1243.6,
  centroidSpread: 310.2,
  onsetRate: 0.43,
  lowEndShare: 0.82,
  stereoWidth: 0.12,
  flatness: 0.004,
};
const clipping = { path: "$", rule: "clipping", message: "channel 0 reaches 1.2 of full scale" };

test("lists the range misses first, then the failed checks", () => {
  const misses = excerptMisses(
    { raw, heard },
    { ok: false, findings: [clipping] },
    { lowEndShare: [null, 0.5], onsetRate: [0, 1] },
  );
  expect(misses.map(({ rule }) => rule)).toEqual(["target", "clipping"]);
  expect(misses[0]?.path).toBe("features.lowEndShare");
});

test("an excerpt inside every range with passing checks misses nothing", () => {
  expect(
    excerptMisses({ raw, heard }, { ok: true, findings: [] }, { lowEndShare: [0.5, 1] }),
  ).toEqual([]);
});
