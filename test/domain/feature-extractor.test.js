import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { FEATURE_EXTRACTOR } from "../../src/domain/feature-extractor.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const ENTRIES = ["src/domain/extract-features.js", "src/domain/render-checks.js"];

/**
 * Every file the entries import, directly or not, as paths from the repository root.
 * @param {string[]} entries
 */
function closure(entries) {
  const found = new Set();
  const pending = [...entries];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (found.has(path)) continue;
    found.add(path);
    const source = readFileSync(join(root, path), "utf8");
    for (const [, spec] of source.matchAll(/^import\s[^"]*"(\.[^"]+)"/gm)) {
      pending.push(relative(root, join(root, dirname(path), /** @type {string} */ (spec))));
    }
  }
  return [...found].sort();
}

describe("FEATURE_EXTRACTOR", () => {
  test("names files that exist, from the repository root", () => {
    for (const path of FEATURE_EXTRACTOR) expect(existsSync(join(root, path)), path).toBe(true);
  });

  test("is every file the features and the render checks import, sorted", () => {
    expect(FEATURE_EXTRACTOR).toEqual(closure(ENTRIES));
  });
});
