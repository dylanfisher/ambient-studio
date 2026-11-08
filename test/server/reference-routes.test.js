// The reference routes through the real server (decision 0050): each accepted format uploads,
// is kept by its hash and gets a peak strip; files ffprobe refuses are 400s that leave nothing
// behind; regions are added, replaced and removed; a region plays as an MP3 of its decode.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { FILE_NAME_HEADER, UPLOAD_TYPE } from "../../src/domain/reference-upload.js";
import { MAX_UPLOAD_BYTES } from "../../src/server/receive-upload.js";
import { PEAK_COUNT } from "../../src/server/reference-peaks.js";
import { getReferenceFile, getRegion, REMOVED } from "../../src/server/reference-store.js";
import { spanQuery } from "../../src/web/region-form.js";
import { startTestServer } from "../support/http-client.js";
import { decodeMp3 } from "../support/mp3.js";
import { FIXTURE_FORMATS, makeFixture, makeReference } from "../support/reference-fixtures.js";

/** @type {import("../support/http-client.js").TestServer} */
let server;
/** @type {string} */
let fixtures;
beforeAll(async () => {
  server = await startTestServer();
  fixtures = await mkdtemp(join(tmpdir(), "reference-routes-"));
});
afterAll(async () => {
  await server.remove();
  await rm(fixtures, { recursive: true });
});

/**
 * Uploads bytes under a name, sent percent-encoded as the page sends it.
 * @param {Buffer} bytes
 * @param {string} name
 */
const upload = (bytes, name) =>
  server.request("POST", "/api/references", {
    headers: { "content-type": UPLOAD_TYPE, [FILE_NAME_HEADER]: encodeURIComponent(name) },
    body: bytes,
  });

/** Every file under the data root's reference folders, so a refused upload can be seen to leave none. */
async function referenceFiles() {
  /** @param {string} folder */
  const list = async (folder) => (existsSync(folder) ? readdir(folder, { recursive: true }) : []);
  const kept = await list(server.paths.references);
  const cache = await list(server.paths.referenceCache);
  return [...kept, ...cache.filter((name) => name.startsWith("upload-"))];
}

/**
 * Waits until `check` holds, looking every 10 ms, for at most 5 s.
 * @param {() => Promise<boolean>} check
 * @param {string} what
 */
async function until(check, what) {
  for (let tries = 0; tries < 500; tries++) {
    if (await check()) return;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`never happened: ${what}`);
}

/** Whether an upload's temp file is in the reference cache. */
const uploading = async () =>
  (await referenceFiles()).some((name) => String(name).startsWith("upload-"));

const sha256 = (/** @type {Buffer} */ bytes) => createHash("sha256").update(bytes).digest("hex");

describe.each(Object.keys(FIXTURE_FORMATS))("a %s file", (format) => {
  test("uploads, is kept by its hash, and gets a peak strip", async () => {
    const path = await makeReference(fixtures, /** @type {any} */ (format), { seed: 11 });
    const bytes = await readFile(path);
    const reply = await upload(bytes, `field take — ${format}`);
    expect(reply.status, reply.body.toString()).toBe(200);
    const { reference, added } = reply.json();
    expect(added).toBe(true);
    expect(reference).toMatchObject({
      sha256: sha256(bytes),
      fileName: `field take — ${format}`,
      format,
      channels: 2,
      sizeBytes: bytes.length,
      removedAt: null,
    });
    expect(reference.durationSeconds).toBeCloseTo(12, 1);
    const kept = join(server.paths.references, reference.file);
    expect(reference.file).toMatch(new RegExp(`^${sha256(bytes)}\\.[a-z0-9]+$`));
    expect(await readFile(kept)).toEqual(bytes);

    const peaks = await server.api("GET", `/api/references/${reference.id}/peaks`);
    expect(peaks.status).toBe(200);
    const { peaks: values } = peaks.json();
    expect(values).toHaveLength(PEAK_COUNT);
    // The fixture's sine is at 1/8 and its noise at 0.05.
    expect(Math.max(...values)).toBeGreaterThan(0.1);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
  });
});

describe("refused uploads", () => {
  test.each([
    ["a text file", async () => Buffer.from("not audio at all\n".repeat(200)), /isn't audio/],
    [
      "a 5 s file",
      async () => readFile(await makeReference(fixtures, "wav", { seconds: 5 })),
      /5\.0 seconds long/,
    ],
    [
      "a 4-channel file",
      async () =>
        readFile(await makeFixture(fixtures, "quad.wav", ["-c:a", "pcm_s16le"], { channels: 4 })),
      /4 channels/,
    ],
  ])("%s is a 400 naming why, and leaves nothing behind", async (_, make, reason) => {
    const before = (await server.api("GET", "/api/references")).json().references.length;
    const reply = await upload(await make(), "refused.wav");
    expect(reply.status).toBe(400);
    expect(reply.json().error).toMatch(reason);
    expect(await referenceFiles()).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/^upload-/)]),
    );
    expect((await server.api("GET", "/api/references")).json().references).toHaveLength(before);
  });

  test("a body declared over the limit is a 413", async () => {
    // The body is never sent, so the socket is closed after, not reused for the next request.
    const reply = await server.request("POST", "/api/references", {
      headers: {
        connection: "close",
        "content-type": UPLOAD_TYPE,
        [FILE_NAME_HEADER]: "big.wav",
        "content-length": String(MAX_UPLOAD_BYTES + 1),
      },
      body: Buffer.alloc(0),
    });
    expect(reply.status).toBe(413);
    expect(await referenceFiles()).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/^upload-/)]),
    );
  });

  test("a client that drops the connection mid-upload leaves no file behind", async () => {
    const { hostname, port } = new URL(server.origin);
    const outgoing = httpRequest({
      hostname,
      port,
      method: "POST",
      path: "/api/references",
      headers: {
        "content-type": UPLOAD_TYPE,
        [FILE_NAME_HEADER]: "dropped.wav",
        "content-length": String(10_000_000),
      },
    });
    outgoing.on("error", () => undefined); // the reset this test causes
    outgoing.write(Buffer.alloc(100_000, 7));
    await until(uploading, "the upload's temp file appears");
    outgoing.destroy();
    await until(async () => !(await uploading()), "the temp file is removed");
  });

  test("a body that isn't an upload is a 415, and one without a file name a 400", async () => {
    const bytes = await readFile(await makeReference(fixtures, "wav", { seed: 5 }));
    const json = await server.request("POST", "/api/references", {
      headers: { "content-type": "application/json", [FILE_NAME_HEADER]: "a.wav" },
      body: bytes,
    });
    expect(json.status).toBe(415);
    const nameless = await server.request("POST", "/api/references", {
      headers: { "content-type": UPLOAD_TYPE },
      body: bytes,
    });
    expect(nameless.status).toBe(400);
    expect(nameless.json().error).toMatch(FILE_NAME_HEADER);
    const badEscape = await server.request("POST", "/api/references", {
      headers: { "content-type": UPLOAD_TYPE, [FILE_NAME_HEADER]: "%E0%A4%A" },
      body: bytes,
    });
    expect(badEscape.status).toBe(400);
    const newline = await server.request("POST", "/api/references", {
      headers: { "content-type": UPLOAD_TYPE, [FILE_NAME_HEADER]: encodeURIComponent("a\nb.wav") },
      body: bytes,
    });
    expect(newline.status).toBe(400);
  });
});

describe("one file", () => {
  /** @type {any} */
  let reference;
  /** @type {Buffer} */
  let bytes;
  beforeAll(async () => {
    bytes = await readFile(await makeReference(fixtures, "flac", { seed: 21, seconds: 20 }));
    reference = (await upload(bytes, "../../etc/passwd")).json().reference;
  });

  test("the same bytes twice give one row, and the name is only data", async () => {
    expect(reference.fileName).toBe("../../etc/passwd");
    expect(reference.file).toBe(`${sha256(bytes)}.flac`);
    const again = await upload(bytes, "another name.flac");
    expect(again.json()).toEqual({ reference, added: false });
    const listed = (await server.api("GET", "/api/references")).json().references;
    expect(listed.filter((/** @type {any} */ row) => row.sha256 === reference.sha256)).toEqual([
      reference,
    ]);
  });

  test("a region is added, replaced and removed, keeping the old rows", async () => {
    const regions = `/api/references/${reference.id}/regions`;
    const added = await server.api("POST", regions, {
      startSeconds: 2,
      endSeconds: 6.5,
      label: "the hiss",
      note: "",
    });
    expect(added.status, added.body.toString()).toBe(200);
    const { region } = added.json();
    const replaced = await server.api("POST", `/api/reference-regions/${region.id}/replace`, {
      startSeconds: 3,
      endSeconds: 7,
      label: "the hiss",
      note: 'a quote " and\na line break',
    });
    expect(replaced.status, replaced.body.toString()).toBe(200);
    const next = replaced.json().region;
    expect(next).toMatchObject({ replacesId: region.id, startSeconds: 3, endSeconds: 7 });
    expect(getRegion(server.store, region.id)?.removedReason).toBe(REMOVED.replaced);

    const read = await server.api("GET", `/api/references/${reference.id}`);
    expect(read.json().regions).toEqual([next]);
    const removed = await server.api("POST", `/api/reference-regions/${next.id}/remove`, {});
    expect(removed.status).toBe(200);
    expect((await server.api("GET", `/api/references/${reference.id}`)).json().regions).toEqual([]);
    expect(getRegion(server.store, next.id)?.removedReason).toBe(REMOVED.removed);
    const again = await server.api("POST", `/api/reference-regions/${next.id}/replace`, {
      startSeconds: 3,
      endSeconds: 7,
      label: "x",
      note: "",
    });
    expect(again.status).toBe(400);
  });

  test("bounds are stored to the millisecond, and a stored region plays", async () => {
    const regions = `/api/references/${reference.id}/regions`;
    const { region } = (
      await server.api("POST", regions, {
        startSeconds: 1 / 3,
        endSeconds: 4 + 2 / 3,
        label: "thirds",
        note: "",
      })
    ).json();
    expect(region).toMatchObject({ startSeconds: 0.333, endSeconds: 4.667 });
    const audio = await server.request(
      "GET",
      `/api/references/${reference.id}/audio?${spanQuery(region)}`,
    );
    expect(audio.status, audio.body.toString()).toBe(200);
    await server.api("POST", `/api/reference-regions/${region.id}/remove`, {});
  });

  test("a region outside the file or the limits is a 400 naming why", async () => {
    const regions = `/api/references/${reference.id}/regions`;
    /** @param {Record<string, unknown>} body */
    const post = (body) =>
      server.api("POST", regions, {
        startSeconds: 1,
        endSeconds: 5,
        label: "a",
        note: "",
        ...body,
      });
    expect((await post({ endSeconds: 25 })).json().error).toMatch(/past the end/);
    expect((await post({ startSeconds: 5 })).json().error).toMatch(/after the start/);
    expect((await post({ label: " " })).status).toBe(400);
    expect((await post({ startSeconds: "1" })).status).toBe(400);
  });

  test("a region plays as a 320 kbps MP3 of its decode, with byte ranges", async () => {
    const path = `/api/references/${reference.id}/audio?start=2.5&end=6`;
    const whole = await server.request("GET", path);
    expect(whole.status, whole.body.toString()).toBe(200);
    expect(whole.headers["content-type"]).toBe("audio/mpeg");
    expect(whole.headers["accept-ranges"]).toBe("bytes");
    const mp3 = join(fixtures, "region.mp3");
    await writeFile(mp3, whole.body);
    const decoded = await decodeMp3(mp3);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.length).toBe(3.5 * 48000);
    const peak = (decoded[0] ?? new Float32Array()).reduce(
      (most, x) => Math.max(most, Math.abs(x)),
      0,
    );
    expect(peak).toBeGreaterThan(0.1);

    const range = await server.request("GET", path, { headers: { range: "bytes=100-199" } });
    expect(range.status).toBe(206);
    expect(range.body).toEqual(whole.body.subarray(100, 200));
    expect(
      (await server.request("GET", `/api/references/${reference.id}/audio?start=2`)).status,
    ).toBe(400);
    const outside = `/api/references/${reference.id}/audio?start=18&end=30`;
    expect((await server.request("GET", outside)).status).toBe(400);
  });

  test("two uploads of the same bytes at once give one row and one file", async () => {
    const twin = await readFile(await makeReference(fixtures, "wav", { seed: 31, seconds: 15 }));
    const replies = await Promise.all([upload(twin, "first.wav"), upload(twin, "second.wav")]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    const ids = replies.map((reply) => reply.json().reference.id);
    expect(ids[0]).toBe(ids[1]);
    const rows = (await server.api("GET", "/api/references")).json().references;
    expect(rows.filter((/** @type {any} */ row) => row.sha256 === sha256(twin))).toHaveLength(1);
    const kept = await readdir(server.paths.references);
    expect(kept.filter((name) => name.startsWith(sha256(twin)))).toHaveLength(1);
    expect(await uploading()).toBe(false);
  });

  test("removing the file keeps its bytes and marks its regions", async () => {
    const regions = `/api/references/${reference.id}/regions`;
    const { region } = (
      await server.api("POST", regions, { startSeconds: 1, endSeconds: 3, label: "a", note: "" })
    ).json();
    const removed = await server.api("POST", `/api/references/${reference.id}/remove`, {});
    expect(removed.status).toBe(200);
    expect(getReferenceFile(server.store, reference.id)?.removedReason).toBe(REMOVED.removed);
    expect(getRegion(server.store, region.id)?.removedReason).toBe(REMOVED.fileRemoved);
    expect(await readFile(join(server.paths.references, reference.file))).toEqual(bytes);
    expect((await server.api("GET", `/api/references/${reference.id}`)).status).toBe(404);
    const listed = (await server.api("GET", "/api/references")).json().references;
    expect(listed.map((/** @type {any} */ row) => row.id)).not.toContain(reference.id);
  });
});
