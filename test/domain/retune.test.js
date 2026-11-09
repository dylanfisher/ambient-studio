// Retunes (decision 0094): the base with the owner's tuning, scale and key and nothing else
// changed, the key nearest the base's root suggested, and the locks and the brief holding.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { expect, test } from "vitest";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import {
  nearestKey,
  pitchText,
  retune,
  retuneRefusal,
  rootHz,
  suggestedPitch,
} from "../../src/domain/retune.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";

/** 12-TET D dorian. */
const base = /** @type {Genome} */ (requireGenome(droneGenome, "the drone"));
const free = { base, locks: [], constraints: {} };

/**
 * The top-level keys whose values differ between two genomes.
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
const changedKeys = (a, b) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .sort();

test("a retune sets the tuning, scale and key and changes nothing else", () => {
  const made = retune({ ...free, pitch: { tuning: "12-tet", scale: "phrygian", key: 4 } });
  expect(made.reason).toBeNull();
  const genome = /** @type {Genome} */ (made.genome);
  expect(genome).toMatchObject({ tuning: "12-tet", scale: "phrygian", key: 4 });
  expect(changedKeys(base, genome)).toEqual(["key", "scale"]);
});

test("a retune to an absolute tuning drops the key", () => {
  const made = retune({ ...free, pitch: { tuning: "colundi", scale: "core18" } });
  const genome = /** @type {Genome} */ (made.genome);
  expect(genome).toMatchObject({ tuning: "colundi", scale: "core18" });
  expect("key" in genome).toBe(false);
  expect(changedKeys(base, genome)).toEqual(["key", "scale", "tuning"]);
});

test("a scale its tuning lacks comes back rejected by the schema", () => {
  const made = retune({ ...free, pitch: { tuning: "19-edo", scale: "dorian", key: 3 } });
  expect(made).toMatchObject({ reason: REJECT_REASON.schemaErrors, genome: null });
  expect(made.lint.findings[0]?.message).toMatch(/"dorian" is not a scale of 19-edo/);
});

test("a brief that fixes another scale rejects the retune by the linter", () => {
  const made = retune({
    ...free,
    constraints: { scale: "dorian" },
    pitch: { tuning: "12-tet", scale: "aeolian", key: 2 },
  });
  expect(made).toMatchObject({ reason: REJECT_REASON.lintErrors, genome: null });
});

test("a retune throws on a missing or extra key, the base's own pitch, or a lock on the pitch", () => {
  expect(() => retune({ ...free, pitch: { tuning: "19-edo", scale: "all" } })).toThrow(
    "19-edo is relative, so a retune to it needs a key",
  );
  expect(() => retune({ ...free, pitch: { tuning: "colundi", scale: "all", key: 0 } })).toThrow(
    "colundi is absolute, so it takes no key",
  );
  expect(() => retune({ ...free, pitch: { tuning: "12-tet", scale: "dorian", key: 2 } })).toThrow(
    "the base already plays this tuning, scale and key",
  );
  const lock = { path: "scale", value: "dorian" };
  expect(() =>
    retune({ ...free, locks: [lock], pitch: { tuning: "12-tet", scale: "ionian", key: 2 } }),
  ).toThrow("the brief locks scale, so a retune would be undone; remove the lock first");
  expect(retuneRefusal([{ path: "voices.pad.level", value: -12, voiceType: "pad" }])).toBeNull();
});

test("the suggested key keeps the root nearest where it was", () => {
  // D is 200 cents above C; 19-EDO's degree 3 is 189 cents above it, degree 4 is 253.
  expect(nearestKey(base, "19-edo")).toBe(3);
  expect(nearestKey(base, "just-5-limit")).toBe(2);
  expect(nearestKey(base, "colundi")).toBeUndefined();
  expect(rootHz({ tuning: "12-tet", scale: "aeolian", key: 9 })).toBeCloseTo(440, 6);
});

test("the suggested scale is the base's when the tuning has it, else every degree", () => {
  expect(suggestedPitch(base, "just-5-limit")).toEqual({
    tuning: "just-5-limit",
    scale: "dorian",
    key: 2,
  });
  expect(suggestedPitch(base, "19-edo")).toEqual({ tuning: "19-edo", scale: "all", key: 3 });
  expect(suggestedPitch(base, "colundi")).toEqual({ tuning: "colundi", scale: "all" });
});

test("a pitch reads with its key only when it has one", () => {
  expect(pitchText({ tuning: "19-edo", scale: "all", key: 5 })).toBe("19-edo, scale all, key 5");
  expect(pitchText({ tuning: "colundi", scale: "core18" })).toBe("colundi, scale core18");
});
