// Oscillators start on whole frames with the phase they have reached rotated into their
// PeriodicWave, so an excerpt plays the phase a full render does (decision 0007).

/**
 * A PeriodicWave's coefficients for sine partials `gains` (index n is harmonic n) whose
 * fundamental has turned `turns` cycles: sin(n(ωt + φ)) = sin(nωt) cos(nφ) + cos(nωt) sin(nφ).
 * An oscillator started on a whole frame with this wave plays the phase it would have had,
 * without relying on how the library starts an oscillator between frames.
 * @param {Float32Array} gains
 * @param {number} turns
 */
function phasedWave(gains, turns) {
  const phase = 2 * Math.PI * (turns - Math.floor(turns));
  const real = new Float32Array(gains.length);
  const imag = new Float32Array(gains.length);
  gains.forEach((gain, n) => {
    real[n] = gain * Math.sin(n * phase);
    imag[n] = gain * Math.cos(n * phase);
  });
  return { real, imag };
}

/**
 * An oscillator playing sine partials `gains` (index n is harmonic n) at `hz`, to be started on
 * a whole frame `elapsed` seconds after its sound began, with the phase it has reached by then.
 * @param {BaseAudioContext} ctx
 * @param {Float32Array} gains amplitudes as played: the wave isn't rescaled to a peak of 1
 * @param {number} hz
 * @param {number} elapsed seconds
 */
export function phasedOscillator(ctx, gains, hz, elapsed) {
  // The node holds its frequency as a 32-bit float, so the phase is computed from that.
  const played = Math.fround(hz);
  const { real, imag } = phasedWave(gains, elapsed * played);
  const oscillator = ctx.createOscillator();
  oscillator.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
  oscillator.frequency.value = played;
  return oscillator;
}
