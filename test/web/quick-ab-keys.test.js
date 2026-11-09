// Quick A/B's keys (decision 0048): each does what it names, once per press, and none fires
// while a field you type in has the focus. Checked on a fake document: an EventTarget and the
// element said to have the focus.
import { expect, test } from "vitest";
import { bindQuickAbKeys, keyLabel, OWN_KEYS, QUICK_AB_KEYS } from "../../src/web/quick-ab-keys.js";

/** Every action and the key the owner chose for it. */
const CHOSEN = {
  playLeft: "ArrowLeft",
  playRight: "ArrowRight",
  chooseLeft: "KeyA",
  chooseRight: "KeyD",
  same: "KeyS",
  skip: "KeyW",
  playPause: "Space",
  undo: "KeyZ",
};

/** @param {{ tagName: string, type?: string, isContentEditable?: boolean, hasAttribute?: (name: string) => boolean } | null} focused */
function page(focused = null) {
  const target = new EventTarget();
  /** @type {string[]} */
  const ran = [];
  const actions = /** @type {Record<keyof typeof CHOSEN, () => void>} */ (
    /** @type {unknown} */ (
      Object.fromEntries(Object.keys(CHOSEN).map((name) => [name, () => ran.push(name)]))
    )
  );
  const state = { focused };
  bindQuickAbKeys(/** @type {any} */ (target), actions, () => /** @type {any} */ (state.focused));
  /**
   * @param {string} code
   * @param {Partial<{ shiftKey: boolean, metaKey: boolean, ctrlKey: boolean, altKey: boolean, repeat: boolean, isComposing: boolean }>} [more]
   */
  const press = (code, more = {}) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      code,
      isComposing: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      repeat: false,
      ...more,
    });
    target.dispatchEvent(event);
    return event;
  };
  return { ran, press, state };
}

test("the key table is the owner's, and each button shows its key", () => {
  expect(QUICK_AB_KEYS).toEqual(CHOSEN);
  expect(Object.values(CHOSEN).map(keyLabel)).toEqual(["←", "→", "A", "D", "S", "W", "Space", "Z"]);
});

test("every key does what it names, and takes the browser's default", () => {
  for (const [name, key] of Object.entries(CHOSEN)) {
    const { ran, press } = page();
    const event = press(key);
    expect(ran, key).toEqual([name]);
    expect(event.defaultPrevented, key).toBe(true);
  }
});

test("letters work with Shift, and not with Cmd, Ctrl or Alt or while composing", () => {
  const { ran, press } = page();
  press("KeyD", { shiftKey: true });
  press("KeyA", { metaKey: true });
  press("KeyS", { ctrlKey: true });
  press("KeyW", { altKey: true });
  press("KeyZ", { isComposing: true });
  expect(ran).toEqual(["chooseRight"]);
});

test("a held key acts once", () => {
  const { ran, press } = page();
  press("KeyD");
  press("KeyD", { repeat: true });
  press("KeyD", { repeat: true });
  expect(ran).toEqual(["chooseRight"]);
});

test("no key fires while a field you type in has the focus", () => {
  for (const focused of [
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { tagName: "INPUT", type: "text" },
    { tagName: "INPUT", type: "number" },
    { tagName: "DIV", isContentEditable: true },
  ]) {
    const { ran, press } = page(focused);
    for (const key of Object.values(CHOSEN)) {
      expect(press(key).defaultPrevented).toBe(false);
    }
    expect(ran, focused.tagName).toEqual([]);
  }
});

test("keys still fire on a focused button, switch or seek bar", () => {
  for (const focused of [
    { tagName: "BUTTON" },
    { tagName: "INPUT", type: "checkbox" },
    { tagName: "INPUT", type: "range" },
  ]) {
    const { ran, press } = page(focused);
    press("Space");
    press("ArrowRight");
    expect(ran, focused.type ?? focused.tagName).toEqual(["playPause", "playRight"]);
  }
});

test("keys do nothing on an element that keeps them, such as a steering slider", () => {
  const { ran, press } = page({
    tagName: "INPUT",
    type: "range",
    hasAttribute: (/** @type {string} */ name) => name === OWN_KEYS,
  });
  expect(press("ArrowRight").defaultPrevented).toBe(false);
  expect(ran).toEqual([]);
});

test("other keys pass through", () => {
  const { ran, press } = page();
  expect(press("KeyQ").defaultPrevented).toBe(false);
  expect(press("Tab").defaultPrevented).toBe(false);
  expect(ran).toEqual([]);
});

test("a page whose handlers and table disagree is refused", () => {
  const { playLeft: _, ...missing } = Object.fromEntries(
    Object.keys(CHOSEN).map((name) => [name, () => {}]),
  );
  expect(() =>
    bindQuickAbKeys(new EventTarget(), /** @type {any} */ (missing), () => null),
  ).toThrow(/playLeft/);
});
