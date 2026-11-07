import { describe, expect, test } from "vitest";
import { actionFor, KEY_MAP, keyName, swallowsHeld } from "../../src/web/key-map.js";

/** @typedef {import("../../src/web/key-map.js").KeyPress} KeyPress */

/**
 * @param {string} key
 * @param {Partial<KeyPress>} [rest]
 * @returns {KeyPress}
 */
const press = (key, rest = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  inField: false,
  repeat: false,
  ...rest,
});

describe("KEY_MAP", () => {
  test("every page has its keys, and no key does two things on one page", () => {
    expect(Object.keys(KEY_MAP).sort()).toEqual(["ab", "list", "session", "vibe"]);
    for (const [view, bindings] of Object.entries(KEY_MAP)) {
      const keys = bindings.flatMap((binding) => binding.keys);
      expect(new Set(keys).size, view).toBe(keys.length);
      const actions = bindings.map((binding) => binding.action);
      expect(new Set(actions).size, view).toBe(actions.length);
      for (const binding of bindings) {
        expect(binding.keys.length, binding.action).toBeGreaterThan(0);
        expect(binding.label.length, binding.action).toBeGreaterThan(0);
      }
    }
  });

  test("the session view has a key for every rating and every job action", () => {
    const actions = KEY_MAP.session.map((binding) => binding.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "nextCandidate",
        "previousCandidate",
        "playPause",
        "back",
        "forward",
        "thumbsUp",
        "thumbsDown",
        "writeNote",
        "writeTags",
        "previousMacro",
        "nextMacro",
        "moreLikeThis",
        "lessLikeThis",
        "keepSketch",
        "markAb",
        "askCandidates",
        "renderExcerpts",
        "cancelJob",
        "stopSession",
      ]),
    );
    const ab = KEY_MAP.ab.map((binding) => binding.action);
    expect(ab).toEqual(
      expect.arrayContaining([
        "playLeft",
        "playRight",
        "leftWins",
        "rightWins",
        "tiePair",
        "skipPair",
      ]),
    );
  });
});

describe("actionFor", () => {
  test("a key gives its page's action", () => {
    expect(actionFor("session", press("u"))).toBe("thumbsUp");
    expect(actionFor("session", press(" "))).toBe("playPause");
    expect(actionFor("session", press("+"))).toBe("moreLikeThis");
    expect(actionFor("session", press("="))).toBe("moreLikeThis");
    expect(actionFor("ab", press("f"))).toBe("leftWins");
    expect(actionFor("list", press("n"))).toBe("newVibe");
  });

  test("shift is part of the key: Q stops the session, q does nothing", () => {
    expect(actionFor("session", press("Q"))).toBe("stopSession");
    expect(actionFor("session", press("q"))).toBeUndefined();
  });

  test("a key with Ctrl, Cmd or Alt is left to the browser", () => {
    for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
      expect(actionFor("session", press("u", { [modifier]: true }))).toBeUndefined();
    }
  });

  test("typing in a field fires only the field keys", () => {
    expect(actionFor("session", press("u", { inField: true }))).toBeUndefined();
    expect(actionFor("session", press(" ", { inField: true }))).toBeUndefined();
    expect(actionFor("session", press("Escape", { inField: true }))).toBe("leaveField");
    expect(actionFor("vibe", press("Enter", { inField: true, metaKey: true }))).toBe("saveForm");
    expect(actionFor("vibe", press("Enter", { inField: true, ctrlKey: true }))).toBe("saveForm");
    expect(actionFor("vibe", press("Enter", { inField: true }))).toBeUndefined();
  });

  test("an unbound key gives nothing", () => {
    expect(actionFor("vibe", press("z"))).toBeUndefined();
  });
});

test("keyName spells out the keys a page lists", () => {
  expect(keyName(" ")).toBe("Space");
  expect(keyName("Mod+Enter")).toBe("Cmd/Ctrl+Enter");
  expect(keyName("Escape")).toBe("Esc");
  expect(keyName("u")).toBe("u");
});

describe("held keys", () => {
  test("a repeated key press fires no action", () => {
    expect(actionFor("session", press("u", { repeat: true }))).toBeUndefined();
    expect(actionFor("ab", press("f", { repeat: true }))).toBeUndefined();
  });

  test("a held Enter or Space is swallowed, so it can't repeat a button's click or a submit", () => {
    expect(swallowsHeld(press("Enter", { repeat: true }))).toBe(true);
    expect(swallowsHeld(press(" ", { repeat: true }))).toBe(true);
    expect(swallowsHeld(press("Enter"))).toBe(false);
    expect(swallowsHeld(press("j", { repeat: true }))).toBe(false);
  });

  test("a held Enter in a one-line field is swallowed; typing keeps its repeats", () => {
    expect(swallowsHeld(press("Enter", { repeat: true, inField: true }))).toBe(true);
    const inTextarea = { repeat: true, inField: true, multiline: true };
    expect(swallowsHeld(press("Enter", inTextarea))).toBe(false);
    expect(swallowsHeld(press(" ", { repeat: true, inField: true }))).toBe(false);
  });
});
