import { spawn } from "node:child_process";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

/**
 * Encodes a WAV file to FLAC with the `flac` CLI found on PATH (0012). The WAV is streamed to
 * flac's stdin, so a long render isn't held in memory a second time.
 * @param {string} wavPath
 * @param {string} flacPath
 */
export async function writeFlac(wavPath, flacPath) {
  const child = spawn("flac", ["--best", "--silent", "-o", flacPath, "-"], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [input, exit] = await Promise.allSettled([
    pipeline(createReadStream(wavPath), child.stdin),
    once(child, "close"),
  ]);
  if (exit.status === "rejected") throw exit.reason;
  const [code, signal] = exit.value;
  // Checked before the input: when flac fails early, writing its stdin fails with EPIPE, and
  // flac's stderr says why.
  if (code !== 0) {
    throw new Error(`flac exited with code ${code ?? signal} writing ${flacPath}:\n${stderr}`);
  }
  if (input.status === "rejected") throw input.reason;
}
