// Candidates and their excerpt renders written straight to a studio's store and render cache
// (decision 0026), for route tests that need rows and a playable file but not the audio. The
// rows are those `renderExcerpt` writes: the same key, producer and cache folder.
/** @import { Candidate } from "../../src/server/generation-store.js" */
/** @import { Render } from "../../src/server/render-store.js" */
/** @import { Studio } from "./studio.js" */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import { excerptRequest } from "../../src/server/candidate-excerpt.js";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { renderExcerpt } from "../../src/server/render-excerpt.js";
import { putRender } from "../../src/server/render-store.js";
import { writeMp3 } from "../../src/server/write-mp3.js";
import { tempRoot } from "./temp-root.js";

const SAMPLE_RATE = 44100;
/** Long enough for several MPEG frames, so a range request has bytes to take. */
const STUB_SECONDS = 0.5;
const PASSING = Object.freeze({ ok: true, findings: [] });

/** @type {Promise<Buffer> | undefined} */
let stubMp3;

/** A short silent MP3, encoded once per worker. */
function stub() {
  stubMp3 ??= (async () => {
    const root = await tempRoot();
    try {
      const file = join(root.root, "stub.mp3");
      const channels = [new Float32Array(Math.round(SAMPLE_RATE * STUB_SECONDS))];
      await writeMp3(file, encodePcm24(channels), { channelCount: 1, sampleRate: SAMPLE_RATE });
      return await readFile(file);
    } finally {
      await root.remove();
    }
  })();
  return stubMp3;
}

/**
 * What a real render of one genome at one seed came to, kept for the worker's life: rendering
 * is the cost this module exists to avoid paying per test.
 * @type {Map<string, Promise<{ features: unknown, checks: unknown, mp3: Buffer }>>}
 */
const measuredByKey = new Map();

/**
 * @param {Studio} studio
 * @param {Candidate} candidate
 * @param {unknown} genome
 */
function measure({ server }, candidate, genome) {
  const key = JSON.stringify([genome, candidate.seed]);
  let made = measuredByKey.get(key);
  if (!made) {
    const request = excerptRequest(server.store, candidate);
    if (!request) throw new Error("a candidate with a genome has a request");
    made = renderExcerpt(server.store, server.paths.renderCache, request).then(
      async ({ render }) => ({
        features: render.features,
        checks: render.checks,
        mp3: await readFile(join(server.paths.renderCache, render.file)),
      }),
    );
    measuredByKey.set(key, made);
  }
  return made;
}

/**
 * Stores one candidate of the session per genome, each with its excerpt row and MP3 file, and
 * returns them in order with their renders. The first call with `measured` for a genome and seed
 * renders it; later calls in the same worker copy that render's features, checks and file. A
 * test that rates an excerpt needs `measured`: capturing it renders the excerpt again and
 * compares the gain with the row's features. Without `measured`, the row's features are empty
 * and the file is a short silence.
 * @param {Studio} studio
 * @param {{ vibe: any, session: any }} opened as `openSession` returns it
 * @param {readonly unknown[]} genomes
 * @param {{ measured?: boolean }} [options]
 * @returns {Promise<{ candidate: Candidate, render: Render }[]>}
 */
export async function seedExcerpts(studio, { vibe, session }, genomes, { measured = false } = {}) {
  const { store, paths } = studio.server;
  await mkdir(paths.renderCache, { recursive: true });
  /** @type {{ candidate: Candidate, render: Render }[]} */
  const seeded = [];
  for (const [index, genome] of genomes.entries()) {
    const candidate = addCandidate(store, {
      vibeRevisionId: vibe.revision.id,
      generationId: null,
      sessionId: session.id,
      genomeId: putGenome(store, vibe.id, genome).id,
      seed: index + 1,
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
    const request = excerptRequest(store, candidate);
    if (!request) throw new Error("a candidate with a genome has a request");
    const { features, checks, mp3 } = measured
      ? await measure(studio, candidate, genome)
      : { features: {}, checks: PASSING, mp3: await stub() };
    const duration = EXCERPT_SECONDS;
    const offset = excerptOffset(/** @type {any} */ (genome), request.seed, duration);
    const file = `seeded-${candidate.id}.mp3`;
    await writeFile(join(paths.renderCache, file), mp3);
    const { render } = putRender(store, {
      ...request,
      offset,
      duration,
      producer: PRODUCER,
      file,
      features,
      checks,
    });
    seeded.push({ candidate, render });
  }
  return seeded;
}
