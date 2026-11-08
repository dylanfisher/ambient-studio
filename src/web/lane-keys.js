// The macro lanes' keys (decision 0065), a table of their own beside the timeline's (0061) and
// bound the same way: every lane action has a key and a button that shows it, so no drag is
// needed. None is one of the timeline's keys. The chosen lane and its chosen point are what the
// keys act on.
import { bindKeyTable } from "./quick-ab-keys.js";

/** Each action's key, as `KeyboardEvent.code` names it. */
export const LANE_KEYS = Object.freeze({
  lanePrevious: "ArrowUp",
  laneNext: "ArrowDown",
  pointPrevious: "KeyJ",
  pointNext: "KeyL",
  pointEarlier: "KeyU",
  pointLater: "KeyO",
  offsetLower: "KeyQ",
  offsetHigher: "KeyW",
  pointCurve: "KeyY",
  addPoint: "KeyN",
  removePoint: "KeyD",
});

/** @typedef {keyof typeof LANE_KEYS} LaneAction */

/**
 * Runs each lane action on its key.
 * @param {EventTarget} target the document
 * @param {Record<LaneAction, () => void>} actions
 * @param {() => Element | null} focused the element with the focus
 */
export const bindLaneKeys = (target, actions, focused) =>
  bindKeyTable(target, LANE_KEYS, actions, focused, "LANE_KEYS");
