// The genome schema as compact text for the LLM's prompt. omlx contexts are short, so a test
// holds the full text under 4,000 characters (decisions 0005 and 0072).
/** @import { Descriptor, DescriptorTable } from "./descriptor.js" */
import { allowsTrajectory, isRecording, valueText } from "./descriptor.js";
import {
  GLOBAL_PARAMS,
  MACROS,
  MAX_VOICES,
  SCHEMA_VERSION,
  VOICE_ID,
  VOICE_KEYS,
  VOICE_PARAMS,
} from "./genome-schema.js";
import { POINTS_KEY, TRAJECTORY_TEXT } from "./trajectory.js";
import { isAbsolute } from "./tuning.js";
import { getTuning, tuningIds } from "./tuning-registry.js";
import {
  requireVoiceType,
  selfContainedVoiceTypeIds,
  usesRecordings,
  voiceTypeIds,
} from "./voice-registry.js";

/** Written after a parameter's default when the parameter may be a trajectory. */
const TRAJECTORY_MARK = "(T)";

/**
 * One line: name, allowed values, =default (or "required" for a recording, which has none), the
 * trajectory mark when it may be one, description. The mark stands apart from the name: a model
 * copied a `~` written against the name into its keys (`cutoff~`).
 * @param {string} name
 * @param {Descriptor} d
 */
function line(name, d) {
  const mark = allowsTrajectory(d) ? ` ${TRAJECTORY_MARK}` : "";
  const when = d.when ? `; only ${d.when.text}` : "";
  const given = isRecording(d) ? "required" : `=${d.default}`;
  return `${name} ${valueText(d)} ${given}${mark} ${d.description}${when}`;
}

/** @param {DescriptorTable} table @param {string} indent */
const lines = (table, indent) => Object.entries(table).map(([name, d]) => indent + line(name, d));

/** @param {string[]} types */
const voiceLines = (types) =>
  types.flatMap((type) => {
    const voice = requireVoiceType(type);
    return [` type ${JSON.stringify(type)}: ${voice.description}`, ...lines(voice.params, "  ")];
  });

/**
 * The lines for the voice types that play a field recording, in the base text's notation. The
 * prompt adds them, with the list of recordings, only when the folder holds some; without one
 * such a voice can't be written, so `schemaText` leaves them out (decision 0029).
 * @returns {string}
 */
export const recordingVoiceText = () =>
  voiceLines(voiceTypeIds().filter(usesRecordings)).join("\n");

/**
 * Each tuning's key range and scales, with tunings that share both on one line.
 * @returns {string[]}
 */
export function pitchLines() {
  /** @type {Map<string, string[]>} key range and scale list → tunings */
  const groups = new Map();
  for (const id of tuningIds()) {
    const tuning = getTuning(id);
    const key = isAbsolute(tuning) ? "no key" : `key 0..${tuning.degrees.length - 1}`;
    const text = `${key}; scale ${Object.keys(tuning.scales).join("|")}`;
    groups.set(text, [...(groups.get(text) ?? []), id]);
  }
  return [...groups].map(([text, ids]) => `  ${ids.join(",")}: ${text}`);
}

/** @returns {string} every voice type but those that play a field recording */
export function schemaText() {
  // A scale's values and a key's range depend on the tuning, so they're listed per tuning, and
  // the tunings' names there are the tuning's values.
  const { tuning, scale, key } = GLOBAL_PARAMS;
  const globalLines = Object.entries(GLOBAL_PARAMS).flatMap(([name, d]) => {
    if (d === tuning) return [`${name} =${d.default}, one of:`, ...pitchLines()];
    if (d === scale) return [`${name} =${d.default}, per tuning above`];
    if (d === key) return [`${name} int =${d.default} ${d.description}; only ${key.when.text}`];
    return [line(name, d)];
  });
  return [
    "Genome JSON. Omitted keys take =default; unknown keys error.",
    `${TRAJECTORY_MARK} = may be a trajectory: an object with key "${POINTS_KEY}", never a bare array: "cutoff": {"${POINTS_KEY}": [[0, 400], [300, 900]]}; ${TRAJECTORY_TEXT}.`,
    `schemaVersion ${SCHEMA_VERSION}`,
    ...globalLines,
    // Every macro shares one descriptor, so one line covers them.
    line(`macros.{${Object.keys(MACROS).join(",")}}`, MACROS.brightness),
    `voices: up to ${MAX_VOICES} {${VOICE_KEYS.map((key) => `"${key}"`).join(",")},...}; id matches ${VOICE_ID.source}, unique`,
    " every voice, start and end in timeline seconds:",
    ...lines(VOICE_PARAMS, "  "),
    ...voiceLines(selfContainedVoiceTypeIds()),
  ].join("\n");
}
