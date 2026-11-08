// The buttons of a page with keys, Quick A/B (decision 0048) and the timeline (0061): each
// action's button is the element with the action's name as its id, and shows its key.
import { elementById } from "./element-by-id.js";
import { keyLabel } from "./quick-ab-keys.js";

/**
 * @template {string} A
 * @param {Readonly<Record<A, string>>} table each action's `KeyboardEvent.code`
 * @returns {Record<A, HTMLButtonElement>}
 */
export function keyButtons(table) {
  return /** @type {Record<A, HTMLButtonElement>} */ (
    Object.fromEntries(
      Object.entries(table).map(([name, code]) => {
        const button = elementById(name, HTMLButtonElement);
        const kbd = document.createElement("kbd");
        kbd.textContent = keyLabel(/** @type {string} */ (code));
        button.append(" ", kbd);
        return [name, button];
      }),
    )
  );
}
