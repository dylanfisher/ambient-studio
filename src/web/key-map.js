// Every page's keys, in one table, so the list each page shows and the keys it answers are the
// same data (decision 0028). No DOM here: a page turns a keydown into a `KeyPress` and asks
// `actionFor` what to do.

/**
 * One action and the keys that fire it. A key is a KeyboardEvent `key` value, so Shift is part
 * of it (`Q` is not `q`); `Mod+Enter` is Enter with Cmd or Ctrl. `inField` bindings fire while a
 * text field, select or checkbox has focus, and no others do.
 * @typedef {object} Binding
 * @property {string} action
 * @property {readonly string[]} keys
 * @property {string} label what the page lists next to the keys
 * @property {boolean} [inField]
 */

/**
 * The parts of a keydown the map reads. `inField` is whether the focus is in a form control.
 * @typedef {object} KeyPress
 * @property {string} key
 * @property {boolean} ctrlKey
 * @property {boolean} metaKey
 * @property {boolean} altKey
 * @property {boolean} inField
 * @property {boolean} [multiline] whether the focus is in a textarea
 * @property {boolean} repeat whether the key is held down and auto-repeating
 */

const ENTER = "Enter";
const SPACE = " ";

/**
 * Whether the page drops a held key's repeats entirely, default action included: a held Enter
 * or Space would click a focused button again and again, and a held Enter in a text field
 * would submit its form again and again. Typing keeps its repeats: Space in any text field,
 * Enter in a textarea, where it starts a new line.
 * @param {KeyPress} press
 */
export const swallowsHeld = ({ key, repeat, inField, multiline = false }) =>
  repeat && ((key === ENTER && !multiline) || (key === SPACE && !inField));

/** The action that leaves a form control; the binder runs it itself. */
export const LEAVE_FIELD = "leaveField";
const MOD_ENTER = "Mod+Enter";
const ESCAPE = "Escape";

/** @type {Binding} */
const leaveField = {
  action: LEAVE_FIELD,
  keys: [ESCAPE],
  label: "leave the field",
  inField: true,
};

/** @typedef {keyof typeof KEY_MAP} View */

export const KEY_MAP = Object.freeze(
  /** @satisfies {Record<string, readonly Binding[]>} */ ({
    list: [
      { action: "nextVibe", keys: ["j"], label: "next vibe" },
      { action: "previousVibe", keys: ["k"], label: "previous vibe" },
      { action: "openVibe", keys: [ENTER], label: "open the vibe" },
      { action: "newVibe", keys: ["n"], label: "new vibe" },
    ],
    vibe: [
      { action: "editBrief", keys: ["b"], label: "edit the brief" },
      { action: "editConstraints", keys: ["c"], label: "edit the constraints" },
      { action: "writeNote", keys: ["n"], label: "write a note" },
      {
        action: "saveForm",
        keys: [MOD_ENTER],
        label: "save the form you are in",
        inField: true,
      },
      leaveField,
      { action: "startSession", keys: ["s"], label: "start a session and open it" },
      { action: "openSession", keys: ["o"], label: "open the newest open session" },
      { action: "toList", keys: ["l"], label: "back to the vibe list" },
    ],
    session: [
      { action: "nextCandidate", keys: ["j"], label: "next candidate" },
      { action: "previousCandidate", keys: ["k"], label: "previous candidate" },
      { action: "playPause", keys: [SPACE], label: "play or pause" },
      { action: "back", keys: [","], label: "back 5 s" },
      { action: "forward", keys: ["."], label: "forward 5 s" },
      { action: "thumbsUp", keys: ["u"], label: "thumbs up, with the note" },
      { action: "thumbsDown", keys: ["d"], label: "thumbs down, with the note" },
      { action: "writeNote", keys: ["n"], label: "write a note" },
      { action: "writeTags", keys: ["t"], label: "write the sketch's tags" },
      leaveField,
      { action: "previousMacro", keys: ["["], label: "previous macro" },
      { action: "nextMacro", keys: ["]"], label: "next macro" },
      { action: "moreLikeThis", keys: ["=", "+"], label: "more like this, on the macro" },
      { action: "lessLikeThis", keys: ["-"], label: "less like this, on the macro" },
      { action: "keepSketch", keys: ["s"], label: "keep as sketch, with the note and tags" },
      { action: "markAb", keys: ["x"], label: "mark for A/B; the second mark opens the pair" },
      { action: "askCandidates", keys: ["g"], label: "ask for candidates" },
      { action: "renderExcerpts", keys: ["e"], label: "render missing excerpts" },
      { action: "cancelJob", keys: ["c"], label: "cancel the session's job" },
      { action: "stopSession", keys: ["Q"], label: "stop the session" },
      { action: "toVibe", keys: ["v"], label: "the vibe page" },
    ],
    ab: [
      { action: "playLeft", keys: ["1"], label: "play the left side" },
      { action: "playRight", keys: ["2"], label: "play the right side" },
      { action: "playPause", keys: [SPACE], label: "play or pause" },
      { action: "back", keys: [","], label: "back 5 s" },
      { action: "forward", keys: ["."], label: "forward 5 s" },
      { action: "leftWins", keys: ["f"], label: "left is better" },
      { action: "rightWins", keys: ["j"], label: "right is better" },
      { action: "tiePair", keys: ["t"], label: "tie" },
      { action: "skipPair", keys: ["s"], label: "skip the pair" },
      { action: "closePair", keys: [ESCAPE], label: "close without rating" },
    ],
  }),
);

/**
 * The action a key press fires on a page, or undefined to leave it to the browser.
 * @param {View} view
 * @param {KeyPress} press
 * @returns {string | undefined}
 */
export function actionFor(view, { key, ctrlKey, metaKey, altKey, inField, repeat }) {
  if (repeat) return undefined;
  /** @type {readonly Binding[]} */
  const bindings = KEY_MAP[view];
  const mod = ctrlKey || metaKey;
  let name = key;
  if (key === ENTER && mod && !altKey) name = MOD_ENTER;
  else if (mod || altKey) return undefined;
  return bindings.find((binding) => binding.keys.includes(name) && (!inField || binding.inField))
    ?.action;
}

/** @type {Readonly<Record<string, string>>} */
const SHOWN = Object.freeze({ " ": "Space", [MOD_ENTER]: "Cmd/Ctrl+Enter", [ESCAPE]: "Esc" });

/**
 * A key as a page lists it.
 * @param {string} key
 */
export const keyName = (key) => SHOWN[key] ?? key;
