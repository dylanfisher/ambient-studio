// A temp data root and a config file pointing into it (decision 0019), so no test reads or
// writes the owner's real folders. The config starts from src/config/example.json.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import example from "../../src/config/example.json" with { type: "json" };

/** The dummy omlx key every test config carries; no real key is ever used in a test. */
export const TEST_OMLX_KEY = "test-omlx-key-0123456789";

/**
 * @typedef {object} TempRoot
 * @property {string} root the temp folder, which is also the config's `dataRoot`
 * @property {string} configPath the config file, `root/config.json`
 * @property {() => Promise<void>} remove deletes the temp folder
 */

/**
 * Makes a temp folder and writes a config into it whose `dataRoot` is that folder and whose
 * `fieldRecordings` is `null`, written with mode 600 and the dummy `TEST_OMLX_KEY`. `edit` changes the parsed JSON before it is written, so a test can
 * point `omlx.baseUrl` at a fake or write a broken file. Load it with `loadConfig(configPath)`.
 * @param {(raw: Record<string, any>) => void} [edit]
 * @returns {Promise<TempRoot>}
 */
export async function tempRoot(edit) {
  const root = await mkdtemp(join(tmpdir(), "ambient-studio-"));
  /** @type {Record<string, any>} */
  const raw = { ...structuredClone(example), dataRoot: root, fieldRecordings: null };
  raw.omlx.apiKey = TEST_OMLX_KEY;
  edit?.(raw);
  const configPath = join(root, "config.json");
  // Mode 600, as loadConfig requires: the file holds the omlx key.
  await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  return { root, configPath, remove: () => rm(root, { recursive: true }) };
}
