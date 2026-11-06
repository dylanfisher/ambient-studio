import { describe, expect, test } from "vitest";
import { renderChecks } from "../../src/domain/render-checks.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import cloudGenome from "../../src/engine/genomes/granular-cloud.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { SAMPLE_RATE, stereo, toneSegments } from "../support/tech-3341.js";

/** @param {Float32Array[]} channels */
const result = (channels) => ({ channels, sampleRate: SAMPLE_RATE, engineVersion: ENGINE_VERSION });

/** @param {number} dbfs a 1 kHz sine at this peak level on both channels, 2 s long */
const tone = (dbfs) => stereo(toneSegments([{ seconds: 2, dbfs }]));

/** @param {import("../../src/domain/lint-result.js").LintResult} checks */
const rules = (checks) => checks.findings.map((finding) => finding.rule);

describe("renderChecks", () => {
  test("a clean golden excerpt passes all four", async () => {
    const genome = requireGenome(droneGenome, "drone.json");
    const render = await renderOffline(genome, {
      seed: 1,
      offset: excerptOffset(genome, 1, 3),
      duration: 3,
    });
    expect(renderChecks(render, genome)).toEqual({ ok: true, findings: [] });
  });

  test("a sine at 0 dBFS is clipping, and one just under is not", () => {
    // 48 samples a period put samples on the crests, so the peak is exactly 1.
    expect(rules(renderChecks(result(tone(0)), cloudGenome))).toEqual(["clipping", "clipping"]);
    expect(renderChecks(result(tone(-0.1)), cloudGenome).ok).toBe(true);
  });

  test("a sample over full scale names its channel", () => {
    const channels = tone(-6);
    /** @type {Float32Array} */ (channels[1])[100] = -1.5;
    const [finding] = renderChecks(result(channels), cloudGenome).findings;
    expect(finding?.rule).toBe("clipping");
    expect(finding?.message).toMatch(/channel 1/);
  });

  test.each([
    ["digital silence", stereo(new Float32Array(2 * SAMPLE_RATE))],
    ["a tone at -60 dBFS", tone(-60)],
  ])("%s is near-silent", (_, channels) => {
    expect(rules(renderChecks(result(channels), cloudGenome))).toEqual(["nearSilence"]);
  });

  test("a DC shift on one channel fails the DC check for that channel only", () => {
    const channels = tone(-20);
    channels[0] = /** @type {Float32Array} */ (channels[0]).map((x) => x + 0.05);
    const { findings } = renderChecks(result(channels), cloudGenome);
    expect(rules({ ok: false, findings })).toEqual(["dcOffset"]);
    expect(findings[0]?.message).toMatch(/channel 0/);
  });

  test("a genome over the cost budget fails the budget check", () => {
    const [voice] = cloudGenome.voices;
    const heavy = {
      ...cloudGenome,
      voices: Array.from({ length: 16 }, (_, i) => ({
        ...voice,
        id: `c${i}`,
        density: 30,
        size: 0.5,
      })),
    };
    expect(cost(heavy)).toBeGreaterThan(COST_BUDGET);
    expect(rules(renderChecks(result(tone(-20)), heavy))).toEqual(["costBudget"]);
  });
});
