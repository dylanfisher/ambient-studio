// The `producer` key on a renders row (decisions 0021, 0023, 0026): the engine version and a hash
// of the feature extractor's source. A cached excerpt made under another one is rendered again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_EXTRACTOR } from "../domain/feature-extractor.js";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { sha256Hex } from "./sha256-hex.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * `engine-<version> features-<sha256>`, the hash over each file's path and contents in the
 * order given, each ended by a NUL, which neither a path nor a source file holds.
 * @param {number} engineVersion
 * @param {{ path: string, text: string }[]} sources
 * @returns {string}
 */
export function producerOf(engineVersion, sources) {
  const hashed = sources.map(({ path, text }) => `${path}\0${text}\0`).join("");
  return `engine-${engineVersion} features-${sha256Hex(hashed)}`;
}

/**
 * This process's producer, read once at start-up: the source a running server hashes is the
 * source it loaded.
 */
export const PRODUCER = producerOf(
  ENGINE_VERSION,
  FEATURE_EXTRACTOR.map((path) => ({
    path,
    text: readFileSync(join(REPOSITORY_ROOT, path), "utf8"),
  })),
);
