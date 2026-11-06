// Starts the real server (decision 0025) in a temp data root on an ephemeral port of 127.0.0.1,
// and sends it requests. Requests go through node:http rather than fetch, so a path such as
// `/../package.json` reaches the server as written instead of normalized by the client.
/** @import { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http" */
/** @import { Socket } from "node:net" */
/** @import { Paths } from "../../src/config/paths.js" */
/** @import { Route } from "../../src/server/routing.js" */
/** @import { Store } from "../../src/server/store.js" */
import { once } from "node:events";
import { Agent, request as httpRequest } from "node:http";
import { loadConfig } from "../../src/config/config.js";
import { paths } from "../../src/config/paths.js";
import { startServer } from "../../src/server/main.js";
import { tempRoot } from "./temp-root.js";

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
 */

/**
 * @typedef {object} TestServer
 * @property {string} origin `http://127.0.0.1:<port>`
 * @property {Paths} paths the temp root's folders
 * @property {Store} store the server's open store
 * @property {string[]} logged every line the server logged
 * @property {(method: string, path: string, options?: RequestOptions) => Promise<Reply>} request
 *   `path` is sent exactly as given
 * @property {() => Promise<void>} stop stops the server and closes the client's sockets, waiting
 *   for each to close
 * @property {() => Promise<void>} remove stops the server if it is running and deletes the root
 */

/**
 * @param {{ routes?: Route[] }} [options] the routes to serve instead of the app's table
 * @returns {Promise<TestServer>}
 */
export async function startTestServer(options = {}) {
  const root = await tempRoot();
  const config = loadConfig(root.configPath);
  /** @type {string[]} */
  const logged = [];
  const server = await startServer(
    { ...config, server: { host: "127.0.0.1", port: 0 } },
    { log: (line) => logged.push(line), ...options },
  );
  const address = new URL(server.origin);
  const agent = new Agent({ keepAlive: true });
  /** @type {Set<Socket>} */
  const sockets = new Set();
  let running = true;

  /** @type {TestServer["request"]} */
  const request = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        { hostname: address.hostname, port: address.port, method, path, headers, agent },
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

  return {
    origin: server.origin,
    paths: paths(config.dataRoot),
    store: server.store,
    logged,
    request,
    stop,
    async remove() {
      if (running) await stop();
      await root.remove();
    },
  };
}
