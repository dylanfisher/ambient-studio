// The genome schema as compact text for the LLM's prompt. omlx contexts are short, so a test
// holds the full text under 3,000 characters (decision 0005).
/** @import { Descriptor, DescriptorTable } from "./descriptor.js" */
import { allowsTrajectory, valueText } from "./descriptor.js";
import {
  GLOBAL_PARAMS,
  MACROS,
  MAX_VOICES,
  SCHEMA_VERSION,
  VOICE_ID,
  VOICE_KEYS,
  VOICE_PARAMS,
} from "./genome-schema.js";
import { TRAJECTORY_TEXT } from "./trajectory.js";
import { isAbsolute } from "./tuning.js";
import { getTuning, tuningIds } from "./tuning-registry.js";
import { requireVoiceType, voiceTypeIds } from "./voice-registry.js";

/**
 * One line: name, ~ when it may be a trajectory, allowed values, =default, description.
 * @param {string} name
 * @param {Descriptor} d
 */
function line(name, d) {
  const mark = allowsTrajectory(d) ? "~" : "";
  const when = d.when ? `; only ${d.when.text}` : "";
  return `${name}${mark} ${valueText(d)} =${d.default} ${d.description}${when}`;
}

/** @param {DescriptorTable} table @param {string} indent */
const lines = (table, indent) => Object.entries(table).map(([name, d]) => indent + line(name, d));

/** Each tuning's key range and scales, with tunings that share both on one line. */
function pitchLines() {
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

/** @returns {string} */
export function schemaText() {
  // A scale's values and a key's range depend on the tuning, so they're listed per tuning.
  const { scale, key } = GLOBAL_PARAMS;
  const globalLines = Object.entries(GLOBAL_PARAMS).flatMap(([name, d]) => {
    if (d === scale) return [`${name} =${d.default} ${d.description}, per tuning below`];
    if (d === key) {
      const when = `; only ${key.when.text}`;
      return [`${name} int =${d.default} ${d.description}${when}, per tuning:`, ...pitchLines()];
    }
    return [line(name, d)];
  });
  const voiceLines = voiceTypeIds().flatMap((type) => {
    const voice = requireVoiceType(type);
    return [` type ${JSON.stringify(type)}: ${voice.description}`, ...lines(voice.params, "  ")];
  });
  return [
    "Genome JSON. Omitted keys take their =default; unknown keys are errors.",
    `name~ may be a trajectory: ${TRAJECTORY_TEXT}.`,
    `schemaVersion ${SCHEMA_VERSION}`,
    ...globalLines,
    // Every macro shares one descriptor, so one line covers them.
    line(`macros.{${Object.keys(MACROS).join(",")}}`, MACROS.brightness),
    `voices: up to ${MAX_VOICES} {${VOICE_KEYS.map((key) => `"${key}"`).join(",")},...}; id matches ${VOICE_ID.source}, unique`,
    " every voice, start and end in timeline seconds:",
    ...lines(VOICE_PARAMS, "  "),
    ...voiceLines,
  ].join("\n");
}
