// The words job through the real server against the fake omlx (decision 0084): one request
// holding the set's fields with the page's values now and the owner's words, its checked
// changes and sentence returned unsaved; one repair quoting each finding; a cut-off answer
// rejected with no repair; the route refusing an unknown set, a set it doesn't serve, bad values
// now, and a second words job while one runs; and a cancel. A candidate's sets (0085) read the
// candidate the page names: its locks, its Less / More choices and where a steer from it aims.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test, vi } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { lockChoices } from "../../src/domain/lock-choices.js";
import { OPERATOR } from "../../src/domain/operator.js";
import { ROLE } from "../../src/domain/prompt-tokens.js";
import { sketchReading } from "../../src/domain/sketch-reading.js";
import { directionField } from "../../src/domain/words-sets.js";
import { MACROS } from "../../src/engine/genome-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { listDevelopments } from "../../src/server/development-store.js";
import {
  addCandidate,
  getGeneration,
  listRequestGroup,
  putGenome,
} from "../../src/server/generation-store.js";
import { addSketch } from "../../src/server/rating-store.js";
import { markRemoved, TABLE } from "../../src/server/store.js";
import { listRevisions } from "../../src/server/vibe-store.js";
import { GENOMES, removeStudio, startStudio, VIBE } from "../support/studio.js";

// Every real set the words route serves is a candidate's, so the test adds one the page sends
// values for with no candidate: a number, a
// whole number and a choice; and a candidate's set too large for the prompt even narrowed, which
// counts how often it was narrowed.
const narrowings = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/domain/words-sets.js", async (original) => {
  /** @type {any} */
  const real = await original();
  const { choice, int, number } = await import("../../src/engine/descriptor.js");
  const TEST_FIELDS = Object.freeze({
    level: number({ min: 0, max: 1, default: 0.5, unit: "", description: "how loud" }),
    voices: int({ min: 1, max: 6, default: 2, unit: "", description: "how many" }),
    pulse: choice({ values: ["none", "beat"], default: "none", description: "the pulse" }),
  });
  const sets = {
    ...real.WORDS_SETS,
    test: {
      subject: "how one voice plays",
      scope: real.WORDS_SCOPE.page,
      fields: () => TEST_FIELDS,
    },
    huge: {
      subject: "everything at once",
      scope: real.WORDS_SCOPE.candidate,
      label: "Everything",
      fields: (/** @type {any} */ context) => ({
        [context.voicesWithParams === 0 ? "narrow" : "wide"]: number({
          min: 0,
          max: 1,
          default: 0.5,
          unit: "",
          description: "x".repeat(40_000),
        }),
      }),
      narrower: (/** @type {any} */ context) => {
        if (context.voicesWithParams === 0) return null;
        narrowings.count += 1;
        return { ...context, voicesWithParams: 0 };
      },
    },
  };
  return {
    ...real,
    WORDS_SETS: sets,
    wordsSet: (/** @type {string} */ name) => (Object.hasOwn(sets, name) ? sets[name] : undefined),
  };
});

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

const WORDS = "louder, with a beat";
const CURRENT = Object.freeze({ level: 0.5, voices: 2, pulse: "none" });
const GOOD = Object.freeze({
  changes: { level: 0.8, pulse: "beat" },
  said: "Louder, with a beat.",
});

async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  return { studio, vibe, path: `/api/vibes/${vibe.id}/words` };
}

/** @param {unknown} value */
const tokens = (value) => ({ tokens: [JSON.stringify(value)] });

/**
 * Asks for the test set's changes with the fake omlx answering `answers` in turn, and returns
 * the finished job.
 * @param {Studio} studio
 * @param {string} path
 * @param {object[]} answers
 */
async function ask({ ok, omlx, drive, server }, path, answers) {
  omlx.script(...answers);
  const job = await ok("POST", path, { set: "test", words: WORDS, current: CURRENT });
  await drive(server.jobs.settled(job.id));
  return ok("GET", `/api/jobs/${job.id}`);
}

/**
 * @param {Studio} studio
 * @param {number} i
 * @returns {any[]}
 */
function sent({ omlx }, i) {
  const request = omlx.requests[i];
  if (!request) throw new Error(`the fake omlx got no request ${i}`);
  return request.body.messages;
}

test("one request holds each field with its value now and the words, and the checked changes come back unsaved", async () => {
  const { studio, vibe, path } = await setup();
  const finished = await ask(studio, path, [tokens(GOOD)]);
  expect(finished.state).toBe("done");
  expect(finished.kind).toBe("words");
  expect(finished.result).toMatchObject({ ...GOOD, repaired: false });
  expect(studio.omlx.requests).toHaveLength(1);
  const [system, user] = sent(studio, 0);
  expect(system.role).toBe(ROLE.system);
  expect(user.content).toContain("The fields set how one voice plays.");
  expect(user.content).toContain(`The brief: ${VIBE.brief}`);
  expect(user.content).toContain("- voices: how many; 1..6 int; now 2");
  expect(user.content).toContain(JSON.stringify(WORDS));
  const generation = getGeneration(studio.server.store, finished.result.generationId);
  expect(generation?.requestGroup).toMatch(new RegExp(`^vibe-${vibe.id}-${OPERATOR.words}-\\d+$`));
  expect(generation?.vibeRevisionId).toBe(vibe.revision.id);
  expect(listRevisions(studio.server.store, vibe.id)).toHaveLength(1);
});

test("an unknown field, an out-of-range number and a bad choice each get a finding and one repair, and the fixed answer passes", async () => {
  const { studio, path } = await setup();
  const wrong = { changes: { loud: 1, level: 3, pulse: "swing" }, said: "Louder." };
  const finished = await ask(studio, path, [tokens(wrong), tokens(GOOD)]);
  expect(finished.state).toBe("done");
  expect(finished.result).toMatchObject({ ...GOOD, repaired: true });
  const repair = sent(studio, 1);
  expect(repair.slice(0, 2)).toEqual(sent(studio, 0));
  expect(repair[2]).toEqual({ role: ROLE.assistant, content: JSON.stringify(wrong) });
  expect(repair[3].content).toContain("- $.changes.loud (changes): unknown field");
  expect(repair[3].content).toContain("- $.changes.level (changes): must be from 0 to 1, got 3");
  expect(repair[3].content).toContain(
    '- $.changes.pulse (changes): must be one of "none", "beat", got "swing"',
  );
  const kept = getGeneration(studio.server.store, finished.result.generationId);
  const group = listRequestGroup(studio.server.store, String(kept?.requestGroup));
  expect(group.map(({ repairsId }) => repairsId)).toEqual([null, group[0]?.id]);
});

test("an answer still wrong after its repair fails with its findings, and a cut-off one gets no repair", async () => {
  const { studio, path } = await setup();
  const wrong = { changes: { voices: 9 }, said: "More voices." };
  const failed = await ask(studio, path, [tokens(wrong), tokens(wrong)]);
  expect(failed.state).toBe("failed");
  expect(failed.error).toMatch(/still invalid after one repair/);
  expect(failed.error).toContain("- $.changes.voices (changes): must be from 1 to 6, got 9");

  const cut = await ask(studio, path, [{ tokens: ['{"changes": {'], finishReason: "length" }]);
  expect(cut.state).toBe("failed");
  expect(cut.error).toMatch(/invalid, with nothing to repair/);
  expect(cut.error).toContain("cut off");
  expect(studio.omlx.requests).toHaveLength(3);
});

test("the route refuses an unknown set, a set it doesn't serve, bad values now and a second words job", async () => {
  const { studio, path } = await setup();
  const { server } = studio;
  const post = (/** @type {unknown} */ body) => server.api("POST", path, body);
  const unknown = await post({ set: "everything", words: WORDS, current: CURRENT });
  expect(unknown.status).toBe(400);
  expect(unknown.body.toString()).toContain("there is no field set");
  const shift = await post({ set: "shift", words: WORDS, current: {} });
  expect(shift.status).toBe(400);
  expect(shift.body.toString()).toContain("search by ear");
  const bad = await post({ set: "test", words: WORDS, current: { ...CURRENT, voices: 9 } });
  expect(bad.status).toBe(400);
  expect(bad.body.toString()).toContain("current.voices: must be from 1 to 6, got 9");
  const extra = await post({ set: "test", words: WORDS, current: { ...CURRENT, x: 1 } });
  expect(extra.status).toBe(400);
  const missing = await post({ set: "test", words: WORDS, current: { level: 0.5 } });
  expect(missing.status).toBe(400);
  expect((await post({ set: "test", words: " ", current: CURRENT })).status).toBe(400);
  expect(
    (
      await server.api("POST", "/api/vibes/99/words", {
        set: "test",
        words: WORDS,
        current: CURRENT,
      })
    ).status,
  ).toBe(404);
  expect(studio.omlx.requests).toHaveLength(0);

  studio.omlx.script({ ...tokens(GOOD), holdAfter: 0 });
  const first = await studio.ok("POST", path, { set: "test", words: WORDS, current: CURRENT });
  const second = await post({ set: "test", words: WORDS, current: CURRENT });
  expect(second.status).toBe(409);
  expect(second.json().jobId).toBe(first.id);
  // release() frees only a request the fake holds, so wait for the job to send it.
  await studio.omlx.waitForRequests(1);
  studio.omlx.release();
  await studio.drive(server.jobs.settled(first.id));
});

test("a cancel while the model answers ends the job cancelled with no result", async () => {
  const { studio, vibe, path } = await setup();
  studio.omlx.script({ tokens: ['{"changes": '], holdAfter: 0 });
  const job = await studio.ok("POST", path, { set: "test", words: WORDS, current: CURRENT });
  await studio.omlx.waitForRequests(1);
  await studio.ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await studio.drive(studio.server.jobs.settled(job.id));
  studio.omlx.release();
  const cancelled = await studio.ok("GET", `/api/jobs/${job.id}`);
  expect(cancelled.state).toBe("cancelled");
  expect(cancelled.result ?? null).toBeNull();
  expect(studio.omlx.requests).toHaveLength(1);
  expect(listRevisions(studio.server.store, vibe.id)).toHaveLength(1);
});

// Beside a running job (0092). The brief draft is the long job here: a main-lane job whose one
// request can be held at the fake omlx and that cancels its requests on abort.
const DRAFT = Object.freeze({
  name: "Underwater drone",
  brief: "A slow, dark drone heard from under water.",
  constraints: { pulse: "none" },
  softTargets: { features: {} },
});
const DRAFT_PATH = "/api/brief-drafts";
const DRAFT_BODY = Object.freeze({ words: "a slow, dark underwater drone", current: null });
const WORDS_BODY = Object.freeze({ set: "test", words: WORDS, current: CURRENT });

test("a words job runs and finishes while another job holds the main lane", async () => {
  const { studio, path } = await setup();
  const { server } = studio;
  /** @type {() => void} */
  let release = () => undefined;
  const long = server.jobs.add(
    "candidates",
    () => new Promise((resolve) => (release = () => resolve(undefined))),
  );
  studio.omlx.script(tokens(GOOD));
  const job = await studio.ok("POST", path, WORDS_BODY);
  expect(job.state).toBe("running");
  await studio.drive(server.jobs.settled(job.id));
  expect(await studio.ok("GET", `/api/jobs/${job.id}`)).toMatchObject({
    state: "done",
    result: GOOD,
  });
  expect(server.jobs.get(long.id).state).toBe("running");
  release();
  await server.jobs.settled(long.id);
});

test("cancelling a words job cancels only its request, and the other job's request in flight finishes", async () => {
  const { studio, path } = await setup();
  const { server, omlx } = studio;
  omlx.script({ ...tokens(DRAFT), holdAfter: 0 });
  const draft = await studio.ok("POST", DRAFT_PATH, DRAFT_BODY);
  await omlx.waitForRequests(1);
  const words = await studio.ok("POST", path, WORDS_BODY);
  expect(words.state).toBe("running");
  await studio.ok("POST", `/api/jobs/${words.id}/cancel`, {});
  await server.jobs.settled(words.id);
  expect(server.jobs.get(words.id).state).toBe("cancelled");
  omlx.release();
  await studio.drive(server.jobs.settled(draft.id));
  expect(await studio.ok("GET", `/api/jobs/${draft.id}`)).toMatchObject({
    state: "done",
    result: { draft: DRAFT },
  });
  expect(omlx.requests).toHaveLength(1);
  expect(omlx.aborted()).toBe(0);
  expect(omlx.maxInFlight()).toBe(1);
});

test("cancelling the other job aborts only its request, and the words job's request goes on", async () => {
  const { studio, path } = await setup();
  const { server, omlx } = studio;
  omlx.script({ tokens: ['{"name": '], holdAfter: 0 }, tokens(GOOD));
  const draft = await studio.ok("POST", DRAFT_PATH, DRAFT_BODY);
  await omlx.waitForRequests(1);
  const words = await studio.ok("POST", path, WORDS_BODY);
  // Running in its own lane, its request waiting in the queue behind the draft's.
  expect(words.state).toBe("running");
  await studio.ok("POST", `/api/jobs/${draft.id}/cancel`, {});
  await omlx.waitForAborted(1);
  await studio.drive(server.jobs.settled(words.id));
  expect(await studio.ok("GET", `/api/jobs/${words.id}`)).toMatchObject({
    state: "done",
    result: GOOD,
  });
  await server.jobs.settled(draft.id);
  expect(server.jobs.get(draft.id).state).toBe("cancelled");
  expect(omlx.requests).toHaveLength(2);
  expect(omlx.maxInFlight()).toBe(1);
});

test("cancelling a bridge job aborts only its request, and the words job's request goes on (0081)", async () => {
  const { studio, vibe, path } = await setup();
  const { server, omlx } = studio;
  // Two sections of one drone sketch, kept straight in the store, joined by a crossfade.
  const genome = { ...droneGenome, duration: 120 };
  const candidate = addCandidate(server.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: null,
    genomeId: putGenome(server.store, vibe.id, genome).id,
    seed: 11,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: null,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  const sketch = addSketch(server.store, { candidateId: candidate.id, notes: "", tags: [] });
  const section = { sketchId: sketch.id, offset: 0, seconds: 100, text: "", developmentId: null };
  const { track } = await studio.ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "dusk" });
  const revision = await studio.ok("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement: {
      ...emptyArrangement(),
      sections: [section, section],
      transitions: [{ kind: "crossfade", seconds: 8, text: "" }],
    },
    note: "two",
  });
  omlx.script({ tokens: ['{"duration": '], holdAfter: 0 }, tokens(GOOD));
  const bridge = await studio.ok("POST", `/api/tracks/${track.id}/bridge`, {
    revisionId: revision.id,
    transition: 0,
    seconds: 60,
  });
  await omlx.waitForRequests(1);
  const words = await studio.ok("POST", path, WORDS_BODY);
  // Running in its own lane, its request waiting in the queue behind the bridge's.
  expect(words.state).toBe("running");
  await studio.ok("POST", `/api/jobs/${bridge.id}/cancel`, {});
  await omlx.waitForAborted(1);
  await studio.drive(server.jobs.settled(words.id));
  expect(await studio.ok("GET", `/api/jobs/${words.id}`)).toMatchObject({
    state: "done",
    result: GOOD,
  });
  await server.jobs.settled(bridge.id);
  expect(server.jobs.get(bridge.id).state).toBe("cancelled");
  expect(listDevelopments(server.store, track.id)).toEqual([]);
  expect(omlx.requests).toHaveLength(2);
  expect(omlx.maxInFlight()).toBe(1);
});

/**
 * A brief, a session and one candidate of it with GENOMES[0], stored with no excerpt.
 * @param {Studio} studio
 */
async function seedCandidate(studio) {
  const { vibe, session } = await studio.openSession();
  const { store } = studio.server;
  const genome = requireGenome(GENOMES[0], "the test genome");
  const candidate = addCandidate(store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: session.id,
    genomeId: putGenome(store, vibe.id, genome).id,
    seed: 7,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: null,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  return { vibe, session, candidate, genome, path: `/api/vibes/${vibe.id}/words` };
}

/**
 * Asks a candidate's set with the fake omlx answering `answers` in turn; the finished job.
 * @param {Studio} studio
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @param {object[]} answers
 */
async function askSet({ ok, omlx, drive, server }, path, body, answers) {
  omlx.script(...answers);
  const job = await ok("POST", path, body);
  await drive(server.jobs.settled(job.id));
  return ok("GET", `/api/jobs/${job.id}`);
}

/** @param {import("../../src/engine/genome-schema.js").Genome} genome */
const allFree = (genome) =>
  Object.fromEntries(
    lockChoices(genome).flatMap(({ choices }) => choices.map(({ path }) => [path, "free"])),
  );

async function candidateStudio() {
  const studio = await startStudio();
  studios.push(studio);
  return { studio, ...(await seedCandidate(studio)) };
}

test("the locks set lists the candidate's lockable paths with its reading, and its changes come back", async () => {
  const { studio, session, candidate, genome, path } = await candidateStudio();
  const voice = /** @type {{ id: string, type: string }} */ (genome.voices[0]);
  const good = { changes: { [`voices.${voice.id}`]: "locked" }, said: "Keeps the low drone." };
  const body = {
    set: "locks",
    words: "keep the low drone",
    current: allFree(genome),
    candidateId: candidate.id,
  };
  const finished = await askSet(studio, path, body, [tokens(good)]);
  expect(finished.state).toBe("done");
  expect(finished.result).toMatchObject({ ...good, repaired: false });
  const [, user] = sent(studio, 0);
  expect(user.content).toContain(
    `What is being changed, as it is now:\n${sketchReading(genome, null).join("\n")}`,
  );
  expect(user.content).toContain(
    `- voices.${voice.id}: the whole voice, a ${voice.type}, every parameter; locked|free; now "free"`,
  );
  const generation = getGeneration(studio.server.store, finished.result.generationId);
  expect(generation?.sessionId).toBe(session.id);
});

test("the macros set repairs a value that isn't one of its choices", async () => {
  const { studio, candidate, path } = await candidateStudio();
  const current = Object.fromEntries(Object.keys(MACROS).map((macro) => [macro, "none"]));
  const wrong = { changes: { brightness: "darker" }, said: "Darker." };
  const good = { changes: { brightness: "less", space: "more" }, said: "Darker, roomier." };
  const body = { set: "macros", words: "darker and roomier", current, candidateId: candidate.id };
  const finished = await askSet(studio, path, body, [tokens(wrong), tokens(good)]);
  expect(finished.state).toBe("done");
  expect(finished.result).toMatchObject({ ...good, repaired: true });
  expect(sent(studio, 0)[1].content).toContain(
    '- brightness: less is darker, more is brighter; less|none|more; now "none"',
  );
  expect(sent(studio, 1)[3].content).toContain(
    '- $.changes.brightness (changes): must be one of "less", "none", "more", got "darker"',
  );
});

test("the steer set has a field per direction, and an out-of-range setting is repaired", async () => {
  const { studio, vibe, candidate, path } = await candidateStudio();
  const body = { set: "steer", words: "much wetter", current: {}, candidateId: candidate.id };
  const none = await studio.server.api("POST", path, body);
  expect(none.status).toBe(400);
  expect(none.body.toString()).toContain("the brief has no directions yet");
  const { attachment } = await studio.ok("POST", `/api/vibes/${vibe.id}/attachments`, {
    kind: "direction",
    near: "dry",
    far: "wet",
  });
  const field = directionField(attachment.id);
  const wrong = { changes: { [field]: 1.4 }, said: "Much wetter." };
  const good = { changes: { [field]: 0.9 }, said: "Much wetter." };
  const finished = await askSet(studio, path, { ...body, current: { [field]: 0.5 } }, [
    tokens(wrong),
    tokens(good),
  ]);
  expect(finished.state).toBe("done");
  expect(finished.result).toMatchObject({ changes: good.changes, repaired: true });
  expect(sent(studio, 0)[1].content).toContain(
    `- ${field}: from “dry” at 0 to “wet” at 1; 0..1; now 0.5`,
  );
  expect(sent(studio, 1)[3].content).toContain(
    `- $.changes.${field} (changes): must be from 0 to 1, got 1.4`,
  );
});

test("the route resolves candidateId, refusing one of another brief, a removed one, a missing one, and one a page's set doesn't take", async () => {
  const { studio, candidate, genome, path } = await candidateStudio();
  const other = await seedCandidate(studio);
  const gone = await seedCandidate(studio);
  markRemoved(studio.server.store, TABLE.candidates, gone.candidate.id, "test");
  const base = { set: "locks", words: "keep the drone", current: allFree(genome) };
  /** @type {[Record<string, unknown>, string][]} */
  const refused = [
    [{ ...base, candidateId: other.candidate.id }, "is not a candidate of vibe"],
    [{ ...base, candidateId: gone.candidate.id }, "was removed (test)"],
    [base, "candidateId"],
    [
      { set: "test", words: WORDS, current: CURRENT, candidateId: candidate.id },
      "takes no candidateId",
    ],
    [
      { ...base, candidateId: candidate.id, current: { ...base.current, "voices.x": "locked" } },
      "current",
    ],
  ];
  for (const [body, message] of refused) {
    const answer = await studio.server.api("POST", path, body);
    expect(answer.status, message).toBe(400);
    expect(answer.body.toString()).toContain(message);
  }
  expect(studio.omlx.requests).toHaveLength(0);
});

test("a candidate's set still over the budget once narrowed is a 400 in words, and nothing is asked", async () => {
  const { studio, candidate, path } = await candidateStudio();
  const body = {
    set: "huge",
    words: "all of it",
    current: { wide: 0.5 },
    candidateId: candidate.id,
  };
  const answer = await studio.server.api("POST", path, body);
  expect(answer.status).toBe(400);
  expect(answer.json().error).toMatch(
    /^the words' prompt is about \d+ tokens, over its \d+-token budget/,
  );
  expect(narrowings.count).toBe(1);
  expect(studio.omlx.requests).toHaveLength(0);
});

test("a second words job for a candidate's set is a 409 naming the first", async () => {
  const { studio, candidate, genome, path } = await candidateStudio();
  const body = {
    set: "locks",
    words: "keep it all",
    current: allFree(genome),
    candidateId: candidate.id,
  };
  studio.omlx.script({ ...tokens({ changes: {}, said: "Nothing." }), holdAfter: 0 });
  const first = await studio.ok("POST", path, body);
  const second = await studio.server.api("POST", path, {
    ...body,
    set: "macros",
    current: Object.fromEntries(Object.keys(MACROS).map((macro) => [macro, "none"])),
  });
  expect(second.status).toBe(409);
  expect(second.json().jobId).toBe(first.id);
  await studio.omlx.waitForRequests(1);
  studio.omlx.release();
  await studio.drive(studio.server.jobs.settled(first.id));
  expect(studio.omlx.requests).toHaveLength(1);
});
