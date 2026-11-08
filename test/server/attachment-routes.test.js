// Attaching regions (decision 0052) and directions (0056) to a brief and detaching them through
// the HTTP server. The regions and their analyses are seeded in the store, so no test decodes
// audio, and the config names no CLAP checkpoint, so no route reaches the sidecar.
/** @import { Studio } from "../support/studio.js" */
import { afterAll, beforeAll, expect, test } from "vitest";
import { PRODUCER } from "../../src/server/producer.js";
import { addReferenceFile, addRegion, removeRegion } from "../../src/server/reference-store.js";
import { putRegionFeatures } from "../../src/server/region-analysis-store.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio} */
let studio;
/** @type {{ vibe: number, regions: number[], removed: number, unanalyzed: number }} */
let ids;

const TARGET = -14;

beforeAll(async () => {
  studio = await startStudio();
  const { store } = studio.server;
  const { reference } = addReferenceFile(store, {
    sha256: "a".repeat(64),
    fileName: "dawn.wav",
    format: "wav",
    file: `${"a".repeat(64)}.wav`,
    durationSeconds: 120,
    channels: 2,
    sampleRate: 48000,
    sizeBytes: 10,
  });
  const region = (/** @type {string} */ label, /** @type {number} */ start, analyzed = true) => {
    const row = addRegion(store, {
      referenceFileId: reference.id,
      startSeconds: start,
      endSeconds: start + 10,
      label,
      note: "",
    });
    if (analyzed) {
      putRegionFeatures(store, {
        regionId: row.id,
        target: TARGET,
        producer: PRODUCER,
        windows: [],
      });
    }
    return row.id;
  };
  const vibe = await studio.ok("POST", "/api/vibes", {
    ...VIBE,
    constraints: { loudness: TARGET },
  });
  const removed = region("gone", 60);
  removeRegion(store, removed);
  ids = {
    vibe: vibe.id,
    regions: [region("hum", 0), region("birds", 20), region("wind", 40)],
    removed,
    unanalyzed: region("rain", 80, false),
  };
});
afterAll(async () => {
  await removeStudio(studio);
});

/** @param {unknown} body */
const attach = (body) => studio.server.api("POST", `/api/vibes/${ids.vibe}/attachments`, body);

test("an unknown, removed or unanalyzed region is a 400 naming it", async () => {
  /** @type {[unknown, string | RegExp][]} */
  const cases = [
    [{ kind: "reference", regionId: 999 }, "there is no region 999"],
    [{ kind: "reference", regionId: ids.removed }, `region ${ids.removed} ("gone") was removed`],
    [
      { kind: "reference", regionId: ids.unanalyzed },
      `region ${ids.unanalyzed} ("rain") isn't analyzed at this brief's loudness, -14 LUFS; analyze it first`,
    ],
    [{ kind: "axis", regionId: ids.regions[0] }, /^kind must be one of reference, direction/],
    [{ kind: "reference" }, /^regionId must be an integer/],
  ];
  for (const [body, error] of cases) {
    const reply = await attach(body);
    expect(reply.status).toBe(400);
    expect(reply.json().error).toMatch(error);
  }
});

test("attaching up to two regions, listing them, and detaching one make no new revision", async () => {
  const [hum, birds, wind] = ids.regions;
  const first = await studio.ok("POST", `/api/vibes/${ids.vibe}/attachments`, {
    kind: "reference",
    regionId: hum,
  });
  expect(first.attachment).toMatchObject({ vibeId: ids.vibe, kind: "reference", regionId: hum });
  const twice = await attach({ kind: "reference", regionId: hum });
  expect(twice.status).toBe(400);
  expect(twice.json().error).toBe(`region ${hum} ("hum") is attached to this brief already`);
  await studio.ok("POST", `/api/vibes/${ids.vibe}/attachments`, {
    kind: "reference",
    regionId: birds,
  });
  const third = await attach({ kind: "reference", regionId: wind });
  expect(third.status).toBe(400);
  expect(third.json().error).toBe(
    "this brief holds 2 regions already, the most it takes; detach one first",
  );

  const listed = await studio.ok("GET", `/api/vibes/${ids.vibe}/attachments`);
  expect(listed.target).toBe(TARGET);
  expect(listed.references).toEqual([
    expect.objectContaining({
      id: first.attachment.id,
      regionId: hum,
      label: "hum",
      fileName: "dawn.wav",
      analyzed: true,
      embedded: false,
    }),
    expect.objectContaining({ regionId: birds, label: "birds", analyzed: true }),
  ]);

  const detached = await studio.ok(
    "POST",
    `/api/vibe-attachments/${first.attachment.id}/detach`,
    {},
  );
  expect(detached.attachment.removedReason).toBe("detached");
  const again = await studio.server.api(
    "POST",
    `/api/vibe-attachments/${first.attachment.id}/detach`,
    {},
  );
  expect(again.status).toBe(400);
  expect(again.json().error).toBe(
    `attachment ${first.attachment.id} isn't attached any more (detached)`,
  );
  const after = await studio.ok("GET", `/api/vibes/${ids.vibe}/attachments`);
  expect(after.references.map((/** @type {any} */ r) => r.regionId)).toEqual([birds]);
  await studio.ok("POST", `/api/vibes/${ids.vibe}/attachments`, {
    kind: "reference",
    regionId: wind,
  });

  const { revisions } = await studio.ok("GET", `/api/vibes/${ids.vibe}/revisions`);
  expect(revisions).toHaveLength(1);
  expect((await studio.server.api("POST", "/api/vibe-attachments/999/detach", {})).status).toBe(
    404,
  );
});

test("directions are attached with their two ends, listed, refused when wrong, and make no revision", async () => {
  const vibe = await studio.ok("POST", "/api/vibes", { ...VIBE, name: "directions" });
  const path = `/api/vibes/${vibe.id}/attachments`;
  const typed = await studio.ok("POST", path, {
    kind: "direction",
    near: "dry",
    far: "underwater",
  });
  expect(typed.attachment).toMatchObject({
    vibeId: vibe.id,
    kind: "direction",
    regionId: null,
    details: { near: "dry", far: "underwater" },
  });
  const fromExcerpts = await studio.ok("POST", path, { kind: "direction", far: "hissing" });
  expect(fromExcerpts.attachment.details).toEqual({ near: null, far: "hissing" });

  /** @type {[unknown, string | RegExp][]} */
  const cases = [
    [{ kind: "direction", near: "dry" }, "its far end must be text"],
    [{ kind: "direction", far: "   " }, "its far end must hold some text"],
    [{ kind: "direction", far: "x".repeat(101) }, "its far end must be at most 100 characters"],
    [{ kind: "direction", far: "dry", near: "dry" }, "its two ends are the same text"],
    [
      { kind: "direction", far: "a\nb" },
      "its far end must be one line, with no control characters",
    ],
    [{ kind: "direction", far: "x", regionId: ids.regions[0] }, "a direction names no region"],
    [
      { kind: "reference", regionId: ids.regions[0], far: "x" },
      "a reference takes no near or far end",
    ],
  ];
  for (const [body, error] of cases) {
    const reply = await studio.server.api("POST", path, body);
    expect(reply.status, JSON.stringify(body)).toBe(400);
    expect(reply.json().error).toMatch(error);
  }
  await studio.ok("POST", path, { kind: "direction", far: "bright" });
  await studio.ok("POST", path, { kind: "direction", far: "slow" });
  const fifth = await studio.server.api("POST", path, { kind: "direction", far: "loud" });
  expect(fifth.status).toBe(400);
  expect(fifth.json().error).toBe(
    "this brief holds 4 directions already, the most it takes; remove one first",
  );

  await studio.ok("POST", `/api/vibe-attachments/${typed.attachment.id}/detach`, {});
  const listed = await studio.ok("GET", path);
  expect(listed.directions.map((/** @type {any} */ d) => [d.near, d.far])).toEqual([
    [null, "hissing"],
    [null, "bright"],
    [null, "slow"],
  ]);
  expect(listed.references).toEqual([]);
  const { revisions } = await studio.ok("GET", `/api/vibes/${vibe.id}/revisions`);
  expect(revisions).toHaveLength(1);
});

test("the steering route says why there are no positions, and asks the sidecar nothing without directions or regions", async () => {
  const bare = await studio.ok("POST", "/api/vibes", { ...VIBE, name: "bare" });
  expect(await studio.ok("GET", `/api/vibes/${bare.id}/steering`)).toEqual({
    reason: null,
    excerpts: 0,
    directions: [],
    regions: [],
  });
  await studio.ok("POST", `/api/vibes/${bare.id}/attachments`, { kind: "direction", far: "dry" });
  const off = await studio.ok("GET", `/api/vibes/${bare.id}/steering`);
  expect(off.reason).toMatch(/^the config's sidecar.checkpointCache is null/);
  expect(off.directions).toEqual([
    expect.objectContaining({ near: null, far: "dry", positions: {} }),
  ]);
});
