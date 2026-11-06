// The render cost unit (decision 0010): node-seconds alive per second of timeline. The library
// processes every node on every render quantum from its creation to its end, started or not,
// so a node costs for every second it exists, and a voice's cost is about how many nodes it
// keeps alive on average. These weights are calibrated on step 1a's probes.

/**
 * Node-seconds a second of impulse response costs each second of timeline: probe (d)'s 12 s
 * convolver took as long as about 300 other nodes.
 */
export const IR_WEIGHT = 25;

/**
 * Node-seconds an event node costs beyond the seconds it sounds. It waits up to 3 s from its
 * window's creation (a 2 s window created 1 s ahead), and probe (b)'s windowed grains cost
 * about 3 s more each than that wait and their sound.
 */
export const EVENT_OVERHEAD = 6;

/**
 * The cost of events that start `rate` times a second, each made of `nodes` nodes that sound
 * for `seconds`.
 * @param {{ rate: number; seconds: number; nodes: number }} events
 * @returns {number} node-seconds a second
 */
export const eventCost = ({ rate, seconds, nodes }) => rate * nodes * (seconds + EVENT_OVERHEAD);
