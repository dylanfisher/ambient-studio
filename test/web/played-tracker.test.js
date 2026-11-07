import { expect, test } from "vitest";
import { createPlayedTracker } from "../../src/web/played-tracker.js";

/**
 * Plays from `from` to `to`, reaching each quarter second on the way as timeupdate would.
 * @param {ReturnType<typeof createPlayedTracker>} tracker
 * @param {number} from
 * @param {number} to
 */
function play(tracker, from, to) {
  tracker.start(from);
  for (let t = from + 0.25; t < to; t += 0.25) tracker.reach(t);
  tracker.stop(to);
}

test("nothing played is 0", () => {
  expect(createPlayedTracker(25).fraction()).toBe(0);
});

test("replaying the first five seconds four times counts five seconds", () => {
  const tracker = createPlayedTracker(25);
  for (let i = 0; i < 4; i += 1) play(tracker, 0, 5);
  expect(tracker.fraction()).toBeCloseTo(5 / 25, 10);
});

test("overlapping and separate intervals count their union", () => {
  const tracker = createPlayedTracker(20);
  play(tracker, 0, 6);
  play(tracker, 4, 10);
  play(tracker, 15, 17);
  expect(tracker.fraction()).toBeCloseTo(12 / 20, 10);
});

test("playing to the end counts the whole excerpt, and never more", () => {
  const tracker = createPlayedTracker(25);
  play(tracker, 0, 25);
  play(tracker, 10, 26);
  expect(tracker.fraction()).toBe(1);
});

test("the interval still open while playing counts", () => {
  const tracker = createPlayedTracker(10);
  tracker.start(2);
  tracker.reach(3);
  tracker.reach(4);
  expect(tracker.fraction()).toBeCloseTo(0.2, 10);
});

test("a seek closes the interval where playback was, not where it lands", () => {
  const tracker = createPlayedTracker(20);
  tracker.start(0);
  tracker.reach(2);
  // `seeking` fires with currentTime already at the new position, so it stops without one.
  tracker.stop();
  tracker.start(15);
  tracker.reach(16);
  tracker.stop(16);
  expect(tracker.fraction()).toBeCloseTo(3 / 20, 10);
});

test("a jump back with no seek event starts a new interval instead of spanning the gap", () => {
  const tracker = createPlayedTracker(20);
  tracker.start(10);
  tracker.reach(12);
  tracker.reach(1);
  tracker.reach(2);
  tracker.stop(2);
  expect(tracker.fraction()).toBeCloseTo(3 / 20, 10);
});

test("timeupdates while paused, or a stop before any start, count nothing", () => {
  const tracker = createPlayedTracker(20);
  tracker.reach(5);
  tracker.stop(8);
  expect(tracker.fraction()).toBe(0);
});

test("a stop at a time before the last reached keeps the interval as reached", () => {
  const tracker = createPlayedTracker(10);
  tracker.start(0);
  tracker.reach(4);
  tracker.stop(3);
  expect(tracker.fraction()).toBeCloseTo(0.4, 10);
});

test("a duration that isn't a positive number throws", () => {
  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => createPlayedTracker(duration)).toThrow(/duration/);
  }
});
