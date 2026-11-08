// The folders under the app-data root (decision 0019).
import { isAbsolute, join, relative } from "node:path";
import { expect, test } from "vitest";
import { paths } from "../../src/config/paths.js";

test("paths() puts every folder under the root, each in its own place", () => {
  const root = join("/", "data", "Ambient Studio");
  const all = Object.values(paths(root));
  expect(all.length).toBeGreaterThan(0);
  for (const path of all) {
    const inside = relative(root, path);
    expect(inside).not.toBe("");
    expect(inside.startsWith("..")).toBe(false);
    expect(isAbsolute(inside)).toBe(false);
  }
  expect(new Set(all).size).toBe(all.length);
});

test("names the folders the store and job runner use", () => {
  const root = join("/", "data");
  expect(paths(root)).toEqual({
    database: join(root, "studio.db"),
    renderCache: join(root, "renders"),
    ratedAudio: join(root, "rated_audio"),
    backups: join(root, "backups"),
    models: join(root, "models"),
    rankings: join(root, "rankings"),
  });
});
