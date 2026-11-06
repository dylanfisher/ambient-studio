// The genome schema as compact text for the LLM's prompt. omlx contexts are short, so a test
// holds the full text under 3,000 characters (decision 0005).
/** @import { Descriptor, DescriptorTable } from "./descriptor.js" */
import { allowsTrajectory, valueText } from "./descriptor.js";
import {
  GLOBAL_PARAMS,
  MACROS,
  SCHEMA_VERSION,
  VOICE_ID,
  VOICE_KEYS,
  VOICE_PARAMS,
} from "./genome-schema.js";
import { TRAJECTORY_TEXT } from "./trajectory.js";
import { getTuning, tuningIds } from "./tuning-registry.js";
import { findVoiceType, voiceTypeIds } from "./voice-registry.js";

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

/** Each tuning's scales, with tunings that share a scale list on one line. */
function scaleLines() {
  /** @type {Map<string, string[]>} scale list → tunings */
  const groups = new Map();
  for (const id of tuningIds()) {
    const scales = Object.keys(getTuning(id).scales).join("|");
    groups.set(scales, [...(groups.get(scales) ?? []), id]);
  }
  return [...groups].map(([scales, ids]) => `  ${ids.join(",")}: ${scales}`);
}

/** @returns {string} */
export function schemaText() {
  // The scale's allowed values depend on the tuning, so it lists them per tuning.
  const globalLines = Object.entries(GLOBAL_PARAMS).flatMap(([name, d]) =>
    d === GLOBAL_PARAMS.scale
      ? [`${name} =${d.default} ${d.description}:`, ...scaleLines()]
      : [line(name, d)],
  );
  const voiceLines = voiceTypeIds().flatMap((type) => {
    const voice = /** @type {NonNullable<ReturnType<typeof findVoiceType>>} */ (
      findVoiceType(type)
    );
    return [` type "${type}": ${voice.description}`, ...lines(voice.params, "  ")];
  });
  return [
    "Genome JSON. Omitted keys take their =default; unknown keys are errors.",
    `name~ may be a trajectory: ${TRAJECTORY_TEXT}.`,
    `schemaVersion ${SCHEMA_VERSION}`,
    ...globalLines,
    // Every macro shares one descriptor, so one line covers them.
    line(`macros.{${Object.keys(MACROS).join(",")}}`, MACROS.brightness),
    `voices: list of {${VOICE_KEYS.map((key) => `"${key}"`).join(",")},...}; id matches ${VOICE_ID.source}, unique`,
    " every voice:",
    ...lines(VOICE_PARAMS, "  "),
    ...voiceLines,
  ].join("\n");
}
