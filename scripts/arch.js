#!/usr/bin/env node
// Enforces the tier rules in docs/map.md. This file holds the rules; map.md describes them.
// Fails on an import edge the table forbids, on a src/ file outside every tier, and on any
// non-relative import from a tier the browser loads as-is: the web UI has no build step, so a
// `node:` module or a bare package name there breaks in the browser and nowhere else. Also fails
// on `Math.random` or `Date.now` in the engine, which must render the same audio from a seed.
// `--root <dir>` checks another tree instead of this repo; scripts/arch-test uses it.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const rootArg = process.argv.indexOf("--root");
const rootValue = rootArg === -1 ? undefined : process.argv[rootArg + 1];
if (rootArg !== -1 && !rootValue) {
  console.error("arch: --root needs a directory");
  process.exit(2);
}
const root = rootValue
  ? resolve(rootValue)
  : resolve(dirname(new URL(import.meta.url).pathname), "..");
const src = join(root, "src");

/** @type {Record<string, string[]>} tier → tiers it may import from */
const allowed = {
  engine: [],
  domain: ["engine"],
  config: [],
  server: ["domain", "engine", "config"],
  web: ["domain", "engine"],
};
const browserTiers = new Set(["engine", "domain", "web"]);
const unseeded = /\b(Math\.random|Date\.now)\b/g;

const importPattern =
  /(?:^|[\s;])(?:import|export)\s(?:[^'"`;]*?\sfrom\s)?\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.m?js$/.test(entry.name) ? [path] : [];
  });
}

/** @param {string} file */
const tierOf = (file) => relative(src, file).split("/")[0] ?? "";

const problems = [];
for (const file of walk(src)) {
  const tier = tierOf(file);
  const shown = relative(root, file);
  if (!(tier in allowed)) {
    problems.push(`${shown}: not inside a tier (${Object.keys(allowed).join(", ")})`);
    continue;
  }
  const text = readFileSync(file, "utf8");
  if (tier === "engine") {
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(unseeded)) {
        problems.push(
          `${shown}:${index + 1}: uses ${match[1]}; the engine draws only from its seeded PRNG`,
        );
      }
    });
  }
  for (const match of text.matchAll(importPattern)) {
    const spec = match[1] ?? match[2] ?? "";
    if (!spec.startsWith(".")) {
      if (browserTiers.has(tier)) {
        problems.push(`${shown}: imports "${spec}"; ${tier} runs in the browser unbundled`);
      }
      continue;
    }
    const target = tierOf(resolve(dirname(file), spec));
    if (target !== tier && !allowed[tier]?.includes(target)) {
      problems.push(`${shown}: ${tier} may not import ${target} ("${spec}")`);
    }
  }
}

if (problems.length > 0) {
  console.error(`tier rules broken (see docs/map.md):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("tier rules hold");
