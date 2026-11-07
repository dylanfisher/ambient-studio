// Quick A/B's keys (decision 0048): each does what it names, once per press, and none fires
// while a field you type in has the focus. Checked on a fake document: an EventTarget and the
// element said to have the focus.
import { expect, test } from "vitest";
import { bindQuickAbKeys, keyLabel, QUICK_AB_KEYS } from "../../src/web/quick-ab-keys.js";

/** Every action and the key the owner chose for it. */
const CHOSEN = {
  playLeft: "ArrowLeft",
  playRight: "ArrowRight",
  chooseLeft: "a",
  chooseRight: "d",
  same: "s",
  skip: "w",
  playPause: " ",
  undo: "z",
};

/** @param {{ tagName: string, type?: string, isContentEditable?: boolean } | null} focused */
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
   * @param {string} key
   * @param {Partial<{ shiftKey: boolean, metaKey: boolean, ctrlKey: boolean, altKey: boolean, repeat: boolean }>} [more]
   */
  const press = (key, more = {}) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      key,
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

test("letters work with Shift or Caps Lock, and not with Cmd, Ctrl or Alt", () => {
  const { ran, press } = page();
  press("D", { shiftKey: true });
  press("a", { metaKey: true });
  press("s", { ctrlKey: true });
  press("w", { altKey: true });
  expect(ran).toEqual(["chooseRight"]);
});

test("a held key acts once", () => {
  const { ran, press } = page();
  press("d");
  press("d", { repeat: true });
  press("d", { repeat: true });
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
    press(" ");
    press("ArrowRight");
    expect(ran, focused.type ?? focused.tagName).toEqual(["playPause", "playRight"]);
  }
});

test("other keys pass through", () => {
  const { ran, press } = page();
  expect(press("q").defaultPrevented).toBe(false);
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
