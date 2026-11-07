// Sessions and their jobs through the HTTP routes (decision 0027), against the fake omlx on a
// fake clock: asking for candidates renders playable excerpts, and stopping a session cancels
// its jobs and their omlx requests.
/** @import { Studio } from "../support/studio.js" */
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { getRender } from "../../src/server/render-store.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { FIXTURE_RECORDINGS } from "../support/golden.js";
import { GENOMES, removeStudio, startStudio } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  return studio;
}

test("asking for candidates runs a job that generates them and renders playable excerpts", async () => {
  const { server, omlx, ok, openSession, generate } = await setup();
  const { session } = await openSession();
  expect(omlx.requests).toHaveLength(0);

  const job = await generate(session.id, GENOMES);
  expect(job).toMatchObject({ kind: "candidates", state: "done", error: null });
  expect(job.progress).toEqual({ done: 2, total: 2 });
  expect(job.result.candidateIds).toHaveLength(2);
  expect(job.result.excerpts.map((/** @type {any} */ e) => e.candidateId)).toEqual(
    job.result.candidateIds,
  );
  expect(omlx.requests).toHaveLength(2);
  expect(omlx.maxInFlight()).toBe(1);

  const { candidates } = await ok("GET", `/api/sessions/${session.id}/candidates`);
  expect(candidates).toHaveLength(2);
  for (const candidate of candidates) {
    expect(candidate).toMatchObject({ rejectReason: null, intent: "a slow cold drone" });
    expect(candidate.lint.ok).toBe(true);
    expect(candidate.genome).toMatchObject({ voices: [{ type: "drone" }] });
    expect(candidate.excerpt).toMatchObject({ duration: 25, target: -16 });
    expect(candidate.excerpt.features.heard.gainDb).toEqual(expect.any(Number));
    expect(candidate.excerpt.url).toBe(`/audio/${candidate.excerpt.renderId}`);
    const audio = await server.request("GET", candidate.excerpt.url, {
      headers: { range: "bytes=0-11" },
    });
    expect(audio.status).toBe(206);
    expect(audio.headers["content-type"]).toBe("audio/wav");
    expect(audio.body.subarray(0, 4).toString("latin1")).toBe("RIFF");
  }
  const view = await ok("GET", `/api/sessions/${session.id}`);
  expect(view).toMatchObject({ id: session.id, stoppedAt: null });
  expect(view.jobs.map((/** @type {any} */ j) => j.id)).toEqual([job.id]);
});

test("a candidate that plays a field recording from the configured folder gets a playable excerpt", async () => {
  const folder = await mkdtemp(join(tmpdir(), "session-recordings-"));
  cleanups.push(() => rm(folder, { recursive: true }));
  await copyFile(join(FIXTURE_RECORDINGS, "noise-tone.wav"), join(folder, "walk.wav"));
  const hash = sha256Hex(await readFile(join(folder, "walk.wav")));
  const studio = await startStudio({ fieldRecordings: folder });
  studios.push(studio);
  const { server, omlx, ok, openSession, generate } = studio;
  const { session } = await openSession();
  const [drone] = GENOMES;
  const field = { id: "field", type: "recording", recording: hash, level: -18, mode: "scatter" };
  const genome = { ...drone, voices: [.../** @type {any} */ (drone).voices, field] };

  const job = await generate(session.id, [genome]);
  expect(job).toMatchObject({ state: "done", error: null });
  expect(omlx.requests[0]?.body.messages[0].content).toContain(`${hash} 2 2 "walk.wav"`);
  const [candidate] = (await ok("GET", `/api/sessions/${session.id}/candidates`)).candidates;
  expect(candidate).toMatchObject({ rejectReason: null });
  expect(candidate.genome.voices.map((/** @type {any} */ v) => v.type)).toContain("recording");
  expect(candidate.excerpt).toMatchObject({ duration: 25, checks: { ok: true } });
  const audio = await server.request("GET", candidate.excerpt.url);
  expect(audio.status).toBe(200);
  expect(audio.body.subarray(0, 4).toString("latin1")).toBe("RIFF");
});

test("stopping a session cancels its running and queued jobs and the omlx request in flight", async () => {
  const { server, omlx, ok, openSession } = await setup();
  const { session } = await openSession();
  omlx.script({ tokens: ["{"], holdAfter: 0 });
  const running = await ok("POST", `/api/sessions/${session.id}/candidates`, { count: 3 });
  const queued = await ok("POST", `/api/sessions/${session.id}/candidates`, { count: 3 });
  await omlx.waitForRequests(1);
  expect(server.jobs.get(running.id).state).toBe("running");
  expect(server.jobs.get(queued.id).state).toBe("queued");

  const stopped = await ok("POST", `/api/sessions/${session.id}/stop`, {});
  expect(stopped.stoppedAt).not.toBeNull();
  await server.jobs.settled(running.id);
  await omlx.waitForAborted(1);
  expect((await ok("GET", `/api/jobs/${running.id}`)).state).toBe("cancelled");
  expect((await ok("GET", `/api/jobs/${queued.id}`)).state).toBe("cancelled");
  expect(server.jobs.get(queued.id).startedAt).toBeNull();
  await server.jobs.idle();
  expect(omlx.requests).toHaveLength(1);

  const again = await server.api("POST", `/api/sessions/${session.id}/candidates`, {});
  expect(again.status).toBe(409);
  expect(again.json().error).toMatch(/has stopped/);
});

test("cancelling a job through its route aborts its omlx request", async () => {
  const { server, omlx, ok, openSession } = await setup();
  const { session } = await openSession();
  omlx.script({ tokens: ["{"], holdAfter: 0 });
  const job = await ok("POST", `/api/sessions/${session.id}/candidates`, { count: 2 });
  await omlx.waitForRequests(1);
  await ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await server.jobs.settled(job.id);
  await omlx.waitForAborted(1);
  expect((await ok("GET", `/api/jobs/${job.id}`)).state).toBe("cancelled");
  expect(omlx.requests).toHaveLength(1);
});

test("a candidate whose excerpt file is gone gets it back from the excerpts job", async () => {
  const { server, ok, openSession, generate, drive } = await setup();
  const { session } = await openSession();
  await generate(session.id, GENOMES.slice(0, 1));
  const [before] = (await ok("GET", `/api/sessions/${session.id}/candidates`)).candidates;
  const render = getRender(server.store, before.excerpt.renderId);
  await rm(join(server.paths.renderCache, /** @type {any} */ (render).file));
  const [missing] = (await ok("GET", `/api/sessions/${session.id}/candidates`)).candidates;
  expect(missing.excerpt).toBeNull();

  const job = await ok("POST", `/api/sessions/${session.id}/excerpts`, {});
  await drive(server.jobs.settled(job.id));
  expect((await ok("GET", `/api/jobs/${job.id}`)).state).toBe("done");
  const [after] = (await ok("GET", `/api/sessions/${session.id}/candidates`)).candidates;
  expect(after.excerpt.url).toMatch(/^\/audio\/\d+$/);
});

test("a count outside 1 to 32, an unknown field and an unknown session are refused", async () => {
  const { server, omlx, openSession } = await setup();
  const { session } = await openSession();
  const post = (/** @type {string} */ path, /** @type {unknown} */ value) =>
    server.api("POST", path, value);
  for (const count of [0, 33, 1.5, "8"]) {
    const reply = await post(`/api/sessions/${session.id}/candidates`, { count });
    expect(reply.status).toBe(400);
    expect(reply.json().error).toMatch(/^count must be an integer from 1 to 32/);
  }
  expect((await post(`/api/sessions/${session.id}/candidates`, { n: 8 })).status).toBe(400);
  expect((await post("/api/sessions/999/candidates", {})).status).toBe(404);
  expect((await server.api("GET", "/api/jobs/999")).status).toBe(404);
  expect(omlx.requests).toHaveLength(0);
});

test("a POST without a JSON body is refused, so a cross-site form can't start a job", async () => {
  const { server, omlx, openSession } = await setup();
  const { session } = await openSession();
  const reply = await server.request("POST", `/api/sessions/${session.id}/candidates`, {
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  expect(reply.status).toBe(415);
  const empty = await server.request("POST", `/api/sessions/${session.id}/stop`);
  expect(empty.status).toBe(415);
  expect(server.jobs.list()).toEqual([]);
  expect(omlx.requests).toHaveLength(0);
});
