// The numbers toggle (decision 0083): closed by default, its open state kept per page in
// storage that can be empty or throw, over fakes for the storage, the page root and the button.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  NUMBERS_LABEL,
  numbersMemory,
  numbersToggle,
  OPEN_ATTRIBUTE,
} from "../../src/web/numbers-toggle.js";

/**
 * The three calls the toggle makes are all a fake has; the toggle uses no other.
 * @param {Pick<Storage, "getItem" | "setItem" | "removeItem">} fake
 */
const asStorage = (fake) => /** @type {Storage} */ (/** @type {unknown} */ (fake));

function fakeStorage() {
  /** @type {Map<string, string>} */
  const items = new Map();
  const storage = asStorage({
    getItem: (/** @type {string} */ key) => items.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => {
      items.set(key, value);
    },
    removeItem: (/** @type {string} */ key) => {
      items.delete(key);
    },
  });
  return Object.assign(storage, { items });
}

/** Storage the browser refuses, as with site data blocked: every call throws. */
const blocked = () => {
  throw new Error("The operation is insecure.");
};
const throwingStorage = asStorage({ getItem: blocked, setItem: blocked, removeItem: blocked });

function fakePage() {
  /** @type {Set<string>} */
  const rootAttributes = new Set();
  const root = {
    toggleAttribute: (/** @type {string} */ name, /** @type {boolean} */ on) => {
      if (on) rootAttributes.add(name);
      else rootAttributes.delete(name);
      return on;
    },
  };
  /** @type {Map<string, string>} */
  const buttonAttributes = new Map();
  const button = Object.assign(new EventTarget(), {
    textContent: "",
    setAttribute: (/** @type {string} */ name, /** @type {string} */ value) => {
      buttonAttributes.set(name, value);
    },
  });
  return {
    root,
    button,
    isOpen: () => rootAttributes.has(OPEN_ATTRIBUTE),
    expanded: () => buttonAttributes.get("aria-expanded"),
    click: () => button.dispatchEvent(new Event("click")),
  };
}

test("a page with nothing stored opens closed", () => {
  const page = fakePage();
  /** @type {unknown[]} */
  const reported = [];
  numbersToggle(
    page.root,
    page.button,
    numbersMemory(
      () => fakeStorage(),
      "map.html",
      (error) => reported.push(error),
    ),
  );
  expect(page.isOpen()).toBe(false);
  expect(page.expanded()).toBe("false");
  expect(page.button.textContent).toBe(NUMBERS_LABEL.closed);
  expect(reported).toEqual([]);
});

test("pressing the button opens it, and the page opens that way next time", () => {
  const storage = fakeStorage();
  const memory = () =>
    numbersMemory(
      () => storage,
      "map.html",
      () => {},
    );
  const first = fakePage();
  numbersToggle(first.root, first.button, memory());
  first.click();
  expect(first.isOpen()).toBe(true);
  expect(first.expanded()).toBe("true");
  expect(first.button.textContent).toBe(NUMBERS_LABEL.open);

  const next = fakePage();
  numbersToggle(next.root, next.button, memory());
  expect(next.isOpen()).toBe(true);
  next.click();
  expect(next.isOpen()).toBe(false);
  expect(storage.items.size).toBe(0);
});

test("each page keeps its own state, and stores only that it is open", () => {
  const storage = fakeStorage();
  numbersMemory(
    () => storage,
    "map.html",
    () => {},
  ).keep(true);
  expect(
    numbersMemory(
      () => storage,
      "map.html",
      () => {},
    ).open(),
  ).toBe(true);
  expect(
    numbersMemory(
      () => storage,
      "brief.html",
      () => {},
    ).open(),
  ).toBe(false);
  expect([...storage.items.values()]).toEqual(["open"]);
});

test("storage that throws leaves the page closed, still toggles, and reports each failure", () => {
  const page = fakePage();
  /** @type {unknown[]} */
  const reported = [];
  numbersToggle(
    page.root,
    page.button,
    numbersMemory(
      () => throwingStorage,
      "map.html",
      (error) => reported.push(error),
    ),
  );
  expect(page.isOpen()).toBe(false);
  expect(page.button.textContent).toBe(NUMBERS_LABEL.closed);
  page.click();
  expect(page.isOpen()).toBe(true);
  expect(reported).toHaveLength(2);
  expect(String(reported[0])).toMatch(/map\.html/);
});

test("storage the browser won't even hand over leaves the page closed", () => {
  const page = fakePage();
  /** @type {unknown[]} */
  const reported = [];
  numbersToggle(
    page.root,
    page.button,
    numbersMemory(blocked, "map.html", (error) => reported.push(error)),
  );
  expect(page.isOpen()).toBe(false);
  expect(reported).toHaveLength(1);
});

test("a stored value that isn't the open state is reported and read as closed", () => {
  const storage = fakeStorage();
  /** @type {unknown[]} */
  const reported = [];
  const memory = numbersMemory(
    () => storage,
    "map.html",
    (error) => reported.push(error),
  );
  memory.keep(true);
  const [key] = storage.items.keys();
  storage.setItem(/** @type {string} */ (key), "yes");
  expect(memory.open()).toBe(false);
  expect(String(reported[0])).toMatch(/"yes"/);
});

test("the stylesheet hides every marked part while the page root lacks the open attribute", () => {
  const css = readFileSync("src/web/studio.css", "utf8");
  expect(css).toContain(`:root:not([${OPEN_ATTRIBUTE}]) [data-numbers] {\n  display: none;\n}`);
});
