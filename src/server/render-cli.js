// The render command (decision 0017): parses arguments, calls `exportRender` or `rerender`, and
// prints what it wrote. `./scripts/render` runs this file.
/** @import { Export } from "./export-render.js" */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { requireGenome } from "../engine/validate-genome.js";
import { exportRender, rerender } from "./export-render.js";
import { indexRecordings } from "./recording-index.js";

const USAGE = `usage: ./scripts/render <genome.json> --seed N --duration S --out DIR [--offset S] [--no-flac] [--recordings DIR]
       ./scripts/render --from <export.json> --out DIR [--recordings DIR]`;

/** Exit status for a command line the parser refuses. */
const USAGE_EXIT = 2;

/** A command line the parser refuses; the message names the argument. */
class UsageError extends Error {}

/**
 * @typedef {object} GenomeRender
 * @property {string} genomePath
 * @property {number} seed
 * @property {number} duration seconds
 * @property {number} offset timeline seconds
 * @property {boolean} flac
 * @property {string} outDir
 * @property {string} [recordingsDir] the field-recordings folder, for a genome that plays one
 */

/**
 * @typedef {object} Rerender
 * @property {string} sidecarPath
 * @property {string} outDir
 * @property {string} [recordingsDir]
 */

/**
 * @param {string} flag
 * @param {string | undefined} text
 * @param {RegExp} shape
 * @param {string} what
 * @returns {number}
 */
function numberArg(flag, text, shape, what) {
  if (text === undefined) throw new UsageError(`--${flag} is required`);
  if (!shape.test(text)) throw new UsageError(`--${flag} must be ${what}, got "${text}"`);
  return Number(text);
}

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/** @param {string[]} argv */
function readArgs(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        seed: { type: "string" },
        duration: { type: "string" },
        offset: { type: "string" },
        out: { type: "string" },
        from: { type: "string" },
        "no-flac": { type: "boolean" },
        recordings: { type: "string" },
      },
    });
  } catch (error) {
    // parseArgs throws a TypeError with a code for each command-line problem.
    if (error instanceof TypeError && "code" in error) throw new UsageError(error.message);
    throw error;
  }
}

/**
 * Reads the command line. Throws a `UsageError` naming the problem: a missing `--out`, an
 * unknown option, a value that isn't a number, or a mix of the two forms.
 * @param {string[]} argv the arguments after the script's name
 * @returns {GenomeRender | Rerender}
 */
export function parseRenderArgs(argv) {
  const { values, positionals } = readArgs(argv);
  if (values.out === undefined) throw new UsageError("--out is required");
  const folder = values.recordings === undefined ? {} : { recordingsDir: values.recordings };
  if (values.from !== undefined) {
    const { from, out, recordings, ...others } = values;
    if (positionals.length > 0 || Object.keys(others).length > 0) {
      throw new UsageError(
        "--from takes only --out and --recordings; the sidecar holds everything else",
      );
    }
    return { sidecarPath: from, outDir: out, ...folder };
  }
  if (positionals.length !== 1) {
    throw new UsageError(`expected one genome file, got ${positionals.length}`);
  }
  return {
    genomePath: /** @type {string} */ (positionals[0]),
    seed: numberArg("seed", values.seed, WHOLE, "a whole number from 0"),
    duration: numberArg("duration", values.duration, DECIMAL, "a number of seconds"),
    offset:
      values.offset === undefined
        ? 0
        : numberArg("offset", values.offset, DECIMAL, "a number of seconds from 0"),
    flac: !values["no-flac"],
    outDir: values.out,
    ...folder,
  };
}

/**
 * Runs the command and prints the paths it wrote and the export's loudness.
 * @param {string[]} argv the arguments after the script's name
 * @param {(line: string) => void} print
 * @returns {Promise<Export>}
 */
export async function renderCli(argv, print) {
  const args = parseRenderArgs(argv);
  const recordings =
    args.recordingsDir === undefined
      ? undefined
      : await indexRecordings(resolve(args.recordingsDir));
  /** @type {Export} */
  let exported;
  if ("sidecarPath" in args) {
    exported = await rerender(args.sidecarPath, args.outDir, recordings);
  } else {
    const genome = requireGenome(
      JSON.parse(await readFile(args.genomePath, "utf8")),
      `${args.genomePath} isn't a valid genome`,
    );
    const { seed, duration, offset, flac, outDir } = args;
    exported = await exportRender(genome, {
      seed,
      duration,
      offset,
      target: genome.loudness,
      outDir,
      flac,
      recordings,
    });
  }
  const { paths, sidecar } = exported;
  for (const path of [paths.wav, paths.flac, paths.json]) if (path) print(path);
  const { target, integrated, truePeak, gainDb } = sidecar.loudness;
  print(
    `loudness ${integrated.toFixed(2)} LUFS (target ${target}), true peak ${truePeak.toFixed(2)} dBTP, gain ${gainDb.toFixed(2)} dB`,
  );
  return exported;
}

if (import.meta.main) {
  try {
    await renderCli(process.argv.slice(2), console.log);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`render: ${error.message}\n${USAGE}`);
    process.exitCode = USAGE_EXIT;
  }
}
