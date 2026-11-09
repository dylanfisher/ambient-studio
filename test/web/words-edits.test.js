// What a words answer does to a session card's fields (decision 0085): the values now each set
// sends, the changes that differ from them, the edits a Keep sends and the words that say each
// change, and an Undo that gives back the values before.
import { expect, test } from "vitest";
import { lockChoices } from "../../src/domain/lock-choices.js";
import { directionField } from "../../src/domain/words-sets.js";
import pad from "../../src/engine/genomes/pad.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import {
  applyWords,
  changeLines,
  lockEdits,
  lockValues,
  macroEdits,
  macroValues,
  steerEdits,
} from "../../src/web/words-edits.js";

const genome = requireGenome(pad, "the pad example");
const voice = /** @type {string} */ (genome.voices[0]?.id);

test("applying keeps only the changes that differ, and undoing gives back the values before", () => {
  const current = { a: "free", b: "locked", c: "free" };
  const edit = applyWords(current, { a: "locked", b: "locked" });
  expect(edit.next).toEqual({ a: "locked", b: "locked", c: "free" });
  expect(edit.changed).toEqual([{ field: "a", from: "free", to: "locked" }]);
  expect(edit.before).toEqual(current);
  expect(edit.before).not.toBe(current);
  expect(() => applyWords(current, { d: "locked" })).toThrow(/d/);
});

test("the locks' values now mark each path a live lock holds, and a Keep locks and unlocks", () => {
  const locks = [{ id: 3, path: "reverbDecay" }];
  const now = lockValues(lockChoices(genome), locks);
  expect(now.reverbDecay).toBe("locked");
  expect(now[`voices.${voice}`]).toBe("free");
  const { changed } = applyWords(now, { reverbDecay: "free", [`voices.${voice}`]: "locked" });
  expect(lockEdits(changed, locks)).toEqual({
    unlock: [locks[0]],
    lock: [`voices.${voice}`],
    dropped: [],
  });
  const labels = new Map(
    lockChoices(genome).flatMap(({ choices }) => choices.map(({ path, label }) => [path, label])),
  );
  expect(
    changeLines("locks", changed, { choices: lockChoices(genome), directions: [], locks }),
  ).toEqual([
    `Unlock ${labels.get("reverbDecay")}`,
    `Lock the whole ${voice} voice, every parameter`,
  ]);
});

test("a Keep unlocks first, then locks whole voices, then the rest, and drops a parameter its voice keeps", () => {
  const whole = `voices.${voice}`;
  const param = `voices.${voice}.level`;
  /** @param {Record<string, string>} changes @param {{ id: number, path: string }[]} locks */
  const edits = (changes, locks) => {
    const now = lockValues(lockChoices(genome), locks);
    return lockEdits(applyWords(now, changes).changed, locks);
  };
  // The answer locks the voice's parameter before the whole voice.
  expect(edits({ [param]: "locked", [whole]: "locked", reverbDecay: "locked" }, [])).toEqual({
    unlock: [],
    lock: [whole, "reverbDecay"],
    dropped: [{ path: param, voice }],
  });
  // The voice is already locked whole, and its parameter shows as free.
  const held = [{ id: 7, path: whole }];
  expect(edits({ [param]: "locked" }, held)).toEqual({
    unlock: [],
    lock: [],
    dropped: [{ path: param, voice }],
  });
  // The voice is unlocked whole and one parameter locked: the unlock goes first.
  expect(edits({ [param]: "locked", [whole]: "free" }, held)).toEqual({
    unlock: held,
    lock: [param],
    dropped: [],
  });
  const lines = changeLines(
    "locks",
    applyWords(lockValues(lockChoices(genome), held), { [param]: "locked" }).changed,
    { choices: lockChoices(genome), directions: [], locks: held },
  );
  expect(lines).toEqual([
    `Leave ${voice} level as it is: the whole ${voice} voice is locked, which keeps it`,
  ]);
});

test("the macros' values now are the live choices, and a Keep sets or clears each", () => {
  const now = macroValues({ brightness: { id: 1, direction: "more" } });
  expect(now.brightness).toBe("more");
  expect(now.space).toBe("none");
  const { changed } = applyWords(now, { brightness: "none", space: "less" });
  expect(macroEdits(changed)).toEqual([
    { macro: "brightness", direction: null },
    { macro: "space", direction: "less" },
  ]);
  expect(changeLines("macros", changed, { choices: [], directions: [], locks: [] })).toEqual([
    "brightness: no choice",
    "space: less (sound closer and drier)",
  ]);
});

test("a steer's settings go back to their sliders by direction id, said in words", () => {
  const field = directionField(12);
  const { changed } = applyWords({ [field]: 0.5 }, { [field]: 0.9 });
  expect(steerEdits(changed)).toEqual(new Map([[12, 0.9]]));
  expect(
    changeLines("steer", changed, {
      choices: [],
      directions: [{ id: 12, near: "dry", far: "wet" }],
      locks: [],
    }),
  ).toEqual(["Steer aims close to “wet” on “dry” to “wet”"]);
});
