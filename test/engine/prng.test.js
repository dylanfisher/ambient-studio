import { describe, expect, test } from "vitest";
import { draw, fires, TRIGGER_SLOT } from "../../src/engine/prng.js";

describe("draw", () => {
  test("gives fixed values for fixed keys", () => {
    expect([
      draw(1, "drone", 0, 0),
      draw(1, "drone", 0, 1),
      draw(1, "drone", 1, 0),
      draw(2, "drone", 0, 0),
      draw(1, "bells", 0, 0),
      draw(4294967295, "", 4294967295, 4294967295),
    ]).toEqual([
      0.6561638514976948, 0.4737285259179771, 0.6662384073715657, 0.645145726390183,
      0.18250594474375248, 0.46268068882636726,
    ]);
  });

  test("returns values in [0, 1)", () => {
    for (let event = 0; event < 2000; event++) {
      const value = draw(7, "pad", event, 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("draws for different voice ids don't share values", () => {
    const keys = Array.from({ length: 1000 }, (_, event) => event);
    const a = new Set(keys.map((event) => draw(3, "a", event, 0)));
    const b = keys.map((event) => draw(3, "b", event, 0));
    expect(a.size).toBe(1000);
    expect(b.filter((value) => a.has(value))).toEqual([]);
  });

  test("ids that a naive string hash would confuse draw differently", () => {
    expect(draw(1, "ab", 0, 0)).not.toBe(draw(1, "ba", 0, 0));
    expect(draw(1, "a", 0, 0)).not.toBe(draw(1, "a\u0000", 0, 0));
  });

  test("a draw doesn't depend on which other draws were made first", () => {
    const alone = draw(5, "cloud", 40, 2);
    for (let event = 0; event < 100; event++) draw(5, "cloud", event, 1);
    draw(9, "other", 40, 2);
    expect(draw(5, "cloud", 40, 2)).toBe(alone);
  });

  test("rejects keys outside unsigned 32-bit integers", () => {
    expect(() => draw(-1, "a", 0, 0)).toThrow(/seed/);
    expect(() => draw(2 ** 32, "a", 0, 0)).toThrow(/seed/);
    expect(() => draw(1.5, "a", 0, 0)).toThrow(/seed/);
    expect(() => draw(1, "a", -1, 0)).toThrow(/eventIndex/);
    expect(() => draw(1, "a", 0, Number.NaN)).toThrow(/slot/);
  });
});

describe("fires", () => {
  test("is the trigger slot's draw compared with the density", () => {
    for (let candidate = 0; candidate < 200; candidate++) {
      expect(fires(11, "bells", candidate, 0.3)).toBe(
        draw(11, "bells", candidate, TRIGGER_SLOT) < 0.3,
      );
    }
  });

  test("raising density by 10% keeps every original event and adds new ones", () => {
    const candidates = Array.from({ length: 5000 }, (_, i) => i);
    const at = (/** @type {number} */ density) =>
      candidates.filter((candidate) => fires(21, "bells", candidate, density));
    const before = at(0.2);
    const after = at(0.22);
    expect(before.length).toBeGreaterThan(900);
    expect(after.filter((candidate) => before.includes(candidate))).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
  });

  test("never fires at density 0 and always fires at density 1", () => {
    for (let candidate = 0; candidate < 500; candidate++) {
      expect(fires(2, "x", candidate, 0)).toBe(false);
      expect(fires(2, "x", candidate, 1)).toBe(true);
    }
  });

  test("rejects a density outside [0, 1]", () => {
    expect(() => fires(1, "x", 0, 1.1)).toThrow(/density/);
    expect(() => fires(1, "x", 0, -0.1)).toThrow(/density/);
  });
});
