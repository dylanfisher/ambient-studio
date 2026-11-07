// A stored time, in milliseconds since the epoch, as the pages show it.

/** @param {number} ms */
export const formatTime = (ms) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
