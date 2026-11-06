import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { genomeHash } from "../../src/server/genome-hash.js";

describe("genomeHash", () => {
  test("is the SHA-256 of the canonical genome, in hex", () => {
    const expected = createHash("sha256").update(canonicalGenome(droneGenome)).digest("hex");
    expect(genomeHash(droneGenome)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is the same for the normalized form and differs when a parameter changes", () => {
    expect(genomeHash(requireGenome(droneGenome, "drone"))).toBe(genomeHash(droneGenome));
    expect(genomeHash({ ...droneGenome, key: 3 })).not.toBe(genomeHash(droneGenome));
  });

  test("throws on an invalid genome", () => {
    expect(() => genomeHash({ duration: -1 })).toThrow();
  });
});
