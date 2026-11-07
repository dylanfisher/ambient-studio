// The excerpt player every page plays audio with (decision 0048): a play button, the time and
// duration, and a seek bar the width of its card, built beside an `<audio>` element that has no
// controls. The native controls squeeze the seek bar to a few centimeters. Seeking sets the
// element's `currentTime`, so the played tracker sees the same events as before (0028), and
// Safari seeks through the byte ranges the audio route serves (0025).

/** The seek bar's steps from start to end; fine enough that a step is under 25 ms of 25 s. */
export const SEEK_STEPS = 1000;

/** The titles of the controls the player builds (0032). */
export const PLAYER_TITLES = Object.freeze({
  toggle:
    "Plays the excerpt, or pauses it when it is playing. Starting it pauses any other excerpt.",
  seek: "Shows how far the excerpt has played. Drag it, or click along it, to jump to that point.",
});

/**
 * @param {number} seconds
 * @returns {string} such as `0:25`, or dashes when the time isn't known yet
 */
export function clockTime(seconds) {
  if (!Number.isFinite(seconds)) return "–:––";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The parts of one player.
 * @typedef {object} PlayerParts
 * @property {HTMLAudioElement} audio
 * @property {HTMLButtonElement} toggle
 * @property {HTMLElement} time
 * @property {HTMLInputElement} seek a range from 0 to `SEEK_STEPS`
 */

/**
 * Wires the parts to each other for the element's life; a new `src` resets them through the
 * element's `emptied` event.
 * @param {PlayerParts} parts
 * @param {(error: Error) => void} onError a play the browser refused
 */
export function wirePlayer({ audio, toggle, time, seek }, onError) {
  /** Set while the bar is held, so playback doesn't pull it back from under the pointer. */
  let dragging = false;
  const fraction = () => Number(seek.value) / SEEK_STEPS;
  /** @param {number} at seconds */
  const showTime = (at) => {
    time.textContent = `${clockTime(at)} / ${clockTime(audio.duration)}`;
  };
  const showPosition = () => {
    if (dragging) return;
    const { currentTime, duration } = audio;
    seek.value = String(duration > 0 ? Math.round((currentTime / duration) * SEEK_STEPS) : 0);
    showTime(currentTime);
  };
  const showButton = () => {
    toggle.textContent = audio.paused ? "Play" : "Pause";
  };

  toggle.addEventListener("click", () => {
    if (audio.paused) playAudio(audio, onError);
    else audio.pause();
  });
  seek.addEventListener("input", () => {
    dragging = true;
    showTime(fraction() * audio.duration);
  });
  seek.addEventListener("change", () => {
    dragging = false;
    if (audio.duration > 0) audio.currentTime = fraction() * audio.duration;
    showPosition();
  });
  for (const type of ["timeupdate", "durationchange", "loadedmetadata", "seeked", "emptied"]) {
    audio.addEventListener(type, showPosition);
  }
  for (const type of ["play", "pause", "ended", "emptied"]) {
    audio.addEventListener(type, showButton);
  }
  showPosition();
  showButton();
}

/**
 * Builds a player beside `audio`, taking its native controls away.
 * @param {HTMLAudioElement} audio
 * @param {(error: Error) => void} onError a play the browser refused
 * @returns {HTMLElement} the player's box, placed after the element
 */
export function mountPlayer(audio, onError) {
  audio.controls = false;
  const box = document.createElement("div");
  box.className = "player";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "button outline small";
  toggle.title = PLAYER_TITLES.toggle;
  const time = document.createElement("span");
  time.className = "small muted player-time";
  const seek = document.createElement("input");
  seek.type = "range";
  seek.min = "0";
  seek.max = String(SEEK_STEPS);
  seek.step = "1";
  seek.title = PLAYER_TITLES.seek;
  seek.setAttribute("aria-label", "Position in the excerpt");
  box.append(toggle, time, seek);
  audio.after(box);
  wirePlayer({ audio, toggle, time, seek }, onError);
  return box;
}

/** `HTMLMediaElement.HAVE_METADATA`: the duration is known and `currentTime` can be set. */
const HAVE_METADATA = 1;

/**
 * Starts playback. A pause or a new source before playback starts rejects the play with an
 * AbortError, which switching sides fast does all the time and which is not a fault.
 * @param {HTMLAudioElement} audio
 * @param {(error: Error) => void} onError any other refusal
 */
export function playAudio(audio, onError) {
  audio.play().catch((/** @type {Error} */ error) => {
    if (error.name !== "AbortError") onError(error);
  });
}

/**
 * Moves playback from one excerpt to the other at the same point, as Quick A/B's arrow keys do,
 * so the owner hears the same moment of both. An element whose metadata hasn't loaded can't
 * take a time yet, so it gets it on `loadedmetadata`. Playing `to` again when it is already the
 * one playing does nothing.
 * @param {HTMLAudioElement} from the side heard last
 * @param {HTMLAudioElement} to
 * @param {(error: Error) => void} onError a play the browser refused
 */
export function switchPlayback(from, to, onError) {
  if (from !== to) {
    from.pause();
    const at = from.currentTime;
    if (to.readyState >= HAVE_METADATA) {
      to.currentTime = at;
    } else {
      to.addEventListener(
        "loadedmetadata",
        () => {
          to.currentTime = at;
        },
        { once: true },
      );
    }
  }
  if (to.paused) playAudio(to, onError);
}
