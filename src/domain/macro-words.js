// What more and less of each macro mean, in words, for the session page's choices and their
// titles (decision 0032) and the taste summary (0047). A macro the schema adds without words
// here fails the titles test.

/** @type {Readonly<Record<string, { more: string, less: string }>>} */
const WORDS = Object.freeze({
  brightness: { more: "brighter", less: "darker" },
  density: { more: "denser, with more going on", less: "sparser, with less going on" },
  motion: { more: "move more", less: "stay stiller" },
  space: { more: "sound more spacious", less: "sound closer and drier" },
  warmth: { more: "warmer", less: "cooler" },
  tension: { more: "more tense", less: "more relaxed" },
});

/**
 * @param {string} macro a name from the genome schema's macros
 * @returns {{ more: string, less: string }}
 */
export function macroWords(macro) {
  const words = WORDS[macro];
  if (!words) throw new Error(`no words for the macro ${macro}`);
  return words;
}

/**
 * A macro's words after "should" or "to": "be brighter", "move more".
 * @param {string} way one of `macroWords`' two
 */
export const macroVerb = (way) => `${/^(move|stay|sound)/.test(way) ? "" : "be "}${way}`;

/**
 * The titles of a macro's Less, clear and More choices.
 * @param {string} macro
 */
export function macroTitles(macro) {
  const { more, less } = macroWords(macro);
  /** @param {string} way */
  const ask = (way) =>
    `Tell the studio this candidate should ${macroVerb(way)}. Replaces any earlier ${macro} choice for this candidate.`;
  return {
    less: ask(less),
    clear: `Clear your ${macro} choice for this candidate, so it counts neither way.`,
    more: ask(more),
  };
}
