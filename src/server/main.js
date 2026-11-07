// The studio's HTTP server (decision 0025), which `./scripts/dev` runs: the route table in
// routes.js, then static files, on the config's host and port. No auth: it is a LAN app with
// no secrets.
/** @import { IncomingMessage, Server, ServerResponse } from "node:http" */
/** @import { Config } from "../config/config.js" */
/** @import { JobRunner } from "./job-runner.js" */
/** @import { Clock } from "./omlx-queue.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { SidecarClient, SidecarLaunch } from "./sidecar-client.js" */
/** @import { Store } from "./store.js" */
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { loadConfig } from "../config/config.js";
import { paths } from "../config/paths.js";
import { allowedHost } from "./allowed-host.js";
import { createJobRunner } from "./job-runner.js";
import { createOmlxQueue } from "./omlx-queue.js";
import { ROUTES } from "./routes.js";
import { HttpError, matchRoute, parseTarget, readJson, sendJson } from "./routing.js";
import { serveStatic } from "./serve-static.js";
import { createSidecarClient, SIDECAR_LAUNCH } from "./sidecar-client.js";
import { openStore } from "./store.js";

/**
 * @typedef {object} RunningServer
 * @property {string} origin `http://<address>:<port>` as bound; port 0 in the config binds an
 *   ephemeral one
 * @property {Store} store
 * @property {JobRunner} jobs
 * @property {SidecarClient} sidecar
 * @property {() => Promise<void>} stop cancels every job and waits for them to end, closes every
 *   connection, waits for the requests in flight to settle and the server to close, ends the
 *   sidecar's process, then closes the store
 */

/**
 * @typedef {object} ServerOptions
 * @property {Route[]} [routes] the app's table when omitted; tests add routes of their own
 * @property {(line: string) => void} [log] where 5xx stacks and omlx retries go; stderr when
 *   omitted
 * @property {Clock} [clock] the omlx queue's timers and the job runner's clock; the real ones
 *   when omitted
 * @property {() => number} [random] a draw in [0, 1) for the queue's jitter and for stream and
 *   order seeds; `Math.random` when omitted
 * @property {SidecarLaunch} [sidecarLaunch] how to start the sidecar; the real one when omitted,
 *   the fake in tests
 */

/** @type {Clock} */
const REAL_CLOCK = {
  now: Date.now,
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * Answers one request. Never rejects: an `HttpError` is sent as its status, anything else is
 * logged with its stack and sent as a 500.
 * @param {Route[]} routes
 * @param {App} app
 * @param {IncomingMessage} request
 * @param {ServerResponse} response
 */
async function answer(routes, app, request, response) {
  const method = request.method ?? "";
  const url = request.url ?? "";
  try {
    if (!allowedHost(request.headers.host)) {
      throw new HttpError(
        421,
        `this server doesn't answer for Host ${request.headers.host ?? "(none)"}`,
      );
    }
    const target = parseTarget(url);
    if (!target) throw new HttpError(404, `nothing is served at ${url}`);
    const match = matchRoute(routes, method, target.segments);
    if (match && "allow" in match) {
      response.setHeader("allow", match.allow.join(", "));
      throw new HttpError(405, `${url} takes ${match.allow.join(" or ")}, not ${method}`);
    }
    if (match) {
      const value = await match.route.handle({
        request,
        response,
        params: match.params,
        query: target.query,
        body: () => readJson(request),
        app,
      });
      if (value !== undefined) sendJson(response, 200, value);
      else if (!response.headersSent)
        throw new Error("the handler returned nothing and sent nothing");
      return;
    }
    if (await serveStatic(request, response, target.segments)) return;
    throw new HttpError(404, `nothing is served at ${method} ${url}`);
  } catch (error) {
    const known = error instanceof HttpError;
    if (!known) app.log(`${method} ${url}: ${/** @type {Error} */ (error).stack}`);
    // A 500's message can hold a server path or a value from the store; it goes to the log only.
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(
      response,
      known ? error.status : 500,
      known ? { error: error.message, ...error.details } : { error: "internal error" },
    );
  }
}

/**
 * Listens, and returns the origin as bound.
 * @param {Server} server
 * @param {{ host: string, port: number }} at
 * @returns {Promise<string>}
 */
async function listen(server, { host, port }) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(`the server is bound to ${address}, not a TCP port`);
  }
  const name = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return `http://${name}:${address.port}`;
}

/**
 * Opens the store in the config's data root, creating the folder, and listens on the config's
 * host and port.
 * @param {Config} config
 * @param {ServerOptions} [options]
 * @returns {Promise<RunningServer>}
 */
export async function startServer(
  config,
  {
    routes = ROUTES,
    log = console.error,
    clock = REAL_CLOCK,
    random = Math.random,
    sidecarLaunch = SIDECAR_LAUNCH,
  } = {},
) {
  const dataPaths = paths(config.dataRoot);
  await mkdir(config.dataRoot, { recursive: true });
  const store = openStore(dataPaths.database, { now: Date.now });
  // Making the queue sends nothing: a request goes out only when a job the owner started asks.
  const queue = createOmlxQueue({
    omlx: config.omlx,
    queue: config.queue,
    clock,
    jitter: random,
    onRetry: ({ attempt, reason, delayMs }) =>
      log(`omlx was busy on attempt ${attempt} (${reason}); retrying in ${delayMs / 1000} s`),
  });
  const jobs = createJobRunner({ now: clock.now });
  // Like the queue, making the client starts nothing: the process starts on the first request.
  const sidecar = createSidecarClient({
    launch: sidecarLaunch,
    timeoutMs: config.sidecar.requestTimeoutMs,
    clock,
    log,
  });
  /** @type {App} */
  const app = {
    config,
    paths: dataPaths,
    store,
    log,
    queue,
    jobs,
    sidecar,
    random,
    sessionJobs: new Map(),
  };
  /** @type {Set<Promise<void>>} */
  const inFlight = new Set();
  // A request without Host reaches `answer`, which refuses it like a foreign one.
  const server = createServer({ requireHostHeader: false }, (request, response) => {
    const answered = answer(routes, app, request, response).finally(() =>
      inFlight.delete(answered),
    );
    inFlight.add(answered);
  });
  /** @type {string} */
  let origin;
  try {
    origin = await listen(server, config.server);
  } catch (error) {
    store.close();
    throw error;
  }
  return {
    origin,
    store,
    jobs,
    sidecar,
    async stop() {
      /** @type {Promise<void>} */
      const closed = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await Promise.all(inFlight);
      // A job left running would write to the closed store, and its omlx request or render
      // would hold the process open. Cancelling a finished job leaves it as it is.
      for (const { id } of jobs.list()) jobs.cancel(id);
      await jobs.idle();
      await closed;
      await sidecar.stop();
      store.close();
    },
  };
}

/**
 * The URLs other machines use: by LAN IP, since `.local` names don't resolve from every one.
 * @param {string} origin
 * @returns {string[]}
 */
function lanUrls(origin) {
  const url = new URL(origin);
  if (url.hostname !== "0.0.0.0") return [origin];
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net?.family === "IPv4" && !net.internal)
    .map((net) => `http://${net?.address}:${url.port}`);
}

if (import.meta.main) {
  if (process.argv.length > 2) {
    console.error("usage: ./scripts/dev, with no arguments; the config sets the host and port");
    process.exitCode = 2;
  } else {
    const running = await startServer(loadConfig());
    for (const url of lanUrls(running.origin)) console.log(`studio at ${url}`);
    // Ctrl-C, and the restart `node --watch` does, close the store before the process exits.
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void running.stop());
  }
}
