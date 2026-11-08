// The arc target's layout (decision 0066), with no DOM: a reference region's per-window
// features stretched to the track's length, each window at its share of the region on the
// track, beside each section's measured features, and a plain line when no section is measured.
import { expect, test } from "vitest";
import { FEATURE_NAMES } from "../../src/domain/feature-names.js";
import { ARC_UNMEASURED, arcLayout } from "../../src/web/arc-layout.js";
import { span } from "../../src/web/timeline-layout.js";

const CENTROID = /** @type {import("../../src/domain/feature-names.js").FeatureName} */ (
  FEATURE_NAMES.find(({ name }) => name === "centroidMean")
);

/** @param {number | null} centroidMean */
const features = (centroidMean) => ({
  raw: { loudness: -20, shortTermMax: -18, loudnessRange: 3, truePeak: -3 },
  heard:
    centroidMean === null
      ? null
      : {
          gainDb: 0,
          centroidMean,
          centroidSpread: 40,
          onsetRate: 0.2,
          lowEndShare: 0.4,
          stereoWidth: 0.3,
          flatness: 0.1,
        },
});

/** A 50 s region read as 25 s windows hopped by half, as 5b measures one. */
const WINDOWS = [
  { startSeconds: 0, seconds: 25, features: features(400), notHeard: null },
  { startSeconds: 12.5, seconds: 25, features: features(800), notHeard: null },
  { startSeconds: 25, seconds: 25, features: features(null), notHeard: "too quiet" },
];

test("each of the region's windows sits at its share of the region on a track of another length", () => {
  const length = 200;
  const blocks = [span(0, 120, length), span(112, 200, length)];
  const arc = arcLayout({
    length,
    windows: WINDOWS,
    blocks,
    measures: [features(600), null],
    feature: CENTROID,
  });
  // 200 s of track over 50 s of region: 4 track seconds for each region second.
  expect(arc.windows.map(({ span: at, value }) => [at.start, at.end, value])).toEqual([
    [0, 100, 400],
    [50, 150, 800],
    [100, 200, null],
  ]);
  expect(arc.windows[1]?.span).toEqual(span(50, 150, length));
  expect(arc.sections.map(({ value }) => value)).toEqual([600, null]);
  expect(arc.sections.map(({ span: at }) => at)).toEqual(blocks);
  // Heights run over every value drawn: 800 at the top, 400 at the bottom.
  expect(arc.windows.map(({ top }) => top)).toEqual([100, 0, null]);
  expect(arc.sections.map(({ top }) => top)).toEqual([50, null]);
  expect(arc.line).toBe(
    "Spectral centroid, from 400 Hz to 800 Hz. 1 of 2 sections measured; play the others to measure them.",
  );
  expect(arc.windows[0]?.title).toBe(
    "The region from 0:00 to 0:25, at 0:00 to 1:40 of the track: spectral centroid 400 Hz.",
  );
  expect(arc.windows[2]?.title).toMatch(/: spectral centroid none measurable\.$/);
});

test("with no section measured, the arc says so plainly", () => {
  const arc = arcLayout({
    length: 60,
    windows: WINDOWS,
    blocks: [span(0, 60, 60)],
    measures: [null],
    feature: CENTROID,
  });
  expect(arc.sections.map(({ value }) => value)).toEqual([null]);
  expect(arc.line).toBe(`Spectral centroid, from 400 Hz to 800 Hz. ${ARC_UNMEASURED}`);
});

test("a track with no sections has nothing to stretch the region over", () => {
  const arc = arcLayout({
    length: 0,
    windows: WINDOWS,
    blocks: [],
    measures: [],
    feature: CENTROID,
  });
  expect(arc.windows).toEqual([]);
  expect(arc.line).toBe("Add a section: the region is stretched over the track's length.");
});
