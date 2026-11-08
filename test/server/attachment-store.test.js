// A vibe's attachments (decision 0052): append-only rows keyed by vibe, detached with their
// region, and migration 0010 over 0009's shape.
/** @import { Store } from "../../src/server/store.js" */
import { afterEach, expect, test } from "vitest";
import { ATTACHMENT_KIND } from "../../src/domain/attachment-kind.js";
import {
  addAttachment,
  DETACHED,
  detachAttachment,
  getAttachment,
  listAttachments,
} from "../../src/server/attachment-store.js";
import { addGeneration, getGeneration } from "../../src/server/generation-store.js";
import {
  addReferenceFile,
  addRegion,
  removeReferenceFile,
  removeRegion,
  replaceRegion,
} from "../../src/server/reference-store.js";
import { openStore, readMigrations } from "../../src/server/store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const REFERENCE = ATTACHMENT_KIND.reference;

/**
 * A vibe and a file with two regions.
 * @param {Store} store
 */
function seeded(store) {
  const vibe = createVibe(store, {
    name: "dawn",
    brief: "a low hum at dawn",
    constraints: {},
    softTargets: {},
  });
  const { reference } = addReferenceFile(store, {
    sha256: "d".repeat(64),
    fileName: "dawn.wav",
    format: "wav",
    file: `${"d".repeat(64)}.wav`,
    durationSeconds: 60,
    channels: 2,
    sampleRate: 48000,
    sizeBytes: 10,
  });
  const region = (/** @type {number} */ start) =>
    addRegion(store, {
      referenceFileId: reference.id,
      startSeconds: start,
      endSeconds: start + 10,
      label: `from ${start}`,
      note: "",
    });
  return { vibe, reference, regions: [region(0), region(20)] };
}

/**
 * @param {Store} store
 * @param {number} vibeId
 * @param {number} regionId
 */
const attach = (store, vibeId, regionId) =>
  addAttachment(store, { vibeId, kind: REFERENCE, regionId, details: {} });

test("detaching marks the row and attaching again adds one; changing them makes no revision", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const { vibe, regions } = seeded(store);
  const [a, b] = regions.map((region) => attach(store, vibe.id, region.id));
  expect(listAttachments(store, vibe.id, REFERENCE).map((row) => row.regionId)).toEqual(
    regions.map((region) => region.id),
  );
  detachAttachment(store, /** @type {number} */ (a?.id));
  expect(getAttachment(store, /** @type {number} */ (a?.id))).toMatchObject({
    removedReason: DETACHED.owner,
  });
  const again = attach(store, vibe.id, regions[0]?.id ?? 0);
  expect(listAttachments(store, vibe.id, REFERENCE).map((row) => row.id)).toEqual([
    b?.id,
    again.id,
  ]);
  const revisions = store.db.prepare("SELECT count(*) AS n FROM vibe_revisions").get()?.n;
  expect(revisions).toBe(1);
  expect(() => store.db.prepare("DELETE FROM vibe_attachments").run()).toThrow(/append-only/);
});

test("changing or removing a region, or removing its file, detaches it from every vibe", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const { vibe, reference, regions } = seeded(store);
  const [first, second] = regions;
  if (!first || !second) throw new Error("seeded no regions");
  const other = createVibe(store, { name: "o", brief: "o", constraints: {}, softTargets: {} });
  const changed = attach(store, vibe.id, first.id);
  const elsewhere = attach(store, other.id, first.id);
  replaceRegion(store, first.id, { startSeconds: 1, endSeconds: 9, label: "hum", note: "" });
  expect(getAttachment(store, changed.id)?.removedReason).toBe(DETACHED.regionReplaced);
  expect(getAttachment(store, elsewhere.id)?.removedReason).toBe(DETACHED.regionReplaced);

  const removed = attach(store, vibe.id, second.id);
  removeRegion(store, second.id);
  expect(getAttachment(store, removed.id)?.removedReason).toBe(DETACHED.regionRemoved);

  const third = addRegion(store, {
    referenceFileId: reference.id,
    startSeconds: 30,
    endSeconds: 40,
    label: "late",
    note: "",
  });
  const onFile = attach(store, vibe.id, third.id);
  removeReferenceFile(store, reference.id);
  expect(getAttachment(store, onFile.id)?.removedReason).toBe(DETACHED.fileRemoved);
  expect(listAttachments(store, vibe.id, REFERENCE)).toEqual([]);
});

test("migration 0010 over a database built with 0001 to 0009 keeps its rows and adds attachments", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { paths, store: current } = made;
  current.close();
  const file = `${paths.database}-0009`;
  const migrations = readMigrations();
  const now = () => 0;
  const old = openStore(file, { now, migrations: migrations.slice(0, 9) });
  const { vibe, regions } = seeded(old);
  const generationId = Number(
    old.db
      .prepare(
        `INSERT INTO generations (vibeRevisionId, sessionId, requestGroup, prompt, exampleIds,
           retrievalMethod, model, sampling, response, finishReason, repairRound, latencyMs,
           createdAt)
         VALUES (?, NULL, 'g', '[]', '[]', 'rating-recency', 'm', '{}', '{}', 'stop', 0, 1, 0)`,
      )
      .run(vibe.revision.id).lastInsertRowid,
  );
  old.close();

  const store = openStore(file, { now, migrations });
  cleanups.push(async () => store.close());
  expect(getGeneration(store, generationId)?.attachmentIds).toEqual([]);
  const regionId = regions[0]?.id ?? 0;
  const row = attach(store, vibe.id, regionId);
  expect(row).toMatchObject({ vibeId: vibe.id, kind: REFERENCE, regionId, details: {} });
  const insert = (/** @type {string} */ values) =>
    store.db
      .prepare(
        `INSERT INTO vibe_attachments (vibeId, kind, regionId, details, createdAt) VALUES ${values}`,
      )
      .run();
  expect(() => insert(`(${vibe.id}, 'reference', NULL, '{}', 0)`)).toThrow(/CHECK constraint/);
  expect(() => insert(`(${vibe.id}, 'tag', NULL, '{}', 0)`)).toThrow(/CHECK constraint/);
  expect(() => insert(`(${vibe.id}, 'reference', 999, '{}', 0)`)).toThrow(/FOREIGN KEY/);
  expect(() => insert(`(${vibe.id}, 'reference', ${regionId}, '{}', 0)`)).toThrow(/UNIQUE/);
  // 5g's and 5h's kinds need no other migration.
  insert(`(${vibe.id}, 'direction', NULL, '{"from":"dry","to":"underwater"}', 0)`);
  insert(`(${vibe.id}, 'axis', ${regionId}, '{"bins":8}', 0)`);
  const later = addGeneration(store, {
    vibeRevisionId: vibe.revision.id,
    sessionId: null,
    requestGroup: "g2",
    prompt: [],
    exampleIds: [],
    attachmentIds: [row.id],
    retrievalMethod: "rating-recency",
    model: "m",
    sampling: {},
    response: "{}",
    finishReason: "stop",
    repairRound: 0,
    repairsId: null,
    latencyMs: 1,
    firstTokenMs: null,
    promptTokens: null,
    completionTokens: null,
    reasoning: null,
    requestParams: null,
    retries: null,
    error: null,
  });
  expect(later.attachmentIds).toEqual([row.id]);
});

test("each kind's details are checked: a reference takes none, and an unknown kind is refused", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const { vibe, regions } = seeded(store);
  const regionId = regions[0]?.id ?? 0;
  expect(() =>
    addAttachment(store, { vibeId: vibe.id, kind: REFERENCE, regionId, details: { weight: 1 } }),
  ).toThrow("the reference attachment's details are wrong: a reference takes no details, {}");
  expect(() =>
    addAttachment(store, { vibeId: vibe.id, kind: "direction", regionId: null, details: {} }),
  ).toThrow('there is no attachment kind "direction"');
  expect(listAttachments(store, vibe.id, REFERENCE)).toEqual([]);
});
