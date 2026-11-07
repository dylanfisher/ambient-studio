// The one module that reads the config file and the environment (decision 0019). Every key is
// required and nothing has a default here: a missing value throws with its key and the file.
import { readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

/**
 * @typedef {object} Config
 * @property {{ baseUrl: string, model: string, apiKey: string }} omlx
 * @property {QueueConfig} queue
 * @property {string} dataRoot absolute, `~` expanded
 * @property {string | null} fieldRecordings absolute, `~` expanded; `null` until the owner sets one
 * @property {{ host: string, port: number }} server
 */

/**
 * The omlx queue's terms; step 2d sets and justifies the numbers.
 * @typedef {object} QueueConfig
 * @property {number} requestTimeoutMs
 * @property {number} firstTokenThresholdMs
 * @property {number} minPrefillTokensPerSecond
 * @property {number} minGapMs
 * @property {number} backoffBaseMs
 * @property {number} maxWaitMs
 * @property {number} maxTokens
 * @property {number} contextBudgetTokens
 * @property {boolean} sendResponseFormat
 * @property {boolean} thinking whether requests ask the model's chat template to think first
 */

const ENV_VAR = "AMBIENT_STUDIO_CONFIG";
/** The owner's real folders, relative to a home folder. Tests may not name them (AGENTS.md). */
const CONFIG_FOLDER = ".config/ambient-studio";
const DATA_FOLDER = "Library/Application Support/Ambient Studio";

/** A config value that fails its check; the message is what it must be. */
class ConfigError extends Error {}

/**
 * Expands a leading `~/` (or a bare `~`) to the home folder and requires an absolute path.
 * @param {string} text
 * @returns {string}
 */
function expandPath(text) {
  const expanded = text === "~" || text.startsWith("~/") ? join(homedir(), text.slice(1)) : text;
  if (!isAbsolute(expanded)) {
    throw new ConfigError(`must be an absolute path or start with ~/, got ${JSON.stringify(text)}`);
  }
  return resolve(expanded);
}

/**
 * The owner's real folders, under both `$HOME` and the account's home from the user database,
 * so a test that points `HOME` elsewhere is still refused them.
 * @returns {string[]}
 */
function ownerFolders() {
  const homes = new Set([homedir(), userInfo().homedir]);
  return [...homes].flatMap((home) =>
    [CONFIG_FOLDER, DATA_FOLDER].map((folder) => join(home, folder)),
  );
}

/**
 * While Vitest runs, throws when `path` is one of the owner's real folders or inside one.
 * Compares without case, as macOS volumes do by default.
 * @param {string} path absolute
 * @returns {void}
 */
function refuseOwnerData(path) {
  if (process.env.VITEST !== "true") return;
  const lower = path.toLowerCase();
  for (const folder of ownerFolders()) {
    const owner = folder.toLowerCase();
    if (lower === owner || lower.startsWith(owner + sep)) {
      throw new ConfigError(
        `is ${path}, in the owner's real folder ${folder}; tests use test/support/temp-root.js`,
      );
    }
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  if (typeof value !== "string" || value === "") {
    throw new ConfigError(`must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * A secret: a non-empty single-line string. The message never quotes the value.
 * @param {unknown} value
 * @returns {string}
 */
function secret(value) {
  if (typeof value !== "string" || value === "" || /[\r\n]/.test(value)) {
    throw new ConfigError("must be a non-empty one-line string");
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function positiveInteger(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ConfigError(`must be a whole number of at least 1, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function boolean(value) {
  if (typeof value !== "boolean") {
    throw new ConfigError(`must be true or false, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function httpUrl(value) {
  const url = text(value);
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    throw new ConfigError(`must be an http:// or https:// URL, got ${JSON.stringify(url)}`);
  }
  return url;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function port(value) {
  const number = positiveInteger(value);
  if (number > 65535) throw new ConfigError(`must be a port from 1 to 65535, got ${number}`);
  return number;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function folder(value) {
  const path = expandPath(text(value));
  refuseOwnerData(path);
  return path;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
const folderOrNull = (value) => (value === null ? null : folder(value));

/** @typedef {{ [key: string]: ((value: unknown) => unknown) | Schema }} Schema */

/** Every key, each required. */
const SCHEMA = {
  omlx: { baseUrl: httpUrl, model: text, apiKey: secret },
  queue: {
    requestTimeoutMs: positiveInteger,
    firstTokenThresholdMs: positiveInteger,
    minPrefillTokensPerSecond: positiveInteger,
    minGapMs: positiveInteger,
    backoffBaseMs: positiveInteger,
    maxWaitMs: positiveInteger,
    maxTokens: positiveInteger,
    contextBudgetTokens: positiveInteger,
    sendResponseFormat: boolean,
    thinking: boolean,
  },
  dataRoot: folder,
  fieldRecordings: folderOrNull,
  server: { host: text, port },
};

/**
 * Checks `raw` against `schema`, naming the first bad key by its dotted path.
 * @param {Schema} schema
 * @param {unknown} raw
 * @param {string} file
 * @param {string} prefix
 * @returns {Record<string, unknown>}
 */
function check(schema, raw, file, prefix) {
  const where = prefix === "" ? "the top level" : prefix.slice(0, -1);
  if (!isRecord(raw)) {
    throw new Error(`${file}: ${where} must be an object, got ${JSON.stringify(raw)}`);
  }
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(schema, key))
      throw new Error(`${file}: ${prefix}${key} is not a config key`);
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, rule] of Object.entries(schema)) {
    const name = prefix + key;
    if (!Object.hasOwn(raw, key)) throw new Error(`${file}: ${name} is missing`);
    if (isRecord(rule)) {
      out[key] = check(/** @type {Schema} */ (rule), raw[key], file, `${name}.`);
      continue;
    }
    try {
      out[key] = /** @type {(value: unknown) => unknown} */ (rule)(raw[key]);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      throw new Error(`${file}: ${name} ${error.message}`);
    }
  }
  return out;
}

/**
 * The config file's path: `$AMBIENT_STUDIO_CONFIG` when set, else
 * `~/.config/ambient-studio/config.json`.
 * @returns {string}
 */
function configPath() {
  const fromEnv = process.env[ENV_VAR];
  if (fromEnv === undefined) return join(homedir(), CONFIG_FOLDER, "config.json");
  try {
    return expandPath(text(fromEnv));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new Error(`$${ENV_VAR} ${error.message}`);
  }
}

/**
 * Reads and checks the config file, which holds the omlx key and so must not be readable by
 * group or others. Throws, naming the key and the file, on a missing, unknown
 * or mistyped key; while Vitest runs, also on any path in the owner's real folders, before
 * reading anything there.
 * @param {string} [file] defaults to `$AMBIENT_STUDIO_CONFIG`, else the owner's config file
 * @returns {Config}
 */
export function loadConfig(file = configPath()) {
  try {
    refuseOwnerData(resolve(file));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new Error(`config file ${error.message}`);
  }
  /** @type {string} */
  let source;
  let mode;
  try {
    mode = statSync(file).mode;
    source = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`${file}: can't read the config file; copy src/config/example.json there`, {
      cause: error,
    });
  }
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `${file}: group or others can read the config file, which holds the omlx key; ` +
        `run chmod 600 ${file}`,
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(source);
  } catch {
    // The parser's message quotes the file's text, which holds the omlx key, so it is dropped.
    throw new Error(`${file}: not valid JSON`);
  }
  return /** @type {Config} */ (/** @type {unknown} */ (check(SCHEMA, raw, file, "")));
}
