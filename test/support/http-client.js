// Starts the real server (decision 0025) in a temp data root on an ephemeral port of 127.0.0.1,
// and sends it requests. Requests go through node:http rather than fetch, so a path such as
// `/../package.json` reaches the server as written instead of normalized by the client.
/** @import { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http" */
/** @import { Socket } from "node:net" */
/** @import { Paths } from "../../src/config/paths.js" */
/** @import { JobRunner } from "../../src/server/job-runner.js" */
/** @import { Clock } from "../../src/server/omlx-queue.js" */
/** @import { Route } from "../../src/server/routing.js" */
/** @import { Store } from "../../src/server/store.js" */
import { once } from "node:events";
import { Agent, request as httpRequest } from "node:http";
import { loadConfig } from "../../src/config/config.js";
import { paths } from "../../src/config/paths.js";
import { startServer } from "../../src/server/main.js";
import { tempRoot } from "./temp-root.js";

/**
 * The omlx base URL a test server gets unless the test passes a fake's. `.invalid` never
 * resolves (RFC 6761), so a server that tried to reach omlx would fail rather than reach the
 * real one, which serves a live site.
 */
const NO_OMLX = "http://omlx.invalid";

/**
 * @typedef {object} Reply
 * @property {number} status
 * @property {IncomingHttpHeaders} headers
 * @property {Buffer} body
 * @property {() => any} json the body parsed as JSON
 */

/**
 * @typedef {object} RequestOptions
 * @property {OutgoingHttpHeaders} [headers]
 * @property {string | Buffer} [body]
 * @property {boolean} [setHost] false sends no Host header; true when omitted
 */

/**
 * @typedef {object} TestServer
 * @property {string} origin `http://127.0.0.1:<port>`; a restart binds a new port
 * @property {Paths} paths the temp root's folders
 * @property {Store} store the running server's open store
 * @property {JobRunner} jobs the running server's job runner
 * @property {string[]} logged every line the server logged
 * @property {(method: string, path: string, options?: RequestOptions) => Promise<Reply>} request
 *   `path` is sent exactly as given
 * @property {(method: string, path: string, value?: unknown) => Promise<Reply>} api sends
 *   `value`, when given, as an application/json body
 * @property {() => Promise<void>} stop stops the server and closes the client's sockets, waiting
 *   for each to close
 * @property {() => Promise<void>} restart stops the server and starts a new one on the same root
 * @property {() => Promise<void>} remove stops the server if it is running and deletes the root
 */

/**
 * @typedef {object} TestServerOptions
 * @property {Route[]} [routes] the routes to serve instead of the app's table
 * @property {string} [omlxBaseUrl] a fake omlx's; one that never resolves when omitted
 * @property {Clock} [clock] the queue's and the job runner's clock; the real one when omitted
 * @property {() => number} [random]
 * @property {string} [fieldRecordings] the config's recordings folder; `null` when omitted
 * @property {boolean} [sendResponseFormat] the config's `queue.sendResponseFormat`; the example
 *   config's when omitted
 */

/**
 * @param {TestServerOptions} [options]
 * @returns {Promise<TestServer>}
 */
export async function startTestServer({
  omlxBaseUrl = NO_OMLX,
  fieldRecordings,
  sendResponseFormat,
  ...options
} = {}) {
  const root = await tempRoot((raw) => {
    raw.omlx.baseUrl = omlxBaseUrl;
    if (fieldRecordings !== undefined) raw.fieldRecordings = fieldRecordings;
    if (sendResponseFormat !== undefined) raw.queue.sendResponseFormat = sendResponseFormat;
  });
  const config = loadConfig(root.configPath);
  /** @type {string[]} */
  const logged = [];
  const start = () =>
    startServer(
      { ...config, server: { host: "127.0.0.1", port: 0 } },
      { log: (line) => logged.push(line), ...options },
    );
  let server = await start();
  let address = new URL(server.origin);
  const agent = new Agent({ keepAlive: true });
  /** @type {Set<Socket>} */
  const sockets = new Set();
  let running = true;

  /** @type {TestServer["request"]} */
  const request = (method, path, { headers = {}, body, setHost = true } = {}) =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        { hostname: address.hostname, port: address.port, method, path, headers, agent, setHost },
        (incoming) => {
          /** @type {Buffer[]} */
          const chunks = [];
          incoming.on("data", (chunk) => chunks.push(chunk));
          incoming.on("error", reject);
          incoming.on("end", () => {
            const bytes = Buffer.concat(chunks);
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: bytes,
              json: () => JSON.parse(bytes.toString("utf8")),
            });
          });
        },
      );
      outgoing.on("socket", (socket) => sockets.add(socket));
      outgoing.on("error", reject);
      outgoing.end(body);
    });

  const stop = async () => {
    running = false;
    await server.stop();
    agent.destroy();
    await Promise.all(
      [...sockets].filter((socket) => !socket.closed).map((socket) => once(socket, "close")),
    );
  };

  /** @type {TestServer} */
  const made = {
    origin: server.origin,
    paths: paths(config.dataRoot),
    store: server.store,
    jobs: server.jobs,
    logged,
    request,
    api: (method, path, value) =>
      value === undefined
        ? request(method, path)
        : request(method, path, {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(value),
          }),
    stop,
    async restart() {
      if (running) await stop();
      server = await start();
      running = true;
      address = new URL(server.origin);
      Object.assign(made, { origin: server.origin, store: server.store, jobs: server.jobs });
    },
    async remove() {
      if (running) await stop();
      await root.remove();
    },
  };
  return made;
}
