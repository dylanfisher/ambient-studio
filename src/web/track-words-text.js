// The track page in words (decision 0087), with no DOM: the list the timeline leads with, each
// section's words and development and each join's, and what a words answer changed on the
// timeline, said from templates (as 0047). The seconds, offsets, curves' names and lane values
// are behind the numbers toggle.
/** @import { Arrangement, Section, Transition } from "../domain/arrangement-schema.js" */
/** @import { TrackEdit } from "../domain/track-words.js" */
/** @import { BlockSketch } from "./timeline-layout.js" */
import { TRANSITION_KIND } from "../domain/arrangement-schema.js";
import { WORDS_SETS, wordsSet } from "../domain/words-sets.js";
import { developedText } from "./develop-text.js";
import { clockTime } from "./excerpt-player.js";
import { lanePoints } from "./lane-edits.js";
import { laneWords } from "./lane-layout.js";
import { blockText, placeWords } from "./timeline-layout.js";
import { transitionWords } from "./transition-text.js";

/** A kind as "instead of …" says it. */
const INSTEAD = Object.freeze(
  /** @type {Record<string, string>} */ ({
    [TRANSITION_KIND.crossfade]: "crossfading",
    [TRANSITION_KIND.morph]: "morphing",
    [TRANSITION_KIND.weave]: "weaving",
  }),
);

/**
 * A development as the timeline's list reads it.
 * @typedef {{ id: number, text: string, seconds: number, bridge: boolean, createdAt: number }} WordsDevelopment
 */

/** @param {string} text */
const yours = (text) => `Your words: “${text}”.`;

/**
 * The timeline in words: each section with its name, the owner's words and the development it
 * plays, and each join after it.
 * @param {Arrangement} arrangement
 * @param {(id: number) => BlockSketch | undefined} sketchOf
 * @param {(id: number) => WordsDevelopment | undefined} developmentOf
 * @returns {string[]}
 */
export function timelineWords(arrangement, sketchOf, developmentOf) {
  return arrangement.sections.flatMap((section, i) => {
    const development =
      section.developmentId === null ? undefined : developmentOf(section.developmentId);
    const { name } = blockText(section, sketchOf(section.sketchId), development);
    const words = section.text === "" ? "No words for it yet." : yours(section.text);
    const lines = [
      `Section ${i + 1}: ${name}. ${placeWords(arrangement, i)} ${words} ${developedText(development)}`,
    ];
    const transition = arrangement.transitions[i];
    if (transition !== undefined) {
      const join = transition.text === "" ? "No words for this join yet." : yours(transition.text);
      lines.push(`Then ${transitionWords(i, transition)}. ${join}`);
    }
    return lines;
  });
}

/**
 * What a words answer changed, one line each, or none when it changed nothing.
 * @param {string} set the field set's name
 * @param {Arrangement} before the timeline it was asked of
 * @param {number | string} target the part it changed
 * @param {TrackEdit} edit the answer applied
 * @returns {string[]}
 */
export function trackChangeLines(set, before, target, { arrangement, removed, redrawn }) {
  const named = wordsSet(set);
  if (named === WORDS_SETS.length) {
    const at = /** @type {number} */ (target);
    const was = /** @type {Section} */ (before.sections[at]).seconds;
    const now = /** @type {Section} */ (arrangement.sections[at]).seconds;
    return was === now
      ? []
      : [`Section ${at + 1} plays for ${clockTime(now)} instead of ${clockTime(was)}.`];
  }
  if (named === WORDS_SETS.transition) {
    const at = /** @type {number} */ (target);
    const was = /** @type {Transition} */ (before.transitions[at]);
    const now = /** @type {Transition} */ (arrangement.transitions[at]);
    const words = transitionWords(at, now);
    return [
      ...(was.kind === now.kind
        ? []
        : [`${words.charAt(0).toUpperCase()}${words.slice(1)}, instead of ${INSTEAD[was.kind]}.`]),
      ...(was.seconds === now.seconds
        ? []
        : [`The two overlap for ${clockTime(now.seconds)} instead of ${clockTime(was.seconds)}.`]),
    ];
  }
  if (named === WORDS_SETS.lane) {
    const macro = /** @type {import("../engine/macro-table.js").MacroName} */ (target);
    if (arrangement === before) return [];
    return [
      laneWords(macro, lanePoints(arrangement, macro)),
      ...removed.map(([time]) => `Replaces your point at ${clockTime(time)}.`),
      ...redrawn.map(
        ([from, to]) =>
          `Redraws your lane from ${clockTime(from)} to ${clockTime(to)} to join the change: its curve there can't be cut and keep its shape.`,
      ),
    ];
  }
  throw new Error(`the track page has no words for the field set ${set}`);
}
