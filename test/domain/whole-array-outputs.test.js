// The whole-array meters, limiter and normalize are one-chunk calls of the streaming forms, so
// comparing the two can't catch a change to both. This compares them with outputs recorded from
// the code as it was before the streaming forms (decision 0060).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { integratedLoudness } from "../../src/domain/integrated-loudness.js";
import { limitTruePeak } from "../../src/domain/limit-true-peak.js";
import { normalize } from "../../src/domain/normalize.js";
import { truePeak } from "../../src/domain/true-peak.js";
import { currentEnvironment, goldenGenomes, goldenWindows, renderRaw } from "../support/golden.js";
import { tech3341Signals } from "../support/streaming-inputs.js";
import { wholeArrayOutputs } from "../support/whole-array-outputs.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/whole-array/outputs.json", import.meta.url), "utf8"),
);
const current = { integratedLoudness, truePeak, limitTruePeak, normalize };
const env = currentEnvironment();

describe("the whole-array functions give the outputs recorded before streaming", () => {
  test.each(tech3341Signals())("on Tech 3341 $name", ({ name, channels }) => {
    expect(wholeArrayOutputs(current, channels)).toEqual(fixture.tech3341[name]);
  });

  // Renders differ by CPU, so the golden windows count only on the machine that recorded them,
  // as the golden hashes do (0009). A golden added after the recording has no outputs from the
  // code before streaming to compare with.
  const sameMachine = env.platform === fixture.golden.platform && env.cpu === fixture.golden.cpu;
  const recorded = goldenGenomes().filter(({ name }) =>
    Object.hasOwn(fixture.golden.windows, `${name}/start`),
  );
  test("every recorded golden is still a golden", () => {
    expect(2 * recorded.length).toBe(Object.keys(fixture.golden.windows).length);
  });
  test.skipIf(!sameMachine).each(recorded)(
    "on $name's golden windows",
    async ({ name, genome }) => {
      for (const window of goldenWindows(genome, "raw")) {
        const outputs = wholeArrayOutputs(current, await renderRaw(genome, window));
        expect(outputs).toEqual(fixture.golden.windows[`${name}/${window.name}`]);
      }
    },
  );
});
