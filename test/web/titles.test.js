// Every control on every page says what it does in a title (decision 0032): the pages' HTML,
// templates included, and the titles the modules set on what they build.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MACROS } from "../../src/engine/genome-schema.js";
import { constraintFields, fieldTitle } from "../../src/web/constraint-fields.js";
import { jobControl } from "../../src/web/job-control.js";
import { macroTitles } from "../../src/web/macro-words.js";

const PAGES = readdirSync("src/web").filter((name) => name.endsWith(".html"));
const INTERACTIVE = /<(a|button|input|select|textarea|summary|audio)\b([^>]*)>/g;

/** @param {string} page */
const html = (page) => readFileSync(`src/web/${page}`, "utf8").replace(/<!--[\s\S]*?-->/g, "");

/** @param {string} text */
const isSentence = (text) => /^[A-Z].{19,}[.?]$/s.test(text.trim());

describe.each(PAGES)("%s", (page) => {
  test("every link, button, field, summary and player has a title of a full sentence", () => {
    const tags = [...html(page).matchAll(INTERACTIVE)];
    expect(tags.length).toBeGreaterThan(0);
    for (const [tag, , attributes] of tags) {
      const title = /\stitle="([^"]*)"/.exec(attributes ?? "")?.[1] ?? "";
      expect(isSentence(title), `${page}: ${tag}`).toBe(true);
    }
  });

  test("says brief, never vibe, in what the owner reads", () => {
    const shown = html(page)
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]*?\s(?:title|placeholder|aria-label)="([^"]*)"[^>]*>/g, " $1 ")
      .replace(/<[^>]*>/g, " ");
    expect(shown, page).not.toMatch(/vibe/i);
  });

  test("starts with a short help paragraph", () => {
    expect(html(page), page).toMatch(/<p class="help[^"]*"[^>]*>\s*\S/);
  });
});

describe("titles the modules set", () => {
  test("each constraint field's title says what it limits", () => {
    for (const field of constraintFields()) {
      expect(isSentence(fieldTitle(field)), field.name).toBe(true);
    }
  });

  test("each macro's three choices have a title", () => {
    for (const macro of Object.keys(MACROS)) {
      const titles = macroTitles(macro);
      for (const title of [titles.less, titles.clear, titles.more]) {
        expect(isSentence(title), macro).toBe(true);
      }
    }
  });

  test("a job button's title says why it is off while its job runs", () => {
    const button = { disabled: false, title: "Starts a job for the test page." };
    const control = jobControl(button);
    control.hold({ id: 7, kind: "candidates" });
    expect(button.disabled).toBe(true);
    expect(isSentence(button.title)).toBe(true);
    expect(button.title).toMatch(/job 7/);
    control.release();
    expect(button).toEqual({ disabled: false, title: "Starts a job for the test page." });
  });
});
