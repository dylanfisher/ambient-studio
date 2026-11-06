import { describe, expect, test } from "vitest";
import { drone, droneFundamental, dronePartials } from "../../src/engine/drone.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { resolvePitch, tuningFrequencies } from "../../src/engine/pitch.js";
import { getTuning } from "../../src/engine/tuning-registry.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";

const dMinor = resolvePitch(getTuning("12-tet"), "dorian", 2);
const colundi = resolvePitch(getTuning("colundi"), "all");

/** @param {number} a @param {number} b */
const cents = (a, b) => 1200 * Math.log2(a / b);

describe("the drone", () => {
  test("is registered", () => {
    expect(voiceTypeIds()).toContain(drone.type);
  });

  test("plays the scale note nearest its root, from 33 to 135 Hz", () => {
    expect(droneFundamental(dMinor, 37)).toBeCloseTo(36.7081, 3);
    expect(droneFundamental(dMinor, 130)).toBeCloseTo(130.8128, 3);
    for (const root of [33, 50, 80, 135]) {
      const hz = droneFundamental(colundi, root);
      expect(tuningFrequencies(colundi, 33, 135)).toContain(hz);
    }
  });

  test("in a relative tuning, partials are harmonics falling `slope` dB per octave", () => {
    const partials = dronePartials(dMinor, 50, 8, 6);
    expect(partials.map((p) => p.harmonic)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(partials.map((p) => p.hz)).toEqual([50, 100, 150, 200, 250, 300, 350, 400]);
    const db = partials.map((p) => 20 * Math.log10(p.gain / (partials[0]?.gain ?? 1)));
    expect(db[1]).toBeCloseTo(-6, 9);
    expect(db[3]).toBeCloseTo(-12, 9);
    expect(db[7]).toBeCloseTo(-18, 9);
  });

  test("in an absolute tuning, a partial within 40 cents of a scale member snaps to it", () => {
    const f0 = droneFundamental(colundi, 55);
    const members = tuningFrequencies(colundi, 20, 2000);
    const partials = dronePartials(colundi, f0, 12, 6);
    let snapped = 0;
    partials.forEach((p, i) => {
      const target = (i + 1) * f0;
      const nearest = members.reduce((a, b) =>
        Math.abs(cents(b, target)) < Math.abs(cents(a, target)) ? b : a,
      );
      if (Math.abs(cents(nearest, target)) <= 40) {
        expect(p.hz).toBe(nearest);
        if (p.harmonic === undefined) snapped++;
      } else {
        expect(p).toMatchObject({ hz: target, harmonic: i + 1 });
      }
    });
    // Colundi isn't harmonic, so some partials move off the harmonic series.
    expect(snapped).toBeGreaterThan(0);
  });

  test("the golden genome uses a trajectory and a non-neutral macro", () => {
    const golden = requireGenome(droneGenome, "the drone golden genome");
    expect(golden.voices.map((v) => v.type)).toEqual([drone.type]);
    expect(golden.voices[0]?.cutoff).toHaveProperty("points");
    expect(golden.macros.brightness).not.toBe(0.5);
    // Brightness is mapped onto the cutoff, so the macro moves it.
    const raw = /** @type {any} */ (
      effectiveParams({ ...golden, macros: { ...golden.macros, brightness: 0.5 } }, 2)
    );
    expect(effectiveParams(golden, 2).voices[0]?.cutoff).toBeGreaterThan(raw.voices[0].cutoff);
  });
});
