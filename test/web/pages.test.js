// Each page loads through the real server: the page, its stylesheet, and every module it
// imports, followed through the engine and domain tiers, each answered 200 with the type a
// browser needs (decision 0025). A module the server can't serve breaks only in the browser.
import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { startTestServer } from "../support/http-client.js";

/** @type {import("../support/http-client.js").TestServer} */
let server;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.remove());

const PAGES = ["brief.html", "evaluation.html", "index.html", "session.html"];

const moduleScript = /<script\s+type="module"\s+src="([^"]+)"/g;
const stylesheet = /<link\s+rel="stylesheet"\s+href="([^"]+)"/g;
const importSpec =
  /(?:^|[\s;])(?:import|export)\s(?:[^'"`;]*?\sfrom\s)?\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

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

test.each(PAGES)("%s loads, with its stylesheet and every module it imports", async (page) => {
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
  while (queue.length > 0) {
    const path = /** @type {string} */ (queue.shift());
    const source = await fetchOk(path, "text/javascript; charset=utf-8");
    for (const match of source.matchAll(importSpec)) {
      const spec = match[1] ?? match[2] ?? "";
      expect(spec.startsWith("./") || spec.startsWith("../"), `${path} imports ${spec}`).toBe(true);
      const next = new URL(spec, `http://studio${path}`).pathname;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  // Every page reaches past its own folder into the domain or engine tier.
  expect(
    [...seen].some((path) => /^\/(domain|engine)\//.test(path)),
    page,
  ).toBe(true);
});
