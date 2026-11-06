#!/usr/bin/env node
// The render-speed bench (decision 0016), run by ./scripts/bench under `nice -n 10`. For each
// case it starts one child process for the render alone and one for render plus export, each
// under /usr/bin/time -l for its peak RSS, and prints the ratio of audio time to wall time.
// mbp2021 only: it reads macOS's /usr/bin/time output. Not part of ./scripts/check.
//   ./scripts/bench                 the 300 s case, then the 720 s case, and the render's peak
//                                   RSS projected from both to 0010's 900 s
//   ./scripts/bench --duration S    one case, 300 or 720, which takes under 5 minutes
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cost } from "../src/engine/cost.js";
import { requireGenome } from "../src/engine/validate-genome.js";
import { exportRender } from "../src/server/export-render.js";
import { renderOffline } from "../src/server/render-offline.js";

const SELF = fileURLToPath(import.meta.url);
const GENOME_PATH = fileURLToPath(new URL("../src/engine/genomes/example.json", import.meta.url));
const SEED = 1;
/** Timed runs after the one warm-up, per case: 0016's five, and two for the long case. */
const CASES = Object.freeze({ 300: 5, 720: 2 });
/** Decision 0010's memory ceiling, for a 900 s render. */
const RSS_CEILING = { bytes: 1.5 * 2 ** 30, seconds: 900 };
const TARGET_SPEED = 10;
const MODES = Object.freeze({ render: "render", export: "render+export" });
const MIB = 2 ** 20;

/** @typedef {keyof typeof MODES} Mode */

/**
 * The example genome stretched to `duration` when the case is longer than its timeline, so the
 * fade-out lands at the case's end.
 * @param {number} duration
 */
function benchGenome(duration) {
  const genome = requireGenome(JSON.parse(readFileSync(GENOME_PATH, "utf8")), GENOME_PATH);
  return { ...genome, duration: Math.max(genome.duration, duration) };
}

/**
 * The child: a warm-up and then `runs` timed runs in one process, printing the wall seconds of
 * each as JSON, warm-up first.
 * @param {Mode} mode
 * @param {number} duration
 * @param {number} runs
 */
async function child(mode, duration, runs) {
  const genome = benchGenome(duration);
  /** @type {number[]} */
  const seconds = [];
  for (let run = 0; run <= runs; run++) {
    const outDir = mode === "export" ? await mkdtemp(join(tmpdir(), "bench-")) : "";
    const start = performance.now();
    if (mode === "render") {
      await renderOffline(genome, { seed: SEED, duration });
    } else {
      await exportRender(genome, { seed: SEED, duration, target: genome.loudness, outDir });
    }
    seconds.push((performance.now() - start) / 1000);
    if (outDir) await rm(outDir, { recursive: true });
  }
  console.log(JSON.stringify(seconds));
}

/**
 * Runs a child under /usr/bin/time -l.
 * @param {Mode} mode
 * @param {number} duration
 * @param {number} runs
 * @returns {{ seconds: number[]; rss: number }} wall seconds, warm-up first, and peak RSS bytes
 */
function measure(mode, duration, runs) {
  const args = ["-l", process.execPath, SELF, "--child", mode, String(duration), String(runs)];
  const result = spawnSync("/usr/bin/time", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`bench: the ${mode} child exited ${result.status}:\n${result.stderr}`);
  }
  const rss = /(\d+)\s+maximum resident set size/.exec(result.stderr)?.[1];
  if (rss === undefined) {
    throw new Error(`bench: no peak RSS in /usr/bin/time's output:\n${result.stderr}`);
  }
  return { seconds: JSON.parse(result.stdout.trim().split("\n").at(-1) ?? ""), rss: Number(rss) };
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return Number.isInteger(mid)
    ? ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2
    : (sorted[Math.floor(mid)] ?? NaN);
}

const load = () =>
  `load average ${loadavg()
    .map((x) => x.toFixed(2))
    .join(" ")}`;
const mib = (/** @type {number} */ bytes) => `${(bytes / MIB).toFixed(0)} MiB`;

/** @param {number} duration */
function bench(duration) {
  const runs = CASES[/** @type {keyof typeof CASES} */ (duration)];
  const genome = benchGenome(duration);
  console.log(
    `${duration} s of example.json, seed ${SEED}, 48 kHz stereo; cost ${cost(genome).toFixed(1)}; 1 warm-up + ${runs} timed runs`,
  );
  /** @type {Partial<Record<Mode, { median: number; rss: number }>>} */
  const found = {};
  for (const mode of /** @type {Mode[]} */ (Object.keys(MODES))) {
    console.log(`  ${load()}`);
    const { seconds, rss } = measure(mode, duration, runs);
    const ratios = seconds.slice(1).map((s) => duration / s);
    found[mode] = { median: median(ratios), rss };
    console.log(
      `  ${MODES[mode].padEnd(13)} median ${median(ratios).toFixed(1)}x, slowest ${Math.min(...ratios).toFixed(1)}x; peak RSS ${mib(rss)}; runs ${seconds.map((s) => s.toFixed(2)).join(" ")} s (warm-up first)`,
    );
  }
  console.log(`  ${load()}`);
  return /** @type {Record<Mode, { median: number; rss: number }>} */ (found);
}

const childAt = process.argv.indexOf("--child");
if (childAt !== -1) {
  const [mode, duration, runs] = process.argv.slice(childAt + 1);
  if (mode !== "render" && mode !== "export") throw new Error(`bench: no mode "${mode}"`);
  await child(mode, Number(duration), Number(runs));
} else {
  const durationAt = process.argv.indexOf("--duration");
  const durations =
    durationAt === -1 ? Object.keys(CASES).map(Number) : [Number(process.argv[durationAt + 1])];
  for (const duration of durations) {
    if (!Object.hasOwn(CASES, duration)) {
      throw new Error(`bench: --duration must be one of ${Object.keys(CASES).join(", ")}`);
    }
  }
  /** @type {[number, number][]} duration and the render's peak RSS */
  const rss = [];
  for (const duration of durations) {
    const { render } = bench(duration);
    rss.push([duration, render.rss]);
    console.log(
      `  render-only median ${render.median >= TARGET_SPEED ? "meets" : "misses"} the ${TARGET_SPEED}x target`,
    );
  }
  const [short, long] = rss;
  if (short && long) {
    // A straight line through the two cases, since RSS has a fixed part that doesn't scale.
    const [d0, r0] = short;
    const [d1, r1] = long;
    const projected = r1 + ((r1 - r0) / (d1 - d0)) * (RSS_CEILING.seconds - d1);
    console.log(
      `render peak RSS projected to ${RSS_CEILING.seconds} s: ${mib(projected)}, ${projected <= RSS_CEILING.bytes ? "under" : "over"} the ${mib(RSS_CEILING.bytes)} ceiling (0010)`,
    );
  }
}
