// The region analysis routes through the HTTP server (decision 0051), over a reference made by
// ffmpeg from seeded noise and a sine. The test config names no checkpoint folder, so the job
// keeps the features, says why there is no embedding, and nothing starts the sidecar.
/** @import { Studio } from "../support/studio.js" */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { rangesFromRegion } from "../../src/domain/ranges-from-region.js";
import { FILE_NAME_HEADER, UPLOAD_TYPE } from "../../src/domain/reference-upload.js";
import { validateTargets } from "../../src/domain/validate-targets.js";
import { NO_CHECKPOINT_CACHE } from "../../src/server/embed-audio.js";
import { makeReference } from "../support/reference-fixtures.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio} */
let studio;
/** @type {string} */
let fixtures;
/** @type {{ vibe: number, region: number, removed: number }} */
let ids;

beforeAll(async () => {
  studio = await startStudio();
  fixtures = await mkdtemp(join(tmpdir(), "region-analysis-routes-"));
  const bytes = await readFile(await makeReference(fixtures, "wav", { seconds: 20, seed: 4 }));
  const reply = await studio.server.request("POST", "/api/references", {
    headers: { "content-type": UPLOAD_TYPE, [FILE_NAME_HEADER]: encodeURIComponent("hum.wav") },
    body: bytes,
  });
  const { reference } = reply.json();
  /** @param {string} label */
  const region = async (label) =>
    (
      await studio.ok("POST", `/api/references/${reference.id}/regions`, {
        startSeconds: 2,
        endSeconds: 17,
        label,
        note: "",
      })
    ).region.id;
  const vibe = await studio.ok("POST", "/api/vibes", { ...VIBE, constraints: { loudness: -14 } });
  ids = { vibe: vibe.id, region: await region("the hum"), removed: await region("gone") };
  await studio.ok("POST", `/api/reference-regions/${ids.removed}/remove`, {});
});
afterAll(async () => {
  await removeStudio(studio);
  await rm(fixtures, { recursive: true });
});

test("GET /api/reference-regions lists every live region and the files they are on", async () => {
  const { references, regions } = await studio.ok("GET", "/api/reference-regions");
  expect(regions.map((/** @type {any} */ r) => r.label)).toEqual(["the hum"]);
  expect(references.map((/** @type {any} */ r) => r.fileName)).toEqual(["hum.wav"]);
});

test("Analyze measures the region at the brief's target and saves nothing to the brief", async () => {
  const path = `/api/reference-regions/${ids.region}`;
  expect(await studio.ok("GET", `${path}/analysis?vibeId=${ids.vibe}`)).toEqual({
    regionId: ids.region,
    target: -14,
    analysis: null,
  });
  const before = await studio.ok("GET", `/api/vibes/${ids.vibe}/revisions`);

  const job = await studio.ok("POST", `${path}/analyze`, { vibeId: ids.vibe });
  expect(job).toMatchObject({ kind: "analyze" });
  await studio.server.jobs.settled(job.id);
  expect(await studio.ok("GET", `/api/jobs/${job.id}`)).toMatchObject({
    state: "done",
    result: { regionId: ids.region, target: -14, windows: 1, notEmbedded: NO_CHECKPOINT_CACHE },
  });

  const { analysis } = await studio.ok("GET", `${path}/analysis?vibeId=${ids.vibe}`);
  expect(analysis.embedded).toBe(false);
  expect(analysis.windows.map((/** @type {any} */ w) => w.seconds)).toEqual([15]);
  const ranges = rangesFromRegion(analysis.windows.map((/** @type {any} */ w) => w.features));
  expect(validateTargets({ features: ranges }).ok).toBe(true);

  // The References page's target, 0018's default, has no analysis yet.
  expect(await studio.ok("GET", `${path}/analysis`)).toMatchObject({
    target: -16,
    analysis: null,
  });
  expect(await studio.ok("GET", `/api/vibes/${ids.vibe}/revisions`)).toEqual(before);
});

test("a removed region, an unknown brief and an unknown field are refused", async () => {
  const removed = await studio.server.api(
    "POST",
    `/api/reference-regions/${ids.removed}/analyze`,
    {},
  );
  expect(removed.status).toBe(400);
  expect(removed.json().error).toBe(`region ${ids.removed} was removed`);
  const path = `/api/reference-regions/${ids.region}`;
  const unknown = await studio.server.api("POST", `${path}/analyze`, { vibeId: 999 });
  expect(unknown.status).toBe(404);
  const extra = await studio.server.api("POST", `${path}/analyze`, { target: -10 });
  expect(extra.status).toBe(400);
});

test("a second Analyze while one is unfinished is refused with its id", async () => {
  // A job that runs until it is cancelled, as stopping the server does.
  const running = studio.server.jobs.add(
    "analyze",
    ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  );
  const reply = await studio.server.api("POST", `/api/reference-regions/${ids.region}/analyze`, {});
  expect(reply.status).toBe(409);
  expect(reply.json()).toMatchObject({ jobId: running.id });
  studio.server.jobs.cancel(running.id);
});
