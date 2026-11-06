// A voice with windowed events, for tests of the window path the event voices (1j, 1k) take: a
// short tone burst every half second of timeline from 0, so events fall on window boundaries
// too. A test file registers it in `beforeAll` and unregisters it in `afterAll`.
/** @import { VoiceSetup, VoiceWindow } from "../../src/engine/render.js" */

/** Seconds between bursts. */
export const PULSE_EVERY = 0.5;
const BURST = 0.1;
const HZ = 440;

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, voice, from, at }) {
  const frames = Math.round(BURST * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  buffer.copyToChannel(
    Float32Array.from({ length: frames }, (_, i) => {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frames - 1));
      return 0.5 * hann * Math.sin((2 * Math.PI * HZ * i) / ctx.sampleRate);
    }),
    0,
  );
  return (windowFrom, windowTo) => {
    // Event k starts at k × PULSE_EVERY; the window takes those starting in [windowFrom, windowTo).
    for (let k = Math.ceil(windowFrom / PULSE_EVERY); k * PULSE_EVERY < windowTo; k++) {
      const time = k * PULSE_EVERY;
      if (time < from || time < voice.start || time >= voice.end) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      source.start(at(time));
    }
  };
}

export const pulseVoice = {
  type: "pulse",
  description: "test voice with windowed events",
  params: {},
  macros: [],
  longestEvent: () => BURST,
  build,
};
