import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { preRoll, renderPlan, trimToResult } from "../../src/engine/render-plan.js";
import { requireGenome } from "../../src/engine/validate-genome.js";

const golden = requireGenome(droneGenome, "the drone golden genome");
const RATE = 48000;

describe("renderPlan", () => {
  test("a render from 0 has no pre-roll and nothing to trim", () => {
    const plan = renderPlan(golden, { duration: 3, offset: 0 });
    expect(plan).toMatchObject({ sampleRate: RATE, channels: 2, startFrame: 0, trim: 0 });
    expect(plan.frames).toBe(3 * RATE);
    expect(plan.length).toBe(3 * RATE);
  });

  test("an excerpt starts its context a pre-roll early, on a render-quantum boundary", () => {
    const offset = 30.123;
    const plan = renderPlan(golden, { duration: 2.5, offset });
    const offsetFrame = Math.round(offset * RATE);
    const earliest = offsetFrame - Math.ceil(preRoll(golden, offset) * RATE);
    expect(plan.startFrame % 128).toBe(0);
    expect(plan.startFrame).toBeLessThanOrEqual(earliest);
    expect(plan.startFrame).toBeGreaterThan(earliest - 128);
    expect(plan.startFrame + plan.trim).toBe(offsetFrame);
    expect(plan.frames).toBe(2.5 * RATE);
    expect(plan.length).toBe(plan.trim + plan.frames);
  });

  test("the pre-roll is the reverb decay plus the time the echo takes to fall 60 dB", () => {
    // 0.4 s × 60 dB / (−20 log10 0.3) dB per echo.
    const echo = (0.4 * 60) / (-20 * Math.log10(0.3));
    expect(preRoll(golden, 30)).toBeCloseTo(2 + echo, 12);
    expect(preRoll({ ...golden, delayFeedback: 0 }, 30)).toBe(2);
  });

  test("the pre-roll takes the highest feedback a trajectory reaches before the offset", () => {
    const rising = {
      ...golden,
      delayFeedback: /** @type {any} */ ({
        points: [
          [0, 0.1],
          [20, 0.6, "linear"],
          [40, 0, "linear"],
        ],
      }),
    };
    const echo = (0.4 * 60) / (-20 * Math.log10(0.6));
    expect(preRoll(rising, 30)).toBeCloseTo(2 + echo, 9);
  });

  test("the pre-roll stops at timeline 0", () => {
    expect(renderPlan(golden, { duration: 2, offset: 1 }).startFrame).toBe(0);
    expect(renderPlan(golden, { duration: 2, offset: 1 }).trim).toBe(RATE);
  });

  test.each([
    ["a duration of 0", { duration: 0, offset: 0 }, /duration/],
    ["a negative offset", { duration: 2, offset: -1 }, /offset/],
    ["a window past the timeline", { duration: 5, offset: 57 }, /past the genome's 60 s/],
  ])("throws on %s", (_, options, message) => {
    expect(() => renderPlan(golden, options)).toThrow(message);
  });
});

describe("trimToResult", () => {
  test("drops the pre-roll and keeps the requested frames, with the engine version", () => {
    const plan = renderPlan(golden, { duration: 0.01, offset: 10 });
    const ctx = new OfflineAudioContext({
      numberOfChannels: 2,
      length: plan.length,
      sampleRate: RATE,
    });
    const buffer = ctx.createBuffer(2, plan.length, RATE);
    const ramp = Float32Array.from({ length: plan.length }, (_, i) => i);
    buffer.copyToChannel(ramp, 0);
    buffer.copyToChannel(
      ramp.map((x) => -x),
      1,
    );
    const result = trimToResult(buffer, plan);
    expect(result.sampleRate).toBe(RATE);
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.channels.map((c) => c.length)).toEqual([plan.frames, plan.frames]);
    expect(result.channels[0]?.[0]).toBe(plan.trim);
    expect(result.channels[1]?.[plan.frames - 1]).toBe(-(plan.length - 1));
  });

  test("throws on a buffer of another length", () => {
    const plan = renderPlan(golden, { duration: 0.01, offset: 0 });
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 128, sampleRate: RATE });
    expect(() => trimToResult(ctx.createBuffer(2, 128, RATE), plan)).toThrow(/480 frames/);
  });
});
