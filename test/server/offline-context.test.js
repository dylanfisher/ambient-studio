// The renderer spike from step 1a: what node-web-audio-api 2.2.0 does that the engine relies
// on. Answers and measurements are recorded in docs/decisions/0002-pin-node-web-audio-api.md.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, test } from "vitest";
import { retryOnSuspendRace } from "../../src/server/render-offline.js";
import {
  FRAMES,
  hashChannels,
  LATE_START_FRAME,
  renderEveryNode,
  SAMPLE_RATE,
  SUSPEND_FRAME,
} from "../support/render-graph.js";

const run = promisify(execFile);
const helper = fileURLToPath(new URL("../support/render-graph.js", import.meta.url));

/** @param {number} frames */
function stereoContext(frames) {
  return new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: SAMPLE_RATE });
}

/**
 * A one-frame impulse buffer, so the first nonzero output frame is where the source started.
 * @param {OfflineAudioContext} ctx
 */
function impulse(ctx) {
  const buffer = ctx.createBuffer(1, 1, SAMPLE_RATE);
  buffer.copyToChannel(new Float32Array([1]), 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

/**
 * @param {AudioBuffer} rendered
 * @returns {number[]} indices of nonzero frames in channel 0
 */
function nonzeroFrames(rendered) {
  const data = new Float32Array(rendered.length);
  rendered.copyFromChannel(data, 0);
  /** @type {number[]} */
  const frames = [];
  data.forEach((value, i) => {
    if (value !== 0) frames.push(i);
  });
  return frames;
}

describe("OfflineAudioContext at 48 kHz stereo", () => {
  test("offers every node type the engine uses", () => {
    const ctx = stereoContext(128);
    expect(ctx.sampleRate).toBe(48000);
    expect(ctx.destination.channelCount).toBe(2);
    const wave = ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
    expect(() => ctx.createOscillator().setPeriodicWave(wave)).not.toThrow();
    for (const create of [
      () => ctx.createBiquadFilter(),
      () => ctx.createGain(),
      () => ctx.createDelay(1),
      () => ctx.createConvolver(),
      () => ctx.createStereoPanner(),
      () => ctx.createBufferSource(),
      () => ctx.createChannelSplitter(2),
      () => ctx.createChannelMerger(2),
    ]) {
      expect(create().context).toBe(ctx);
    }
  });

  // Two renders in one process can match while separate runs differ, so each render gets its
  // own process.
  test("renders one graph to identical bytes in three separate processes", async () => {
    const runs = await Promise.all([1, 2, 3].map(() => run(process.execPath, [helper])));
    const hashes = runs.map(({ stdout }) => stdout.trim());
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(hashes).size).toBe(1);
    const channels = await renderEveryNode({ suspend: false });
    expect(hashChannels(channels)).toBe(hashes[0]);
    // A silent render would also hash the same everywhere.
    for (const data of channels) {
      expect(Math.max(...data.map(Math.abs))).toBeGreaterThan(0.05);
    }
  });

  test("renders the graph the same whether a source is created up front or in a suspend", async () => {
    const upFront = await renderEveryNode({ suspend: false });
    const suspended = await renderEveryNode({ suspend: true });
    expect(upFront[0]?.length).toBe(FRAMES);
    expect(hashChannels(suspended)).toBe(hashChannels(upFront));
  });

  test("starts a node created in a suspend callback on its exact frame", async () => {
    const rendered = await retryOnSuspendRace(async () => {
      const ctx = stereoContext(8192);
      const suspended = ctx.suspend(SUSPEND_FRAME / SAMPLE_RATE).then(() => {
        const source = impulse(ctx);
        source.connect(ctx.destination);
        source.start(LATE_START_FRAME / SAMPLE_RATE);
        return ctx.resume();
      });
      // Awaited together, so a refused suspend rejects instead of dropping the impulse.
      const [buffer] = await Promise.all([ctx.startRendering(), suspended]);
      return buffer;
    });
    expect(nonzeroFrames(rendered)).toEqual([LATE_START_FRAME]);
  });
});

describe("a DelayNode inside a feedback loop", () => {
  /**
   * Feeds one impulse into sum -> delay -> gain(0.5) -> sum and returns where the first echo
   * lands relative to the impulse.
   * @param {number} delayFrames the delay time asked for
   */
  async function echoSpacing(delayFrames) {
    const ctx = stereoContext(2048);
    const sum = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = delayFrames / SAMPLE_RATE;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    sum.connect(delay).connect(feedback).connect(sum);
    sum.connect(ctx.destination);
    const source = impulse(ctx);
    source.connect(sum);
    source.start(0);
    const [first, second] = nonzeroFrames(await ctx.startRendering());
    if (first === undefined || second === undefined) throw new Error("no echo rendered");
    return second - first;
  }

  // The spec clamps a delay in a cycle to at least one render quantum; this pins what 2.2.0 does.
  test.each([
    [0, 128],
    [1, 128],
    [64, 128],
    [127, 128],
  ])("asked for %i frames, echoes after %i", async (asked, measured) => {
    expect(await echoSpacing(asked)).toBe(measured);
  });

  test("keeps a delay longer than one quantum as asked", async () => {
    expect(await echoSpacing(200)).toBe(200);
  });
});
