import { CHROMATIC_12_MODES } from "../modes.js";

export default {
  name: "12-tone equal temperament",
  period: "2/1",
  steps: 12,
  // Degree 0 is C, so A4 is degree 9 in octave 4.
  reference: { degree: 9, octave: 4, hz: 440 },
  scales: { ...CHROMATIC_12_MODES },
};
