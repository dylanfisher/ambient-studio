import { expect, test } from "vitest";
import { CHUNK_SECONDS, chunkWindows } from "../../src/engine/chunk-windows.js";
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";

test("a window splits into chunks on multiples of the chunk length from its own start", () => {
  const chunks = chunkWindows({ offset: 30, duration: 2.5 * CHUNK_SECONDS });
  expect(chunks).toEqual([
    { offset: 30, duration: CHUNK_SECONDS, frame: 0, frames: CHUNK_SECONDS * SAMPLE_RATE },
    {
      offset: 30 + CHUNK_SECONDS,
      duration: CHUNK_SECONDS,
      frame: CHUNK_SECONDS * SAMPLE_RATE,
      frames: CHUNK_SECONDS * SAMPLE_RATE,
    },
    {
      offset: 30 + 2 * CHUNK_SECONDS,
      duration: CHUNK_SECONDS / 2,
      frame: 2 * CHUNK_SECONDS * SAMPLE_RATE,
      frames: (CHUNK_SECONDS / 2) * SAMPLE_RATE,
    },
  ]);
});

test("a window splits the same way each time, and its chunks cover it to the frame", () => {
  const window = { offset: 12.3, duration: 3 * CHUNK_SECONDS + 7.7 };
  const chunks = chunkWindows(window);
  expect(chunkWindows(window)).toEqual(chunks);
  expect(chunks.reduce((sum, { frames }) => sum + frames, 0)).toBe(
    Math.round(window.duration * SAMPLE_RATE),
  );
  const last = chunks.at(-1);
  expect(last && last.offset + last.duration).toBe(window.offset + window.duration);
});

test("a chunk length can be given, for tests that render seconds", () => {
  expect(chunkWindows({ offset: 0, duration: 5 }, 2).map(({ duration }) => duration)).toEqual([
    2, 2, 1,
  ]);
});
