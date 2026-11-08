// A track's mix (decision 0062): each section's window through `renderChunks`, neighbors summed
// with an equal-power crossfade, and a span of it, as the seam preview renders, equal to that
// span of the whole mix. Sections are seconds long.
/** @import { TrackPlan } from "../../src/server/mix-track.js" */
import { expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { mixTrack, trackFrames } from "../../src/server/mix-track.js";
import { renderOffline } from "../../src/server/render-offline.js";

const unfaded = requireGenome({ ...droneGenome, fadeIn: 0, fadeOut: 0 }, "drone");
const other = requireGenome({ ...droneGenome, fadeIn: 0, fadeOut: 0, key: 5 }, "other");

/** Two sections of 4 s and 5 s with a 2 s crossfade: 7 s. */
/** @type {TrackPlan} */
const plan = {
  sections: [
    { genome: unfaded, seed: 1, offset: 6, duration: 4 },
    { genome: other, seed: 2, offset: 20, duration: 5 },
  ],
  transitions: [2],
  fades: { fadeIn: 0, fadeOut: 0 },
};

/**
 * The whole of a mix, or of a span of it, joined.
 * @param {AsyncIterable<Float32Array[]>} blocks
 */
async function joined(blocks) {
  /** @type {Float32Array[][]} */
  const parts = [];
  // Copied: each block is a view the next one overwrites.
  for await (const block of blocks) parts.push(block.map((channel) => channel.slice()));
  return [0, 1].map((c) => {
    const length = parts.reduce((sum, block) => sum + (block[c]?.length ?? 0), 0);
    const out = new Float32Array(length);
    let at = 0;
    for (const block of parts) {
      const channel = /** @type {Float32Array} */ (block[c]);
      out.set(channel, at);
      at += channel.length;
    }
    return out;
  });
}

test("the overlap is the equal-power sum of the two windows, and the rest each window alone", async () => {
  expect(trackFrames(plan)).toBe(7 * SAMPLE_RATE);
  const mix = await joined(mixTrack(plan, { chunkSeconds: 3 }));
  const [a, b] = await Promise.all(plan.sections.map((s) => renderOffline(s.genome, s)));
  const fade = 2 * SAMPLE_RATE;
  const start = 2 * SAMPLE_RATE;
  for (const c of [0, 1]) {
    const out = /** @type {Float32Array} */ (mix[c]);
    const first = /** @type {Float32Array} */ (a?.channels[c]);
    const second = /** @type {Float32Array} */ (b?.channels[c]);
    expect(out.length).toBe(7 * SAMPLE_RATE);
    let worst = 0;
    for (let i = 0; i < fade; i++) {
      const x = (Math.PI / 2) * ((i + 0.5) / fade);
      const want = (first[start + i] ?? 0) * Math.cos(x) + (second[i] ?? 0) * Math.sin(x);
      worst = Math.max(worst, Math.abs((out[start + i] ?? 0) - want));
    }
    // Two float32 roundings of a sum of samples under 1, and 3 s chunks against one render.
    expect(worst).toBeLessThan(1e-5);
    let solo = 0;
    for (let i = 0; i < start; i++)
      solo = Math.max(solo, Math.abs((out[i] ?? 0) - (first[i] ?? 0)));
    for (let i = fade; i < 5 * SAMPLE_RATE; i++) {
      solo = Math.max(solo, Math.abs((out[start + i] ?? 0) - (second[i] ?? 0)));
    }
    expect(solo).toBeLessThan(1e-5);
  }
});

test("a span around the crossfade equals that span of the whole mix, from fewer chunks", async () => {
  const whole = await joined(mixTrack(plan, { chunkSeconds: 1 }));
  const from = 1.5 * SAMPLE_RATE;
  const to = 4.5 * SAMPLE_RATE;
  /** @type {string[]} */
  const steps = [];
  const span = await joined(
    mixTrack(plan, {
      chunkSeconds: 1,
      from,
      to,
      progress: (_done, _total, step) => steps.push(step),
    }),
  );
  for (const c of [0, 1]) {
    expect(span[c]).toEqual(whole[c]?.slice(from, to));
  }
  // Chunks 2 to 4 of the first section and 1 to 3 of the second.
  expect(steps).toEqual([
    "Rendering section 1 of 2, chunk 1 of 3",
    "Rendering section 1 of 2, chunk 2 of 3",
    "Rendering section 1 of 2, chunk 3 of 3",
    "Rendering section 2 of 2, chunk 1 of 3",
    "Rendering section 2 of 2, chunk 2 of 3",
    "Rendering section 2 of 2, chunk 3 of 3",
  ]);
});

test("the track's fades fall on its first and last frames", async () => {
  const faded = { ...plan, fades: { fadeIn: 1, fadeOut: 1 } };
  const plain = await joined(mixTrack(plan, { chunkSeconds: 3 }));
  const mix = await joined(mixTrack(faded, { chunkSeconds: 3 }));
  const last = 7 * SAMPLE_RATE - 1;
  expect(Math.abs(mix[0]?.[0] ?? 1)).toBeLessThan(Math.abs(plain[0]?.[0] ?? 0) * 1e-6 + 1e-12);
  expect(Math.abs(mix[0]?.[last] ?? 1)).toBeLessThan(
    Math.abs(plain[0]?.[last] ?? 0) * 1e-6 + 1e-12,
  );
  expect(mix[0]?.slice(SAMPLE_RATE, 6 * SAMPLE_RATE)).toEqual(
    plain[0]?.slice(SAMPLE_RATE, 6 * SAMPLE_RATE),
  );
});
