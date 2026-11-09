// The track page's words controller (decision 0087), with no DOM: a fake host holds the
// timeline, and fake parts stand in for the fields and buttons. An answer fills the timeline
// unsaved; Keep keeps it, Undo puts the timeline back, another edit counts as Keep, and an
// answer that comes back after the timeline changed fills nothing. The select is rebuilt only
// when its choices change.
/** @import { Arrangement } from "../../src/domain/arrangement-schema.js" */
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { wordsController } from "../../src/web/track-words.js";

const TRACK = /** @type {Arrangement} */ (
  Object.freeze({
    ...emptyArrangement(),
    sections: [1, 2].map((sketchId) => ({
      sketchId,
      offset: 0,
      seconds: 120,
      text: "",
      developmentId: null,
    })),
    transitions: [{ kind: "crossfade", seconds: 8, text: "" }],
  })
);

/** A button, an input and a select as the controller reads and writes them. */
const button = () => ({ disabled: false, title: "idle", onclick: /** @type {any} */ (null) });

/**
 * A page with the controller on it, and what it said and showed.
 * @param {(body: any) => Promise<any>} answer the words job's run, given its body
 */
function page(answer) {
  /** @type {Arrangement} */
  let draft = TRACK;
  /** @type {string[]} */
  const said = [];
  /** @type {any[]} */
  const shown = [];
  /** @type {string[]} */
  const closed = [];
  /** @type {string[][]} */
  const optioned = [];
  const parts = {
    section: { input: { value: "" }, button: button() },
    lane: { input: { value: "" }, button: button() },
    select: { value: "" },
  };
  const host = {
    status: {
      run: (/** @type {() => any} */ action) => action(),
      say: (/** @type {string} */ text) => said.push(text),
    },
    trackId: 3,
    vibeId: () => 1,
    draft: () => draft,
    selected: () => 0,
    lane: () => /** @type {const} */ ("brightness"),
    edit: (/** @type {Arrangement} */ next) => {
      words.edited(next);
      draft = next;
    },
    checked: () => /** @type {const} */ ({ ok: true }),
    draw: () => words.draw(true),
  };
  const words = wordsController(host, parts, {
    run: (_area, body) => answer(body),
    show: (area, text, lines, actions) => shown.push({ area, text, lines, ...actions }),
    close: (area) => closed.push(area),
    options: (choices) => {
      optioned.push(choices.map(({ value }) => value));
      parts.select.value = choices[0]?.value ?? "";
    },
  });
  return {
    words,
    parts,
    said,
    shown,
    closed,
    optioned,
    draft: () => draft,
    /** @param {Arrangement} next */
    set: (next) => {
      draft = next;
    },
  };
}

/** @param {unknown} changes */
const done = (changes) => Promise.resolve({ result: { changes, said: "Longer." }, refused: null });

/** Asks the section's length in words on `at`. */
async function askLength(/** @type {ReturnType<typeof page>} */ at) {
  at.words.draw(true);
  at.parts.select.value = "length";
  at.parts.section.input.value = "much longer";
  await at.parts.section.button.onclick();
}

test("an answer fills the timeline unsaved, and Keep keeps it and empties the field", async () => {
  /** @type {any} */
  let body = null;
  const at = page((sent) => {
    body = sent;
    return done({ seconds: 200 });
  });
  await askLength(at);
  expect(body).toEqual({
    set: "length",
    words: "much longer",
    trackId: 3,
    arrangement: TRACK,
    target: 0,
  });
  expect(at.draft().sections[0]?.seconds).toBe(200);
  expect(at.shown).toHaveLength(1);
  expect(at.shown[0].lines).toEqual(["Section 1 plays for 3:20 instead of 2:00."]);
  expect(at.parts.section.button.disabled).toBe(true);
  at.shown[0].keep();
  expect(at.draft().sections[0]?.seconds).toBe(200);
  expect(at.closed).toEqual(["section"]);
  expect(at.parts.section.input.value).toBe("");
  expect(at.parts.section.button.disabled).toBe(false);
});

test("Undo puts the timeline back as it was", async () => {
  const at = page(() => done({ seconds: 200 }));
  await askLength(at);
  at.shown[0].undo();
  expect(at.draft()).toBe(TRACK);
  expect(at.closed).toEqual(["section"]);
});

test("another edit while the answer is open keeps it, and Undo no longer reaches it", async () => {
  const at = page(() => done({ seconds: 200 }));
  await askLength(at);
  const filled = at.draft();
  const moved = { ...filled, arc: "slow" };
  at.words.edited(moved);
  at.set(moved);
  expect(at.closed).toEqual(["section"]);
  expect(at.said.at(-1)).toMatch(/^Kept the words' change/);
  at.shown[0].undo();
  expect(at.draft()).toBe(moved);
});

test("an answer that comes back after the timeline changed fills nothing", async () => {
  /** @type {(value: any) => void} */
  let release = () => undefined;
  const at = page(() => new Promise((resolve) => (release = resolve)));
  at.words.draw(true);
  at.parts.select.value = "length";
  at.parts.section.input.value = "much longer";
  const asked = at.parts.section.button.onclick();
  const changed = { ...TRACK, arc: "slow" };
  at.set(changed);
  release({ result: { changes: { seconds: 200 }, said: "Longer." }, refused: null });
  await asked;
  expect(at.draft()).toBe(changed);
  expect(at.shown).toEqual([]);
  expect(at.said.at(-1)).toMatch(/^The timeline changed while the model read your words/);
});

test("the select is rebuilt only when its choices change", () => {
  const at = page(() => done({}));
  at.words.draw(true);
  at.words.draw(true);
  expect(at.optioned).toEqual([["length", "transition"]]);
  at.set({ ...TRACK, sections: TRACK.sections.slice(0, 1), transitions: [] });
  at.words.draw(true);
  expect(at.optioned).toEqual([["length", "transition"], ["length"]]);
});
