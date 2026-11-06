// The server (decision 0025): the route table with JSON bodies and errors, static serving of
// src/web, src/engine and src/domain, and a stop that leaves no open handles.
/** @import { Route } from "../../src/server/routing.js" */
import { readFile } from "node:fs/promises";
import { setImmediate as tick } from "node:timers/promises";
import { afterEach, expect, test } from "vitest";
import { ROUTES } from "../../src/server/routes.js";
import { MAX_BODY_BYTES } from "../../src/server/routing.js";
import { startTestServer } from "../support/http-client.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** @type {Route[]} */
const TEST_ROUTES = [
  ...ROUTES,
  {
    method: "POST",
    path: "/api/echo/:name",
    handle: async ({ params, body }) => ({ params, body: await body() }),
  },
  { method: "GET", path: "/api/missing", handle: () => undefined },
  {
    method: "GET",
    path: "/api/broken",
    handle: () => {
      throw new Error("the handler broke");
    },
  },
];

/** @param {Route[]} [routes] */
async function setup(routes) {
  const server = await startTestServer(routes ? { routes } : {});
  cleanups.push(server.remove);
  return server;
}

const JSON_HEADERS = { "content-type": "application/json" };

test("a JSON body reaches the handler with the path's params decoded", async () => {
  const { request } = await setup(TEST_ROUTES);
  const reply = await request("POST", "/api/echo/cold%20drone", {
    headers: JSON_HEADERS,
    body: JSON.stringify({ n: 8 }),
  });
  expect(reply.status).toBe(200);
  expect(reply.headers["content-type"]).toBe("application/json; charset=utf-8");
  expect(reply.json()).toEqual({ params: { name: "cold drone" }, body: { n: 8 } });
});

test("malformed JSON is a 400 with a message", async () => {
  const { request } = await setup(TEST_ROUTES);
  const reply = await request("POST", "/api/echo/x", { headers: JSON_HEADERS, body: "{n: 8" });
  expect(reply.status).toBe(400);
  expect(reply.json().error).toMatch(/^the request body is not valid JSON: /);
});

test("an empty body is a 400 with a message", async () => {
  const { request } = await setup(TEST_ROUTES);
  const reply = await request("POST", "/api/echo/x", { headers: JSON_HEADERS });
  expect(reply.status).toBe(400);
  expect(reply.json().error).toMatch(/not valid JSON/);
});

test("a body that isn't labeled JSON is a 415", async () => {
  const { request } = await setup(TEST_ROUTES);
  const reply = await request("POST", "/api/echo/x", {
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  expect(reply.status).toBe(415);
  expect(reply.json().error).toMatch(/application\/json/);
});

test("a body over the limit is a 413, by its Content-Length and when chunked", async () => {
  const { request } = await setup(TEST_ROUTES);
  const big = JSON.stringify({ text: "x".repeat(MAX_BODY_BYTES) });
  const sized = await request("POST", "/api/echo/x", { headers: JSON_HEADERS, body: big });
  expect(sized.status).toBe(413);
  expect(sized.json().error).toMatch(/limit/);
  const chunked = await request("POST", "/api/echo/x", {
    headers: { ...JSON_HEADERS, "transfer-encoding": "chunked" },
    body: big,
  });
  expect(chunked.status).toBe(413);
});

test("a body at the limit is read", async () => {
  const { request } = await setup(TEST_ROUTES);
  const text = "x".repeat(MAX_BODY_BYTES - '{"t":""}'.length);
  const reply = await request("POST", "/api/echo/x", {
    headers: JSON_HEADERS,
    body: JSON.stringify({ t: text }),
  });
  expect(reply.status).toBe(200);
  expect(reply.json().body.t.length).toBe(text.length);
});

test("a handler that throws is a 500 whose stack is logged", async () => {
  const { request, logged } = await setup(TEST_ROUTES);
  const reply = await request("GET", "/api/broken");
  expect(reply.status).toBe(500);
  expect(reply.json().error).toBe("the handler broke");
  expect(logged.join("\n")).toMatch(/Error: the handler broke\n\s+at /);
});

test("a handler that sends nothing is a 500, not a hung request", async () => {
  const { request, logged } = await setup(TEST_ROUTES);
  expect((await request("GET", "/api/missing")).status).toBe(500);
  expect(logged.join("\n")).toMatch(/GET \/api\/missing/);
});

test("an unknown path is a JSON 404", async () => {
  const { request } = await setup();
  const reply = await request("GET", "/api/nothing");
  expect(reply.status).toBe(404);
  expect(reply.json().error).toEqual(expect.any(String));
});

test("the index page is served at /", async () => {
  const { request } = await setup();
  const reply = await request("GET", "/");
  expect(reply.status).toBe(200);
  expect(reply.headers["content-type"]).toBe("text/html; charset=utf-8");
  expect(reply.body.equals(await readFile("src/web/index.html"))).toBe(true);
});

test.each([
  ["/index.js", "src/web/index.js"],
  ["/engine/engine-version.js", "src/engine/engine-version.js"],
  ["/engine/tunings/12-tet.js", "src/engine/tunings/12-tet.js"],
  ["/domain/excerpt-seconds.js", "src/domain/excerpt-seconds.js"],
])("%s is served as text/javascript, so Safari loads it as a module", async (path, file) => {
  const { request } = await setup();
  const reply = await request("GET", `${path}?v=1`);
  expect(reply.status).toBe(200);
  expect(reply.headers["content-type"]).toBe("text/javascript; charset=utf-8");
  expect(reply.headers["x-content-type-options"]).toBe("nosniff");
  expect(reply.body.equals(await readFile(file))).toBe(true);
});

test("an engine JSON file is served as application/json", async () => {
  const { request } = await setup();
  const reply = await request("GET", "/engine/genomes/drone.json");
  expect(reply.status).toBe(200);
  expect(reply.headers["content-type"]).toBe("application/json");
});

test("a HEAD on a static file gives its length and no body", async () => {
  const { request } = await setup();
  const reply = await request("HEAD", "/engine/engine-version.js");
  expect(reply.status).toBe(200);
  const file = await readFile("src/engine/engine-version.js");
  expect(reply.headers["content-length"]).toBe(String(file.length));
  expect(reply.body.length).toBe(0);
});

test.each([
  "/server/main.js",
  "/config/example.json",
  "/../package.json",
  "/../../package.json",
  "/%2e%2e/package.json",
  "/%2E%2E/%2e%2e/package.json",
  "/engine/../server/main.js",
  "/engine/%2e%2e/server/main.js",
  "/engine/..%2fserver%2fmain.js",
  "/engine/..%5cserver%5cmain.js",
  "/engine/./engine-version.js",
  "//etc/hosts",
  "/%2Fetc%2Fhosts",
  "/engine/%00.js",
  "/engine/%zz.js",
  "/engine",
  "/engine/",
  "/engine/tunings",
  "/engine/tunings/",
  "/server/",
  "/index.html/",
])("%s is a 404", async (path) => {
  const { request } = await setup();
  const reply = await request("GET", path);
  expect(reply.status).toBe(404);
  expect(reply.json().error).toEqual(expect.any(String));
});

test("POST to a static path is a 404", async () => {
  const { request } = await setup();
  expect((await request("POST", "/index.js")).status).toBe(404);
});

/** The TCP handles this process holds, by kind. */
const tcpHandles = () =>
  process
    .getActiveResourcesInfo()
    .filter((kind) => kind.startsWith("TCP"))
    .sort();

/**
 * The TCP handles once libuv has freed the ones closing. A socket's 'close' event comes before
 * its handle is freed, which takes a further turn or two of the event loop; this waits up to ten
 * turns, not a length of time.
 * @param {string[]} expected
 */
async function tcpHandlesSettledTo(expected) {
  for (let turn = 0; turn < 10 && tcpHandles().join() !== expected.join(); turn++) await tick();
  return tcpHandles();
}

test("stop closes the server, its idle keep-alive sockets and the store", async () => {
  const before = tcpHandles();
  const { request, stop, store } = await setup();
  expect((await request("GET", "/")).status).toBe(200);
  expect(tcpHandles().length).toBeGreaterThan(before.length);
  await stop();
  expect(await tcpHandlesSettledTo(before)).toEqual(before);
  expect(store.db.isOpen).toBe(false);
});
