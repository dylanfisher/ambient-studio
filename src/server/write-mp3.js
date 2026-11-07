// Playback audio as MP3 through the lame CLI (decision 0048). Only what the pages play is MP3:
// the excerpts in the render cache. A rated excerpt is kept as FLAC (0026), and exports stay WAV
// and FLAC (0012).
import { spawn } from "node:child_process";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { PCM24_BYTES } from "./encode-pcm24.js";

/** The lame CLI, found on PATH like flac (0012); Homebrew puts it in /opt/homebrew/bin. */
const LAME = "lame";

/** The constant bit rate of every playback MP3, in kbps. */
export const MP3_KBPS = 320;

/** The extension of a playback MP3, which the audio route serves as `audio/mpeg`. */
export const MP3_EXTENSION = ".mp3";

/** lame's channel mode for each channel count: mono, or joint stereo. */
const MODES = new Map([
  [1, "m"],
  [2, "j"],
]);

/**
 * Encodes 24-bit PCM as a constant-bit-rate MP3. The PCM goes to lame's stdin as raw samples,
 * so no WAV is written first.
 * @param {string} path
 * @param {Uint8Array} pcm interleaved 24-bit PCM from `encodePcm24`
 * @param {{ channelCount: number, sampleRate: number }} format
 */
export async function writeMp3(path, pcm, { channelCount, sampleRate }) {
  const mode = MODES.get(channelCount);
  if (!mode) throw new Error(`an MP3 takes 1 or 2 channels, not ${channelCount}`);
  const bits = String(PCM24_BYTES * 8);
  const khz = String(sampleRate / 1000);
  const args = ["-r", "-s", khz, "--bitwidth", bits, "--signed", "--little-endian", "-m", mode];
  const child = spawn(LAME, [...args, "-b", String(MP3_KBPS), "--cbr", "--silent", "-", path], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(pcm);
  const [input, exit] = await Promise.allSettled([finished(child.stdin), once(child, "close")]);
  if (exit.status === "rejected") throw exit.reason;
  const [code, signal] = exit.value;
  // Checked before the input: when lame fails early, writing its stdin fails with EPIPE, and
  // lame's stderr says why.
  if (code !== 0) {
    throw new Error(`lame exited with code ${code ?? signal} writing ${path}:\n${stderr}`);
  }
  if (input.status === "rejected") throw input.reason;
}
