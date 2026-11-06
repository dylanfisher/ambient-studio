// Renders a genome the way the server will: an OfflineAudioContext sized by `renderPlan`,
// `render()` to schedule, then `trimToResult`. src/engine can't import node-web-audio-api, so
// tests build the context here.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { RenderResult } from "../../src/engine/render-plan.js" */
import { OfflineAudioContext } from "node-web-audio-api";
import { render } from "../../src/engine/render.js";
import { renderPlan, trimToResult } from "../../src/engine/render-plan.js";

/**
 * @param {Genome} genome
 * @param {{ seed: number; duration: number; offset?: number; voices?: string[] }} options
 * @param {(ctx: OfflineAudioContext) => void} [prepare] changes the context before `render()`
 * @returns {Promise<RenderResult>}
 */
export async function renderOffline(genome, options, prepare) {
  const { duration, offset = 0 } = options;
  const plan = renderPlan(genome, { duration, offset });
  const ctx = new OfflineAudioContext({
    numberOfChannels: plan.channels,
    length: plan.length,
    sampleRate: plan.sampleRate,
  });
  prepare?.(ctx);
  // `render()` registers its suspends before rendering starts. The two are awaited together,
  // so a window that throws rejects here instead of going unhandled.
  const scheduled = render(genome, ctx, options);
  const [buffer] = await Promise.all([ctx.startRendering(), scheduled]);
  return trimToResult(buffer, plan);
}
