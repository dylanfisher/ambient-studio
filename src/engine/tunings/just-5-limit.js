import { CHROMATIC_12_MODES } from "../modes.js";

export default {
  name: "5-limit just intonation, 12 notes",
  period: "2/1",
  degrees: ["16/15", "9/8", "6/5", "5/4", "4/3", "45/32", "3/2", "8/5", "5/3", "9/5", "15/8"],
  // Degree 0 is C4 as 12-TET at A4 = 440 Hz tunes it. The ratios are fixed to degree 0, so a
  // key other than 0 moves the same table, not a retuned one.
  reference: { degree: 0, octave: 4, hz: 261.6255653005986 },
  scales: { ...CHROMATIC_12_MODES },
};
