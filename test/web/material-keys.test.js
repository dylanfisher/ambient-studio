// The material panel's keys (decision 0066): each action has its own, none the timeline's, and
// each runs once per press, as the timeline's do. Checked on a fake document.
import { expect, test } from "vitest";
import { bindMaterialKeys, MATERIAL_KEYS } from "../../src/web/material-keys.js";
import { keyLabel } from "../../src/web/quick-ab-keys.js";
import { TIMELINE_KEYS } from "../../src/web/timeline-keys.js";

test("every material action has its own key, and none is a timeline key", () => {
  const keys = Object.values(MATERIAL_KEYS);
  expect(new Set(keys).size).toBe(keys.length);
  const timeline = new Set(/** @type {string[]} */ (Object.values(TIMELINE_KEYS)));
  expect(keys.filter((code) => timeline.has(code))).toEqual([]);
  expect(Object.entries(MATERIAL_KEYS).map(([name, code]) => [name, keyLabel(code)])).toEqual([
    ["placeElite", "I"],
    ["steerFar", "T"],
    ["steerNear", "G"],
    ["arcFeature", "F"],
    ["arcRegion", "J"],
  ]);
});

test("each key runs its action once, and none fires in a field you type in", () => {
  const target = new EventTarget();
  /** @type {string[]} */
  const ran = [];
  let focused = /** @type {any} */ (null);
  const actions = /** @type {any} */ (
    Object.fromEntries(Object.keys(MATERIAL_KEYS).map((name) => [name, () => ran.push(name)]))
  );
  bindMaterialKeys(/** @type {any} */ (target), actions, () => focused);
  /** @param {string} code @param {boolean} repeat */
  const press = (code, repeat) =>
    target.dispatchEvent(
      Object.assign(new Event("keydown", { cancelable: true }), {
        code,
        isComposing: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        repeat,
      }),
    );
  for (const code of Object.values(MATERIAL_KEYS)) {
    press(code, false);
    press(code, true);
  }
  expect(ran).toEqual(Object.keys(MATERIAL_KEYS));
  focused = { tagName: "SELECT" };
  press("KeyI", false);
  expect(ran).toHaveLength(Object.keys(MATERIAL_KEYS).length);
});
