// The timeline's keys (decision 0061): each action has one, each runs once per press, and none
// fires while a field you type in has the focus. Checked on a fake document, as Quick A/B's are.
import { expect, test } from "vitest";
import { keyLabel } from "../../src/web/quick-ab-keys.js";
import { bindTimelineKeys, TIMELINE_KEYS } from "../../src/web/timeline-keys.js";

/** @param {{ tagName: string, type?: string } | null} focused */
function page(focused = null) {
  const target = new EventTarget();
  /** @type {string[]} */
  const ran = [];
  const actions = /** @type {any} */ (
    Object.fromEntries(Object.keys(TIMELINE_KEYS).map((name) => [name, () => ran.push(name)]))
  );
  bindTimelineKeys(/** @type {any} */ (target), actions, () => /** @type {any} */ (focused));
  /** @param {string} code @param {Record<string, boolean>} [more] */
  const press = (code, more = {}) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      code,
      isComposing: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      repeat: false,
      ...more,
    });
    target.dispatchEvent(event);
    return event;
  };
  return { ran, press };
}

test("every action has its own key, shown on its button", () => {
  const keys = Object.values(TIMELINE_KEYS);
  expect(new Set(keys).size).toBe(keys.length);
  expect(Object.keys(TIMELINE_KEYS)).toEqual([
    "selectPrevious",
    "selectNext",
    "moveLeft",
    "moveRight",
    "shorter",
    "longer",
    "startEarlier",
    "startLater",
    "fadeShorter",
    "fadeLonger",
    "add",
    "remove",
    "play",
    "save",
  ]);
  expect(keys.map(keyLabel)).toEqual([
    "←",
    "→",
    ",",
    ".",
    "−",
    "=",
    "[",
    "]",
    ";",
    "'",
    "A",
    "X",
    "Space",
    "S",
  ]);
});

test("each key runs its action once and takes the browser's default", () => {
  for (const [name, code] of Object.entries(TIMELINE_KEYS)) {
    const { ran, press } = page();
    expect(press(code).defaultPrevented, code).toBe(true);
    press(code, { repeat: true });
    expect(ran, code).toEqual([name]);
  }
});

test("no key fires in a field you type in, or with Cmd", () => {
  const typing = page({ tagName: "INPUT", type: "number" });
  for (const code of Object.values(TIMELINE_KEYS)) typing.press(code);
  expect(typing.ran).toEqual([]);
  const { ran, press } = page({ tagName: "BUTTON" });
  press("KeyS", { metaKey: true });
  press("KeyS");
  expect(ran).toEqual(["save"]);
});
