// The material panel's keys (decision 0066): each of its actions has one and a button that shows
// it, bound as the timeline's are (0061), in a table of their own so the panel's wiring stays
// apart from the timeline's. None is a key `TIMELINE_KEYS` holds.
import { bindKeyTable } from "./quick-ab-keys.js";

/** Each action's key, as `KeyboardEvent.code` names it. */
export const MATERIAL_KEYS = Object.freeze({
  placeElite: "KeyI",
  steerFar: "KeyT",
  steerNear: "KeyG",
  arcFeature: "KeyF",
  arcRegion: "KeyJ",
});

/** @typedef {keyof typeof MATERIAL_KEYS} MaterialAction */

/**
 * Runs each material action on its key.
 * @param {EventTarget} target the document
 * @param {Record<MaterialAction, () => void>} actions
 * @param {() => Element | null} focused the element with the focus
 */
export const bindMaterialKeys = (target, actions, focused) =>
  bindKeyTable(target, MATERIAL_KEYS, actions, focused, "MATERIAL_KEYS");
