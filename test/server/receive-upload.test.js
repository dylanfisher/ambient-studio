// Receiving an upload's body (decision 0050): streamed to a temp file and hashed on the way, an
// oversize body a 413 that leaves no file, and the content type checked first.
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, expect, test } from "vitest";
import { UPLOAD_TYPE } from "../../src/domain/reference-upload.js";
import { receiveUpload } from "../../src/server/receive-upload.js";
import { HttpError } from "../../src/server/routing.js";

/** @type {string} */
let folder;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "receive-upload-"));
});
afterAll(() => rm(folder, { recursive: true }));

/**
 * A request-like stream of the chunks, with headers.
 * @param {Buffer[]} chunks
 * @param {Record<string, string>} headers
 */
function body(chunks, headers = { "content-type": UPLOAD_TYPE }) {
  return Object.assign(Readable.from(chunks), { headers });
}

const chunks = [Buffer.alloc(3000, 1), Buffer.alloc(5000, 2), Buffer.alloc(100, 3)];

test("a body is written to a temp file in the folder and hashed as it streams", async () => {
  const upload = await receiveUpload(body(chunks), join(folder, "a"), 10_000);
  const bytes = Buffer.concat(chunks);
  expect(upload.sizeBytes).toBe(bytes.length);
  expect(upload.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(await readFile(upload.path)).toEqual(bytes);
  expect(upload.path.startsWith(join(folder, "a"))).toBe(true);
});

test("a body over the limit is a 413 and leaves no file", async () => {
  const at = join(folder, "b");
  const failed = receiveUpload(body(chunks), at, 8000);
  await expect(failed).rejects.toThrow(HttpError);
  await expect(failed).rejects.toMatchObject({ status: 413 });
  expect(await readdir(at)).toEqual([]);
});

test("a declared length over the limit is a 413 before anything is written", async () => {
  const at = join(folder, "c");
  const headers = { "content-type": UPLOAD_TYPE, "content-length": "8101" };
  await expect(receiveUpload(body(chunks, headers), at, 8000)).rejects.toMatchObject({
    status: 413,
  });
  expect(await readdir(at).catch(() => [])).toEqual([]);
});

test("a body of another type is a 415, and an empty one a 400", async () => {
  const json = { "content-type": "application/json" };
  await expect(receiveUpload(body(chunks, json), join(folder, "d"), 10_000)).rejects.toMatchObject({
    status: 415,
  });
  await expect(receiveUpload(body([]), join(folder, "e"), 10_000)).rejects.toMatchObject({
    status: 400,
  });
  expect(await readdir(join(folder, "e"))).toEqual([]);
});
