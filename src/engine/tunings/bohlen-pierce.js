export default {
  name: "Bohlen-Pierce, 13 equal divisions of 3/1",
  period: "3/1",
  steps: 13,
  // The period is 3/1, so "octave" counts periods: octave 0 starts at C3.
  reference: { degree: 0, octave: 0, hz: 130.8127826502993 },
  scales: {
    lambda: [0, 2, 3, 4, 6, 7, 9, 10, 12],
  },
};
