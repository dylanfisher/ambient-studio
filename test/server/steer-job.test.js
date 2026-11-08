// The steer job (decision 0056): 5e's search job at a small budget, scoring each point by its
// position on the chosen directions' sliders and its nearness to the chosen regions. A scripted
// embedder stands in for render and embed, so nothing is rendered; the fake sidecar answers the
// embedder, the ends' text embeddings and the optimizer. No taste model exists, so these steers
// also show a brief with no model still steers.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { Candidate } from "../../src/server/generation-store.js" */
/** @import { EmbedExcerpts } from "../../src/server/steer-job.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ATTACHMENT_KIND } from "../../src/domain/attachment-kind.js";
import { directionVector, projection } from "../../src/domain/direction-vector.js";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { OPERATOR } from "../../src/domain/operator.js";
import { DEFAULT_STEER_BUDGET, searchPopulation } from "../../src/domain/search-settings.js";
import { searchSpace } from "../../src/domain/search-space.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { regionSimilarity } from "../../src/domain/steer-terms.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { addAttachment } from "../../src/server/attachment-store.js";
import { putEmbedding } from "../../src/server/embedding-store.js";
import {
  addCandidate,
  getCandidate,
  getGenome,
  putGenome,
} from "../../src/server/generation-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addReferenceFile, addRegion } from "../../src/server/reference-store.js";
import { putRegionEmbedding, putRegionFeatures } from "../../src/server/region-analysis-store.js";
import { vibeLoudness } from "../../src/server/render-excerpt.js";
import { putRender } from "../../src/server/render-store.js";
import { readSearchResults } from "../../src/server/search-job.js";
import { SESSION_ROUTES } from "../../src/server/session-routes.js";
import { startSession } from "../../src/server/session-store.js";
import { steerJob } from "../../src/server/steer-job.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";
import { VIBE } from "../support/studio.js";
import { testApp } from "../support/test-app.js";

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

const checked = validateConstraints(SEED_VIBES["cold-dorian"]?.constraints);
if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
const constraints = checked.constraints;
const base = requireGenome(SEED_GENOMES["cold-dorian"], "the cold-dorian seed genome");
const dimensions = searchSpace(base, [], constraints, []).length;
const population = searchPopulation(dimensions);
const CLAP = "fake-clap@1 clap-aa";
const EMBEDDER = { producer: CLAP, dimension: 3, ready: true };
/** The direction's ends embed along the first two axes, so "underwater" is more space. */
const DRY = [1, 0, 0];
const UNDERWATER = [0, 1, 0];

/**
 * The scripted embedding of a genome: its space macro along the second axis, its motion along
 * the third. Macros unset read 0.5, as the engine's defaults.
 * @param {Genome} genome
 */
function scriptedEmbedding(genome) {
  const macros = /** @type {Record<string, number>} */ (genome.macros ?? {});
  const space = macros.space ?? 0.5;
  const motion = macros.motion ?? 0.5;
  return Float32Array.from([1 - space, space, motion]);
}

/**
 * Stores an excerpt of the genome for the vibe, with its scripted embedding.
 * @param {TestApp["app"]} app
 * @param {number} vibeId
 * @param {Genome} genome
 */
function seedExcerpt(app, vibeId, genome) {
  const row = putGenome(app.store, vibeId, genome);
  const { render } = putRender(app.store, {
    genomeId: row.id,
    seed: 7,
    offset: 0,
    duration: EXCERPT_SECONDS,
    target: vibeLoudness(constraints),
    producer: PRODUCER,
    file: `seeded-${row.id}.mp3`,
    features: {},
    checks: {},
  });
  putEmbedding(app.store, {
    ratedAudioId: null,
    renderId: render.id,
    producer: CLAP,
    vector: new Uint8Array(scriptedEmbedding(genome).buffer),
  });
  return row;
}

/**
 * A vibe under cold-dorian's constraints with a session, a base candidate, three excerpts (the
 * base's in the middle of the space macro's spread), and a direction from "dry" to "underwater".
 */
async function steerApp() {
  const made = await testApp();
  apps.push(made);
  const { app } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  const vibe = createVibe(app.store, { ...VIBE, constraints });
  const session = startSession(app.store, vibe.id);
  const genome = seedExcerpt(app, vibe.id, base);
  for (const space of [0.2, 0.8]) {
    seedExcerpt(app, vibe.id, { ...base, macros: { ...base.macros, space } });
  }
  const candidate = addCandidate(app.store, {
    generationId: null,
    vibeRevisionId: vibe.revision.id,
    sessionId: session.id,
    genomeId: genome.id,
    seed: 7,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: "seeded",
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  const direction = addAttachment(app.store, {
    vibeId: vibe.id,
    kind: ATTACHMENT_KIND.direction,
    regionId: null,
    details: { near: "dry", far: "underwater" },
  });
  return { ...made, vibe, session, candidate, direction };
}

/**
 * @param {TestApp["app"]} app
 * @param {Candidate} candidate
 */
function genomeOf(app, candidate) {
  const row = candidate.genomeId === null ? undefined : getGenome(app.store, candidate.genomeId);
  if (!row) throw new Error(`candidate ${candidate.id} has no genome`);
  return requireGenome(row.genome, `candidate ${candidate.id}'s genome`);
}

/**
 * The scripted embedder: each candidate's embedding from its macros, without a render.
 * @type {EmbedExcerpts}
 */
const embedExcerpts = (app) => async (candidates, signal) => {
  signal.throwIfAborted();
  return candidates.map((candidate) => ({
    embedding: scriptedEmbedding(genomeOf(app, candidate)),
    seconds: { render: 1, embed: 0.1 },
    item: /** @type {any} */ (null),
  }));
};

/**
 * Scripts the fake sidecar for a steer: the embedder, the text ends it embeds (far, then near),
 * then a start and an ask and a tell per generation, each ask drawing near the start.
 * @param {TestApp["sidecar"]} sidecar
 * @param {number} budget
 * @param {number[][]} texts each embed_text answer's floats, in order
 */
function scriptSteer(sidecar, budget, texts) {
  sidecar.script(
    { do: "answer", result: EMBEDDER },
    ...texts.map((floats) => ({ do: /** @type {const} */ ("answer"), result: {}, floats })),
    { do: "answer", result: { dimension: dimensions } },
  );
  for (let asked = 0, g = 0; asked < budget; asked += population, g++) {
    const count = Math.min(population, budget - asked);
    sidecar.script(
      { do: "answer", result: { count }, points: { seed: 300 + g, spread: 0.12 } },
      { do: "answer", result: { generations: g + 1 } },
    );
  }
}

/**
 * Runs a steer to its end and returns its result and the run's summary.
 * @param {Awaited<ReturnType<typeof steerApp>>} made
 * @param {{ directions: { id: number, setting: number }[], regions: number[] }} choices
 */
async function steer(made, choices) {
  const { app } = made;
  const job = steerJob(
    app,
    {
      vibeId: made.vibe.id,
      sessionId: made.session.id,
      base: made.candidate,
      genome: base,
      budget: DEFAULT_STEER_BUDGET,
      choices,
    },
    { embedExcerpts },
  );
  const status = app.jobs.add(OPERATOR.steer, job);
  await app.jobs.settled(status.id);
  const done = app.jobs.get(status.id);
  expect(done.error).toBeNull();
  const result = /** @type {any} */ (done.result);
  const saved = /** @type {any} */ (await readSearchResults(app.paths.search, result.run));
  return { result, saved };
}

/**
 * The mean of `value` over the shown points' scripted embeddings.
 * @param {TestApp["app"]} app
 * @param {number[]} ids
 * @param {(embedding: Float32Array) => number} value
 */
function meanOver(app, ids, value) {
  const values = ids.map((id) => {
    const candidate = getCandidate(app.store, id);
    if (!candidate) throw new Error(`no candidate ${id}`);
    return value(scriptedEmbedding(genomeOf(app, candidate)));
  });
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

const along = directionVector(Float32Array.from(DRY), Float32Array.from(UNDERWATER));
/** @param {Float32Array} embedding */
const onDirection = (embedding) => projection(embedding, along);

test("steering toward more raises the shown points' mean projection over the base's, and toward less lowers it", async () => {
  const baseProjection = onDirection(scriptedEmbedding(base));
  /** @type {Record<string, number>} */
  const means = {};
  for (const [name, setting] of /** @type {const} */ ([
    ["more", 1],
    ["less", 0],
  ])) {
    const made = await steerApp();
    scriptSteer(made.sidecar, DEFAULT_STEER_BUDGET, [UNDERWATER, DRY]);
    const choices = { directions: [{ id: made.direction.id, setting }], regions: [] };
    const { result, saved } = await steer(made, choices);
    expect(saved.shown.length).toBeGreaterThan(0);
    expect(result.model).toBe(false);
    means[name] = meanOver(made.app, saved.shown, onDirection);

    // Every point records the steer's operator, source and the directions it read.
    const point = getCandidate(made.app.store, /** @type {number} */ (saved.shown[0]));
    expect(point?.operator).toBe(OPERATOR.steer);
    expect(point?.source).toBe("optimizer");
    expect(point?.operatorParams).toMatchObject({
      budget: DEFAULT_STEER_BUDGET,
      steer: choices,
    });
    // The text ends were embedded through the cache: a second read asks the sidecar nothing.
    const texts = (await made.sidecar.received()).filter(
      ({ request }) => request.method === "embed_text",
    );
    expect(texts.map(({ request }) => /** @type {any} */ (request.params).text)).toEqual([
      "underwater",
      "dry",
    ]);
  }
  expect(means.more).toBeGreaterThan(baseProjection);
  expect(means.less).toBeLessThan(baseProjection);
});

test("a region term pulls the best point toward the region", async () => {
  const made = await steerApp();
  const { app, vibe } = made;
  const target = vibeLoudness(constraints);
  const { reference } = addReferenceFile(app.store, {
    sha256: "f".repeat(64),
    fileName: "tide.wav",
    format: "wav",
    file: `${"f".repeat(64)}.wav`,
    durationSeconds: 60,
    channels: 2,
    sampleRate: 48000,
    sizeBytes: 10,
  });
  const region = addRegion(app.store, {
    referenceFileId: reference.id,
    startSeconds: 0,
    endSeconds: 10,
    label: "moving tide",
    note: "",
  });
  const analysis = putRegionFeatures(app.store, {
    regionId: region.id,
    target,
    producer: PRODUCER,
    windows: [],
  });
  // The region sits along the motion axis, so nearness to it is more motion.
  const toward = Float32Array.from([0, 0, 1]);
  putRegionEmbedding(app.store, analysis.id, {
    embeddingProducer: CLAP,
    embedding: new Uint8Array(toward.buffer),
  });
  // A seeded excerpt with more motion, so the region's scale has a spread.
  seedExcerpt(app, vibe.id, { ...base, macros: { ...base.macros, motion: 0.9 } });
  const attached = addAttachment(app.store, {
    vibeId: vibe.id,
    kind: ATTACHMENT_KIND.reference,
    regionId: region.id,
    details: {},
  });
  scriptSteer(made.sidecar, DEFAULT_STEER_BUDGET, [UNDERWATER, DRY]);
  const { result, saved } = await steer(made, { directions: [], regions: [attached.id] });
  /** @param {Float32Array} embedding */
  const near = (embedding) => regionSimilarity(embedding, toward);
  const best = /** @type {number} */ (result.best.candidateId);
  expect(meanOver(app, [best], near)).toBeGreaterThan(near(scriptedEmbedding(base)));
  // The best is the nearest of every scored point.
  const nearest = Math.max(
    ...saved.evaluated.map((/** @type {any} */ e) => meanOver(app, [e.candidateId], near)),
  );
  expect(meanOver(app, [best], near)).toBe(nearest);
});

/**
 * A session route's handler, called with a body as the router would.
 * @param {TestApp["app"]} app
 * @param {string} path
 * @param {number} sessionId
 * @param {unknown} body
 */
async function post(app, path, sessionId, body) {
  const route = SESSION_ROUTES.find((r) => r.method === "POST" && r.path === path);
  if (!route) throw new Error(`no route ${path}`);
  try {
    return {
      status: 200,
      body: /** @type {any} */ (
        await route.handle(
          /** @type {any} */ ({
            app,
            params: { sessionId: String(sessionId) },
            body: async () => body,
          }),
        )
      ),
    };
  } catch (error) {
    const { status, message, details } = /** @type {any} */ (error);
    if (status === undefined) throw error;
    return { status, body: { error: message, ...details } };
  }
}

test("a brief with no taste model can steer though it can't search, and a second identical steer is a 409", async () => {
  const made = await steerApp();
  const { app, session, candidate, direction, sidecar } = made;
  sidecar.script(
    { do: "answer", result: EMBEDDER },
    { do: "answer", result: {}, floats: UNDERWATER },
    { do: "answer", result: {}, floats: DRY },
    { do: "answer", result: EMBEDDER },
  );
  const searched = await post(app, "/api/sessions/:sessionId/searches", session.id, {
    candidateId: candidate.id,
  });
  expect(searched.status).toBe(409);
  // A job that holds the runner keeps the steer queued.
  /** @type {() => void} */
  let release = () => undefined;
  const blocker = app.jobs.add(
    "blocker",
    () => new Promise((resolve) => (release = () => resolve(undefined))),
  );
  const body = {
    candidateId: candidate.id,
    directions: [{ id: direction.id, setting: 0.75 }],
  };
  const steered = await post(app, "/api/sessions/:sessionId/steers", session.id, body);
  expect(steered.status).toBe(200);
  expect(steered.body.kind).toBe(OPERATOR.steer);
  const again = await post(app, "/api/sessions/:sessionId/steers", session.id, body);
  expect(again.status).toBe(409);
  expect(again.body.jobId).toBe(steered.body.id);
  for (const job of app.jobs.list()) app.jobs.cancel(job.id);
  release();
  await app.jobs.settled(blocker.id);
  await app.jobs.idle();
});

test("a steer naming nothing, a setting outside 0 to 1, or a direction of another brief is a 400", async () => {
  const made = await steerApp();
  const { app, session, candidate, direction } = made;
  const other = createVibe(app.store, { ...VIBE, name: "other", constraints });
  const elsewhere = addAttachment(app.store, {
    vibeId: other.id,
    kind: ATTACHMENT_KIND.direction,
    regionId: null,
    details: { near: null, far: "bright" },
  });
  /** @type {[unknown, string | RegExp][]} */
  const cases = [
    [{ candidateId: candidate.id }, "Move a slider or choose a region to steer toward first."],
    [{ candidateId: candidate.id, directions: [{ id: direction.id, setting: 1.5 }] }, /setting/],
    [
      { candidateId: candidate.id, directions: [{ id: elsewhere.id, setting: 0.5 }] },
      `direction ${elsewhere.id} isn't attached to this brief`,
    ],
    [{ candidateId: candidate.id, regions: [direction.id] }, /isn't a region attached/],
    [
      { candidateId: candidate.id, budget: 0, directions: [{ id: direction.id, setting: 1 }] },
      /budget/,
    ],
  ];
  for (const [body, error] of cases) {
    const reply = await post(app, "/api/sessions/:sessionId/steers", session.id, body);
    expect(reply.status, JSON.stringify(body)).toBe(400);
    expect(reply.body.error).toMatch(error);
  }
  expect(app.jobs.list()).toEqual([]);
});
