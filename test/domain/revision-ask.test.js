// The revision's ask (decision 0036): the locks restated, the ranges, the measured features, and
// what the excerpt missed.
import { expect, test } from "vitest";
import { featuresText } from "../../src/domain/features-text.js";
import { revisionAsk } from "../../src/domain/revision-ask.js";
import { targetsText } from "../../src/domain/targets-text.js";

const features = {
  raw: { loudness: -23.4, shortTermMax: -20.1, loudnessRange: 4.2, truePeak: -3.1 },
  heard: {
    gainDb: 7.4,
    centroidMean: 1243.6,
    centroidSpread: 310.2,
    onsetRate: 0.43,
    lowEndShare: 0.82,
    stereoWidth: 0.12,
    flatness: 0.004,
  },
};
/** @type {import("../../src/domain/target-schema.js").FeatureRanges} */
const ranges = { lowEndShare: [null, 0.5] };
const miss = {
  path: "features.lowEndShare",
  rule: "target",
  message: "low-end share is 0.82; the vibe asks for a value at most 0.5",
};

test("restates the locks, then gives the ranges, the features and each miss", () => {
  const ask = revisionAsk({
    locks: [{ path: "reverbDecay", value: 2 }],
    ranges,
    features,
    misses: [miss],
  });
  const at = (/** @type {string} */ text) => {
    const index = ask.indexOf(text);
    expect(index, text).toBeGreaterThanOrEqual(0);
    return index;
  };
  const locks = at("Locked by the owner; keep these values exactly:\nreverbDecay = 2");
  const targets = at(targetsText(ranges));
  const measured = at(featuresText(features));
  const missed = at(`- features.lowEndShare (target): ${miss.message}`);
  expect(locks).toBeLessThan(targets);
  expect(targets).toBeLessThan(measured);
  expect(measured).toBeLessThan(missed);
  expect(ask).toContain("unchanged");
});

test("leaves the locks out when none are in force", () => {
  const ask = revisionAsk({ locks: [], ranges, features, misses: [miss] });
  expect(ask).not.toContain("Locked by the owner");
});
