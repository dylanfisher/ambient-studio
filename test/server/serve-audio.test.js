// GET /audio/:renderId: a render-cache WAV by renders row id, with byte ranges as RFC 9110
// says, and nothing outside the render-cache folder (decision 0025).
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putGenome } from "../../src/server/generation-store.js";
import { putRender } from "../../src/server/render-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { startTestServer } from "../support/http-client.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** 1000 bytes, each its index mod 251, so any slice is distinct from its neighbors. */
const WAV = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 251));

async function setup() {
  const server = await startTestServer();
  cleanups.push(server.remove);
  const { store, paths } = server;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const genome = putGenome(store, vibe.id, droneGenome);
  let seed = 0;
  /**
   * Adds a renders row whose file is `file`, relative to the render-cache folder.
   * @param {string} file
   */
  const addRender = (file) =>
    putRender(store, {
      genomeId: genome.id,
      seed: seed++,
      offset: 0,
      duration: 25,
      target: -16,
      producer: "test",
      file,
      features: {},
      checks: {},
    }).render.id;
  await mkdir(paths.renderCache);
  await writeFile(join(paths.renderCache, "r.wav"), WAV);
  return { ...server, addRender, id: addRender("r.wav") };
}

test("a whole WAV is a 200 that says it takes ranges", async () => {
  const { request, id } = await setup();
  const reply = await request("GET", `/audio/${id}`);
  expect(reply.status).toBe(200);
  expect(reply.headers["content-type"]).toBe("audio/wav");
  expect(reply.headers["accept-ranges"]).toBe("bytes");
  expect(reply.headers["content-length"]).toBe("1000");
  expect(reply.body.equals(WAV)).toBe(true);
});

/**
 * Range header → the bytes RFC 9110 §14.1.2 selects from a 1000-byte file.
 * @type {[string, number, number][]}
 */
const SATISFIABLE = [
  ["bytes=0-99", 0, 99],
  ["bytes=100-100", 100, 100],
  ["bytes=500-", 500, 999],
  ["bytes=-100", 900, 999],
  ["bytes=-5000", 0, 999],
  ["bytes=990-5000", 990, 999],
  ["BYTES = 10-19", 10, 19],
];

test.each(SATISFIABLE)("%s is a 206 with exactly those bytes", async (range, first, last) => {
  const { request, id } = await setup();
  const reply = await request("GET", `/audio/${id}`, { headers: { range } });
  expect(reply.status).toBe(206);
  expect(reply.headers["content-range"]).toBe(`bytes ${first}-${last}/1000`);
  expect(reply.headers["content-length"]).toBe(String(last - first + 1));
  expect(reply.headers["content-type"]).toBe("audio/wav");
  expect(reply.headers["accept-ranges"]).toBe("bytes");
  expect(reply.body.equals(WAV.subarray(first, last + 1))).toBe(true);
});

test.each(["bytes=1000-", "bytes=1000-2000", "bytes=-0", "bytes=99999999999999999999-"])(
  "%s is a 416 that gives the length",
  async (range) => {
    const { request, id } = await setup();
    const reply = await request("GET", `/audio/${id}`, { headers: { range } });
    expect(reply.status).toBe(416);
    expect(reply.headers["content-range"]).toBe("bytes */1000");
  },
);

test.each(["bytes=0-9,20-29", "bytes=20-10", "bytes=abc", "bytes=-", "items=0-9", "bytes=1.5-9"])(
  "%s is ignored: a 200 with the whole file",
  async (range) => {
    const { request, id } = await setup();
    const reply = await request("GET", `/audio/${id}`, { headers: { range } });
    expect(reply.status).toBe(200);
    expect(reply.headers["content-range"]).toBeUndefined();
    expect(reply.body.equals(WAV)).toBe(true);
  },
);

test("a range with If-Range is ignored, since the server sends no validators", async () => {
  const { request, id } = await setup();
  const reply = await request("GET", `/audio/${id}`, {
    headers: { range: "bytes=0-9", "if-range": '"abc"' },
  });
  expect(reply.status).toBe(200);
  expect(reply.body.equals(WAV)).toBe(true);
});

test("a HEAD gives the GET's headers and no body", async () => {
  const { request, id } = await setup();
  const whole = await request("HEAD", `/audio/${id}`);
  expect(whole.status).toBe(200);
  expect(whole.headers["content-length"]).toBe("1000");
  expect(whole.headers["accept-ranges"]).toBe("bytes");
  expect(whole.body.length).toBe(0);
  const part = await request("HEAD", `/audio/${id}`, { headers: { range: "bytes=-10" } });
  expect(part.status).toBe(206);
  expect(part.headers["content-range"]).toBe("bytes 990-999/1000");
  expect(part.body.length).toBe(0);
});

test.each([
  "/audio/999",
  "/audio/0",
  "/audio/01",
  "/audio/abc",
  "/audio/1.0",
  "/audio/..%2F..%2Fconfig.json",
  "/audio/%2e%2e",
  "/audio/",
])("%s is a 404", async (path) => {
  const { request } = await setup();
  const reply = await request("GET", path);
  expect(reply.status).toBe(404);
  expect(reply.json().error).toEqual(expect.any(String));
});

test("a row whose file is missing is a 404", async () => {
  const { request, addRender } = await setup();
  const reply = await request("GET", `/audio/${addRender("gone.wav")}`);
  expect(reply.status).toBe(404);
});

test("a row whose file leaves the render-cache folder is a 404", async () => {
  const { request, addRender, paths } = await setup();
  await writeFile(join(paths.renderCache, "..", "outside.wav"), WAV);
  for (const file of [
    "../outside.wav",
    join(paths.renderCache, "..", "outside.wav"),
    "/etc/hosts",
  ]) {
    const reply = await request("GET", `/audio/${addRender(file)}`);
    expect(reply.status, file).toBe(404);
  }
});

test("a symlink in the render-cache folder to a file outside it is a 404", async () => {
  const { request, addRender, paths } = await setup();
  const outside = join(paths.renderCache, "..", "outside.wav");
  await writeFile(outside, WAV);
  await symlink(outside, join(paths.renderCache, "link.wav"));
  await symlink("..", join(paths.renderCache, "up"));
  expect((await request("GET", `/audio/${addRender("link.wav")}`)).status).toBe(404);
  expect((await request("GET", `/audio/${addRender("up/outside.wav")}`)).status).toBe(404);
});

test("a symlink that stays inside the render-cache folder is served", async () => {
  const { request, addRender, paths } = await setup();
  await symlink("r.wav", join(paths.renderCache, "alias.wav"));
  const reply = await request("GET", `/audio/${addRender("alias.wav")}`);
  expect(reply.status).toBe(200);
  expect(reply.body.equals(WAV)).toBe(true);
});

test("a directory in the render-cache folder is a 404", async () => {
  const { request, addRender, paths } = await setup();
  await mkdir(join(paths.renderCache, "folder.wav"));
  expect((await request("GET", `/audio/${addRender("folder.wav")}`)).status).toBe(404);
});

test("POST to an audio URL is a 405 that lists GET and HEAD", async () => {
  const { request, id } = await setup();
  const reply = await request("POST", `/audio/${id}`);
  expect(reply.status).toBe(405);
  expect(reply.headers.allow).toBe("GET, HEAD");
});

test("a client that drops a WAV mid-stream logs nothing, and stop waits for the stream", async () => {
  const { request, addRender, paths, origin, logged, stop } = await setup();
  await writeFile(join(paths.renderCache, "big.wav"), Buffer.alloc(16 << 20));
  const id = addRender("big.wav");
  await new Promise((resolve, reject) => {
    const outgoing = get(`${origin}/audio/${id}`, { agent: false }, (incoming) => {
      incoming.once("data", () => {
        outgoing.destroy();
        resolve(undefined);
      });
    });
    outgoing.on("error", (error) => {
      if (!outgoing.destroyed) reject(error);
    });
  });
  const after = await request("GET", `/audio/${id}`, { headers: { range: "bytes=0-3" } });
  expect(after.status).toBe(206);
  await stop();
  expect(logged).toEqual([]);
});
