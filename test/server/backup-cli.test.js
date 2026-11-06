// The backup command (decision 0021), against a temp data root.
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { backupCli } from "../../src/server/backup-cli.js";
import { fillStore, tempStore } from "../support/temp-store.js";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../../scripts/backup", import.meta.url));

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("backs up the config's data root and checks the copy's rated audio", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  /** @type {string[]} */
  const lines = [];
  const written = await backupCli(made.configPath, new Date(Date.UTC(2026, 10, 6)), (line) =>
    lines.push(line),
  );
  expect(lines).toEqual([written.folder, "0 rated excerpts match their PCM hashes"]);
});

test("fails after writing the backup when a rated excerpt's file is missing", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  fillStore(made.store);
  const when = new Date(Date.UTC(2026, 10, 6));
  await expect(backupCli(made.configPath, when, () => {})).rejects.toThrow(
    /drone-7\.flac is missing/,
  );
  expect(await readdir(made.paths.backups)).toEqual(["2026-11-06T00-00-00Z"]);
});

test("./scripts/backup reads the config from the environment and refuses arguments", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const env = { ...process.env, AMBIENT_STUDIO_CONFIG: made.configPath };
  const { stdout } = await run(script, [], { env });
  expect(stdout).toMatch(new RegExp(`^${join(made.paths.backups, "")}`));
  await expect(run(script, ["extra"], { env })).rejects.toMatchObject({ code: 2 });
});
