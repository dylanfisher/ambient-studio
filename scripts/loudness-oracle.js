#!/usr/bin/env node
// Compares our meter with ffmpeg's on an export (decision 0008, phase 1 acceptance 4): runs
// ffmpeg's ebur128 filter on the WAV, reads our integrated loudness and true peak from the
// sidecar JSON beside it, and prints both with the differences. Exits 1 when a difference is
// outside ±0.2 LU or ±0.3 dB. Manual: nothing in the gate or the tests runs it.
//   ./scripts/loudness-oracle.js <export.wav>
// ffmpeg prints one decimal, so a difference reads to about ±0.05.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TOLERANCE = Object.freeze({ integrated: 0.2, truePeak: 0.3 });

const wav = process.argv[2];
if (!wav?.endsWith(".wav")) {
  console.error("usage: ./scripts/loudness-oracle.js <export.wav>");
  process.exit(2);
}
const sidecarPath = `${wav.slice(0, -".wav".length)}.json`;
const ours = JSON.parse(readFileSync(sidecarPath, "utf8")).loudness;

const ffmpeg = spawnSync(
  "ffmpeg",
  ["-nostats", "-i", wav, "-af", "ebur128=peak=true", "-f", "null", "-"],
  { encoding: "utf8" },
);
if (ffmpeg.status !== 0) {
  throw new Error(`ffmpeg exited ${ffmpeg.status}:\n${ffmpeg.stderr}`);
}
// The summary comes last: "Integrated loudness: I: -16.0 LUFS" and "True peak: Peak: -1.4 dBFS".
const summary = ffmpeg.stderr.slice(ffmpeg.stderr.lastIndexOf("Summary:"));
/** @param {RegExp} pattern */
function read(pattern) {
  const value = pattern.exec(summary)?.[1];
  if (value === undefined) throw new Error(`no ${pattern} in ffmpeg's summary:\n${summary}`);
  return Number(value);
}
const theirs = {
  integrated: read(/I:\s+(-?[\d.]+) LUFS/),
  truePeak: read(/Peak:\s+(-?[\d.]+) dBFS/),
};

let outside = false;
for (const [key, unit] of /** @type {const} */ ([
  ["integrated", "LUFS"],
  ["truePeak", "dBTP"],
])) {
  const difference = ours[key] - theirs[key];
  const ok = Math.abs(difference) <= TOLERANCE[key];
  outside ||= !ok;
  console.log(
    `${key.padEnd(10)} ours ${ours[key].toFixed(2)} ${unit}, ffmpeg ${theirs[key].toFixed(1)} ${unit}, difference ${difference.toFixed(2)} (±${TOLERANCE[key]}) ${ok ? "ok" : "OUTSIDE"}`,
  );
}
if (outside) process.exitCode = 1;
