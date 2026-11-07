// The vibe routes (decision 0027): create, list, read, edit as a new revision, and notes; and
// loading the seed vibes (0030).
/** @import { SeedVibe } from "../../src/domain/seed-vibes.js" */
/** @import { TestServer } from "../support/http-client.js" */
import { afterEach, expect, test } from "vitest";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { MAX_CHARS } from "../../src/server/request-fields.js";
import { markRemoved, TABLE } from "../../src/server/store.js";
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

test("a name, a brief or a note one character over its limit is a 400 naming it", async () => {
  const { server, ok } = await setup();
  const over = (/** @type {number} */ limit) => "x".repeat(limit + 1);
  const atLimit = {
    ...VIBE,
    name: "x".repeat(MAX_CHARS.name),
    brief: "x".repeat(MAX_CHARS.brief),
  };
  const vibe = await ok("POST", "/api/vibes", atLimit);
  for (const [field, limit] of /** @type {const} */ ([
    ["name", MAX_CHARS.name],
    ["brief", MAX_CHARS.brief],
  ])) {
    const reply = await server.api("POST", "/api/vibes", { ...VIBE, [field]: over(limit) });
    expect(reply.status).toBe(400);
    expect(reply.json().error).toBe(
      `${field} must be at most ${limit} characters, got ${limit + 1}`,
    );
  }
  const note = await server.api("POST", `/api/vibes/${vibe.id}/notes`, {
    text: over(MAX_CHARS.note),
  });
  expect(note.status).toBe(400);
  expect(note.json().error).toBe(
    `text must be at most ${MAX_CHARS.note} characters, got ${MAX_CHARS.note + 1}`,
  );
  expect((await ok("GET", `/api/vibes/${vibe.id}`)).notes).toEqual([]);
});

test("a seed vibe loads once as a normal vibe, and again only once that vibe is removed", async () => {
  const { server, ok } = await setup();
  const listed = await ok("GET", "/api/seed-vibes");
  expect(listed.seeds.map((/** @type {any} */ seed) => seed.id)).toEqual(Object.keys(SEED_VIBES));
  expect(listed.seeds.every((/** @type {any} */ seed) => seed.vibeId === null)).toBe(true);

  const seed = /** @type {SeedVibe} */ (SEED_VIBES["bell-field"]);
  const vibe = await ok("POST", "/api/seed-vibes/bell-field", {});
  expect(vibe.revision).toMatchObject({ ...seed, vibeId: vibe.id });
  expect((await ok("GET", "/api/vibes")).vibes).toEqual([vibe]);
  const after = await ok("GET", "/api/seed-vibes");
  expect(after.seeds.find((/** @type {any} */ s) => s.id === "bell-field").vibeId).toBe(vibe.id);

  const again = await server.api("POST", "/api/seed-vibes/bell-field", {});
  expect(again.status).toBe(409);
  expect(again.json().error).toMatch(`vibe ${vibe.id}`);
  // An edit appends a revision; the vibe still came from the seed.
  await ok("POST", `/api/vibes/${vibe.id}/revisions`, { ...seed, name: "my bells" });
  expect((await server.api("POST", "/api/seed-vibes/bell-field", {})).status).toBe(409);

  markRemoved(server.store, TABLE.vibes, vibe.id, "starting over");
  const reloaded = await ok("POST", "/api/seed-vibes/bell-field", {});
  expect(reloaded.id).not.toBe(vibe.id);
});

test("an unknown seed is a 404, and a body with fields or no JSON body is refused", async () => {
  const { server } = await setup();
  expect((await server.api("POST", "/api/seed-vibes/nope", {})).status).toBe(404);
  const withField = await server.api("POST", "/api/seed-vibes/cold-dorian", { name: "x" });
  expect(withField.status).toBe(400);
  expect((await server.api("POST", "/api/seed-vibes/cold-dorian")).status).toBe(415);
});
