import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * The versions besides the engine's that decide a render's samples (decisions 0002, 0009).
 * @typedef {object} RendererVersions
 * @property {string} node `process.version`
 * @property {string} nodeWebAudioApi the installed node-web-audio-api version
 */

/** @returns {RendererVersions} */
export function rendererVersions() {
  // The package's exports map doesn't list package.json, so it's read beside the entry point.
  const entry = createRequire(import.meta.url).resolve("node-web-audio-api");
  const pkg = JSON.parse(readFileSync(join(dirname(entry), "package.json"), "utf8"));
  return { node: process.version, nodeWebAudioApi: pkg.version };
}
