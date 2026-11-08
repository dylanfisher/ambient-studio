// One genome per seed vibe that passes the schema and the vibe's linter, built from the goldens,
// so a test can answer as a model that follows the vibe would (decision 0030).
import chantEnsemble from "../../src/engine/genomes/chant-ensemble.json" with { type: "json" };
import colundi from "../../src/engine/genomes/colundi.json" with { type: "json" };
import cymbal from "../../src/engine/genomes/cymbal.json" with { type: "json" };
import drone from "../../src/engine/genomes/drone.json" with { type: "json" };
import drum from "../../src/engine/genomes/drum.json" with { type: "json" };
import noiseBed from "../../src/engine/genomes/noise-bed.json" with { type: "json" };
import pad from "../../src/engine/genomes/pad.json" with { type: "json" };

const [colundiDrone, colundiPad, , colundiBell] = colundi.voices;

/** @type {Readonly<Record<string, Record<string, unknown>>>} seed id → genome */
export const SEED_GENOMES = Object.freeze({
  "cold-dorian": {
    ...drone,
    duration: 360,
    loudness: -16,
    fadeIn: 8,
    fadeOut: 30,
    macros: { brightness: 0.3 },
    voices: [drone.voices[0], { ...pad.voices[0], hold: 45, tone: 6 }],
  },
  "bell-field": {
    ...colundi,
    macros: { brightness: 0.4 },
    voices: [colundiDrone, colundiPad, { ...colundiBell, density: 3 }],
  },
  "tidal-noise": { ...noiseBed, duration: 480, loudness: -16, fadeIn: 10, fadeOut: 30 },
  "low-chant": {
    ...chantEnsemble,
    duration: 360,
    fadeIn: 8,
    fadeOut: 30,
    reverbDecay: 5,
    macros: { brightness: 0.3 },
    voices: [
      { ...chantEnsemble.voices[0], level: -12, singers: 12 },
      { ...cymbal.voices[0], density: 2, level: -16 },
      { ...drum.voices[0], density: 3, drop: 1 },
      { ...noiseBed.voices[0], level: -30, color: "brown", preset: "wind" },
    ],
  },
});
