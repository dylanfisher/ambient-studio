// The brief page's attached regions (decision 0052): which regions can be attached, and what
// each attached one says.
import { describe, expect, test } from "vitest";
import { MAX_REFERENCES } from "../../src/domain/attachment-kind.js";
import { attachable, attachedStatus, attachHelp } from "../../src/web/attached-regions.js";

const region = (/** @type {number} */ id) => ({
  id,
  referenceFileId: 1,
  startSeconds: 10,
  endSeconds: 20,
  label: `r${id}`,
  note: "",
});

describe("attachable", () => {
  test("offers the regions not attached yet, and none once the brief holds the most", () => {
    const regions = [region(1), region(2), region(3)];
    expect(attachable(regions, [{ regionId: 2 }]).map((r) => r.id)).toEqual([1, 3]);
    const full = Array.from({ length: MAX_REFERENCES }, (_, i) => ({ regionId: i + 1 }));
    expect(attachable(regions, full)).toEqual([]);
  });
});

describe("attachedStatus", () => {
  test("says what the model is told, or why the studio would stop", () => {
    expect(attachedStatus({ analyzed: true, embedded: true }, -16)).toBe(
      "The model is told its measurements and the words nearest its sound.",
    );
    expect(attachedStatus({ analyzed: true, embedded: false }, -16)).toBe(
      "The model is told its measurements. Its sound isn't analyzed, so no words go with them.",
    );
    expect(attachedStatus({ analyzed: false, embedded: false }, -14)).toBe(
      "Not measured at this brief's loudness, -14 LUFS, so asking for candidates stops with an error. Press Measure, or detach it.",
    );
  });

  test("the help says how many regions a brief takes and that no version is made", () => {
    expect(attachHelp(0)).toMatch(/up to 2/);
    expect(attachHelp(0)).toMatch(/doesn't save a new version/);
    expect(attachHelp(MAX_REFERENCES)).toMatch(/Detach one to attach another/);
  });
});
