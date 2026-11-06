// The backup command (decision 0021): backs up the data root the config names, then checks the
// copy's rated audio against the copy's rows. `./scripts/backup` runs this file.
/** @import { Backup } from "./backup.js" */
import { loadConfig } from "../config/config.js";
import { paths } from "../config/paths.js";
import { backup } from "./backup.js";
import { checkRatedAudio } from "./check-rated-audio.js";
import { openStore } from "./store.js";

/**
 * Throws, after writing the backup, when a rated excerpt is missing or changed.
 * @param {string | undefined} configPath the default config file when undefined
 * @param {Date} when names the backup folder
 * @param {(line: string) => void} print
 * @returns {Promise<Backup>}
 */
export async function backupCli(configPath, when, print) {
  const config = loadConfig(configPath);
  const made = await backup(paths(config.dataRoot), when);
  print(made.folder);
  const copy = openStore(made.database, { now: () => when.getTime() });
  try {
    const checked = await checkRatedAudio(copy, made.ratedAudio);
    print(`${checked} rated excerpts match their PCM hashes`);
  } finally {
    copy.close();
  }
  return made;
}

if (import.meta.main) {
  if (process.argv.length > 2) {
    console.error("usage: ./scripts/backup, with no arguments; the config names the data root");
    process.exitCode = 2;
  } else {
    await backupCli(undefined, new Date(), console.log);
  }
}
