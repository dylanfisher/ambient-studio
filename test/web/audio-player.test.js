// The audio element's events reach the played tracker as decision 0028 says, checked on a fake
// element: an EventTarget with the media fields trackAudio reads.
import { expect, test } from "vitest";
import { trackAudio } from "../../src/web/audio-player.js";

function fakeAudio() {
  return Object.assign(new EventTarget(), {
    currentTime: 0,
    duration: 25,
    paused: true,
    seeking: false,
    src: "/audio/1",
    error: null,
  });
}

function recorder() {
  /** @type {unknown[][]} */
  const calls = [];
  return {
    calls,
    start: (/** @type {number} */ t) => calls.push(["start", t]),
    reach: (/** @type {number} */ t) => calls.push(["reach", t]),
    stop: (/** @type {number | undefined} */ t) => {
      calls.push(t === undefined ? ["stop"] : ["stop", t]);
    },
    fraction: () => 0,
  };
}

/**
 * @param {ReturnType<typeof fakeAudio>} audio
 * @param {string} type
 * @param {Partial<{ currentTime: number, paused: boolean, seeking: boolean }>} [state]
 */
function fire(audio, type, state = {}) {
  Object.assign(audio, state);
  audio.dispatchEvent(new Event(type));
}

function wired() {
  const audio = fakeAudio();
  const tracker = recorder();
  /** @type {string[]} */
  const seen = [];
  const controller = new AbortController();
  trackAudio(
    /** @type {any} */ (audio),
    tracker,
    {
      onPlay: () => seen.push("play"),
      onChange: () => seen.push("change"),
      onError: (error) => seen.push(error.message),
    },
    controller.signal,
  );
  return { audio, tracker, seen, controller };
}

test("playing starts, timeupdate reaches, pause and ended stop at the current time", () => {
  const { audio, tracker } = wired();
  fire(audio, "playing", { currentTime: 2, paused: false });
  fire(audio, "timeupdate", { currentTime: 2.25 });
  fire(audio, "pause", { currentTime: 3, paused: true });
  fire(audio, "playing", { currentTime: 20, paused: false });
  fire(audio, "ended", { currentTime: 25, paused: true });
  expect(tracker.calls).toEqual([
    ["start", 2],
    ["reach", 2.25],
    ["stop", 3],
    ["start", 20],
    ["stop", 25],
  ]);
});

test("seeking stops where playback was, and seeked while playing starts again", () => {
  const { audio, tracker } = wired();
  fire(audio, "playing", { currentTime: 0, paused: false });
  fire(audio, "seeking", { currentTime: 10, seeking: true });
  fire(audio, "timeupdate");
  fire(audio, "seeked", { seeking: false });
  expect(tracker.calls).toEqual([["start", 0], ["stop"], ["start", 10]]);
});

test("timeupdate while paused and seeked while paused reach nothing", () => {
  const { audio, tracker } = wired();
  fire(audio, "timeupdate", { currentTime: 4 });
  fire(audio, "seeked", { currentTime: 8 });
  expect(tracker.calls).toEqual([]);
});

test("play and changes reach the page, and aborting the signal unwires the element", () => {
  const { audio, tracker, seen, controller } = wired();
  fire(audio, "play");
  fire(audio, "playing", { paused: false });
  expect(seen).toEqual(["play", "change"]);
  controller.abort();
  fire(audio, "pause", { paused: true });
  expect(tracker.calls).toEqual([["start", 0]]);
});

test("an error reaches the page with the excerpt's address", () => {
  const { audio, seen } = wired();
  fire(audio, "error");
  expect(seen[0]).toMatch(/\/audio\/1/);
});
