// Rendering and exporting a track (decision 0062) through the real server: nothing renders
// until a route starts it; the render job makes an MP3 preview cached by the revision's hash;
// the export writes a WAV, a FLAC and a manifest into a new folder under the data root's
// exports/ and refuses one that exists; the manifest alone renders the same PCM again; a seam
// preview plays; cancel removes the temp files and keeps the revision. Sections are seconds.
/** @import { Studio } from "../support/studio.js" */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { CHUNK_SECONDS } from "../../src/engine/chunk-windows.js";
import { CROSSFADE_LAW } from "../../src/engine/crossfade.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { genomeHash } from "../../src/server/genome-hash.js";
import { addSketch } from "../../src/server/rating-store.js";
import { rerenderTrack } from "../../src/server/render-track.js";
import { rendererVersions } from "../../src/server/renderer-versions.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { exportFolder, trackExportJob, trackRenderJob } from "../../src/server/track-render-job.js";
import { listTrackExports, listTrackRevisions } from "../../src/server/track-store.js";
import { headerBytes, PCM24 } from "../../src/server/wav-writer.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

/**
 * Three kept sketches of drone variants, written straight to the store.
 * @param {Studio} studio
 * @param {any} vibe as the vibe route returns it
 */
function seedSketches({ server }, vibe) {
  return [2, 5, 9].map((key, i) => {
    const genome = { ...droneGenome, key };
    const candidate = addCandidate(server.store, {
      vibeRevisionId: vibe.revision.id,
      generationId: null,
      sessionId: null,
      genomeId: putGenome(server.store, vibe.id, genome).id,
      seed: 11 + i,
      source: "llm",
      parentIds: [],
      locks: [],
      operator: null,
      operatorParams: null,
      intent: `drone in key ${key}`,
      rejectReason: null,
      lint: null,
      rejectedGenome: null,
    });
    return addSketch(server.store, { candidateId: candidate.id, notes: "", tags: [] });
  });
}

/** Three 10 s sections with 2 s crossfades, 26 s, the last extended past its sketch's 60 s. */
async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  const sketches = seedSketches(studio, vibe);
  const { track } = await studio.ok("POST", `/api/vibes/${vibe.id}/tracks`, {
    name: "../First light: dawn/",
  });
  const arrangement = {
    ...emptyArrangement(),
    sections: [
      { sketchId: sketches[0]?.id, offset: 0, seconds: 10 },
      { sketchId: sketches[1]?.id, offset: 30, seconds: 10 },
      { sketchId: sketches[2]?.id, offset: 55, seconds: 10 },
    ],
    transitions: [
      { kind: "crossfade", seconds: 2 },
      { kind: "crossfade", seconds: 2 },
    ],
  };
  const revision = await studio.ok("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement,
    note: "three",
  });
  return { ...studio, vibe, track, revision, path: `/api/tracks/${track.id}` };
}

/**
 * Starts a job by its route and waits for it to finish.
 * @param {Studio} studio
 * @param {string} path
 * @param {unknown} body
 */
async function runJob({ ok, server }, path, body) {
  const job = await ok("POST", path, body);
  await server.jobs.settled(job.id);
  const done = await ok("GET", `/api/jobs/${job.id}`);
  expect(done.error).toBeNull();
  expect(done.state).toBe("done");
  return done;
}

test("a track renders from its route, previews as MP3, exports, and re-renders from its manifest", async () => {
  const studio = await setup();
  const { ok, server, track, revision, path } = studio;
  const status = `${path}/revisions/${revision.id}/render`;
  const before = await ok("GET", status);
  expect(before.preview).toBeNull();
  expect(before.estimate.cost.length).toBe(26);
  expect(before.estimate.measured).toBe(false);
  // Reading the track and its render state starts nothing.
  await ok("GET", path);
  expect(server.jobs.list()).toEqual([]);

  const rendered = await runJob(studio, `${path}/render`, { revisionId: revision.id });
  expect(rendered.kind).toBe("track-render");
  expect(rendered.result).toMatchObject({ cached: false });
  const audio = await server.request("GET", rendered.result.url);
  expect(audio.status).toBe(200);
  expect(audio.headers["content-type"]).toBe("audio/mpeg");
  const after = await ok("GET", status);
  expect(after.preview.url).toBe(rendered.result.url);
  expect(after.estimate.measured).toBe(true);
  const again = await runJob(studio, `${path}/render`, { revisionId: revision.id });
  expect(again.result).toMatchObject({ cached: true, url: rendered.result.url });

  const exported = await runJob(studio, `${path}/export`, { revisionId: revision.id });
  const folder = exported.result.folder;
  expect(folder).toBe(`track${track.id}-v2-first-light-dawn`);
  const dir = join(server.paths.exports, folder);
  expect((await readdir(dir)).sort()).toEqual(
    [`${folder}.flac`, `${folder}.json`, `${folder}.wav`].sort(),
  );
  const text = await readFile(join(dir, `${folder}.json`), "utf8");
  const manifest = JSON.parse(text);
  const pcm = (await readFile(join(dir, `${folder}.wav`))).subarray(headerBytes(PCM24));
  expect(manifest.pcmSha256).toBe(sha256Hex(pcm));
  expect(manifest).toMatchObject({
    files: { wav: `${folder}.wav`, flac: `${folder}.flac` },
    chunkSeconds: 120,
    crossfadeLaw: "equal-power",
    transitions: [
      { kind: "crossfade", seconds: 2 },
      { kind: "crossfade", seconds: 2 },
    ],
  });
  expect(manifest.sections.map((/** @type {any} */ s) => [s.offset, s.duration, s.seed])).toEqual([
    [0, 10, 11],
    [30, 10, 12],
    [55, 10, 13],
  ]);
  // The extended section's genome runs to its end.
  expect(manifest.sections[2].genome.duration).toBe(65);
  expect(Math.abs(manifest.loudness.integrated - VIBE.constraints.loudness)).toBeLessThanOrEqual(
    0.1,
  );
  expect(listTrackExports(server.store, revision.id)).toMatchObject([
    { kind: "mix", folder, manifestSha256: sha256Hex(text) },
  ]);

  const temp = await mkdtemp(join(server.paths.trackRenders, "rerender-"));
  try {
    expect(await rerenderTrack(manifest, { tempDir: temp })).toEqual({
      pcmSha256: manifest.pcmSha256,
    });
  } finally {
    await rm(temp, { recursive: true });
  }

  const refused = await server.api("POST", `${path}/export`, { revisionId: revision.id });
  expect(refused.status).toBe(409);
  expect(refused.json().error).toContain(`${folder} already exists`);

  // A later version that sounds the same shares the cached render, and its export names itself.
  const same = await ok("POST", `${path}/revisions`, {
    arrangement: revision.arrangement,
    note: "same",
  });
  const shared = await runJob(studio, `${path}/render`, { revisionId: same.id });
  expect(shared.result).toMatchObject({ cached: true, url: rendered.result.url });
  const second = await runJob(studio, `${path}/export`, { revisionId: same.id });
  expect(second.result.folder).toBe(`track${track.id}-v3-first-light-dawn`);
  const own = JSON.parse(
    await readFile(
      join(server.paths.exports, second.result.folder, `${second.result.folder}.json`),
      "utf8",
    ),
  );
  expect(own.track).toEqual({ id: track.id, name: track.name, revisionId: same.id });
  expect(own.pcmSha256).toBe(manifest.pcmSha256);
  expect(manifest.track.revisionId).toBe(revision.id);

  // A cancel while flac runs removes the export's folder and logs nothing.
  const third = await ok("POST", `${path}/revisions`, {
    arrangement: revision.arrangement,
    note: "third",
  });
  const controller = new AbortController();
  const cancelled = trackExportJob(/** @type {any} */ (server), {
    trackId: track.id,
    revisionId: third.id,
  })({
    signal: controller.signal,
    progress: (_done, _total, step) => {
      if (step) controller.abort(new Error("cancelled"));
    },
  });
  await expect(cancelled).rejects.toThrow("cancelled");
  expect(existsSync(join(server.paths.exports, `track${track.id}-v4-first-light-dawn`))).toBe(
    false,
  );
  expect(listTrackExports(server.store, third.id)).toEqual([]);
});

test("an export needs a render first, and a revision must be the track's own", async () => {
  const { server, path, revision, ok, vibe } = await setup();
  const early = await server.api("POST", `${path}/export`, { revisionId: revision.id });
  expect(early.status).toBe(409);
  expect(early.json().error).toContain("Render this version first");
  const { track: other } = await ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "other" });
  const wrong = await server.api("POST", `/api/tracks/${other.id}/render`, {
    revisionId: revision.id,
  });
  expect(wrong.status).toBe(404);
  const bad = await server.api("POST", `${path}/render`, { revisionId: "../1" });
  expect(bad.status).toBe(400);
  expect(server.jobs.list()).toEqual([]);
});

test("a seam preview renders the span around one transition as an MP3", async () => {
  const studio = await setup();
  const { path, revision, server } = studio;
  const done = await runJob(studio, `${path}/seam-preview`, {
    revisionId: revision.id,
    transition: 1,
  });
  expect(done.kind).toBe("seam-preview");
  // 30 s around a transition is more than this 26 s track, so the span is all of it.
  expect(done.result).toMatchObject({ from: 0, to: 26 });
  const audio = await server.request("GET", done.result.url);
  expect(audio.status).toBe(200);
  const missing = await server.api("POST", `${path}/seam-preview`, {
    revisionId: revision.id,
    transition: 2,
  });
  expect(missing.status).toBe(400);
});

test("cancel stops at the next chunk, removes the temp files and keeps the revision", async () => {
  const { server, track, revision } = await setup();
  const controller = new AbortController();
  const app = { store: server.store, paths: server.paths, config: { fieldRecordings: null } };
  const job = trackRenderJob(/** @type {any} */ (app), {
    trackId: track.id,
    revisionId: revision.id,
  });
  const run = job({
    signal: controller.signal,
    progress: (_done, _total, step) => {
      if (step?.startsWith("Rendering section 2")) controller.abort(new Error("cancelled"));
    },
  });
  await expect(run).rejects.toThrow("cancelled");
  const folder = join(server.paths.trackRenders, String(track.id));
  expect(existsSync(folder) ? await readdir(folder) : []).toEqual([]);
  expect(listTrackRevisions(server.store, track.id)).toHaveLength(2);
});

test("an export folder is named from the ids and a cleaned name, never a path", () => {
  expect(exportFolder({ id: 4, name: "../../etc/passwd" }, 3)).toBe("track4-v3-etc-passwd");
  expect(exportFolder({ id: 4, name: "Été à l'aube" }, 1)).toBe("track4-v1-t-l-aube");
  expect(exportFolder({ id: 4, name: "///" }, 1)).toBe("track4-v1");
  expect(exportFolder({ id: 4, name: "x".repeat(200) }, 1)).toBe(`track4-v1-${"x".repeat(40)}`);
  expect(() => exportFolder({ id: 0, name: "a" }, 1)).toThrow();
});

test("a malformed manifest is refused, and one whose audio differs names both hashes", async () => {
  // rerenderTrack reads only numbers, strings and genomes from a manifest, and writes nothing
  // but its temp file, so a manifest naming another folder can't move it.
  const temp = await mkdtemp(join(tmpdir(), "rerender-"));
  try {
    await writeFile(join(temp, "keep"), "");
    await expect(rerenderTrack({ files: { wav: "../../x" } }, { tempDir: temp })).rejects.toThrow(
      /isn't a track manifest/,
    );
    const genome = requireGenome({ ...droneGenome, fadeIn: 0, fadeOut: 0 }, "drone");
    const manifest = {
      sections: [{ seed: 1, offset: 0, duration: 10, genomeHash: genomeHash(genome), genome }],
      transitions: [],
      fades: { fadeIn: 0, fadeOut: 0 },
      chunkSeconds: CHUNK_SECONDS,
      crossfadeLaw: CROSSFADE_LAW,
      loudness: { target: -16, ceiling: -1 },
      engineVersion: ENGINE_VERSION,
      ...rendererVersions(),
      pcmSha256: "0".repeat(64),
    };
    await expect(rerenderTrack(manifest, { tempDir: temp })).rejects.toThrow(
      /doesn't reproduce it: the PCM hashes to [0-9a-f]{64}, the manifest says 0{64}/,
    );
    expect(await readdir(temp)).toEqual(["keep"]);
  } finally {
    await rm(temp, { recursive: true });
  }
});
