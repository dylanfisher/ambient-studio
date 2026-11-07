// Writing the owner's locks into an answer (decision 0035): each locked value restored and
// listed as changed or filled, a dropped voice put back, and a lock the answer can't take a
// `lock` finding.
/** @import { Lock } from "../../src/domain/validate-lock.js" */
import { describe, expect, test } from "vitest";
import { applyLocks, LOCK_RULE } from "../../src/domain/apply-locks.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";

const genome = requireGenome(exampleGenome, "example genome");

/** @param {string[]} paths @returns {Lock[]} */
const locksOn = (paths) =>
  paths.map((path) => {
    const result = lockOn(genome, path);
    if (!result.ok) throw new Error(`${path}: ${result.message}`);
    return result.lock;
  });

/**
 * The example genome with `edit` applied to a copy, as an answer would write it.
 * @param {(answer: any) => void} edit
 */
function answerWith(edit) {
  const answer = structuredClone(exampleGenome);
  edit(answer);
  return answer;
}

/**
 * applyLocks over an answer as validation fills it out, with the answer as written.
 * @param {unknown} written
 * @param {Lock[]} locks
 */
const apply = (written, locks) => applyLocks(requireGenome(written, "answer"), locks, written);

/** @param {any[]} voices @param {string} id */
const voice = (voices, id) => voices.find((v) => v.id === id);

describe("applyLocks", () => {
  test("restores every locked value an answer changed and lists each as changed", () => {
    const paths = [
      "reverbDecay",
      "macros.space",
      "voices.pad.hold",
      "voices.drone.cutoff",
      "voices.pad.level",
      "voices.bell",
    ];
    const written = answerWith((a) => {
      a.reverbDecay = 12;
      a.macros.space = 0.2;
      voice(a.voices, "pad").hold = 50;
      voice(a.voices, "drone").cutoff = 500;
      // A number lock over an answer that made the parameter a trajectory.
      voice(a.voices, "pad").level = {
        points: [
          [0, -20],
          [300, -8],
        ],
      };
      voice(a.voices, "bell").decay = 9;
    });
    const result = apply(written, locksOn(paths));
    expect(result).toEqual({
      genome: expect.any(Object),
      changed: paths,
      filled: [],
      findings: [],
    });
    expect(canonicalGenome(result.genome)).toBe(canonicalGenome(genome));
  });

  test("lists a locked value the answer left out as filled, not changed", () => {
    const written = answerWith((a) => {
      delete a.reverbDecay;
      delete a.macros.space;
      delete voice(a.voices, "pad").hold;
      a.delayLevel = -30;
    });
    const result = apply(written, locksOn(["reverbDecay", "macros.space", "voices.pad.hold"]));
    expect(result.changed).toEqual([]);
    expect(result.filled).toEqual(["reverbDecay", "macros.space", "voices.pad.hold"]);
    expect(result.findings).toEqual([]);
    // The locked values are back and the answer's own change stays.
    expect(canonicalGenome(result.genome)).toBe(canonicalGenome({ ...genome, delayLevel: -30 }));
  });

  test("puts back a locked voice the answer dropped, as filled", () => {
    const written = answerWith((a) => {
      a.voices = a.voices.filter((/** @type {any} */ v) => v.id !== "bell");
    });
    const result = apply(written, locksOn(["voices.bell"]));
    expect(result).toMatchObject({ changed: [], filled: ["voices.bell"], findings: [] });
    expect(canonicalGenome(result.genome)).toBe(canonicalGenome(genome));
  });

  test("a value the answer kept is neither changed nor filled", () => {
    const result = apply(exampleGenome, locksOn(["reverbDecay", "voices.bell"]));
    expect(result).toEqual({ genome, changed: [], filled: [], findings: [] });
  });

  test("a lock on a parameter of a voice the answer dropped is a lock finding", () => {
    const written = answerWith((a) => {
      a.voices = a.voices.filter((/** @type {any} */ v) => v.id !== "pad");
    });
    const answered = requireGenome(written, "answer");
    const result = applyLocks(answered, locksOn(["reverbDecay", "voices.pad.hold"]), written);
    expect(result).toEqual({
      genome: answered,
      changed: [],
      filled: [],
      findings: [
        {
          path: "$.voices",
          rule: LOCK_RULE,
          message: expect.stringMatching(/voices\.pad\.hold.*keep voice "pad", a pad voice/),
        },
      ],
    });
  });

  test("a lock on a parameter of a voice whose type changed is a lock finding", () => {
    const written = answerWith((a) => {
      const index = a.voices.findIndex((/** @type {any} */ v) => v.id === "pad");
      a.voices[index] = { id: "pad", type: "drone" };
    });
    const result = apply(written, locksOn(["voices.pad.hold"]));
    expect(result.findings).toEqual([
      {
        path: "$.voices[1].type",
        rule: LOCK_RULE,
        message: expect.stringMatching(/voices\.pad\.hold.*keep voice "pad" a pad voice/),
      },
    ]);
  });

  test("locks that leave the answer invalid are lock findings", () => {
    const written = { ...exampleGenome, duration: 60, fadeIn: 45, fadeOut: 10 };
    const result = apply(written, locksOn(["fadeOut"]));
    expect(result.findings).toEqual([
      {
        path: "$.fadeOut",
        rule: LOCK_RULE,
        message: expect.stringMatching(/^with the owner's locks applied: fadeIn \+ fadeOut/),
      },
    ]);
  });

  test("with no answer as written, nothing counts as filled", () => {
    const changed = requireGenome({ ...exampleGenome, reverbDecay: 3 }, "nudged");
    const result = applyLocks(changed, locksOn(["reverbDecay"]));
    expect(result).toEqual({ genome, changed: ["reverbDecay"], filled: [], findings: [] });
  });
});
