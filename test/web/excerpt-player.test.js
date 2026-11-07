// The excerpt player (decision 0048): a play button, the time and duration, and a seek bar the
// width of the card, over an audio element with no controls of its own. Checked on fakes:
// EventTargets with the fields the player reads and writes.
import { expect, test } from "vitest";
import { clockTime, SEEK_STEPS, switchPlayback, wirePlayer } from "../../src/web/excerpt-player.js";

function fakeParts() {
  const audio = Object.assign(new EventTarget(), {
    currentTime: 0,
    duration: Number.NaN,
    paused: true,
    seeking: false,
    play() {
      audio.paused = false;
      audio.dispatchEvent(new Event("play"));
      return Promise.resolve();
    },
    pause() {
      audio.paused = true;
      audio.dispatchEvent(new Event("pause"));
    },
  });
  const toggle = Object.assign(new EventTarget(), { textContent: "" });
  const time = { textContent: "" };
  const seek = Object.assign(new EventTarget(), { value: "0" });
  wirePlayer(/** @type {any} */ ({ audio, toggle, time, seek }), (error) => {
    throw error;
  });
  return { audio, toggle, time, seek };
}

/**
 * @param {EventTarget} target
 * @param {string} type
 */
const fire = (target, type) => target.dispatchEvent(new Event(type));

test("times read as minutes and seconds, and an unknown one as dashes", () => {
  expect(clockTime(0)).toBe("0:00");
  expect(clockTime(25)).toBe("0:25");
  expect(clockTime(65.9)).toBe("1:05");
  expect(clockTime(Number.NaN)).toBe("–:––");
});

test("the button plays when paused and pauses when playing, and says which it will do", () => {
  const { audio, toggle } = fakeParts();
  expect(toggle.textContent).toBe("Play");
  fire(toggle, "click");
  expect(audio.paused).toBe(false);
  expect(toggle.textContent).toBe("Pause");
  fire(toggle, "click");
  expect(audio.paused).toBe(true);
  expect(toggle.textContent).toBe("Play");
});

test("shows the time and duration, and moves the bar as it plays", () => {
  const { audio, time, seek } = fakeParts();
  expect(time.textContent).toBe("0:00 / –:––");
  audio.duration = 25;
  fire(audio, "durationchange");
  expect(time.textContent).toBe("0:00 / 0:25");
  audio.currentTime = 12.5;
  fire(audio, "timeupdate");
  expect(time.textContent).toBe("0:12 / 0:25");
  expect(Number(seek.value)).toBe(SEEK_STEPS / 2);
});

test("dragging the bar shows where it will land, and letting go seeks there", () => {
  const { audio, time, seek } = fakeParts();
  audio.duration = 20;
  fire(audio, "durationchange");
  seek.value = String(SEEK_STEPS / 4);
  fire(seek, "input");
  expect(time.textContent).toBe("0:05 / 0:20");
  // Playback goes on while the bar is held; it doesn't pull the bar back.
  audio.currentTime = 1;
  fire(audio, "timeupdate");
  expect(Number(seek.value)).toBe(SEEK_STEPS / 4);
  fire(seek, "change");
  expect(audio.currentTime).toBe(5);
});

test("the bar goes back to the start when the source changes", () => {
  const { audio, time, seek } = fakeParts();
  audio.duration = 25;
  audio.currentTime = 10;
  fire(audio, "timeupdate");
  audio.currentTime = 0;
  audio.duration = Number.NaN;
  fire(audio, "emptied");
  expect(Number(seek.value)).toBe(0);
  expect(time.textContent).toBe("0:00 / –:––");
});

test("switching plays the other excerpt from the same point and pauses the first", async () => {
  const left = /** @type {any} */ (fakeParts().audio);
  const right = /** @type {any} */ (fakeParts().audio);
  await left.play();
  left.currentTime = 7.25;
  await switchPlayback(left, right);
  expect(left.paused).toBe(true);
  expect(right.paused).toBe(false);
  expect(right.currentTime).toBe(7.25);

  // Switching to the one already playing changes nothing.
  right.currentTime = 9;
  await switchPlayback(right, right);
  expect(right).toMatchObject({ paused: false, currentTime: 9 });

  // From a paused side it still starts at that side's point.
  right.pause();
  right.currentTime = 3;
  await switchPlayback(right, left);
  expect(left).toMatchObject({ paused: false, currentTime: 3 });
});
