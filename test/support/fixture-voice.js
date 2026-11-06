// A voice type with one parameter of each descriptor kind and a few macro rows, for tests of the
// schema, macros, vector view and random genomes. A test file registers it in `beforeAll` and
// unregisters it in `afterAll`, so it never leaks into another file's registry, isolated or not.
/** @import { MacroRow } from "../../src/engine/macro-table.js" */
import { choice, flag, int, number } from "../../src/engine/descriptor.js";

export const fixtureVoice = {
  type: "fixture",
  description: "test voice",
  params: {
    cutoff: number({
      min: 100,
      max: 2000,
      default: 600,
      unit: "Hz",
      scale: "log",
      trajectory: true,
      safe: [100, 800],
      description: "filter cutoff",
    }),
    partials: int({ min: 1, max: 12, default: 6, unit: "", description: "partial count" }),
    wave: choice({ values: ["sine", "triangle"], default: "sine", description: "waveform" }),
    snap: flag({ default: false, description: "snap partials to the tuning" }),
  },
  // Two macros on one parameter, and a row on a parameter every voice has.
  macros: /** @type {MacroRow[]} */ ([
    { macro: "brightness", param: "cutoff", depth: 0.25 },
    { macro: "warmth", param: "cutoff", depth: -0.1 },
    { macro: "density", param: "level", depth: 0.2 },
  ]),
  longestEvent: () => 0,
  /** Stands in for a voice's nodes, so random genomes have a cost to cap. */
  cost: () => 4,
  /** @returns {undefined} */
  build() {
    throw new Error("the fixture voice is for schema tests and doesn't render");
  },
};
