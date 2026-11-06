export default {
  name: "12-tone equal temperament",
  period: "2/1",
  steps: 12,
  // Degree 0 is C, so A4 is degree 9 in octave 4.
  reference: { degree: 9, octave: 4, hz: 440 },
  scales: {
    ionian: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
    "major-pentatonic": [0, 2, 4, 7, 9],
    "minor-pentatonic": [0, 3, 5, 7, 10],
  },
};
