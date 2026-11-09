// The candidate's field sets for words (decision 0085): its locks, its Less / More choices and
// where a steer from it aims, each built from what the route reads, and each set's largest first
// prompt held under half the context budget, the locks narrowed until it fits.
import { expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { MAX_DIRECTIONS } from "../../src/domain/attachment-kind.js";
import { lockChoices } from "../../src/domain/lock-choices.js";
import { macroWords } from "../../src/domain/macro-words.js";
import { CHARS_PER_TOKEN, estimateTokens, promptText } from "../../src/domain/prompt-tokens.js";
import { SKETCH_READING_TOKENS } from "../../src/domain/sketch-reading.js";
import { fitWordsPrompt, WORDS_CHARS } from "../../src/domain/words-prompt.js";
import {
  directionField,
  LOCK_STATE,
  MACRO_NONE,
  WORDS_SCOPE,
  WORDS_SETS,
} from "../../src/domain/words-sets.js";
import { MACROS } from "../../src/engine/genome-schema.js";
import pad from "../../src/engine/genomes/pad.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { MAX_CHARS } from "../../src/server/request-fields.js";
import { worstGenome } from "../support/worst-genome.js";

const BUDGET = example.queue.contextBudgetTokens / 2;
const genome = requireGenome(pad, "the pad example");

test("the locks set has one field per lockable path, locked or free, and narrows voice by voice", () => {
  const { locks } = WORDS_SETS;
  expect(locks.scope).toBe(WORDS_SCOPE.candidate);
  const fields = locks.fields({ genome });
  const paths = lockChoices(genome).flatMap(({ choices }) => choices.map(({ path }) => path));
  expect(Object.keys(fields)).toEqual(paths);
  for (const descriptor of Object.values(fields)) {
    expect(descriptor).toMatchObject({ kind: "enum", values: Object.values(LOCK_STATE) });
  }
  const voice = /** @type {string} */ (genome.voices.at(-1)?.id);
  const narrower = /** @type {any} */ (locks.narrower({ genome }));
  const fewer = Object.keys(locks.fields(narrower));
  expect(fewer).toContain(`voices.${voice}`);
  expect(fewer.some((path) => path.startsWith(`voices.${voice}.`))).toBe(false);
  expect(locks.narrower({ genome, voicesWithParams: 0 })).toBeNull();
  expect(() => locks.fields({})).toThrow(/needs a genome/);
});

test("the macros set has every macro, less, none or more, in the macro's own words", () => {
  const fields = WORDS_SETS.macros.fields();
  expect(Object.keys(fields)).toEqual(Object.keys(MACROS));
  const { less, more } = macroWords("brightness");
  expect(fields.brightness).toMatchObject({
    values: ["less", MACRO_NONE, "more"],
    description: `less is ${less}, more is ${more}`,
  });
});

test("the steer set has a field per direction from 0 to 1, named by its id", () => {
  const fields = WORDS_SETS.steer.fields({
    directions: [
      { id: 4, near: "dry", far: "wet" },
      { id: 9, near: null, far: "bells" },
    ],
  });
  expect(Object.keys(fields)).toEqual([directionField(4), directionField(9)]);
  expect(fields[directionField(9)]).toMatchObject({
    min: 0,
    max: 1,
    description: "from the brief's description at 0 to “bells” at 1",
  });
});

/** The rest of a first prompt with every text at its limit and a full reading. */
const FULL = Object.freeze({
  words: "w".repeat(WORDS_CHARS),
  brief: "b".repeat(MAX_CHARS.brief),
  reading: ["r".repeat(SKETCH_READING_TOKENS * CHARS_PER_TOKEN)],
});

/**
 * Every field's value now, each its descriptor's default.
 * @param {Readonly<Record<string, import("../../src/engine/descriptor.js").Descriptor>>} fields
 */
const defaults = (fields) =>
  Object.fromEntries(
    Object.entries(fields).map(([name, d]) => [name, /** @type {any} */ (d).default]),
  );

test("each set's largest first prompt fits half the context budget, the locks narrowed to fit", () => {
  const worst = worstGenome();
  const directions = Array.from({ length: MAX_DIRECTIONS }, (_, i) => ({
    id: 1000 + i,
    near: "n".repeat(100),
    far: "f".repeat(100),
  }));
  /** @type {Record<string, number>} */
  const sizes = {};
  for (const [name, context] of /** @type {const} */ ([
    ["locks", { genome: worst }],
    ["macros", {}],
    ["steer", { directions }],
  ])) {
    const set = WORDS_SETS[name];
    const current = defaults(set.fields(context));
    const { messages, fields } = fitWordsPrompt({ ...FULL, set, context, current }, BUDGET);
    sizes[name] = estimateTokens(promptText(messages));
    expect(sizes[name], name).toBeLessThanOrEqual(BUDGET);
    for (const field of fields) expect(field.current).toBe(current[field.name]);
  }
  // A full 16-voice genome can't list every parameter: the whole voices stay.
  const { fields } = fitWordsPrompt(
    {
      ...FULL,
      set: WORDS_SETS.locks,
      context: { genome: worst },
      current: defaults(WORDS_SETS.locks.fields({ genome: worst })),
    },
    BUDGET,
  );
  for (const voice of worst.voices)
    expect(fields.map((f) => f.name)).toContain(`voices.${voice.id}`);
  expect(sizes).toEqual({
    locks: expect.any(Number),
    macros: expect.any(Number),
    steer: expect.any(Number),
  });
});

test("the pad example lists every parameter of every voice under the budget", () => {
  const set = WORDS_SETS.locks;
  const all = set.fields({ genome });
  const { fields } = fitWordsPrompt(
    { ...FULL, set, context: { genome }, current: defaults(all) },
    BUDGET,
  );
  expect(fields.map((f) => f.name)).toEqual(Object.keys(all));
});

test("a set with nothing narrower over the budget throws", () => {
  const set = WORDS_SETS.macros;
  expect(() =>
    fitWordsPrompt({ ...FULL, set, context: {}, current: defaults(set.fields()) }, 1000),
  ).toThrow(/over its 1000-token budget/);
});
