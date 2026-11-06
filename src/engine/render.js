// Schedules a genome's timeline on an AudioContext (decisions 0007 and 0010). It only
// schedules: the caller builds an offline context from `renderPlan`, runs it, and trims the
// buffer with `trimToResult`, and the same call schedules on a live context.
/** @import { EffectiveParams, Resolved } from "./effective-params.js" */
/** @import { Genome, Voice } from "./genome-schema.js" */
import { CONTROL_RATE, controlTime } from "./control-grid.js";
import { dbToGain } from "./decibels.js";
import { effectiveParams } from "./effective-params.js";
import { masterBus } from "./master-bus.js";
import { renderPlan, SAMPLE_RATE } from "./render-plan.js";
import { requireGenome } from "./validate-genome.js";
import { requireVoiceType } from "./voice-registry.js";

/**
 * Events are created a window at a time, each window this many seconds of timeline, because
 * every node costs render time on every quantum from its creation, started or not (decision
 * 0002, probe b).
 */
export const WINDOW = 2;
/** Seconds before its start a window's nodes are created. */
const LEAD = 1;
const WINDOW_SAMPLES = WINDOW * CONTROL_RATE;
/** Seconds a voice takes to open at its start and close at its end, so neither clicks. */
const GATE_RAMP = 0.02;

/** @typedef {(params: EffectiveParams, time: number) => number} ControlValue */

/**
 * What a voice type's `build` gets.
 * @typedef {object} VoiceSetup
 * @property {BaseAudioContext} ctx
 * @property {AudioNode} output where the voice connects its stereo sound; `render` applies the
 *   voice's level, start and end after it
 * @property {Genome} genome the normalized genome
 * @property {Voice} voice the voice as stored, its trajectories unevaluated
 * @property {number} seed
 * @property {number} from timeline seconds at the render's first frame, pre-roll included
 * @property {number} startFrame the timeline frame at the render's first frame, for a voice that
 *   places nodes on whole frames
 * @property {number} to timeline seconds at the render's end
 * @property {(time: number) => number} at timeline seconds to context seconds
 * @property {(param: AudioParam, value: (voice: Resolved<Voice>, time: number) => number) => void} automate
 *   makes `param` follow a value of the voice's effective parameters, sampled on the control
 *   grid and ramped between samples. Call it inside `build` only: `render` sets every
 *   automated parameter's start value after `build` returns, and a parameter added later from
 *   a window would miss it and the ramps of the windows before.
 */

/**
 * What `build` returns for a voice with events: a function `render` calls once per window with
 * the timeline seconds it covers, at least one second before `from`, to create the nodes of the
 * events that start in [from, to). Events are indexed on the voice's own grid from timeline 0
 * (decision 0003), so a window holds the same events in an excerpt as in a full render. It
 * must not create an event at or after its `to`: that event belongs to the next window, which
 * would create it again, and on the last window it lies past the render's end. It skips events
 * before the setup's `from`, which the pre-roll covers.
 * Undefined for a voice whose nodes all exist from the start.
 * @typedef {((from: number, to: number) => void) | undefined} VoiceWindow
 */

/**
 * The value of a piecewise-linear curve through `points` at `time`, holding the end values
 * outside them.
 * @param {readonly (readonly [number, number])[]} points times rising
 * @param {number} time
 */
function pointValue(points, time) {
  let previous = /** @type {readonly [number, number]} */ (points[0]);
  if (time <= previous[0]) return previous[1];
  for (const point of points) {
    if (time < point[0]) {
      return (
        previous[1] + ((point[1] - previous[1]) * (time - previous[0])) / (point[0] - previous[0])
      );
    }
    previous = point;
  }
  return previous[1];
}

/**
 * The voice's gate: closed before its start, open from `GATE_RAMP` later until as long before
 * its end.
 * @param {Voice} voice
 * @returns {[number, number][]}
 */
function gatePoints({ start, end }) {
  const ramp = Math.min(GATE_RAMP, (end - start) / 2);
  return [
    [start, 0],
    [start + ramp, 1],
    [end - ramp, 1],
    [end, 0],
  ];
}

/**
 * `ctx` with every node made through it, until `held.done` is set, kept in `held.nodes`.
 * The library frees a node whose JS object is garbage-collected and gives its id to the next
 * node created, and orders its graph by id, so a node created before rendering that was freed
 * mid-render would let later event nodes reorder it, and the sums it feeds, at a time that
 * depends on V8 (decision 0010). Keeping them referenced keeps every node created before
 * rendering in one order below every event node's id.
 * @param {BaseAudioContext} ctx
 */
function holdingNodes(ctx) {
  const held = { done: false, nodes: /** @type {unknown[]} */ ([]) };
  // The proxy's target is an empty object, not `ctx`: a proxy must return a non-configurable
  // property of its target unchanged, and tests redefine `create…` methods on `ctx` that way.
  const tracked = new Proxy(/** @type {BaseAudioContext} */ (/** @type {unknown} */ ({})), {
    get(_, key) {
      const value = Reflect.get(ctx, key, ctx);
      if (typeof value !== "function") return value;
      if (typeof key !== "string" || !key.startsWith("create")) return value.bind(ctx);
      return (/** @type {unknown[]} */ ...args) => {
        const made = value.apply(ctx, args);
        if (!held.done) held.nodes.push(made);
        return made;
      };
    },
  });
  return { tracked, held };
}

/**
 * The voices to render, sorted by id so voice order never changes the summing order (decision
 * 0005).
 * @param {Genome} genome
 * @param {readonly string[] | undefined} ids
 */
function selectVoices(genome, ids) {
  for (const id of ids ?? []) {
    if (!genome.voices.some((voice) => voice.id === id)) {
      throw new Error(`render: the genome has no voice "${id}"`);
    }
  }
  return [...genome.voices]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .filter((voice) => !ids || ids.includes(voice.id));
}

/**
 * Schedules the timeline from `offset` minus the pre-roll to `offset + duration` on `ctx`,
 * whose current time (0 for an offline context) is the plan's first frame. Nodes for events are
 * created in windows: on an OfflineAudioContext each window in a `suspend` one second ahead,
 * and on a live context all at once.
 * @param {Genome} genome
 * @param {BaseAudioContext} ctx at 48 kHz with 2 channels; an offline one is
 *   `renderPlan(genome, {duration, offset}).length` frames long
 * @param {{ seed: number; duration: number; offset?: number; voices?: readonly string[] }} options
 *   `voices` limits the render to the voices with these ids, for stems
 * @returns {Promise<void>} settles once every window is created. On an offline context, await it
 *   together with `startRendering()`. A window created in a `suspend` that throws resumes the
 *   render and then rejects the promise; a window created at once (the first second, or every
 *   window on a live context) throws out of `render()` itself.
 */
export function render(genome, ctx, { seed, duration, offset = 0, voices }) {
  const normalized = requireGenome(genome, "render: invalid genome");
  if (ctx.sampleRate !== SAMPLE_RATE) {
    throw new Error(`render: the context must run at ${SAMPLE_RATE} Hz, got ${ctx.sampleRate}`);
  }
  const plan = renderPlan(normalized, { duration, offset });
  const from = plan.startFrame / SAMPLE_RATE;
  const to = (plan.startFrame + plan.length) / SAMPLE_RATE;
  const base = ctx.currentTime;
  const { tracked, held } = holdingNodes(ctx);
  /** @param {number} time */
  const at = (time) => base + (time - from);

  /** @type {{ param: AudioParam; value: ControlValue }[]} */
  const automations = [];
  /** @type {(param: AudioParam, value: ControlValue) => void} */
  const automate = (param, value) => automations.push({ param, value });
  const bus = masterBus(tracked, normalized, seed, automate);

  const players = selectVoices(normalized, voices).map((voice) => {
    const index = normalized.voices.indexOf(voice);
    /** @param {EffectiveParams} params */
    const self = (params) => /** @type {Resolved<Voice>} */ (params.voices[index]);
    const gate = tracked.createGain();
    const level = tracked.createGain();
    gate.connect(level).connect(bus);
    const points = gatePoints(voice);
    gate.gain.setValueAtTime(pointValue(points, from), at(from));
    for (const [time, value] of points) {
      if (time > from) gate.gain.linearRampToValueAtTime(value, at(time));
    }
    automate(level.gain, (params) => dbToGain(/** @type {number} */ (self(params).level)));
    return requireVoiceType(voice.type).build({
      ctx: tracked,
      output: gate,
      genome: normalized,
      voice,
      seed,
      from,
      to,
      startFrame: plan.startFrame,
      at,
      automate: (param, value) => automate(param, (params, time) => value(self(params), time)),
    });
  });

  // Each parameter starts where a render from timeline 0 would be at `from`: on the ramp
  // between the grid samples either side of it.
  const first = Math.floor(from * CONTROL_RATE);
  const last = Math.ceil(to * CONTROL_RATE);
  const before = effectiveParams(normalized, controlTime(first));
  const after = effectiveParams(normalized, controlTime(first + 1));
  const u = (from - controlTime(first)) * CONTROL_RATE;
  for (const { param, value } of automations) {
    const a = value(before, controlTime(first));
    const b = value(after, controlTime(first + 1));
    param.setValueAtTime(a + (b - a) * u, at(from));
  }

  const offline = /** @type {OfflineAudioContext} */ (ctx);
  const windowed = "startRendering" in ctx && typeof offline.suspend === "function";
  /** @type {Promise<void>[]} */
  const pending = [];
  for (let window = Math.floor(from / WINDOW); window * WINDOW < to; window++) {
    const firstSample = Math.max(window * WINDOW_SAMPLES, first + 1);
    // The last window takes every sample up to the first at or after `to`, which sits in the
    // next window when `to` falls on a window boundary.
    const endSample = (window + 1) * WINDOW >= to ? last + 1 : (window + 1) * WINDOW_SAMPLES;
    const create = () => {
      for (let sample = firstSample; sample < endSample; sample++) {
        const time = controlTime(sample);
        const params = effectiveParams(normalized, time);
        for (const { param, value } of automations) {
          param.linearRampToValueAtTime(value(params, time), at(time));
        }
      }
      const windowFrom = Math.max(window * WINDOW, from);
      const windowTo = Math.min((window + 1) * WINDOW, to);
      for (const play of players) play?.(windowFrom, windowTo);
    };
    // The suspend time rounds up to the next render quantum, so it sits a whole second, not
    // just a quantum, before the window's first event (decision 0002).
    const wake = at(window * WINDOW) - LEAD;
    if (!windowed || wake <= base) {
      create();
    } else {
      pending.push(
        offline.suspend(wake).then(async () => {
          try {
            create();
          } finally {
            await offline.resume();
          }
        }),
      );
    }
  }
  held.done = true;
  // The callback keeps `held` referenced until the last window is created; no node is created
  // after it, so the graph's order no longer changes.
  return Promise.all(pending).then(() => {
    held.nodes.length = 0;
  });
}
