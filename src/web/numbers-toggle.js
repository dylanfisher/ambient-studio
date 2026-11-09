// The numbers toggle (decision 0083): one button at the top of a page that shows or hides every
// part of it marked `data-numbers`, the raw values, number fields and parameter controls, so
// the page reads in words first. Closed is the default. The stylesheet does the hiding from an
// attribute on the page root, so parts a module clones from a template later follow it too.
// The open state is kept per page in `localStorage`: a per-viewer convenience, never data, so
// storage that is empty, refused or throwing leaves the page closed, and each failure is
// reported, not swallowed.
import { elementById } from "./element-by-id.js";

/** The button's words, closed and open. */
export const NUMBERS_LABEL = Object.freeze({
  closed: "Show the numbers",
  open: "Hide the numbers",
});

export const NUMBERS_TITLE =
  "Shows or hides the numbers on this page: the fields that set values directly, the measurements and the scores. The page remembers your choice in this browser.";

/** On the page root while the numbers show; `studio.css` hides `[data-numbers]` without it. */
export const OPEN_ATTRIBUTE = "data-numbers-open";

/** The one value stored: the page's numbers are open. Closed stores nothing. */
const OPEN = "open";

/**
 * The page's remembered open state.
 * @param {() => Storage} storage a getter, since reading `localStorage` itself can throw
 * @param {string} page the page's file name, such as `map.html`
 * @param {(error: Error) => void} report told of each read or write that failed
 */
export function numbersMemory(storage, page, report) {
  const key = `numbers open on ${page}`;
  return {
    /** @returns {boolean} false when nothing is stored or the storage fails */
    open() {
      let text;
      try {
        text = storage().getItem(key);
      } catch (error) {
        report(new Error(`couldn't read whether ${page} shows its numbers`, { cause: error }));
        return false;
      }
      if (text === null) return false;
      if (text === OPEN) return true;
      report(new Error(`${page}'s stored numbers state is ${JSON.stringify(text)}, not "open"`));
      return false;
    },
    /** @param {boolean} open */
    keep(open) {
      try {
        if (open) storage().setItem(key, OPEN);
        else storage().removeItem(key);
      } catch (error) {
        report(new Error(`couldn't keep whether ${page} shows its numbers`, { cause: error }));
      }
    },
  };
}

/**
 * Wires the button to the page root, starting from the remembered state.
 * @param {Pick<Element, "toggleAttribute">} root
 * @param {Pick<HTMLElement, "setAttribute" | "addEventListener" | "textContent">} button
 * @param {ReturnType<typeof numbersMemory>} memory
 */
export function numbersToggle(root, button, memory) {
  /** @param {boolean} open */
  const show = (open) => {
    root.toggleAttribute(OPEN_ATTRIBUTE, open);
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? NUMBERS_LABEL.open : NUMBERS_LABEL.closed;
  };
  let open = memory.open();
  show(open);
  button.addEventListener("click", () => {
    open = !open;
    show(open);
    memory.keep(open);
  });
}

/**
 * The page's `#numbersToggle`, kept in this browser's `localStorage`.
 * @param {string} page the page's file name, such as `map.html`
 */
export function pageNumbers(page) {
  numbersToggle(
    document.documentElement,
    elementById("numbersToggle", HTMLButtonElement),
    numbersMemory(
      () => localStorage,
      page,
      (error) => console.error(error),
    ),
  );
}
