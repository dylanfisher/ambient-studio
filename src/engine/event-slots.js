// Gains that live through the render, for a voice's event nodes to connect through (decision
// 0010). The library sums a node's inputs in graph order, which follows node ids, and it hands
// the id of a node it frees, when the JS object is garbage-collected, to the next node created.
// Float addition is commutative but not associative, so three or more events summed straight
// into one node could add up in an order that depends on when V8 collects. Through slots, each
// slot carries at most one event at a time, and the slots, created before any event, keep
// their order.

/**
 * Creates `count` gains into `output` and returns a function that connects an event's node to
 * the first slot free from the event's first frame, the slot then busy until its last. Events
 * must come in order of their first frame. Throws when every slot is busy.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} output
 * @param {number} count at least the most events that sound at once
 * @returns {(node: AudioNode, frame: number, end: number) => void} `frame` is the event's first
 *   timeline frame and `end` the frame after its last
 */
export function eventSlots(ctx, output, count) {
  const slots = Array.from({ length: count }, () => {
    const gain = ctx.createGain();
    gain.connect(output);
    return { gain, freeFrom: -Infinity };
  });
  return (node, frame, end) => {
    const slot = slots.find((s) => s.freeFrom <= frame);
    if (!slot) throw new Error(`eventSlots: all ${count} slots are busy at frame ${frame}`);
    slot.freeFrom = end;
    node.connect(slot.gain);
  };
}
