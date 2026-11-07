// Connects a page to its keys in key-map.js: lists them on the page and runs the action a
// keydown fires. A page whose handlers and keys disagree throws when it binds, so a key is
// never listed without doing something, nor an action left without a key (decision 0028).
/** @import { Binding, View } from "./key-map.js" */
/** @import { StatusLine } from "./status-line.js" */
import { elementById } from "./element-by-id.js";
import { actionFor, KEY_MAP, keyName, LEAVE_FIELD } from "./key-map.js";

/** @typedef {Record<string, () => unknown>} Handlers by action; `LEAVE_FIELD` is built in */

/** @param {EventTarget | null} target */
const isField = (target) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/**
 * @param {HTMLElement} list
 * @param {readonly Binding[]} bindings
 */
function showKeys(list, bindings) {
  list.replaceChildren(
    ...bindings.flatMap(({ keys, label }) => {
      const term = document.createElement("dt");
      keys.forEach((key, i) => {
        if (i > 0) term.append(" or ");
        const kbd = document.createElement("kbd");
        kbd.textContent = keyName(key);
        term.append(kbd);
      });
      const description = document.createElement("dd");
      description.textContent = label;
      return [term, description];
    }),
  );
}

/**
 * Binds every view the page shows. A view's keys are listed in `#keys-<view>`, and each
 * `[data-action]` button inside a `[data-view="<view>"]` element runs that action when clicked.
 * @param {Partial<Record<View, Handlers>>} views
 * @param {View} first the view the keys go to at first
 * @param {StatusLine["run"]} run
 * @returns {(view: View) => void} switches the view the keys go to, and the list shown
 */
export function bindKeys(views, first, run) {
  let current = first;
  /** @type {Map<View, HTMLElement>} */
  const lists = new Map();
  for (const [name, handlers = {}] of Object.entries(views)) {
    const view = /** @type {View} */ (name);
    /** @type {readonly Binding[]} */
    const bindings = KEY_MAP[view];
    const actions = bindings.map((binding) => binding.action);
    const missing = actions.filter((action) => action !== LEAVE_FIELD && !handlers[action]);
    const unbound = Object.keys(handlers).filter((action) => !actions.includes(action));
    if (missing.length > 0 || unbound.length > 0) {
      throw new Error(
        `view ${view}: no handler for ${missing.join(", ") || "-"}; no key for ${unbound.join(", ") || "-"}`,
      );
    }
    const list = elementById(`keys-${view}`, HTMLElement);
    showKeys(list, bindings);
    lists.set(view, list);
    for (const button of document.querySelectorAll(`[data-view="${view}"] [data-action]`)) {
      const handler = handlers[/** @type {HTMLElement} */ (button).dataset.action ?? ""];
      if (!(button instanceof HTMLButtonElement) || !handler) {
        throw new Error(`view ${view}: ${button.outerHTML} names no action of the view`);
      }
      button.onclick = () => run(handler);
    }
  }

  /** @param {View} view */
  const show = (view) => {
    current = view;
    for (const [shown, list] of lists) list.hidden = shown !== view;
  };
  show(first);

  // Capture, so a focused audio element or button doesn't act on Space before the page does.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat || event.isComposing) return;
      const action = actionFor(current, {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        inField: isField(event.target),
      });
      if (action === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === LEAVE_FIELD) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
      }
      const handler = views[current]?.[action];
      if (!handler) throw new Error(`view ${current} has no handler for ${action}`);
      run(handler);
    },
    { capture: true },
  );
  return show;
}
