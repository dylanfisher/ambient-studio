// A voice type with one parameter of each descriptor kind, for tests of the schema, macros and
// vector view. A test file registers it in `beforeAll` and unregisters it in `afterAll`, so it
// never leaks into another file's registry, isolated or not.
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
      description: "filter cutoff",
    }),
    partials: int({ min: 1, max: 12, default: 6, unit: "", description: "partial count" }),
    wave: choice({ values: ["sine", "triangle"], default: "sine", description: "waveform" }),
    snap: flag({ default: false, description: "snap partials to the tuning" }),
  },
};
