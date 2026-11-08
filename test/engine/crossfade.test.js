import { expect, test } from "vitest";
import { CROSSFADE_LAW, crossfadeGains } from "../../src/engine/crossfade.js";

test("the crossfade is equal-power: the two gains' squares sum to 1 at every frame", () => {
  expect(CROSSFADE_LAW).toBe("equal-power");
  const frames = 101;
  for (let frame = 0; frame < frames; frame++) {
    const { fall, rise } = crossfadeGains(frame, frames);
    const x = (frame + 0.5) / frames;
    expect(fall).toBeCloseTo(Math.cos((Math.PI / 2) * x), 15);
    expect(rise).toBeCloseTo(Math.sin((Math.PI / 2) * x), 15);
    expect(fall ** 2 + rise ** 2).toBeCloseTo(1, 15);
  }
});
