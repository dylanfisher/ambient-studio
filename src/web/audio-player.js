// An excerpt's `<audio>` element, measured by a played tracker (decision 0028). The excerpt is
// served with byte ranges (0025), which Safari needs to seek.
/** @import { PlayedTracker } from "./played-tracker.js" */

/**
 * Feeds the element's events to the tracker. `seeking` stops the interval where playback was,
 * because the element's currentTime is already the new position when it fires.
 * @param {HTMLAudioElement} audio
 * @param {PlayedTracker} tracker
 * @param {{ onPlay: () => void, onChange: () => void, onError: (error: Error) => void }} on
 *   `onPlay` when playback is asked for, `onChange` when the played share may have changed
 * @param {AbortSignal} signal aborting it unwires the element, as when the A/B view reuses it
 */
export function trackAudio(audio, tracker, { onPlay, onChange, onError }, signal) {
  /**
   * @param {string} type
   * @param {() => void} listener
   */
  const on = (type, listener) => audio.addEventListener(type, listener, { signal });
  const stopHere = () => {
    tracker.stop(audio.currentTime);
    onChange();
  };
  on("play", onPlay);
  on("playing", () => {
    tracker.start(audio.currentTime);
    onChange();
  });
  on("timeupdate", () => {
    if (!audio.paused && !audio.seeking) tracker.reach(audio.currentTime);
    onChange();
  });
  on("seeking", () => tracker.stop());
  on("seeked", () => {
    if (!audio.paused) tracker.start(audio.currentTime);
  });
  on("pause", stopHere);
  on("ended", stopHere);
  on("error", () =>
    onError(
      new Error(
        `The excerpt at ${audio.src} didn't play: media error ${audio.error?.code} ${audio.error?.message}`,
      ),
    ),
  );
}
