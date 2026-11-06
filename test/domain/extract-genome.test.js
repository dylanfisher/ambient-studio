// Finding the one {intent, genome} answer in a model's response, and saying why when there
// isn't one (decision 0024).
import { describe, expect, test } from "vitest";
import { extractGenome } from "../../src/domain/extract-genome.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };

const answer = { intent: "a slow cold drone", genome: droneGenome };
const json = JSON.stringify(answer, null, 2);

describe("extractGenome finds the answer", () => {
  test.each([
    ["bare", json],
    ["fenced", `\`\`\`json\n${json}\n\`\`\``],
    ["wrapped in prose", `Here is a genome for the vibe:\n\n${json}\n\nIt stays low and slow.`],
    ["fenced inside prose", `Sure.\n\`\`\`\n${json}\n\`\`\`\nEnjoy {it}.`],
  ])("%s", (_, text) => {
    expect(extractGenome(text)).toEqual({
      ok: true,
      answer,
      intent: answer.intent,
      genome: droneGenome,
      errors: [],
    });
  });

  test("braces and quotes inside strings don't end the object", () => {
    const tricky = { intent: 'a "}" drone {', genome: droneGenome };
    const result = extractGenome(`x ${JSON.stringify(tricky)} y`);
    expect(result).toMatchObject({ ok: true, intent: tricky.intent });
  });
});

describe("extractGenome says why it refuses", () => {
  test("no object at all", () => {
    expect(extractGenome("I can't write a genome for that.")).toEqual({
      ok: false,
      reason: REJECT_REASON.noJson,
      message: "the response holds no JSON object",
    });
  });

  test("two objects", () => {
    expect(extractGenome(`${json}\nor maybe\n${json}`)).toEqual({
      ok: false,
      reason: REJECT_REASON.severalObjects,
      message: "the response holds 2 JSON objects; answer with one",
    });
  });

  test("an object that isn't JSON", () => {
    const result = extractGenome('{"intent": "drone", genome: {}}');
    expect(result).toMatchObject({ ok: false, reason: REJECT_REASON.invalidJson });
    expect(!result.ok && result.message).toMatch(/^the response's JSON doesn't parse: /);
  });

  test("an object cut off before it closes", () => {
    expect(extractGenome(json.slice(0, 200))).toEqual({
      ok: false,
      reason: REJECT_REASON.invalidJson,
      message: "the response's JSON doesn't parse: an object opened at character 1 never closes",
    });
  });
});

describe("extractGenome reports a wrong answer shape as errors to repair", () => {
  test("a bare genome, with no intent and no genome key", () => {
    const result = extractGenome(JSON.stringify(droneGenome));
    expect(result).toMatchObject({ ok: true, intent: null, genome: undefined });
    expect(result.ok && result.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        'the answer needs "intent", a one-line string',
        'the answer needs "genome", the genome object',
      ]),
    );
  });

  test("an intent over two lines, and an extra key", () => {
    const result = extractGenome(
      JSON.stringify({ intent: "slow\ncold", genome: droneGenome, notes: "x" }),
    );
    expect(result).toMatchObject({ ok: true, intent: null, genome: droneGenome });
    expect(result.ok && result.errors).toEqual([
      { path: "$", message: 'the answer needs "intent", a one-line string' },
      { path: "$", message: 'the answer has "notes", which is not "intent" or "genome"' },
    ]);
  });
});
