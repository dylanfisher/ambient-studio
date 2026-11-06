// The vibe routes (decision 0027): create, list, read, edit as a new revision, and notes.
/** @import { TestServer } from "../support/http-client.js" */
import { afterEach, expect, test } from "vitest";
import { startTestServer } from "../support/http-client.js";
import { VIBE } from "../support/studio.js";

/** @type {TestServer[]} */
const servers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.remove();
});

async function setup() {
  const server = await startTestServer();
  servers.push(server);
  /** @param {string} method @param {string} path @param {unknown} [value] */
  const ok = async (method, path, value) => {
    const reply = await server.api(method, path, value);
    expect(reply.status, reply.body.toString()).toBe(200);
    return reply.json();
  };
  return { server, ok };
}

test("a vibe is created, listed and read with its notes and sessions", async () => {
  const { ok } = await setup();
  const vibe = await ok("POST", "/api/vibes", VIBE);
  expect(vibe.revision).toMatchObject({ ...VIBE, vibeId: vibe.id });
  expect((await ok("GET", "/api/vibes")).vibes).toEqual([vibe]);
  const note = await ok("POST", `/api/vibes/${vibe.id}/notes`, { text: "less shimmer" });
  const session = await ok("POST", `/api/vibes/${vibe.id}/sessions`, {});
  expect(session).toMatchObject({ vibeId: vibe.id, stoppedAt: null });
  expect(await ok("GET", `/api/vibes/${vibe.id}`)).toEqual({
    ...vibe,
    notes: [note],
    sessions: [session],
  });
});

test("an edit appends a revision and keeps the one before", async () => {
  const { ok } = await setup();
  const vibe = await ok("POST", "/api/vibes", VIBE);
  const edit = { ...VIBE, brief: "slower, colder", constraints: { loudness: -18 } };
  const edited = await ok("POST", `/api/vibes/${vibe.id}/revisions`, edit);
  expect(edited.revision).toMatchObject(edit);
  expect(edited.revision.id).not.toBe(vibe.revision.id);
  expect((await ok("GET", `/api/vibes/${vibe.id}`)).revision).toEqual(edited.revision);
  const { revisions } = await ok("GET", `/api/vibes/${vibe.id}/revisions`);
  expect(revisions).toEqual([vibe.revision, edited.revision]);
});

test("invalid constraints, a missing field and an unknown field are 400s naming them", async () => {
  const { server } = await setup();
  const bad = await server.api("POST", "/api/vibes", { ...VIBE, constraints: { loudness: 3 } });
  expect(bad.status).toBe(400);
  expect(bad.json().error).toMatch(/^the constraints are invalid: \$\.loudness: /);
  const { brief, ...noBrief } = VIBE;
  const missing = await server.api("POST", "/api/vibes", noBrief);
  expect(missing.status).toBe(400);
  expect(missing.json().error).toMatch(/^brief must be a non-empty string/);
  const extra = await server.api("POST", "/api/vibes", { ...VIBE, mood: "cold" });
  expect(extra.status).toBe(400);
  expect(extra.json().error).toMatch(/^unknown fields mood/);
  expect((await server.api("GET", "/api/vibes")).json().vibes).toEqual([]);
});

test("an unknown vibe is a 404", async () => {
  const { server } = await setup();
  expect((await server.api("GET", "/api/vibes/7")).status).toBe(404);
  expect((await server.api("GET", "/api/vibes/07")).status).toBe(404);
  expect((await server.api("POST", "/api/vibes/7/notes", { text: "x" })).status).toBe(404);
});
