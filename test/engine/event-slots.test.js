import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, test } from "vitest";
import { eventSlots } from "../../src/engine/event-slots.js";

/** A context, and a function that tells which slot an event connected to. */
function setup() {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 128, sampleRate: 48000 });
  /** @type {AudioNode[]} */
  const slots = [];
  const createGain = ctx.createGain.bind(ctx);
  Object.defineProperty(ctx, "createGain", {
    value: () => {
      const gain = createGain();
      slots.push(gain);
      return gain;
    },
  });
  /** @param {(node: AudioNode, frame: number, end: number) => void} connect */
  const slotOf = (connect, /** @type {number} */ frame, /** @type {number} */ end) => {
    /** @type {AudioNode | undefined} */
    let target;
    const node = /** @type {AudioNode} */ (
      /** @type {unknown} */ ({ connect: (/** @type {AudioNode} */ to) => (target = to) })
    );
    connect(node, frame, end);
    return slots.indexOf(/** @type {AudioNode} */ (target));
  };
  return { ctx, slotOf };
}

describe("eventSlots", () => {
  test("gives each event the first slot free from its first frame", () => {
    const { ctx, slotOf } = setup();
    const connect = eventSlots(ctx, ctx.destination, 3);
    expect(slotOf(connect, 0, 100)).toBe(0);
    expect(slotOf(connect, 10, 50)).toBe(1);
    expect(slotOf(connect, 20, 200)).toBe(2);
    // Slot 1 is free from frame 50, the frame after its event's last.
    expect(slotOf(connect, 50, 300)).toBe(1);
    expect(slotOf(connect, 100, 300)).toBe(0);
  });

  test("throws when every slot is busy", () => {
    const { ctx, slotOf } = setup();
    const connect = eventSlots(ctx, ctx.destination, 2);
    slotOf(connect, 0, 100);
    slotOf(connect, 10, 100);
    expect(() => slotOf(connect, 99, 200)).toThrow(/all 2 slots are busy at frame 99/);
  });
});
