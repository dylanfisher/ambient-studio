// The end rules of a bridge (decision 0081): where it starts it holds the voices sounding where
// the section before it ends, each with the same type and settings that can't move, and that
// section's join globals; where it ends, the same of the section after it at its start. Then
// each join, as the weave the track will play, must hold. Between two halves in different keys
// only voices with no pitch sound across the crossfade. Each finding has the JSON path a repair
// quotes. Levels and other values that move aren't held to the ends: a weave moves them.
/** @import { Genome, Voice } from "../engine/genome-schema.js" */
/** @import { Curve } from "../engine/trajectory.js" */
/** @import { Finding } from "./lint-result.js" */
import { cymbal } from "../engine/cymbal.js";
import { allowsTrajectory, isNumeric } from "../engine/descriptor.js";
import { fieldRecording } from "../engine/field-recording.js";
import { GENOME_KEY, GLOBAL_PARAMS, VOICE_PARAMS } from "../engine/genome-schema.js";
import { noiseBed } from "../engine/noise-bed.js";
import { show } from "../engine/validation-error.js";
import { MEETING_EDGE, sounds } from "./meeting-state.js";
import { fixedParams, JOIN_GLOBALS, morphGenome } from "./morph-genome.js";
import { paramName } from "./param-name.js";

const START = paramName(VOICE_PARAMS, VOICE_PARAMS.start);
const END = paramName(VOICE_PARAMS, VOICE_PARAMS.end);

/** The rule of each end's findings, of the middle's and of a join that wouldn't hold. */
export const BRIDGE_RULE = Object.freeze({
  start: "bridgeStart",
  end: "bridgeEnd",
  middle: "bridgeMiddle",
  join: "bridgeJoin",
});

/**
 * The voice types whose sound reads none of the genome's tuning, scale and key, so they can
 * sound across a change of key. Any other type, a new one included, counts as carrying pitch.
 */
export const KEYLESS = Object.freeze([noiseBed.type, fieldRecording.type, cymbal.type]);

/**
 * The fixed globals: numbers that can't be trajectories, which a morph keeps at the outgoing
 * values and hands over in its last seconds (0064). The join globals and the genome's length
 * and fades aside.
 */
const FIXED_GLOBALS = Object.entries(GLOBAL_PARAMS)
  .filter(
    ([name, descriptor]) =>
      isNumeric(descriptor) &&
      !allowsTrajectory(descriptor) &&
      !(/** @type {readonly string[]} */ (JOIN_GLOBALS).includes(name)) &&
      descriptor !== GLOBAL_PARAMS.duration &&
      descriptor !== GLOBAL_PARAMS.fadeIn &&
      descriptor !== GLOBAL_PARAMS.fadeOut,
  )
  .map(([name]) => /** @type {keyof Genome} */ (name));

/**
 * The fixed globals both neighbors of a bridge hold the same, which the bridge must hold too.
 * @param {Genome} out
 * @param {Genome} into
 * @returns {Partial<Record<keyof Genome, number>>}
 */
export const sharedGlobals = (out, into) =>
  Object.fromEntries(
    FIXED_GLOBALS.filter((name) => out[name] === into[name]).map((name) => [name, out[name]]),
  );

/**
 * One end of a bridge and what it meets there.
 * @typedef {object} BridgeEdge
 * @property {Genome} genome the neighbor's, fitted to its section, or the first half's
 * @property {number} at where on that genome's timeline it meets the bridge: its end, or its
 *   start
 * @property {string} name what the messages call it, as "section 2"
 * @property {boolean} globals whether the bridge must hold its join globals here
 * @property {number} through the seconds a voice it holds plays through from this end: the
 *   weave's, or the crossfade's between two halves
 * @property {{ seconds: number, curve: Curve } | null} weave the join at this end, checked to
 *   hold; null for the crossfade between two halves
 */

/**
 * What a bridge, or one half of it, is held to.
 * @typedef {object} BridgeEnds
 * @property {BridgeEdge | null} start null for the second half, whose start is its own
 * @property {BridgeEdge | null} end null for the first half
 * @property {{ from: number, to: number } | null} keyless the span of the genome where only
 *   `KEYLESS` voices may sound: the first half's last seconds or the second half's first
 * @property {Partial<Record<keyof Genome, number>>} held `sharedGlobals` of the two neighbors
 */

/**
 * @param {Genome} genome
 * @param {string} id
 */
const placeOf = (genome, id) => genome.voices.findIndex((voice) => voice.id === id);

/**
 * Whether two voices of one id can be one voice: the same type and settings.
 * @param {Voice} a
 * @param {Voice} b
 */
const sameSettings = (a, b) =>
  a.type === b.type && fixedParams(a.type).every((name) => a[name] === b[name]);

/**
 * The findings for one end: the voices the neighbor sounds there, each held by the bridge with
 * the same type and settings and sounding at the bridge's edge long enough to play through the
 * join; no other voice sounding at that edge; and the join globals.
 * @param {Genome} genome the bridge's
 * @param {BridgeEdge} edge
 * @param {boolean} starts whether this is the bridge's start
 * @param {ReadonlySet<string>} skipped ids this end doesn't hold the bridge to
 * @returns {Finding[]}
 */
function endFindings(genome, edge, starts, skipped) {
  const rule = starts ? BRIDGE_RULE.start : BRIDGE_RULE.end;
  const there = starts ? `where ${edge.name} ends` : `where ${edge.name} starts`;
  const at = starts ? 0 : genome.duration;
  const own = starts ? MEETING_EDGE.start : MEETING_EDGE.end;
  const theirs = edge.genome.voices.filter(
    (voice) =>
      !skipped.has(voice.id) &&
      sounds(voice, edge.at, starts ? MEETING_EDGE.end : MEETING_EDGE.start),
  );
  const wanted = new Set(theirs.map(({ id }) => id));
  /** @type {Finding[]} */
  const findings = [];
  for (const target of theirs) {
    const i = placeOf(genome, target.id);
    const voice = genome.voices[i];
    const path = `$.voices[${i}]`;
    if (!voice) {
      findings.push({
        path: `$.${GENOME_KEY.voices}`,
        rule,
        message: `must hold voice ${target.id}, a ${target.type}, ${starts ? "from 0 s" : `up to ${at} s`}, as it sounds ${there}`,
      });
      continue;
    }
    if (voice.type !== target.type) {
      findings.push({
        path: `${path}.type`,
        rule,
        message: `must be ${show(target.type)}, as voice ${target.id} is ${there}`,
      });
      continue;
    }
    for (const name of fixedParams(target.type)) {
      if (voice[name] !== target[name]) {
        findings.push({
          path: `${path}.${name}`,
          rule,
          message: `must be ${target[name] === undefined ? "left out" : show(target[name])}, as voice ${target.id} has it ${there}`,
        });
      }
    }
    if (starts) {
      if (voice.start !== 0) {
        findings.push({
          path: `${path}.start`,
          rule,
          message: `must be 0, as voice ${target.id} sounds ${there}`,
        });
      }
      if (voice.end < edge.through) {
        findings.push({
          path: `${path}.end`,
          rule,
          message: `must be at least ${edge.through}, so voice ${target.id} plays through the ${edge.through} s join`,
        });
      }
    } else {
      if (voice.end < at) {
        findings.push({
          path: `${path}.end`,
          rule,
          message: `must be ${at}, as voice ${target.id} sounds ${there}`,
        });
      }
      if (voice.start > at - edge.through) {
        findings.push({
          path: `${path}.start`,
          rule,
          message: `must be at most ${at - edge.through}, so voice ${target.id} plays through the ${edge.through} s join`,
        });
      }
    }
  }
  genome.voices.forEach((voice, i) => {
    if (wanted.has(voice.id) || skipped.has(voice.id) || !sounds(voice, at, own)) return;
    findings.push(
      starts
        ? {
            path: `$.voices[${i}].start`,
            rule,
            message: `voice ${voice.id} sounds from 0 s, but nothing like it sounds ${there}: start it at ${edge.through} s or later, after the join`,
          }
        : {
            path: `$.voices[${i}].end`,
            rule,
            message: `voice ${voice.id} sounds up to ${at} s, but nothing like it sounds ${there}: end it at ${at - edge.through} s or earlier, before the join`,
          },
    );
  });
  if (edge.globals) {
    for (const name of JOIN_GLOBALS) {
      if (genome[name] !== edge.genome[name]) {
        findings.push({
          path: `$.${name}`,
          rule,
          message: `must be ${edge.genome[name] === undefined ? "left out" : show(edge.genome[name])}, as ${there}: a weave can't move ${name}`,
        });
      }
    }
  }
  return findings;
}

/**
 * The voices the two ends both name but can't share, since one voice has one type and one set
 * of settings: the start holds them, and the end lets them split in its weave, as a weave does.
 * @param {BridgeEnds} ends
 */
function clashing({ start, end }) {
  if (!start || !end) return new Set();
  const first = new Map(
    start.genome.voices
      .filter((voice) => sounds(voice, start.at, MEETING_EDGE.end))
      .map((voice) => [voice.id, voice]),
  );
  return new Set(
    end.genome.voices
      .filter((voice) => {
        const other = first.get(voice.id);
        return (
          other !== undefined &&
          sounds(voice, end.at, MEETING_EDGE.start) &&
          !sameSettings(other, voice)
        );
      })
      .map(({ id }) => id),
  );
}

/**
 * Every finding against a bridge's ends, its middle and its joins. The joins are tried only once
 * the ends hold, since a join that can't hold for an end's reason would say it twice.
 * @param {Genome} genome the bridge's, valid
 * @param {BridgeEnds} ends
 * @returns {Finding[]}
 */
export function checkBridge(genome, ends) {
  const none = new Set();
  /** @type {Finding[]} */
  const findings = [
    ...(ends.start ? endFindings(genome, ends.start, true, none) : []),
    ...(ends.end ? endFindings(genome, ends.end, false, clashing(ends)) : []),
  ];
  for (const [name, value] of Object.entries(ends.held)) {
    if (genome[/** @type {keyof Genome} */ (name)] !== value) {
      findings.push({
        path: `$.${name}`,
        rule: ends.start ? BRIDGE_RULE.start : BRIDGE_RULE.end,
        message: `must be ${show(value)}, as both sections on either side of the bridge have it`,
      });
    }
  }
  const { keyless } = ends;
  if (keyless) {
    genome.voices.forEach((voice, i) => {
      if (KEYLESS.includes(voice.type) || voice.start >= keyless.to || voice.end <= keyless.from) {
        return;
      }
      const first = keyless.from > 0;
      findings.push({
        path: `$.voices[${i}].${first ? END : START}`,
        rule: BRIDGE_RULE.middle,
        message: `voice ${voice.id}, a ${voice.type}, carries pitch, and the other half of the bridge is in another key: ${first ? `end it at ${keyless.from} s or earlier` : `start it at ${keyless.to} s or later`}, so only voices with no pitch (${KEYLESS.join(", ")}) sound across the crossfade between the halves`,
      });
    });
  }
  if (findings.length > 0) return findings;
  // As `fittedGenome` plays it in its section: no master fade.
  const played = { ...genome, fadeIn: 0, fadeOut: 0 };
  /** @type {[BridgeEdge | null, boolean][]} */
  const joins = [
    [ends.start, true],
    [ends.end, false],
  ];
  for (const [edge, starts] of joins) {
    if (!edge?.weave) continue;
    const { seconds, curve } = edge.weave;
    const morph = starts
      ? morphGenome(
          { genome: edge.genome, at: edge.at - seconds },
          { genome: played, at: 0 },
          seconds,
          curve,
          { weave: true },
        )
      : morphGenome(
          { genome: played, at: played.duration - seconds },
          { genome: edge.genome, at: edge.at },
          seconds,
          curve,
          { weave: true },
        );
    if (!morph.ok) {
      findings.push({
        path: "$",
        rule: BRIDGE_RULE.join,
        message: `the weave ${starts ? `from ${edge.name} into the bridge` : `from the bridge into ${edge.name}`} would play as a crossfade: ${morph.reason}`,
      });
    }
  }
  return findings;
}
