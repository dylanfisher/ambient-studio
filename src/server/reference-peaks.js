// The peak strip the References page draws (decision 0050): the loudest sample in each of
// `PEAK_COUNT` equal slices of the file. Derived: kept in the reference cache as
// `<sha256>-peaks.json`, and measured again when the file is missing or of another shape.
/** @import { Paths } from "../config/paths.js" */
/** @import { ReferenceFile } from "./reference-store.js" */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FFMPEG, FFMPEG_TIMEOUT_MS, inputArgs, rawStereoArgs } from "./decode-with-ffmpeg.js";
import { isMissing } from "./file-inside.js";

/** Slices in a strip: about one per pixel of the page's widest strip. */
export const PEAK_COUNT = 1000;

/** The rate the strip is measured at. A peak strip needs no more, and decodes an hour in seconds. */
const PEAK_RATE = 8000;
/** Bytes of one stereo frame of 32-bit floats. */
const FRAME_BYTES = 8;
/** Peaks are stored to this many decimal places, enough for a strip a few hundred pixels tall. */
const PLACES = 1e4;

/**
 * Measures a file's peaks by streaming its decode, so an hour's file never sits in memory.
 * Throws when ffmpeg fails, with its stderr.
 * @param {string} path
 * @param {number} durationSeconds the probed length, which sets the slices' width
 * @returns {Promise<number[]>} `PEAK_COUNT` values from 0 to 1 or more
 */
export async function measurePeaks(path, durationSeconds) {
  const totalFrames = Math.max(1, Math.round(durationSeconds * PEAK_RATE));
  const peaks = new Array(PEAK_COUNT).fill(0);
  const child = spawn(FFMPEG, [...inputArgs(path), ...rawStereoArgs(PEAK_RATE)], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: FFMPEG_TIMEOUT_MS.peaks,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let frame = 0;
  /** Bytes of a frame split across two chunks. */
  let carry = Buffer.alloc(0);
  child.stdout.on("data", (/** @type {Buffer} */ chunk) => {
    const bytes = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    const whole = bytes.length - (bytes.length % FRAME_BYTES);
    for (let at = 0; at < whole; at += FRAME_BYTES, frame++) {
      const level = Math.max(Math.abs(bytes.readFloatLE(at)), Math.abs(bytes.readFloatLE(at + 4)));
      // A file that runs past its probed length puts the rest in the last slice.
      const slice = Math.min(PEAK_COUNT - 1, Math.floor((frame * PEAK_COUNT) / totalFrames));
      if (level > peaks[slice]) peaks[slice] = level;
    }
    carry = Buffer.from(bytes.subarray(whole));
  });
  const [code, signal] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`ffmpeg exited with code ${code ?? signal} measuring ${path}:\n${stderr}`);
  }
  return peaks.map((peak) => Math.round(peak * PLACES) / PLACES);
}

/**
 * Where a file's peaks are kept.
 * @param {Paths} dataPaths
 * @param {ReferenceFile} reference
 */
const peaksFile = (dataPaths, reference) =>
  join(dataPaths.referenceCache, `${reference.sha256}-peaks.json`);

/**
 * Writes peaks to the cache, through a temp file and a rename, so a reader never sees half.
 * @param {Paths} dataPaths
 * @param {ReferenceFile} reference
 * @param {number[]} peaks
 */
export async function keepPeaks(dataPaths, reference, peaks) {
  await mkdir(dataPaths.referenceCache, { recursive: true });
  const temp = join(dataPaths.referenceCache, `peaks-${randomUUID()}`);
  await writeFile(temp, JSON.stringify(peaks));
  await rename(temp, peaksFile(dataPaths, reference));
}

/**
 * A kept file's peaks from the cache, measured and kept first when they aren't there or don't
 * have `PEAK_COUNT` values.
 * @param {Paths} dataPaths
 * @param {ReferenceFile} reference
 * @returns {Promise<number[]>}
 */
export async function readPeaks(dataPaths, reference) {
  try {
    const kept = JSON.parse(await readFile(peaksFile(dataPaths, reference), "utf8"));
    if (Array.isArray(kept) && kept.length === PEAK_COUNT) return kept;
  } catch (error) {
    if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
  }
  const path = join(dataPaths.references, reference.file);
  const peaks = await measurePeaks(path, reference.durationSeconds);
  await keepPeaks(dataPaths, reference, peaks);
  return peaks;
}
