import { afterEach, expect, test, vi } from "vitest";
import { startJob } from "../../src/web/api.js";

/**
 * Answers each fetch with the next reply, and records the calls.
 * @param {{ status: number, body: unknown }[]} replies
 */
function stubFetch(replies) {
  const calls = /** @type {{ path: string, method: string }[]} */ ([]);
  vi.stubGlobal("fetch", async (/** @type {string} */ path, /** @type {RequestInit} */ init) => {
    calls.push({ path, method: init.method ?? "GET" });
    const reply = replies.shift();
    if (!reply) throw new Error(`no reply scripted for ${path}`);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const running = { id: 4, kind: "candidates", state: "running", finishedAt: null };

test("a started job comes back with nothing refused", async () => {
  stubFetch([{ status: 200, body: running }]);
  expect(await startJob("/api/sessions/1/candidates", {})).toEqual({ job: running, refused: null });
});

test("a 409 naming a job attaches to that job and keeps the server's sentence", async () => {
  const calls = stubFetch([
    { status: 409, body: { error: "The same job is already queued as job 4.", jobId: 4 } },
    { status: 200, body: running },
  ]);
  expect(await startJob("/api/sessions/1/candidates", {})).toEqual({
    job: running,
    refused: "The same job is already queued as job 4.",
  });
  expect(calls).toEqual([
    { path: "/api/sessions/1/candidates", method: "POST" },
    { path: "/api/jobs/4", method: "GET" },
  ]);
});

test("a 409 with no job id, or any other error, is a failure", async () => {
  stubFetch([{ status: 409, body: { error: "session 1 has stopped" } }]);
  await expect(startJob("/api/sessions/1/candidates", {})).rejects.toThrow("session 1 has stopped");
  stubFetch([{ status: 400, body: { error: "count must be 1 to 32" } }]);
  await expect(startJob("/api/sessions/1/candidates", {})).rejects.toThrow("count must be 1 to 32");
});
