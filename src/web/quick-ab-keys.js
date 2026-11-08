// Quick A/B's keys (decision 0048), the first page with keys since 0032 removed them elsewhere,
// because the owner asked for them here; the timeline binds its own table the same way (0061).
// This table is the one place they are written: the listener reads it and the page shows each
// key on its button. Keys are read by
// `KeyboardEvent.code`, the physical key, so Shift, Caps Lock and the keyboard layout don't
// change them; Cmd, Ctrl and Alt leave a key to the browser, and so does a key typed while an
// input method is composing. A held key acts once, so holding D
// can't rate several pairs. While a field you type in has the focus, every key goes to it.

/** Each action's key, as `KeyboardEvent.code` names it. */
export const QUICK_AB_KEYS = Object.freeze({
  playLeft: "ArrowLeft",
  playRight: "ArrowRight",
  chooseLeft: "KeyA",
  chooseRight: "KeyD",
  same: "KeyS",
  skip: "KeyW",
  playPause: "Space",
  undo: "KeyZ",
});

/** How a button shows a key that isn't a letter. */
const SHOWN = new Map([
  ["ArrowLeft", "←"],
  ["ArrowRight", "→"],
  ["Comma", ","],
  ["Period", "."],
  ["Minus", "−"],
  ["Equal", "="],
  ["BracketLeft", "["],
  ["BracketRight", "]"],
  ["Semicolon", ";"],
  ["Quote", "'"],
]);

/**
 * The key as its button shows it: an arrow, Space, or the letter.
 * @param {string} code
 */
export const keyLabel = (code) => SHOWN.get(code) ?? code.replace(/^Key/, "");

/** @typedef {keyof typeof QUICK_AB_KEYS} QuickAbAction */

/** Input types that take no typing, so the keys still act while one has the focus. */
const KEYLESS_INPUTS = new Set(["button", "checkbox", "radio", "range", "reset", "submit"]);

/**
 * Whether the focused element takes typed keys: a text field, a textarea, a select or
 * editable content.
 * @param {Element | null} element
 */
function takesTyping(element) {
  if (!element) return false;
  const { tagName } = element;
  if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
  if (tagName !== "INPUT") return /** @type {HTMLElement} */ (element).isContentEditable === true;
  return !KEYLESS_INPUTS.has(/** @type {HTMLInputElement} */ (element).type);
}

/**
 * Runs each action on its key in `table`. Listens in the capture phase and takes the key's
 * default, so Space on a focused button or switch, or an arrow on the seek bar, does the action
 * and not the control's own.
 * @template {string} A
 * @param {EventTarget} target the document
 * @param {Readonly<Record<A, string>>} table each action's `KeyboardEvent.code`
 * @param {Record<A, () => void>} actions
 * @param {() => Element | null} focused the element with the focus
 * @param {string} tableName the table's name, for the error when it and `actions` disagree
 */
export function bindKeyTable(target, table, actions, focused, tableName) {
  const names = /** @type {A[]} */ (Object.keys(table));
  const missing = names.filter((name) => !Object.hasOwn(actions, name));
  const extra = Object.keys(actions).filter((name) => !Object.hasOwn(table, name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `The page's key handlers and ${tableName} disagree: missing ${missing.join(", ") || "none"}, extra ${extra.join(", ") || "none"}.`,
    );
  }
  /** @type {Map<string, A>} */
  const byKey = new Map(names.map((name) => [table[name], name]));
  target.addEventListener(
    "keydown",
    (event) => {
      const press = /** @type {KeyboardEvent} */ (event);
      if (press.metaKey || press.ctrlKey || press.altKey || press.isComposing) return;
      const name = byKey.get(press.code);
      if (!name || takesTyping(focused())) return;
      press.preventDefault();
      if (!press.repeat) actions[name]();
    },
    { capture: true },
  );
}

/**
 * Runs each Quick A/B action on its key.
 * @param {EventTarget} target the document
 * @param {Record<QuickAbAction, () => void>} actions
 * @param {() => Element | null} focused the element with the focus
 */
export const bindQuickAbKeys = (target, actions, focused) =>
  bindKeyTable(target, QUICK_AB_KEYS, actions, focused, "QUICK_AB_KEYS");
