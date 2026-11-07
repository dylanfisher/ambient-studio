// Quick A/B's keys (decision 0048), the one page with keys since 0032 removed them elsewhere,
// because the owner asked for them here. This table is the one place they are written: the
// listener reads it and the page shows each key on its button. Keys are read by
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
 * Runs each action on its key. Listens in the capture phase and takes the key's default, so
 * Space on a focused button or switch, or an arrow on the seek bar, does the action and not
 * the control's own.
 * @param {EventTarget} target the document
 * @param {Record<QuickAbAction, () => void>} actions
 * @param {() => Element | null} focused the element with the focus
 */
export function bindQuickAbKeys(target, actions, focused) {
  const names = /** @type {QuickAbAction[]} */ (Object.keys(QUICK_AB_KEYS));
  const missing = names.filter((name) => !Object.hasOwn(actions, name));
  const extra = Object.keys(actions).filter((name) => !Object.hasOwn(QUICK_AB_KEYS, name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `The page's key handlers and QUICK_AB_KEYS disagree: missing ${missing.join(", ") || "none"}, extra ${extra.join(", ") || "none"}.`,
    );
  }
  /** @type {Map<string, QuickAbAction>} */
  const byKey = new Map(names.map((name) => [QUICK_AB_KEYS[name], name]));
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
