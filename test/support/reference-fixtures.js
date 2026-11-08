// Reference uploads made by ffmpeg at test time from seeded noise and a sine (decision 0050), so
// no recording is committed. Each accepted format has an entry, with the encoder that writes it.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The sample rate the fixtures are written at; 44.1 kHz, so every decode resamples. */
export const FIXTURE_RATE = 44100;

/**
 * Each accepted format's fixture: its file name and the encoder arguments. The native Vorbis
 * encoder is marked experimental and writes stereo only.
 */
export const FIXTURE_FORMATS = Object.freeze({
  wav: { file: "tone.wav", args: ["-c:a", "pcm_s16le"] },
  aiff: { file: "tone.aiff", args: ["-c:a", "pcm_s16be"] },
  flac: { file: "tone.flac", args: ["-c:a", "flac"] },
  mp3: { file: "tone.mp3", args: ["-c:a", "libmp3lame", "-b:a", "128k"] },
  aac: { file: "tone-aac.m4a", args: ["-c:a", "aac", "-b:a", "128k"] },
  alac: { file: "tone-alac.m4a", args: ["-c:a", "alac"] },
  vorbis: { file: "tone.ogg", args: ["-c:a", "vorbis", "-strict", "experimental", "-ac", "2"] },
  opus: { file: "tone.opus", args: ["-c:a", "libopus", "-b:a", "96k"] },
});

/**
 * @typedef {object} FixtureOptions
 * @property {number} [seconds] 12 when omitted
 * @property {number} [channels] 2 when omitted
 * @property {number} [seed] the noise's seed, 7 when omitted
 */

/**
 * Writes a file of seeded noise under a 440 Hz sine, with the given encoder arguments.
 * @param {string} folder
 * @param {string} file
 * @param {readonly string[]} codec ffmpeg's output arguments before the file
 * @param {FixtureOptions} [options]
 * @returns {Promise<string>} the file's path
 */
export async function makeFixture(
  folder,
  file,
  codec,
  { seconds = 12, channels = 2, seed = 7 } = {},
) {
  const path = join(folder, file);
  const source = `sine=frequency=440:sample_rate=${FIXTURE_RATE}:duration=${seconds}`;
  const noise = `anoisesrc=seed=${seed}:amplitude=0.05:sample_rate=${FIXTURE_RATE}:duration=${seconds}`;
  const graph = `[0][1]amix=inputs=2:normalize=0,pan=${channels}c|${Array.from(
    { length: channels },
    (_, c) => `c${c}=c0`,
  ).join("|")}`;
  await run("ffmpeg", [
    ...["-nostdin", "-v", "error", "-y"],
    ...["-f", "lavfi", "-i", source, "-f", "lavfi", "-i", noise],
    ...["-filter_complex", graph],
    ...codec,
    path,
  ]);
  return path;
}

/**
 * The fixture of one accepted format.
 * @param {string} folder
 * @param {keyof typeof FIXTURE_FORMATS} format
 * @param {FixtureOptions} [options]
 */
export const makeReference = (folder, format, options) =>
  makeFixture(folder, FIXTURE_FORMATS[format].file, FIXTURE_FORMATS[format].args, options);
