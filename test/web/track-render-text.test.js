// What the timeline's confirm says a track render costs (decision 0062).
import { expect, test } from "vitest";
import { BENCH_RATE } from "../../src/domain/track-cost.js";
import { trackRenderText } from "../../src/web/track-render-text.js";

const cost = { peak: 600, work: BENCH_RATE * 150, audio: 1210, length: 1200 };

test("the confirm states the minutes at the bench's speed before any track render", () => {
  expect(trackRenderText(cost, { rate: BENCH_RATE, measured: false })).toBe(
    "Render the whole track, 20:00 long? It takes about 3 minutes at the speed the bench measured, and nothing else renders meanwhile. During a crossfade both sections play, 600 node-seconds a second at most, over the 560 one sketch may cost, which makes it slower, not wrong. It makes the preview you can play here; Export then writes the files.",
  );
});

test("after a render the confirm uses that run's speed, and a light track says nothing of cost", () => {
  const text = trackRenderText({ ...cost, peak: 300 }, { rate: BENCH_RATE / 2, measured: true });
  expect(text).toContain("about 5 minutes at the speed of the last track render");
  expect(text).not.toContain("node-seconds");
});
