// The timeline's keys (decision 0061): every action on the page has one, and a button beside it
// that shows it, so nothing needs a drag. Bound as Quick A/B's are (0048): by physical key, once
// per press, and never while a field you type in has the focus. The selected section is the one
// the keys act on.
import { bindKeyTable } from "./quick-ab-keys.js";

/** Each action's key, as `KeyboardEvent.code` names it. */
export const TIMELINE_KEYS = Object.freeze({
  selectPrevious: "ArrowLeft",
  selectNext: "ArrowRight",
  moveLeft: "Comma",
  moveRight: "Period",
  shorter: "Minus",
  longer: "Equal",
  startEarlier: "BracketLeft",
  startLater: "BracketRight",
  fadeShorter: "Semicolon",
  fadeLonger: "Quote",
  morph: "KeyM",
  curve: "KeyK",
  add: "KeyA",
  remove: "KeyX",
  play: "Space",
  save: "KeyS",
  renderTrack: "KeyR",
  playTrack: "KeyP",
  playSeam: "KeyC",
  exportTrack: "KeyE",
  exportStems: "KeyV",
  develop: "KeyZ",
  plainSketch: "Slash",
  bridge: "KeyB",
});

/** @typedef {keyof typeof TIMELINE_KEYS} TimelineAction */

/**
 * Runs each timeline action on its key.
 * @param {EventTarget} target the document
 * @param {Record<TimelineAction, () => void>} actions
 * @param {() => Element | null} focused the element with the focus
 */
export const bindTimelineKeys = (target, actions, focused) =>
  bindKeyTable(target, TIMELINE_KEYS, actions, focused, "TIMELINE_KEYS");
