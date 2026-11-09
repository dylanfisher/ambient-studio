// Each page loads through the real server: the page, its stylesheet, and every module it
// imports, followed through the engine and domain tiers, each answered 200 with the type a
// browser needs (decision 0025). A module the server can't serve breaks only in the browser, as
// does a template one of them clones that the page doesn't hold.
import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { startTestServer } from "../support/http-client.js";

/** @type {import("../support/http-client.js").TestServer} */
let server;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.remove());

const PAGES = [
  "brief.html",
  "evaluation.html",
  "index.html",
  "lineage.html",
  "map.html",
  "quick-ab.html",
  "references.html",
  "session.html",
  "track.html",
];

const moduleScript = /<script\s+type="module"\s+src="([^"]+)"/g;
const stylesheet = /<link\s+rel="stylesheet"\s+href="([^"]+)"/g;
const importSpec =
  /(?:^|[\s;])(?:import|export)\s(?:[^'"`;]*?\sfrom\s)?\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const cloned = /cloneTemplate\(\s*"([^"]+)"/g;
const templateId = /<template\s+id="([^"]+)"/g;

/**
 * @param {string} path
 * @param {string} type the content type it must be served as
 */
async function fetchOk(path, type) {
  const reply = await server.request("GET", path);
  expect(reply.status, path).toBe(200);
  expect(reply.headers["content-type"], path).toBe(type);
  return reply.body.toString("utf8");
}

test("the pages listed here are every page in src/web", async () => {
  const html = (await readdir("src/web")).filter((name) => name.endsWith(".html")).sort();
  expect(html).toEqual(PAGES);
});

test.each(PAGES)(
  "%s loads, with its stylesheet, every module it imports and every template they clone",
  async (page) => {
    const html = await fetchOk(`/${page}`, "text/html; charset=utf-8");
    const base = `http://studio/${page}`;
    const styles = [...html.matchAll(stylesheet)].map((match) => match[1] ?? "");
    expect(styles.length, page).toBeGreaterThan(0);
    for (const href of styles) {
      await fetchOk(new URL(href, base).pathname, "text/css; charset=utf-8");
    }

    const entries = [...html.matchAll(moduleScript)].map((match) => match[1] ?? "");
    expect(entries, page).toHaveLength(1);
    const queue = entries.map((src) => new URL(src, base).pathname);
    const seen = new Set(queue);
    /** @type {Set<string>} */
    const wanted = new Set();
    while (queue.length > 0) {
      const path = /** @type {string} */ (queue.shift());
      const source = await fetchOk(path, "text/javascript; charset=utf-8");
      for (const match of source.matchAll(cloned)) wanted.add(`${path} clones #${match[1]}`);
      for (const match of source.matchAll(importSpec)) {
        const spec = match[1] ?? match[2] ?? "";
        expect(spec.startsWith("./") || spec.startsWith("../"), `${path} imports ${spec}`).toBe(
          true,
        );
        const next = new URL(spec, `http://studio${path}`).pathname;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const held = new Set([...html.matchAll(templateId)].map((match) => match[1]));
    const missing = [...wanted].filter((line) => !held.has(line.split("#")[1]));
    expect(missing, `${page} has no template for these`).toEqual([]);
    // Every page reaches past its own folder into the domain or engine tier.
    expect(
      [...seen].some((path) => /^\/(domain|engine)\//.test(path)),
      page,
    ).toBe(true);
  },
);
