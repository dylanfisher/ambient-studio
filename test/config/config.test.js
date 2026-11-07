// The config loader (decision 0019): every key required, `~` expanded, and the owner's real
// folders refused while Vitest runs.
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../../src/config/config.js";
import example from "../../src/config/example.json" with { type: "json" };
import { TEST_OMLX_KEY, tempRoot } from "../support/temp-root.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** @param {Parameters<typeof tempRoot>[0]} [edit] */
async function makeRoot(edit) {
  const made = await tempRoot(edit);
  cleanups.push(made.remove);
  return made;
}

/**
 * @param {() => unknown} load
 * @param {string[]} parts each must appear in the error's message
 */
function expectRefused(load, ...parts) {
  expect(load).toThrow();
  try {
    load();
  } catch (error) {
    const message = /** @type {Error} */ (error).message;
    for (const part of parts) expect(message).toContain(part);
  }
}

/** @param {() => unknown} load */
function thrownMessage(load) {
  try {
    load();
  } catch (error) {
    return /** @type {Error} */ (error).message;
  }
  throw new Error("expected the config to be refused");
}

/**
 * Every key path in a parsed config, sections included: `omlx`, `omlx.baseUrl`, ….
 * @param {Record<string, unknown>} object
 * @param {string} [prefix]
 * @returns {string[]}
 */
function keyPaths(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix + key;
    return value !== null && typeof value === "object"
      ? [path, ...keyPaths(/** @type {Record<string, unknown>} */ (value), `${path}.`)]
      : [path];
  });
}

/**
 * The object holding a dotted key path's last key, and that key.
 * @param {Record<string, any>} raw
 * @param {string} path
 * @returns {[Record<string, any>, string]}
 */
function locate(raw, path) {
  const keys = path.split(".");
  const last = /** @type {string} */ (keys.pop());
  return [keys.reduce((object, key) => object[key], raw), last];
}

/**
 * @param {Record<string, any>} raw
 * @param {string} path
 * @param {unknown} value
 */
function setPath(raw, path, value) {
  const [parent, key] = locate(raw, path);
  parent[key] = value;
}

/**
 * @param {Record<string, any>} raw
 * @param {string} path
 */
function deletePath(raw, path) {
  const [parent, key] = locate(raw, path);
  delete parent[key];
}

describe("loadConfig", () => {
  test("reads back every value of a complete file", async () => {
    const { root, configPath } = await makeRoot((raw) => {
      raw.fieldRecordings = join(raw.dataRoot, "recordings");
    });
    expect(loadConfig(configPath)).toEqual({
      ...example,
      omlx: { ...example.omlx, apiKey: TEST_OMLX_KEY },
      dataRoot: root,
      fieldRecordings: join(root, "recordings"),
    });
  });

  test("expands a leading ~/ to the home folder and drops a trailing slash", async () => {
    const home = await mkdtemp(join(tmpdir(), "home-"));
    cleanups.push(() => rm(home, { recursive: true }));
    vi.stubEnv("HOME", home);
    const { configPath } = await makeRoot((raw) => {
      raw.dataRoot = "~/studio/";
      raw.fieldRecordings = "~/field recordings";
    });
    const config = loadConfig(configPath);
    expect(config.dataRoot).toBe(join(home, "studio"));
    expect(config.fieldRecordings).toBe(join(home, "field recordings"));
  });

  test.each(["toString", "__proto__"])(
    "a %s key is not a config key, though every object inherits it",
    async (key) => {
      const { configPath } = await makeRoot((raw) => {
        Object.defineProperty(raw, key, { value: 1, enumerable: true });
      });
      expectRefused(() => loadConfig(configPath), `${key} is not a config key`);
    },
  );

  test.each(keyPaths(example))(
    "a file without %s throws with the key and the path",
    async (key) => {
      const { configPath } = await makeRoot((raw) => deletePath(raw, key));
      expectRefused(() => loadConfig(configPath), key, configPath, "missing");
    },
  );

  /** One value of the wrong type or range for every key. */
  const wrong = {
    omlx: "http://127.0.0.1:8000",
    "omlx.baseUrl": "127.0.0.1:8000",
    "omlx.model": "",
    "omlx.apiKey": "",
    queue: [],
    "queue.requestTimeoutMs": "120000",
    "queue.firstTokenThresholdMs": 0,
    "queue.minPrefillTokensPerSecond": 0.5,
    "queue.minGapMs": -1,
    "queue.backoffBaseMs": 1.5,
    "queue.maxWaitMs": null,
    "queue.maxTokens": true,
    "queue.contextBudgetTokens": Number.MAX_VALUE,
    "queue.sendResponseFormat": "false",
    "queue.thinking": 1,
    dataRoot: "relative/folder",
    fieldRecordings: 7,
    server: null,
    "server.host": 0,
    "server.port": 65536,
  };

  test("the wrong-type table covers every key", () => {
    expect(Object.keys(wrong).sort()).toEqual(keyPaths(example).sort());
  });

  test.each(Object.entries(wrong))(
    "%s set to %j throws with the key and the path",
    async (key, value) => {
      const { configPath } = await makeRoot((raw) => setPath(raw, key, value));
      expectRefused(() => loadConfig(configPath), key, configPath, "must be");
    },
  );

  test.each([[""], [7], ["a\nb"]])(
    "an omlx.apiKey of %j is refused without printing it",
    async (value) => {
      const { configPath } = await makeRoot((raw) => {
        raw.omlx.apiKey = value;
      });
      expectRefused(() => loadConfig(configPath), "omlx.apiKey", configPath, "must be");
      expect(thrownMessage(() => loadConfig(configPath))).not.toContain("a\nb");
      expect(thrownMessage(() => loadConfig(configPath))).not.toContain("got 7");
    },
  );

  test("a config file that group or others can read is refused, naming chmod 600, not the key", async () => {
    const { configPath } = await makeRoot();
    await chmod(configPath, 0o644);
    expectRefused(() => loadConfig(configPath), configPath, "chmod 600");
    expect(thrownMessage(() => loadConfig(configPath))).not.toContain(TEST_OMLX_KEY);
    await chmod(configPath, 0o640);
    expectRefused(() => loadConfig(configPath), "chmod 600");
    await chmod(configPath, 0o600);
    expect(loadConfig(configPath).omlx.apiKey).toBe(TEST_OMLX_KEY);
  });

  test("a file that doesn't parse does not quote its contents, which hold the key", async () => {
    const { configPath } = await makeRoot();
    await writeFile(configPath, `{ "omlx": { "apiKey": "${TEST_OMLX_KEY}" oops } }`);
    expectRefused(() => loadConfig(configPath), configPath, "JSON");
    expect(thrownMessage(() => loadConfig(configPath))).not.toContain(TEST_OMLX_KEY);
  });

  test("a key it doesn't know throws with the key and the path", async () => {
    const { configPath } = await makeRoot((raw) => {
      raw.queue.maxToken = 10;
    });
    expectRefused(() => loadConfig(configPath), "queue.maxToken", configPath);
  });

  test("an unparseable file throws with the path", async () => {
    const { configPath } = await makeRoot();
    await writeFile(configPath, '{ "omlx": ');
    expectRefused(() => loadConfig(configPath), configPath, "JSON");
  });

  test("a file that isn't there throws with the path and the example to copy", async () => {
    const { root } = await makeRoot();
    const configPath = join(root, "absent.json");
    expectRefused(() => loadConfig(configPath), configPath, "src/config/example.json");
  });

  test("reads $AMBIENT_STUDIO_CONFIG when it is set", async () => {
    const { root, configPath } = await makeRoot();
    vi.stubEnv("AMBIENT_STUDIO_CONFIG", configPath);
    expect(loadConfig().dataRoot).toBe(root);
  });

  test("an empty or relative $AMBIENT_STUDIO_CONFIG throws", () => {
    vi.stubEnv("AMBIENT_STUDIO_CONFIG", "");
    expectRefused(() => loadConfig(), "AMBIENT_STUDIO_CONFIG");
    vi.stubEnv("AMBIENT_STUDIO_CONFIG", "config.json");
    expectRefused(() => loadConfig(), "AMBIENT_STUDIO_CONFIG", "config.json");
  });

  describe("while Vitest runs", () => {
    const realConfig = join(homedir(), ".config/ambient-studio");
    const realData = join(homedir(), "Library/Application Support/Ambient Studio");

    test("refuses the default path, which is in the owner's config folder, without reading it", () => {
      vi.stubEnv("AMBIENT_STUDIO_CONFIG", undefined);
      expectRefused(() => loadConfig(), join(realConfig, "config.json"), "owner's real");
    });

    test("refuses a config file in the owner's config folder", () => {
      const configPath = join(realConfig, "other.json");
      vi.stubEnv("AMBIENT_STUDIO_CONFIG", configPath);
      expectRefused(() => loadConfig(), configPath, "owner's real");
    });

    test.each([
      ["dataRoot", "~/Library/Application Support/Ambient Studio/", realData],
      ["dataRoot", "~/library/application support/ambient studio/renders", realData],
      ["dataRoot", "~/.config/ambient-studio", realConfig],
      ["fieldRecordings", "~/.config/ambient-studio/recordings", realConfig],
      ["fieldRecordings", `${realData}/recordings`, realData],
    ])("refuses %s %s", async (key, value, folder) => {
      const { configPath } = await makeRoot((raw) => setPath(raw, key, value));
      expectRefused(() => loadConfig(configPath), key, configPath, folder, "owner's real");
    });

    test("refuses the owner's folders even when HOME points elsewhere", async () => {
      const home = await mkdtemp(join(tmpdir(), "home-"));
      cleanups.push(() => rm(home, { recursive: true }));
      vi.stubEnv("HOME", home);
      const owner = join(userInfo().homedir, "Library/Application Support/Ambient Studio");
      const { configPath } = await makeRoot((raw) => {
        raw.dataRoot = owner;
      });
      expectRefused(() => loadConfig(configPath), "dataRoot", owner, "owner's real");
    });
  });
});
