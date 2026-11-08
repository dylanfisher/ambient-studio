#!/usr/bin/env node
// The render-speed bench (decision 0016), run by ./scripts/bench under `nice -n 10`. For each
// case it starts one child process for the render alone and one for render plus export, each
// under /usr/bin/time -l for its peak RSS, and prints the ratio of audio time to wall time.
// mbp2021 only: it reads macOS's /usr/bin/time output. Not part of ./scripts/check. A last case
// times the features and render checks on a 30 s excerpt (decision 0023).
//   ./scripts/bench                 the 300 s case, then the 720 s case, the render's peak RSS
//                                   projected from both to 0010's 900 s, then the features case
//   ./scripts/bench --duration S    one case, 300 or 720, which takes under 5 minutes
//   ./scripts/bench --features      the features case alone, which takes seconds
//   ./scripts/bench --track         a 20-minute and a 10-minute track of five golden genomes
//                                   with four crossfades (decision 0062), each rendered alone and
//                                   rendered and exported, against phase 6's 1 GiB ceiling
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyArrangement } from "../src/domain/arrangement-schema.js";
import { extractFeatures } from "../src/domain/extract-features.js";
import { normalize } from "../src/domain/normalize.js";
import { renderChecks } from "../src/domain/render-checks.js";
import { sectionGenome } from "../src/domain/section-genome.js";
import { trackCost } from "../src/domain/track-cost.js";
import { trackFades } from "../src/domain/track-fades.js";
import { cost } from "../src/engine/cost.js";
import { requireGenome } from "../src/engine/validate-genome.js";
import { exportRender } from "../src/server/export-render.js";
import { mixTrack } from "../src/server/mix-track.js";
import { renderOffline } from "../src/server/render-offline.js";
import { renderTrack } from "../src/server/render-track.js";
import { writeFlac } from "../src/server/write-flac.js";

const SELF = fileURLToPath(import.meta.url);
const GENOME_PATH = fileURLToPath(new URL("../src/engine/genomes/example.json", import.meta.url));
const SEED = 1;
/** Timed runs after the one warm-up, per case: 0016's five, and two for the long case. */
const CASES = Object.freeze({ 300: 5, 720: 2 });
/** Decision 0010's memory ceiling, for a 900 s render. */
const RSS_CEILING = { bytes: 1.5 * 2 ** 30, seconds: 900 };
const TARGET_SPEED = 10;
const MODES = Object.freeze({ render: "render", export: "render+export" });
/** The features case: one excerpt of this length, timed this many runs after a warm-up. */
const FEATURES_CASE = Object.freeze({ duration: 30, runs: 5 });
const MIB = 2 ** 20;
/**
 * The track cases (decision 0062): the golden genomes its five sections play, in order, where
 * each starts on its timeline, its crossfades' seconds, and one timed run per child for each
 * length, with no warm-up, so each case stays under 5 minutes (agent rule 9). The 10-minute case
 * is there for memory: its peak RSS within 10% of the 20-minute one's says memory doesn't grow
 * with length. Sections start past 0 so that in both cases a full chunk renders with its
 * pre-roll, the largest context a chunk makes; from 0, the 10-minute case's only full chunks
 * have none.
 */
const TRACK = Object.freeze({
  genomes: ["example", "drone", "colundi", "pad", "bell"],
  offset: 30,
  transition: 10,
  lengths: [1200, 600],
  ceiling: 2 ** 30,
  spread: 0.1,
});
const TRACK_MODES = Object.freeze({ "track-render": "render", "track-export": "render+export" });

/** @typedef {keyof typeof MODES} Mode */
/** @typedef {keyof typeof TRACK_MODES} TrackMode */
/** @typedef {Mode | TrackMode | "features"} ChildMode */

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
 * @param {ChildMode} mode
 * @param {number} duration
 * @param {number} runs
 */
async function child(mode, duration, runs) {
  if (mode === "track-render" || mode === "track-export") return trackChild(mode, duration);
  const genome = benchGenome(duration);
  if (mode === "features") return featuresChild(genome, duration, runs);
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
 * The features child: renders and normalizes once, untimed, then times `extractFeatures` and
 * `renderChecks` on the result, printed as `child` prints.
 * @param {ReturnType<typeof benchGenome>} genome
 * @param {number} duration
 * @param {number} runs
 */
async function featuresChild(genome, duration, runs) {
  const raw = await renderOffline(genome, { seed: SEED, duration });
  const heard = normalize(raw.channels, raw.sampleRate, { target: genome.loudness });
  /** @type {number[]} */
  const seconds = [];
  for (let run = 0; run <= runs; run++) {
    const start = performance.now();
    extractFeatures(raw, heard);
    renderChecks(raw, genome);
    seconds.push((performance.now() - start) / 1000);
  }
  console.log(JSON.stringify(seconds));
}

/**
 * The track case's arrangement and plan: five sections of the golden genomes, each extended to
 * its length as `sectionGenome` does, with equal crossfades between them, `length` seconds in all.
 * @param {number} length
 */
function benchTrack(length) {
  const { genomes: names, transition } = TRACK;
  const seconds = (length + transition * (names.length - 1)) / names.length;
  /** @type {Map<number, unknown>} */
  const genomes = new Map(
    names.map((name, i) => [
      i + 1,
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL(`../src/engine/genomes/${name}.json`, import.meta.url)),
          "utf8",
        ),
      ),
    ]),
  );
  const arrangement = {
    ...emptyArrangement(),
    sections: names.map((_, i) => ({ sketchId: i + 1, offset: TRACK.offset, seconds })),
    transitions: names.slice(1).map(() => ({ kind: "crossfade", seconds: transition })),
  };
  const plan = {
    sections: arrangement.sections.map((section, index) => ({
      genome: sectionGenome(arrangement, index, genomes),
      seed: SEED,
      offset: section.offset,
      duration: section.seconds,
    })),
    transitions: arrangement.transitions.map(({ seconds: s }) => s),
    fades: trackFades(arrangement, genomes),
  };
  return { plan, cost: trackCost(arrangement, genomes) };
}

/**
 * The track child: one run, timed, printed as `child` prints. Render alone mixes every chunk and
 * drops the blocks; render and export is the track job's path, raw file, normalize, WAV and MP3,
 * plus the export's FLAC, all in a temp folder.
 * @param {TrackMode} mode
 * @param {number} length
 */
async function trackChild(mode, length) {
  const { plan } = benchTrack(length);
  const dir = await mkdtemp(join(tmpdir(), "bench-track-"));
  const start = performance.now();
  try {
    if (mode === "track-render") {
      let frames = 0;
      for await (const block of mixTrack(plan)) frames += block[0]?.length ?? 0;
      if (frames === 0) throw new Error("bench: the track mixed no frames");
    } else {
      const wav = join(dir, "mix.wav");
      await renderTrack(plan, {
        loudness: { target: -16, ceiling: -1 },
        tempDir: dir,
        wav,
        mp3: join(dir, "mix.mp3"),
      });
      await writeFlac(wav, join(dir, "mix.flac"));
    }
  } finally {
    await rm(dir, { recursive: true });
  }
  console.log(JSON.stringify([(performance.now() - start) / 1000]));
}

/** The track cases, then whether the peaks meet the ceiling and don't grow with length. */
function benchTracks() {
  /** @type {Record<number, number>} */
  const rss = {};
  for (const length of TRACK.lengths) {
    const { cost: found } = benchTrack(length);
    console.log(
      `${length} s track of ${TRACK.genomes.join(", ")} from ${TRACK.offset} s, ${TRACK.transition} s crossfades, seed ${SEED}; peak cost ${found.peak.toFixed(1)}, ${(found.work / 1e3).toFixed(0)}k node-seconds; 1 timed run`,
    );
    for (const mode of /** @type {TrackMode[]} */ (Object.keys(TRACK_MODES))) {
      console.log(`  ${load()}`);
      const { seconds, rss: peak } = measure(mode, length, 1);
      const wall = seconds[0] ?? NaN;
      if (mode === "track-render") rss[length] = peak;
      console.log(
        `  ${TRACK_MODES[mode].padEnd(13)} ${(length / wall).toFixed(1)}x, ${wall.toFixed(1)} s, ${(found.work / wall).toFixed(0)} node-seconds a second; peak RSS ${mib(peak)} (${peak <= TRACK.ceiling ? "under" : "over"} ${mib(TRACK.ceiling)})`,
      );
    }
  }
  console.log(`  ${load()}`);
  const [long, short] = TRACK.lengths.map((length) => rss[length] ?? NaN);
  const spread =
    Math.abs(/** @type {number} */ (short) - /** @type {number} */ (long)) /
    /** @type {number} */ (long);
  console.log(
    `render peak RSS at ${TRACK.lengths[1]} s is ${(spread * 100).toFixed(1)}% from ${TRACK.lengths[0]} s's, ${spread <= TRACK.spread ? "within" : "outside"} ${TRACK.spread * 100}%`,
  );
}

/**
 * Runs a child under /usr/bin/time -l.
 * @param {ChildMode} mode
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

function benchFeatures() {
  const { duration, runs } = FEATURES_CASE;
  console.log(
    `${duration} s excerpt of example.json, seed ${SEED}, rendered and normalized once; 1 warm-up + ${runs} timed runs`,
  );
  console.log(`  ${load()}`);
  const { seconds, rss } = measure("features", duration, runs);
  const timed = seconds.slice(1);
  console.log(
    `  ${"features+checks".padEnd(13)} median ${median(timed).toFixed(3)} s (${(duration / median(timed)).toFixed(0)}x), slowest ${Math.max(...timed).toFixed(3)} s; peak RSS ${mib(rss)}; runs ${seconds.map((s) => s.toFixed(3)).join(" ")} s (warm-up first)`,
  );
  console.log(`  ${load()}`);
}

const childAt = process.argv.indexOf("--child");
if (childAt !== -1) {
  const [mode, duration, runs] = process.argv.slice(childAt + 1);
  if (
    mode !== "render" &&
    mode !== "export" &&
    mode !== "features" &&
    mode !== "track-render" &&
    mode !== "track-export"
  ) {
    throw new Error(`bench: no mode "${mode}"`);
  }
  await child(mode, Number(duration), Number(runs));
} else if (process.argv.includes("--track")) {
  benchTracks();
} else if (process.argv.includes("--features")) {
  benchFeatures();
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
  if (durationAt === -1) benchFeatures();
}
