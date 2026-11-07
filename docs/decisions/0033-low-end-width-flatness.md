# 0033. Three more heard features: low-end share, stereo width and spectral flatness

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0023](0023-features-and-render-checks.md) (three heard features, `FEATURE_NAMES`, the
  `featuresText` line).

## Context

Phase 3 gives each vibe ranges over measured features (step 3b) and quotes an excerpt's features
in the revision prompt (3d). 0023 measures loudness, true peak, the spectral centroid and onset
rate. A brief also says how much bass a piece has, how wide it sits and whether it is tones or
hiss, and none of 0023's features measures those: the centroid of a low drone with a hiss on top
can match a mid-range pad's. Ranges and prompts need one list of the features they may name,
with a unit and a rounding each, so 3b's range table, 3g's pages and the prompt line don't each
keep their own.

The heard excerpt is stereo: `normalize` returns one buffer per channel of the render, and its
limiter links the gain across channels (0011), so the stereo image of the heard excerpt is the
render's.

## Decision

**Three heard features**, added to `HeardFeatures` and measured on the normalized excerpt like
the centroid. Each is a finite number from 0 to 1, or `null` when every frame (for width, the
whole excerpt) is under 0023's silent level of 1e-7 mean square.

| Feature | Measured as |
|---|---|
| `lowEndShare` | the power in bins under 150 Hz over the power in all bins, summed over the frames that aren't silent |
| `stereoWidth` | side power over mid plus side power over the whole excerpt, with mid (L + R) / 2 and side (L − R) / 2 |
| `flatness` | per frame that isn't silent, the geometric mean of the magnitudes from 20 Hz to 16 kHz over their arithmetic mean; then the mean over frames |

**Frames.** Low-end share and flatness use the centroid's frames: the channels mixed to mono,
2048-sample Hann frames from the first sample, hop 1024, complete frames only. At 48 kHz the bins
are 23.4 Hz apart.

- Low end is bins 0 to 6, up to 140.6 Hz. 150 Hz takes in the fundamentals of bass notes up to
  about D3 (147 Hz) and leaves out the low mids, where a pad's body sits.
- Flatness skips bin 0, since DC isn't sound, and stops at 16 kHz, since a recording made at
  44.1 kHz has nothing over 22.05 kHz and those empty bins would read the recording as tonal. On
  magnitudes, white noise reads about 0.85, the ratio for magnitudes that scatter as a Rayleigh
  distribution, which one frame of noise does; a 440 Hz sine reads 7e-6.

**Width as a share.** Width reads samples, not frames, since it needs no spectrum. As a share of
mid plus side, identical channels read 0, independent channels of equal level about 0.5, and
opposite channels 1, with no division by zero for mono. A one-channel excerpt reads 0, so a mono
genome is a measured 0 a range can hold, not a missing value that 3b would count as a miss.

**`FEATURE_NAMES`** in `src/domain/feature-names.js` lists every feature ranges and prompts may
name, in prompt order, each as `{set, name, label, unit, digits}`: its set (`raw` or `heard`), its
key in that set, a few plain words, its unit (null for a share), and the decimals the prompt
rounds to. `featureValue(features, entry)` reads one, null when the heard set is. The list is the
raw `shortTermMax`, `loudnessRange` and `truePeak`, and the heard `centroidMean`,
`centroidSpread`, `onsetRate`, `lowEndShare`, `stereoWidth` and `flatness`. Shares round to 0.01;
the others keep 0023's rounding. A test checks the list against the keys `extractFeatures`
returns.

**Loudness and gain are left out.** Every heard excerpt is normalized to the vibe's target, so
integrated loudness doesn't change what the owner hears, and normalize's `gainDb` is the target
less that loudness, the same fact. `featuresText` still opens with both, so the prompt and the
card say how loud the render came out; the rest of its line is `FEATURE_NAMES`, written as
"label: value unit", with "none measurable" for a null. Without a heard excerpt it leaves the
heard entries out and says the render was too quiet to normalize.

`feature-names.js` and `features-text.js` aren't in `FEATURE_EXTRACTOR`, since they change no
stored value; the three new feature files are, so `PRODUCER` changes and every cached excerpt
renders again when next asked for.

**Measured on the golden genomes**, the 25 s excerpt at seed 1, normalized to −16 LUFS:

| Golden | Low-end share | Width | Flatness |
|---|---|---|---|
| bell | 0.12 | 0.10 | 0.0001 |
| colundi | 0.24 | 0.09 | 0.0063 |
| drone | 0.82 | 0.15 | 0.0000 |
| example | 0.80 | 0.12 | 0.0076 |
| field-recording | 0.31 | 0.08 | 0.37 |
| granular-cloud | 0.13 | 0.07 | 0.0002 |
| master-bus | 0.17 | 0.11 | 0.0000 |
| noise-bed | 0.92 | 0.36 | 0.61 |
| pad | 0.10 | 0.10 | 0.0000 |

All of `extractFeatures` on one of these excerpts takes about 0.56 s on mbp2021 under
`nice -n 10`, with the test suite running beside it. Low-end share and flatness take about
0.1 s each, as the centroid does; width takes 1 ms.

## Alternatives considered

- **Flatness on the power spectrum** — rejected: one frame of white noise reads about 0.56
  (e^−γ, for exponentially scattered powers), so "near 1 for white noise" would need averaging
  across frames or bands first.
- **Flatness over every bin to Nyquist** — rejected: the field-recording golden, made from
  44.1 kHz fixtures, read 0.15 instead of 0.37 because of its empty top 2 kHz.
- **Flatness in dB, or "tonality" as 1 − flatness** — rejected: tonal sounds read from 0.0000 to
  0.008, which a dB scale would spread out, but a brief asks "tones or hiss", which 0 to 1 at
  0.01 answers, and a value named tonality that falls as the sound gets noisier reads backwards.
  The key is `flatness` so the number means what its name says.
- **Width as the correlation of the channels** — rejected: it is undefined when one channel is
  silent and reads −1 for opposite channels, which a range would have to treat specially.
- **Width as null for a mono excerpt** — rejected: 3b counts an unmeasurable value as a miss, so
  a vibe asking for a narrow image would fail every mono genome.
- **One frame pass for the centroid, low end and flatness** — rejected for now: one function a
  feature matches the files 0023 has, and the two extra passes cost about 0.2 s on a 25 s
  excerpt.

## Consequences

- Most tonal goldens read 0.00 flatness at the prompt's rounding, so a range over flatness can
  say "no hiss" or "mostly noise" but can't tell a pad from a bell.
- The noise-bed golden reads 0.92 low end because its noise is weighted toward the bass, and the
  field-recording fixtures are synthetic noise and tones, so their figures say little about real
  recordings.
- 3b builds its range table on `FEATURE_NAMES`; adding a feature later means one entry there and
  one in `HeardFeatures`, and the test fails until both agree.
