// Lints a genome against a vibe's constraints and the floors every genome must clear: not
// near-silent, not a lone static drone, and long enough for an excerpt (decision 0020). It
// reports and never rewrites the genome.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { Finding, LintResult } from "./lint-result.js" */
import { drone } from "../engine/drone.js";
import { excerptRoom } from "../engine/excerpt-offset.js";
import { GENOME_KEY, GLOBAL_PARAMS, VOICE_PARAMS } from "../engine/genome-schema.js";
import { highestValue } from "../engine/highest-value.js";
import { isObject } from "../engine/is-object.js";
import { CONSTRAINT_KINDS } from "./constraint-schema.js";
import { EXCERPT_SECONDS } from "./excerpt-seconds.js";
import { lintResult } from "./lint-result.js";
import { paramName } from "./param-name.js";
import { valueRange } from "./value-range.js";

/** A voice whose level stays at or under this while it plays counts as silent. */
const NEAR_SILENT_DB = -50;

const { sweep } = drone.params;
const SWEEP = paramName(drone.params, sweep);

/** @param {Genome} genome @returns {Finding[]} */
function nearSilent(genome) {
  const audible = genome.voices.some((voice) => {
    const end = Math.min(voice.end, genome.duration);
    if (voice.start >= end) return false;
    // No macro row moves a voice's level (decision 0006), so the raw level is what plays.
    const [, highest] = valueRange(voice.level, voice.start, end, VOICE_PARAMS.level.scale);
    return highest > NEAR_SILENT_DB;
  });
  if (audible) return [];
  return [
    {
      path: `$.${GENOME_KEY.voices}`,
      rule: "nearSilent",
      message: `every voice stays at or under ${NEAR_SILENT_DB} dB while it plays; raise a voice's level`,
    },
  ];
}

/** @param {Genome} genome @returns {Finding[]} */
function loneStaticDrone(genome) {
  const [voice, ...others] = genome.voices;
  if (!voice || others.length > 0 || voice.type !== drone.type) return [];
  const globals = Object.keys(GLOBAL_PARAMS).map(
    (name) => /** @type {Record<string, unknown>} */ (genome)[name],
  );
  const values = [...globals, ...Object.values(genome.macros), ...Object.values(voice)];
  if (values.some(isObject)) return [];
  if (highestValue(genome, voice, SWEEP, sweep, drone.macros) > 0) return [];
  return [
    {
      path: "$.voices[0]",
      rule: "loneStaticDrone",
      message:
        "a lone drone with no sweep and no trajectory never changes; give it a sweep or a trajectory, or add a voice",
    },
  ];
}

/** @param {Genome} genome @returns {Finding[]} */
function excerptLength(genome) {
  if (excerptRoom(genome, EXCERPT_SECONDS) >= 0) return [];
  const between = genome.duration - genome.fadeIn - genome.fadeOut;
  return [
    {
      path: "$.duration",
      rule: "excerptLength",
      message: `leaves ${between} s between fadeIn and fadeOut; a ${EXCERPT_SECONDS} s excerpt needs duration - fadeIn - fadeOut of at least ${EXCERPT_SECONDS} s`,
    },
  ];
}

/**
 * Every place the genome breaks a constraint or a floor, constraints first in the table's order.
 * @param {Genome} genome a normalized genome, as `validateGenome` returns it
 * @param {Constraints} constraints a set `validateConstraints` accepted
 * @returns {LintResult}
 */
export function lintGenome(genome, constraints) {
  /** @type {Finding[]} */
  const findings = [];
  for (const [rule, kind] of Object.entries(CONSTRAINT_KINDS)) {
    const constraint = constraints[/** @type {keyof Constraints} */ (rule)];
    if (constraint === undefined) continue;
    for (const { path, message } of kind.lint(genome, /** @type {never} */ (constraint))) {
      findings.push({ path, rule, message });
    }
  }
  findings.push(...nearSilent(genome), ...loneStaticDrone(genome), ...excerptLength(genome));
  return lintResult(findings);
}
