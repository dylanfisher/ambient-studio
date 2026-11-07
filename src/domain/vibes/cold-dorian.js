// A seed vibe (decision 0030): a slow drone and pad in D dorian, dark and still.
export default {
  name: "Cold dorian drone",
  brief:
    "A cold, slow drone in D dorian. A low drone holds the root while a pad moves through long, " +
    "quiet chords, one every 40 seconds or more. Keep the high end down: it should sound like a " +
    "dim, cold room, not a bright one. No beat. Change comes over minutes: the filter opens a " +
    "little and closes again, and the pad swells and falls back.",
  constraints: {
    tuning: "12-tet",
    scale: "dorian",
    key: 2,
    pulse: "none",
    duration: { min: 300, max: 900 },
    loudness: -16,
    allowedVoices: ["drone", "pad"],
    padChords: 1.5,
    brightness: { min: 0.1, max: 0.45 },
  },
  softTargets: {},
};
