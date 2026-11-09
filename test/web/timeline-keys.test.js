// The timeline's keys (decision 0061): each action has one, each runs once per press, and none
// fires while a field you type in has the focus. Checked on a fake document, as Quick A/B's are.
import { expect, test } from "vitest";
import { LANE_KEYS } from "../../src/web/lane-keys.js";
import { MATERIAL_KEYS } from "../../src/web/material-keys.js";
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
    "morph",
    "curve",
    "add",
    "remove",
    "play",
    "save",
    "renderTrack",
    "playTrack",
    "playSeam",
    "exportTrack",
    "exportStems",
    "develop",
    "plainSketch",
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
    "M",
    "K",
    "A",
    "X",
    "Space",
    "S",
    "R",
    "P",
    "C",
    "E",
    "V",
    "Z",
    "/",
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
  // The chosen section's text and its transition's are textareas.
  const writing = page({ tagName: "TEXTAREA" });
  for (const code of Object.values(TIMELINE_KEYS)) writing.press(code);
  expect(writing.ran).toEqual([]);
  const { ran, press } = page({ tagName: "BUTTON" });
  press("KeyS", { metaKey: true });
  press("KeyS");
  expect(ran).toEqual(["save"]);
});

test("the timeline page's three key tables share no key", () => {
  // The timeline (0061), the macro lanes (0065) and the material panel (0066) bind their own
  // tables on one page, so a key in two of them would run two actions.
  const tables = { TIMELINE_KEYS, LANE_KEYS, MATERIAL_KEYS };
  /** @type {Map<string, string[]>} */
  const owners = new Map();
  for (const [table, keys] of Object.entries(tables)) {
    for (const [action, code] of Object.entries(keys)) {
      owners.set(code, [...(owners.get(code) ?? []), `${table}.${action}`]);
    }
  }
  expect([...owners].filter(([, names]) => names.length > 1)).toEqual([]);
});
