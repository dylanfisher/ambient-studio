import { readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lintGenome } from "../../src/domain/lint-genome.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { validateTargets } from "../../src/domain/validate-targets.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";

const seeds = Object.entries(SEED_VIBES);

describe("the seed vibes", () => {
  test("every file in src/domain/vibes/ is listed, and there are four", () => {
    const files = readdirSync(new URL("../../src/domain/vibes/", import.meta.url));
    expect(Object.keys(SEED_VIBES).sort()).toEqual(
      files.map((file) => file.replace(/\.json$/, "")).sort(),
    );
    expect(seeds).toHaveLength(4);
  });

  test.each(seeds)("%s passes 2b's validator, targets -16 LUFS and has a brief", (_id, seed) => {
    expect(validateConstraints(seed.constraints)).toEqual({
      ok: true,
      constraints: seed.constraints,
    });
    expect(seed.constraints.loudness).toBe(-16);
    expect(seed.name.trim()).not.toBe("");
    expect(seed.brief.length).toBeGreaterThan(100);
  });

  test.each(seeds)("%s has feature ranges that validate, and no other soft target", (_id, seed) => {
    const checked = validateTargets(seed.softTargets);
    expect(checked.ok && checked.softTargets).toEqual(seed.softTargets);
    expect(Object.keys(seed.softTargets)).toEqual(["features"]);
    expect(checked.ok && Object.keys(checked.ranges).length).toBeGreaterThan(0);
  });

  test.each(seeds)("%s can be met: a genome passes the schema and its linter", (id, seed) => {
    const genome = requireGenome(SEED_GENOMES[id], `the genome for ${id}`);
    expect(lintGenome(genome, seed.constraints)).toEqual({ ok: true, findings: [] });
  });

  test("together they exercise every kind but bpm, and each sets a kind the others don't", () => {
    const kinds = seeds.map(([, seed]) => Object.keys(seed.constraints));
    expect(new Set(kinds.flat())).toEqual(
      new Set([
        "tuning",
        "scale",
        "key",
        "pulse",
        "duration",
        "loudness",
        "allowedVoices",
        "bannedVoices",
        "bellNotes",
        "grains",
        "padChords",
        "cymbalHits",
        "drumHits",
        "brightness",
        "cost",
      ]),
    );
    for (const [i, own] of kinds.entries()) {
      const others = kinds.filter((_, j) => j !== i).flat();
      expect(
        own.some((kind) => !others.includes(kind)),
        seeds[i]?.[0],
      ).toBe(true);
    }
  });

  // Phase CV's starting point (decision 0072): the chant voices, with sparse struck hits.
  // The bell ceiling stays bell-field's own kind, so the brief keeps the bell rare.
  test("low-chant allows the chant, its bed and the struck voices, caps the cymbal and drum, and has no beat", () => {
    const { constraints } = SEED_VIBES["low-chant"] ?? {};
    expect(constraints?.allowedVoices).toEqual(["chant", "noise", "bell", "cymbal", "drum"]);
    expect(constraints?.pulse).toBe("none");
    expect(constraints).toMatchObject({
      cymbalHits: expect.any(Number),
      drumHits: expect.any(Number),
    });
  });

  // Phase CG's acceptance 7: the starting point allows the chant's growl and breath.
  test("low-chant can be met with every phase CG chant parameter at its most", () => {
    const seed = /** @type {Record<string, any>} */ (SEED_GENOMES["low-chant"]);
    const [singing, ...rest] = seed.voices;
    const every = {
      growl: 1,
      rough: 1,
      flutter: 1,
      shimmer: 1,
      aspiration: 1,
      breathiness: 1,
      focus: 12,
      narrow: 1,
      breath: 0.6,
    };
    const genome = requireGenome(
      { ...seed, voices: [{ ...singing, ...every }, ...rest] },
      "the low chant with growl and breath",
    );
    const { constraints } = /** @type {import("../../src/domain/seed-vibes.js").SeedVibe} */ (
      SEED_VIBES["low-chant"]
    );
    expect(lintGenome(genome, constraints)).toEqual({ ok: true, findings: [] });
    expect(cost(genome)).toBeLessThanOrEqual(COST_BUDGET);
  });

  test("low-chant's brief asks for the growl and the breaths' sound", () => {
    const brief = SEED_VIBES["low-chant"]?.brief ?? "";
    expect(brief).toMatch(/growl/);
    expect(brief).toMatch(/breath is heard/);
  });
});
