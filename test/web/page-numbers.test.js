// Every raw number and number field on a page sits behind its numbers toggle (decision 0083,
// plan WF acceptance 1). The pages' HTML is read as titles.test.js reads it, templates
// included: a part is behind the toggle when it or an element around it carries
// `data-numbers`, or when it is in a template the page clones into such an element. Anything
// else that shows a number is a failure, unless ALLOWED names it with the reason.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { NUMBERS_LABEL, NUMBERS_TITLE } from "../../src/web/numbers-toggle.js";

const PAGES = readdirSync("src/web").filter((name) => name.endsWith(".html"));

/**
 * Parts that show a number though they aren't number fields, by id or `data-part`, beside every
 * `input[type=number]`, `input[type=range]` and `<pre>`, which are listed on every page.
 * @type {Record<string, string[]>}
 */
const SHOWS_NUMBERS = {
  "brief.html": ["constraintBox", "targetBox", "regionBox", "heard"],
  "evaluation.html": [
    "facts",
    "revisionFacts",
    "reportParams",
    "latencyFirst",
    "latencyRepair",
    "latencyTreatment",
    "latencyControl",
    "firstTokenFirst",
    "firstTokenRepair",
    "firstTokenTreatment",
    "firstTokenControl",
    "responseFormat",
    "bases",
    "validBefore",
    "validBeforeRange",
    "validAfter",
    "validAfterRange",
    "schemaBefore",
    "schemaAfter",
    "truncated",
    "failed",
    "summary",
    "made",
    "reportRevisionNumbers",
  ],
  "lineage.html": ["control"],
  "map.html": [
    "coverageLine",
    "controlSwitch",
    "axisAcrossEnds",
    "axisUpEnds",
    "axisLayerEnds",
    "openScore",
    "control",
  ],
  "quick-ab.html": ["earShifts", "value", "progressCount", "leftShare", "rightShare"],
  "references.html": ["regionStart", "regionEnd", "times", "analysis"],
  "session.html": [
    "rankBadge",
    "score",
    "positions",
    "rangesBox",
    "lockPath",
    "lockList",
    "features",
    "control",
    "position",
  ],
  "track.html": ["sectionTimes", "fadeLine", "pointLine", "renderLoudness", "eliteNumbers"],
};

/**
 * The parts a page clones a template into, by template id: its copies are behind the toggle
 * when each of these is.
 * @type {Record<string, Record<string, string[]>>}
 */
const CLONED_INTO = {
  "brief.html": {
    "number-field": ["constraintBox"],
    "range-field": ["constraintBox", "targetBox"],
  },
  "quick-ab.html": { "shift-slider": ["earShifts"] },
  "session.html": { "steer-slider": ["sliders"] },
};

/** Parts left outside the toggle on purpose, by page and id or `data-part`, with why. */
const ALLOWED = {
  "brief.html": {
    constraints:
      "An earlier version's rules and ranges stay in its own disclosure, written by constraintsText and targetsText.",
  },
};

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

/** @param {string} page */
const html = (page) => readFileSync(`src/web/${page}`, "utf8").replace(/<!--[\s\S]*?-->/g, "");

/**
 * @param {string} attributes
 * @param {string} name
 */
const attribute = (attributes, name) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;

/**
 * @typedef {object} Part
 * @property {string} tag
 * @property {string} attributes
 * @property {string | null} key its id, or its `data-part`
 * @property {boolean} marked it or an element around it carries `data-numbers`
 * @property {string | null} template the id of the template it is in
 */

/**
 * Every element of a page, in order, with what surrounds it.
 * @param {string} source
 * @returns {Part[]}
 */
function parts(source) {
  /** @type {Part[]} */
  const open = [];
  /** @type {Part[]} */
  const all = [];
  for (const [, closing, name = "", attributes = ""] of source.matchAll(TAG)) {
    const tag = name.toLowerCase();
    if (closing) {
      const at = open.findLastIndex((part) => part.tag === tag);
      if (at === -1) throw new Error(`</${tag}> closes nothing`);
      open.length = at;
      continue;
    }
    const around = open.at(-1);
    const part = {
      tag,
      attributes,
      key: attribute(attributes, "id") ?? attribute(attributes, "data-part"),
      marked: /\sdata-numbers(?![\w-])/.test(attributes) || (around?.marked ?? false),
      template: tag === "template" ? attribute(attributes, "id") : (around?.template ?? null),
    };
    all.push(part);
    if (!VOID.has(tag) && !attributes.endsWith("/")) open.push(part);
  }
  return all;
}

/**
 * @param {Part} part
 * @param {string[]} named
 */
const showsNumbers = (part, named) =>
  (part.tag === "input" && /^(number|range)$/.test(attribute(part.attributes, "type") ?? "")) ||
  part.tag === "pre" ||
  (part.key !== null && named.includes(part.key));

/**
 * @param {string} page
 * @param {Part[]} all
 * @param {Part} part
 * @returns {boolean}
 */
function behindToggle(page, all, part) {
  if (part.marked) return true;
  if (part.template === null) return false;
  const into = CLONED_INTO[page]?.[part.template] ?? [];
  if (into.length === 0) return false;
  return into.every((key) => {
    const container = all.find((candidate) => candidate.key === key);
    if (container === undefined) throw new Error(`${page} has no #${key} to clone into`);
    return behindToggle(page, all, container);
  });
}

/** @param {string} page */
const outside = (page) => {
  const all = parts(html(page));
  const named = SHOWS_NUMBERS[page] ?? [];
  return all
    .filter((part) => showsNumbers(part, named) && !behindToggle(page, all, part))
    .map((part) => part.key ?? `<${part.tag}${part.attributes}>`);
};

describe.each(PAGES)("%s", (page) => {
  test("shows no number outside the numbers toggle but those allowed", () => {
    const allowed = Object.keys(ALLOWED[/** @type {keyof typeof ALLOWED} */ (page)] ?? {});
    expect(outside(page).filter((key) => !allowed.includes(key))).toEqual([]);
  });

  test("allows only what is outside the toggle, each with a reason", () => {
    const allowed = ALLOWED[/** @type {keyof typeof ALLOWED} */ (page)] ?? {};
    const found = outside(page);
    for (const [key, reason] of Object.entries(allowed)) {
      expect(found, `${page} allows ${key}`).toContain(key);
      expect(reason.length, key).toBeGreaterThan(20);
    }
  });

  test("names only parts it has", () => {
    const keys = new Set(parts(html(page)).map((part) => part.key));
    for (const key of SHOWS_NUMBERS[page] ?? [])
      expect(keys.has(key), `${page}: ${key}`).toBe(true);
  });

  test("has the toggle, closed, exactly when it has something behind it, and starts it", () => {
    const all = parts(html(page));
    const buttons = all.filter((part) => part.key === "numbersToggle");
    const marked = all.some((part) => /\sdata-numbers(?![\w-])/.test(part.attributes));
    expect(buttons, page).toHaveLength(marked ? 1 : 0);
    if (!marked) return;
    const [button] = buttons;
    expect(button?.tag).toBe("button");
    expect(attribute(button?.attributes ?? "", "aria-expanded")).toBe("false");
    expect(attribute(button?.attributes ?? "", "title")).toBe(NUMBERS_TITLE);
    expect(html(page)).toMatch(
      new RegExp(`id="numbersToggle"[^>]*>${NUMBERS_LABEL.closed}</button>`),
    );
    const entry = /<script\s+type="module"\s+src="\.\/([^"]+)"/.exec(html(page))?.[1] ?? "";
    expect(readFileSync(`src/web/${entry}`, "utf8")).toContain(`pageNumbers("${page}")`);
  });
});

test("the track page's lane points can be added and removed with the toggle closed", () => {
  const all = parts(html("track.html"));
  for (const key of ["addPoint", "removePoint", "laneWords"]) {
    const part = all.find((each) => each.key === key);
    expect(part?.marked, key).toBe(false);
  }
});
