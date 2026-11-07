// Where the session page was scrolled, kept across a trip to Quick A/B or the A/B view
// (decision 0049), over a fake storage.
import { expect, test } from "vitest";
import { scrollMemory } from "../../src/web/scroll-memory.js";

function fakeStorage() {
  /** @type {Map<string, string>} */
  const items = new Map();
  return {
    items,
    getItem: (/** @type {string} */ key) => items.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => {
      items.set(key, value);
    },
    removeItem: (/** @type {string} */ key) => {
      items.delete(key);
    },
  };
}

test("the scroll saved on leaving is restored once on return", () => {
  const storage = fakeStorage();
  scrollMemory(storage, "session 5").save(1234.6);
  // The next page load reads it back, and a later load starts at the top again.
  const back = scrollMemory(storage, "session 5");
  expect(back.take()).toBe(1235);
  expect(back.take()).toBeNull();
  expect(storage.items.size).toBe(0);
});

test("each session keeps its own scroll", () => {
  const storage = fakeStorage();
  scrollMemory(storage, "session 5").save(100);
  scrollMemory(storage, "session 6").save(900);
  expect(scrollMemory(storage, "session 5").take()).toBe(100);
  expect(scrollMemory(storage, "session 6").take()).toBe(900);
});

test("a page with nothing saved starts where the browser puts it", () => {
  expect(scrollMemory(fakeStorage(), "session 5").take()).toBeNull();
});

test("a saved value that isn't a scroll position throws", () => {
  const storage = fakeStorage();
  storage.setItem("session 5", "the top");
  expect(() => scrollMemory(storage, "session 5").take()).toThrow(/the top/);
});
