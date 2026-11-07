import { readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lintGenome } from "../../src/domain/lint-genome.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";

const seeds = Object.entries(SEED_VIBES);

describe("the seed vibes", () => {
  test("every file in src/domain/vibes/ is listed, and there are three", () => {
    const files = readdirSync(new URL("../../src/domain/vibes/", import.meta.url));
    expect(Object.keys(SEED_VIBES).sort()).toEqual(
      files.map((file) => file.replace(/\.js$/, "")).sort(),
    );
    expect(seeds).toHaveLength(3);
  });

  test.each(seeds)("%s passes 2b's validator, targets -16 LUFS and has a brief", (_id, seed) => {
    expect(validateConstraints(seed.constraints)).toEqual({
      ok: true,
      constraints: seed.constraints,
    });
    expect(seed.constraints.loudness).toBe(-16);
    expect(seed.name.trim()).not.toBe("");
    expect(seed.brief.length).toBeGreaterThan(100);
    expect(seed.softTargets).toEqual({});
  });

  test.each(seeds)("%s can be met: a genome passes the schema and its linter", (id, seed) => {
    const genome = requireGenome(SEED_GENOMES[id]);
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
});
