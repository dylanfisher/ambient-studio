// Sessions and their jobs through the HTTP routes (decision 0027), against the fake omlx on a
// fake clock: asking for candidates renders playable excerpts, and stopping a session cancels
// its jobs and their omlx requests.
/** @import { Reply } from "../support/http-client.js" */
/** @import { Studio } from "../support/studio.js" */
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
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
  expect(job.progress).toEqual({ done: 2, total: 2, step: null });
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
  // A session holds one candidates job at a time, so the queued one is another session's.
  const other = await ok("POST", `/api/vibes/${session.vibeId}/sessions`, {});
  omlx.script({ tokens: ["{"], holdAfter: 0 });
  const running = await ok("POST", `/api/sessions/${session.id}/candidates`, { count: 3 });
  const queued = await ok("POST", `/api/sessions/${other.id}/candidates`, { count: 3 });
  await omlx.waitForRequests(1);
  expect(server.jobs.get(running.id).state).toBe("running");
  expect(server.jobs.get(queued.id).state).toBe("queued");

  await ok("POST", `/api/sessions/${other.id}/stop`, {});
  expect(server.jobs.get(queued.id).state).toBe("cancelled");
  expect(server.jobs.get(running.id).state).toBe("running");
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

test("while omlx is busy the candidates job says it is waiting for the model", async () => {
  const { server, omlx, ok, openSession } = await setup();
  const { session } = await openSession();
  omlx.script({ status: 429, body: "busy" });
  const job = await ok("POST", `/api/sessions/${session.id}/candidates`, { count: 1 });
  await vi.waitFor(() =>
    expect(server.jobs.get(job.id).progress).toEqual({
      done: 0,
      total: 1,
      step: "Waiting for the model: it is busy with another request",
    }),
  );
  await ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await server.jobs.settled(job.id);
  expect(server.jobs.get(job.id)).toMatchObject({ state: "cancelled", progress: { step: null } });
});

/**
 * Sends `path` twice at once and returns the two replies, the lower status first.
 * @param {Studio} studio
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<Reply[]>}
 */
async function postTwice({ server }, path, body) {
  const replies = await Promise.all([
    server.api("POST", path, body),
    server.api("POST", path, body),
  ]);
  return replies.sort((a, b) => a.status - b.status);
}

/**
 * The accepted reply's job id, after checking one reply was accepted and the other refused.
 * @param {Reply[]} replies
 * @returns {{ id: number, refused: any }}
 */
function oneAccepted([accepted, refused]) {
  expect([accepted?.status, refused?.status]).toEqual([200, 409]);
  return { id: accepted?.json().id, refused: refused?.json() };
}

test("a second candidates request for a session with one unfinished is refused, naming it", async () => {
  const studio = await setup();
  const { server, omlx, ok, openSession } = studio;
  const { session } = await openSession();
  const other = await ok("POST", `/api/vibes/${session.vibeId}/sessions`, {});
  omlx.script({ tokens: ["{"], holdAfter: 0 });
  const path = `/api/sessions/${session.id}/candidates`;
  const { id, refused } = oneAccepted(await postTwice(studio, path, { count: 2 }));
  expect(refused).toEqual({
    error: `This session is already asking for candidates (job ${id}). Wait for it to finish, or cancel it.`,
    jobId: id,
  });
  expect(server.jobs.list().filter((job) => job.kind === "candidates")).toHaveLength(1);
  // Another session's request is another action.
  expect((await server.api("POST", `/api/sessions/${other.id}/candidates`, {})).status).toBe(200);
  // While the candidates job runs it renders the session's excerpts itself.
  const excerpts = await server.api("POST", `/api/sessions/${session.id}/excerpts`, {});
  expect(excerpts.status).toBe(409);
  expect(excerpts.json()).toEqual({
    error: `This session's candidates job (job ${id}) renders the excerpts itself. Wait for it to finish.`,
    jobId: id,
  });
  for (const job of server.jobs.list()) server.jobs.cancel(job.id);
  await server.jobs.idle();
  // Once it has finished the session takes another.
  expect((await server.api("POST", path, { count: 1 })).status).toBe(200);
});

test("a second excerpts request for a session with one unfinished is refused, naming it", async () => {
  const studio = await setup();
  const { server, omlx, openSession } = studio;
  const { session } = await openSession();
  // A held request ahead of it keeps the excerpts job queued.
  const blocker = await openSession();
  omlx.script({ tokens: ["{"], holdAfter: 0 });
  await studio.ok("POST", `/api/sessions/${blocker.session.id}/candidates`, { count: 1 });
  const path = `/api/sessions/${session.id}/excerpts`;
  const { id, refused } = oneAccepted(await postTwice(studio, path, {}));
  expect(refused).toEqual({
    error: `This session is already rendering its excerpts (job ${id}). Wait for it to finish, or cancel it.`,
    jobId: id,
  });
  expect(server.jobs.list().filter((job) => job.kind === "excerpts")).toHaveLength(1);
  for (const job of server.jobs.list()) server.jobs.cancel(job.id);
  await server.jobs.idle();
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
