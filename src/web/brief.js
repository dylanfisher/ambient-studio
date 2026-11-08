// The brief page (decisions 0028, 0032, 0034, 0051, 0052 and 0058): the name, the description, a
// rules form built from 2b's table and a ranges form built from 3b's, which a reference region
// can fill, saved as a new revision; the brief's sessions, notes, attached regions, breeding of
// two sketches, ratings and revisions. With no `id` in
// the query it makes a new brief. A brief is a vibe in the API and the store, and its
// description is the vibe's `brief` field.
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { FeatureRanges, SoftTargets } from "../domain/target-schema.js" */
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { ConstraintField } from "./constraint-fields.js" */
/** @import { TargetField } from "./target-fields.js" */
import { ATTACHMENT_KIND, MAX_DIRECTIONS } from "../domain/attachment-kind.js";
import { breedCostText } from "../domain/breed-cost.js";
import { DEFAULT_BREEDS } from "../domain/breed-settings.js";
import { FORM } from "../domain/constraint-schema.js";
import { constraintsText } from "../domain/constraints-text.js";
import { rangesFromRegion } from "../domain/ranges-from-region.js";
import { MACRO_DIRECTIONS } from "../domain/rating-values.js";
import { RANGE_ENDS } from "../domain/target-schema.js";
import { targetsText } from "../domain/targets-text.js";
import { validateConstraints } from "../domain/validate-constraints.js";
import { validateTargets } from "../domain/validate-targets.js";
import {
  ApiError,
  attachmentPath,
  BREED_ESTIMATE_PATH,
  getJson,
  postJson,
  REGIONS_PATH,
  regionPath,
  sessionPath,
  VIBES_PATH,
} from "./api.js";
import { attachable, attachedStatus, attachHelp } from "./attached-regions.js";
import { cloneTemplate } from "./clone-template.js";
import {
  constraintFields,
  fieldTitle,
  fieldValues,
  rangeInput,
  readConstraints,
} from "./constraint-fields.js";
import { directionHelp, directionText } from "./direction-text.js";
import { elementsById } from "./element-by-id.js";
import { formatTime } from "./format-time.js";
import { oneAtATime } from "./one-at-a-time.js";
import { outcomeText } from "./outcome-text.js";
import { runAnalysis } from "./region-analysis.js";
import { rangeFill, regionChoiceText } from "./region-ranges.js";
import { statusLine } from "./status-line.js";
import {
  keptTargets,
  readTargets,
  targetFields,
  targetInput,
  targetTitle,
  targetValues,
} from "./target-fields.js";

const [MORE] = MACRO_DIRECTIONS;
/** The form controls the constraint fields are made of. */
const CONTROLS = "input, select";

const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  draft: HTMLFormElement,
  briefName: HTMLInputElement,
  briefDescription: HTMLTextAreaElement,
  constraintBox: HTMLElement,
  constraintsText: HTMLElement,
  targetBox: HTMLElement,
  targetsText: HTMLElement,
  regionBox: HTMLElement,
  regionSelect: HTMLSelectElement,
  regionRangesButton: HTMLButtonElement,
  keptBox: HTMLElement,
  keptTargets: HTMLElement,
  draftErrors: HTMLUListElement,
  saveButton: HTMLButtonElement,
  savedOnly: HTMLElement,
  startButton: HTMLButtonElement,
  noteButton: HTMLButtonElement,
  sessionList: HTMLUListElement,
  lineageLink: HTMLAnchorElement,
  noteList: HTMLUListElement,
  noteForm: HTMLFormElement,
  noteText: HTMLTextAreaElement,
  attachedList: HTMLUListElement,
  attachedHelp: HTMLElement,
  attachSelect: HTMLSelectElement,
  attachButton: HTMLButtonElement,
  directionList: HTMLUListElement,
  directionHelp: HTMLElement,
  nearInput: HTMLInputElement,
  farInput: HTMLInputElement,
  directionButton: HTMLButtonElement,
  parentA: HTMLSelectElement,
  parentB: HTMLSelectElement,
  breedButton: HTMLButtonElement,
  breedHelp: HTMLElement,
  ratingList: HTMLUListElement,
  noRatings: HTMLElement,
  revisionList: HTMLUListElement,
  likedText: HTMLElement,
});
const idText = new URLSearchParams(location.search).get("id");
const vibeId = idText === null ? null : Number(idText);
/** The loaded revision's soft targets, whose keys other than the ranges a save keeps. */
let savedTargets = {};
/** Each range field's line saying what is saved now, shown once a region fills the form. */
const savedLines = /** @type {Map<string, HTMLElement>} */ (new Map());

/**
 * The label's text for a field: its kind, what it constrains, and the range it may take.
 * @param {ConstraintField} field
 */
function labelText({ name, description, min, max, unit }) {
  const range = min === null ? "" : `, ${min} to ${max}${unit ? ` ${unit}` : ""}`;
  return `${name} (${description}${range})`;
}

/**
 * @param {HTMLInputElement} input
 * @param {ConstraintField} field
 */
function numberInput(input, { min, max, step }) {
  if (min !== null) input.min = String(min);
  if (max !== null) input.max = String(max);
  input.step = step;
}

/** @param {ConstraintField} field */
function fieldElement(field) {
  if (field.form === FORM.voices) {
    const box = cloneTemplate("voices-field", { label: HTMLElement, options: HTMLElement });
    box.label.textContent = labelText(field);
    box.options.replaceChildren(
      ...(field.options ?? []).map((type) => {
        const option = cloneTemplate("voice-option", {
          input: HTMLInputElement,
          type: HTMLElement,
        });
        option.input.name = field.name;
        option.input.value = type;
        option.input.title = fieldTitle(field);
        option.type.textContent = type;
        return option.root;
      }),
    );
    return box.root;
  }
  if (field.form === FORM.range) {
    const box = cloneTemplate("range-field", {
      label: HTMLElement,
      min: HTMLInputElement,
      max: HTMLInputElement,
    });
    box.label.textContent = labelText(field);
    for (const end of /** @type {const} */ (["min", "max"])) {
      box[end].name = rangeInput(field.name, end);
      box[end].title =
        `${end === "min" ? "The lowest end" : "The highest end"}. ${fieldTitle(field)}`;
      numberInput(box[end], field);
    }
    return box.root;
  }
  if (field.options) {
    const box = cloneTemplate("choice-field", { label: HTMLElement, input: HTMLSelectElement });
    box.input.name = field.name;
    box.input.title = fieldTitle(field);
    for (const value of field.options) box.input.add(new Option(value, value));
    box.label.textContent = labelText(field);
    return box.root;
  }
  const box = cloneTemplate("number-field", { label: HTMLElement, input: HTMLInputElement });
  box.input.name = field.name;
  box.input.title = fieldTitle(field);
  numberInput(box.input, field);
  box.label.textContent = labelText(field);
  return box.root;
}

/** @param {TargetField} field */
function targetElement(field) {
  const box = cloneTemplate("range-field", {
    label: HTMLElement,
    min: HTMLInputElement,
    max: HTMLInputElement,
  });
  box.label.textContent = `${field.label} (${field.unit ?? "a share from 0 to 1"})`;
  const inputs = [box.min, box.max];
  for (const [i, end] of RANGE_ENDS.entries()) {
    const input = /** @type {HTMLInputElement} */ (inputs[i]);
    input.name = targetInput(field.name, end);
    input.title = targetTitle(field, end);
    input.min = String(field.least);
    if (field.most !== null) input.max = String(field.most);
    input.step = "any";
  }
  const saved = document.createElement("p");
  saved.className = "small muted";
  saved.hidden = true;
  box.root.append(saved);
  savedLines.set(field.name, saved);
  return box.root;
}

/** @param {Readonly<Record<string, unknown>>} constraints */
function fillConstraints(constraints) {
  const values = fieldValues(constraints);
  for (const control of page.constraintBox.querySelectorAll(CONTROLS)) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) continue;
    const value = values[control.name];
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      control.checked = Array.isArray(value) && value.includes(control.value);
    } else {
      control.value = Array.isArray(value) ? "" : (value ?? "");
    }
  }
}

/** @param {ValidationError[]} errors */
const errorList = (errors) => errors.map((e) => `${e.path}: ${e.message}`).join("; ");

/**
 * Fills the ranges form and lists the other saved keys. Throws when the saved ranges don't
 * validate, which only a version saved before ranges were checked can hold; the form is then
 * left empty, and saving replaces them.
 * @param {Readonly<Record<string, unknown>>} softTargets
 */
function fillTargets(softTargets) {
  const checked = validateTargets(softTargets);
  const values = targetValues(checked.ok ? checked.ranges : {});
  for (const input of page.targetBox.querySelectorAll("input")) {
    input.value = values[input.name] ?? "";
  }
  for (const line of savedLines.values()) line.hidden = true;
  const kept = keptTargets(softTargets);
  page.keptBox.hidden = Object.keys(kept).length === 0;
  page.keptTargets.textContent = JSON.stringify(kept, null, 2);
  if (!checked.ok) {
    throw new Error(
      `This version's saved ranges are invalid, so the form shows none, and saving replaces them: ${errorList(checked.errors)}`,
    );
  }
}

/**
 * The form's rules and ranges, checked: both, or null with every error shown.
 * @returns {{ constraints: Constraints, softTargets: SoftTargets } | null}
 */
function checkedForm() {
  const data = new FormData(page.draft);
  const get = (/** @type {string} */ name) => String(data.get(name) ?? "");
  const rules = validateConstraints(readConstraints(get, (name) => data.getAll(name).map(String)));
  const targets = validateTargets(readTargets(get, savedTargets));
  const errors = [
    ...(rules.ok ? [] : rules.errors),
    ...(targets.ok ? [] : targets.errors.map((e) => ({ ...e, path: `ranges ${e.path}` }))),
  ];
  page.draftErrors.replaceChildren(
    ...errors.map((error) => {
      const item = document.createElement("li");
      item.textContent = `${error.path}: ${error.message}`;
      return item;
    }),
  );
  page.constraintsText.textContent = rules.ok
    ? `What the model is told: ${constraintsText(rules.constraints)}`
    : "";
  const told = targets.ok ? targetsText(targets.ranges) : "";
  page.targetsText.textContent = told === "" ? "" : `What the model is told: ${told}`;
  if (!rules.ok || !targets.ok) return null;
  return { constraints: rules.constraints, softTargets: targets.softTargets };
}

/** The form as the draft a create or revision route takes. */
function readDraft() {
  const checked = checkedForm();
  if (checked === null) {
    throw new Error("The rules or ranges have errors; see the list above Save.");
  }
  return { name: page.briefName.value, brief: page.briefDescription.value, ...checked };
}

/**
 * @param {string} text
 * @param {number} at
 */
function lineItem(text, at) {
  const item = cloneTemplate("line-item", { line: HTMLElement, time: HTMLElement });
  item.line.textContent = text;
  item.time.textContent = ` · ${formatTime(at)}`;
  return item.root;
}

/** @param {number} fraction */
const percent = (fraction) => `${Math.round(fraction * 100)}%`;

/** @param {any} side */
const heard = (side) => `genome ${side.genomeId} seed ${side.seed}`;

/**
 * A sketch's notes and tags as its line reads them, or nothing when it has neither.
 * @param {{ notes: string, tags: string[] }} sketch
 */
function sketchWords({ notes, tags }) {
  return `${notes ? `: “${notes}”` : ""}${tags.length > 0 ? ` [${tags.join(", ")}]` : ""}`;
}

/**
 * Fills the two parent choosers with the live sketches, newest first, parent A on the newest
 * and parent B on the one before it. A removed sketch isn't listed, so it can't be picked.
 * @param {any[]} sketches oldest first, as the ratings route lists them
 */
function showSketches(sketches) {
  const newest = [...sketches].reverse();
  for (const [select, chosen] of [
    [page.parentA, newest[0]],
    [page.parentB, newest[1]],
  ]) {
    select.replaceChildren(
      ...newest.map(
        (row) =>
          new Option(`Sketch ${row.id}: candidate ${row.candidateId}${sketchWords(row)}`, row.id),
      ),
    );
    if (chosen) select.value = String(chosen.id);
  }
  const enough = sketches.length >= 2;
  page.breedButton.disabled = !enough;
  page.breedHelp.textContent = enough
    ? ""
    : `Keep ${sketches.length === 0 ? "two sketches" : "one more sketch"} on a session page first: press Keep as sketch on a candidate's row.`;
}

/** @param {{ ratings: any[], feedback: any[], sketches: any[] }} rows */
function showRatings({ ratings, feedback, sketches }) {
  const items = [
    ...feedback.map((row) => {
      const what =
        row.macro === null
          ? `Thumbs ${row.direction}${row.note ? `: “${row.note}”` : ""}`
          : `${row.direction === MORE ? "More" : "Less"} ${row.macro} (heard ${row.macroValue.mean.toFixed(2)})`;
      const how = `played ${percent(row.playedFraction)} in ${(row.timeTakenMs / 1000).toFixed(1)} s`;
      return { at: row.createdAt, text: `${what}, ${heard(row)}, ${how}` };
    }),
    ...ratings.map((row) => {
      const [left, right] = row.leftSide === "a" ? [row.a, row.b] : [row.b, row.a];
      return {
        at: row.createdAt,
        text: `Compared ${heard(left)} (left) with ${heard(right)} (right): ${outcomeText(row)}`,
      };
    }),
    ...sketches.map((row) => ({
      at: row.createdAt,
      text: `Sketch of candidate ${row.candidateId}${sketchWords(row)}`,
    })),
  ].sort((x, y) => y.at - x.at);
  page.ratingList.replaceChildren(...items.map(({ at, text }) => lineItem(text, at)));
  page.noRatings.hidden = items.length > 0;
}

/**
 * Fills "What you like" from the taste model (decision 0047). Apart from the rest of the page,
 * since the server may start the sidecar to answer, and a failure there is shown in its place.
 * @param {number} id
 */
async function showLiked(id) {
  page.likedText.textContent = "Reading the taste model…";
  try {
    const { text } = await getJson(`${VIBES_PATH}/${id}/preference`);
    page.likedText.textContent = text;
  } catch (error) {
    page.likedText.textContent = `Couldn't read the taste model: ${/** @type {Error} */ (error).message}`;
  }
}

/** @param {number} id */
async function load(id) {
  const [vibe, { revisions }, ratings] = await Promise.all([
    getJson(`${VIBES_PATH}/${id}`),
    getJson(`${VIBES_PATH}/${id}/revisions`),
    getJson(`${VIBES_PATH}/${id}/ratings`),
  ]);
  const { revision } = vibe;
  page.lineageLink.href = `./lineage.html?id=${id}`;
  document.title = `${revision.name} · Ambient Studio`;
  page.pageTitle.textContent = revision.name;
  page.briefName.value = revision.name;
  page.briefDescription.value = revision.brief;
  savedTargets = revision.softTargets;
  fillConstraints(revision.constraints);

  page.sessionList.replaceChildren(
    ...[...vibe.sessions].reverse().map((/** @type {any} */ session) => {
      const item = cloneTemplate("session-item", {
        link: HTMLAnchorElement,
        state: HTMLElement,
        time: HTMLElement,
      });
      const open = session.stoppedAt === null;
      item.link.href = `./session.html?id=${session.id}`;
      item.link.textContent = `Session ${session.id}`;
      item.link.title = `Opens session ${session.id}, to listen to and rate its candidates${open ? " or ask for more" : ""}.`;
      item.state.textContent = open ? "Open" : "Stopped";
      item.state.classList.toggle("muted", !open);
      item.time.textContent =
        ` started ${formatTime(session.startedAt)}` +
        (open ? "" : `, stopped ${formatTime(session.stoppedAt)}`);
      return item.root;
    }),
  );
  page.noteList.replaceChildren(
    ...vibe.notes.map((/** @type {any} */ note) => lineItem(note.text, note.createdAt)),
  );
  showRatings(ratings);
  showSketches(ratings.sketches);
  void showLiked(id);
  page.revisionList.replaceChildren(
    ...[...revisions].reverse().map((/** @type {any} */ row, i) => {
      const item = cloneTemplate("revision-item", {
        summary: HTMLElement,
        description: HTMLElement,
        constraints: HTMLElement,
      });
      item.summary.textContent = `${formatTime(row.createdAt)}: ${row.name}${i === 0 ? " (current)" : ""}`;
      item.description.textContent = row.brief;
      const ranges = validateTargets(row.softTargets);
      const targets = ranges.ok
        ? targetsText(ranges.ranges)
        : `Saved ranges are invalid: ${errorList(ranges.errors)}`;
      item.constraints.textContent = [constraintsText(row.constraints), targets]
        .filter((text) => text !== "")
        .join("\n\n");
      return item.root;
    }),
  );
  await showRegions(id);
  // Last, so a throw over invalid saved ranges leaves the rest of the page filled.
  try {
    fillTargets(revision.softTargets);
  } finally {
    checkedForm();
  }
}

/**
 * Lists every live region in the region chooser, or says there is none, and the regions
 * attached to the brief.
 * @param {number} id the saved brief's
 */
async function showRegions(id) {
  const { references, regions } = await getJson(REGIONS_PATH);
  const chosen = page.regionSelect.value;
  const names = new Map(
    references.map((/** @type {any} */ reference) => [reference.id, reference.fileName]),
  );
  page.regionSelect.replaceChildren(
    ...regions.map(
      (/** @type {any} */ region) =>
        new Option(regionChoiceText(region, names.get(region.referenceFileId)), String(region.id)),
    ),
  );
  if (regions.length === 0) {
    page.regionSelect.add(new Option("No regions yet: mark one on the References page", ""));
  }
  if (regions.some((/** @type {any} */ region) => String(region.id) === chosen)) {
    page.regionSelect.value = chosen;
  }
  page.regionSelect.disabled = regions.length === 0;
  page.regionRangesButton.disabled = regions.length === 0;
  page.regionBox.hidden = false;
  await showAttached(id, regions, names);
}

/**
 * The regions attached to the brief, each with Measure and Detach, and the chooser of the ones
 * it can still attach.
 * @param {number} id the saved brief's
 * @param {any[]} regions every live region
 * @param {Map<unknown, any>} names each recording's file name, by id
 */
async function showAttached(id, regions, names) {
  const {
    target,
    references: attached,
    directions,
  } = await getJson(`${VIBES_PATH}/${id}/attachments`);
  showDirections(directions);
  page.attachedList.replaceChildren(
    ...attached.map((/** @type {any} */ row) => {
      const item = cloneTemplate("attached-item", {
        line: HTMLElement,
        status: HTMLElement,
        measure: HTMLButtonElement,
        detach: HTMLButtonElement,
      });
      const text = regionChoiceText(row, row.fileName);
      item.line.textContent = text;
      item.status.textContent = attachedStatus(row, target);
      // One at a time per row, so a double press measures or detaches once.
      const measure = oneAtATime(() => measureAttached(row.regionId, text));
      const detachThis = oneAtATime(() => detach(row.id, text));
      item.measure.onclick = () => status.run(measure);
      item.detach.onclick = () => status.run(detachThis);
      return item.root;
    }),
  );
  page.attachedHelp.textContent = attachHelp(attached.length);
  const choices = attachable(regions, attached);
  const chosen = page.attachSelect.value;
  page.attachSelect.replaceChildren(
    ...choices.map(
      (region) =>
        new Option(regionChoiceText(region, names.get(region.referenceFileId)), String(region.id)),
    ),
  );
  if (choices.length === 0) {
    const none =
      regions.length === 0
        ? "No regions yet: mark one on the References page"
        : "No region to attach now";
    page.attachSelect.add(new Option(none, ""));
  }
  if (choices.some((region) => String(region.id) === chosen)) page.attachSelect.value = chosen;
  page.attachSelect.disabled = choices.length === 0;
  page.attachButton.disabled = choices.length === 0;
}

/**
 * The brief's directions (decision 0056), each with Remove.
 * @param {{ id: number, near: string | null, far: string }[]} directions
 */
function showDirections(directions) {
  page.directionList.replaceChildren(
    ...directions.map((direction) => {
      const item = cloneTemplate("direction-item", {
        line: HTMLElement,
        remove: HTMLButtonElement,
      });
      const text = directionText(direction);
      item.line.textContent = `From ${text}`;
      const removeThis = oneAtATime(() => removeDirection(direction.id, text));
      item.remove.onclick = () => status.run(removeThis);
      return item.root;
    }),
  );
  page.directionHelp.textContent = directionHelp(directions.length);
  page.directionButton.disabled = directions.length >= MAX_DIRECTIONS;
}

/**
 * The region's measured windows at this brief's saved loudness, measuring them first when
 * they haven't been.
 * @param {number} vibe
 * @param {number} regionId
 */
async function regionWindows(vibe, regionId) {
  const path = `${regionPath(regionId)}/analysis?vibeId=${vibe}`;
  const { analysis, target } = await getJson(path);
  if (analysis) return analysis.windows;
  status.say(`Measuring the region at this brief's loudness, ${target} LUFS…`);
  await runAnalysis(regionId, vibe, (step) => status.say(step));
  const measured = await getJson(path);
  if (!measured.analysis)
    throw new Error("The region was measured, but no measurements were kept.");
  return measured.analysis.windows;
}

/** The saved vibe's id, or an error saying to save it first. */
function savedId() {
  if (vibeId === null) throw new Error("Save the brief first.");
  return vibeId;
}

/** Holds a guarded action until the page it navigated to replaces this one. */
const leaving = () => new Promise(() => {});

// Each is one at a time, so a double press or a held Enter saves once (decision 0028).
const save = oneAtATime(async () => {
  const body = readDraft();
  if (vibeId === null) {
    const vibe = await postJson(VIBES_PATH, body);
    location.assign(`./brief.html?id=${vibe.id}`);
    return leaving();
  }
  await postJson(`${VIBES_PATH}/${vibeId}/revisions`, body);
  await load(vibeId);
  status.say("Saved as a new version.");
});

const addNote = oneAtATime(async () => {
  const id = savedId();
  await postJson(`${VIBES_PATH}/${id}/notes`, { text: page.noteText.value });
  page.noteText.value = "";
  await load(id);
  status.say("Note added.");
});

// Fills the ranges form only; the owner's Save is the one write.
const setRangesFromRegion = oneAtATime(async () => {
  const id = savedId();
  const regionId = Number(page.regionSelect.value);
  if (!(regionId > 0)) throw new Error("Choose a region first.");
  const windows = await regionWindows(id, regionId);
  const proposed = rangesFromRegion(windows.map((/** @type {any} */ w) => w.features));
  const checked = validateTargets(savedTargets);
  /** @type {FeatureRanges} */
  const saved = checked.ok ? checked.ranges : {};
  const { values, beside } = rangeFill(proposed, saved);
  for (const input of page.targetBox.querySelectorAll("input")) {
    const value = values[input.name];
    if (value !== undefined) input.value = value;
  }
  for (const [name, line] of savedLines) {
    const text = beside[name];
    line.hidden = text === undefined;
    line.textContent = text ?? "";
  }
  checkedForm();
  const chosen = page.regionSelect.selectedOptions[0]?.textContent ?? "the region";
  status.say(
    `Filled the ranges from ${chosen}. Nothing is saved until you press Save as a new version.`,
  );
});

// Attaching measures the region first when it hasn't been, as the route takes only a region
// measured at the brief's loudness.
const attach = oneAtATime(async () => {
  const id = savedId();
  const regionId = Number(page.attachSelect.value);
  if (!(regionId > 0)) throw new Error("Choose a region first.");
  const chosen = page.attachSelect.selectedOptions[0]?.textContent ?? "the region";
  await regionWindows(id, regionId);
  await postJson(`${VIBES_PATH}/${id}/attachments`, {
    kind: ATTACHMENT_KIND.reference,
    regionId,
  });
  await showRegions(id);
  status.say(`Attached ${chosen}. The next request for candidates tells the model about it.`);
});

/**
 * @param {number} regionId
 * @param {string} text the region as its row names it
 */
async function measureAttached(regionId, text) {
  const id = savedId();
  // The job measures only what is missing or stale, and embeds again under a new checkpoint.
  await runAnalysis(regionId, id, (step) => status.say(step));
  await showRegions(id);
  status.say(`Measured ${text} at this brief's loudness.`);
}

/**
 * @param {number} attachmentId
 * @param {string} text the region as its row names it
 */
async function detach(attachmentId, text) {
  const id = savedId();
  await postJson(`${attachmentPath(attachmentId)}/detach`, {});
  await showRegions(id);
  status.say(`Detached ${text}. Later requests for candidates leave it out.`);
}

/**
 * @param {number} attachmentId
 * @param {string} text the direction as its row names it
 */
async function removeDirection(attachmentId, text) {
  const id = savedId();
  await postJson(`${attachmentPath(attachmentId)}/detach`, {});
  await showRegions(id);
  status.say(`Removed the direction from ${text}. Session pages stop showing its slider.`);
}

const addDirection = oneAtATime(async () => {
  const id = savedId();
  const near = page.nearInput.value.trim();
  const far = page.farInput.value.trim();
  if (far.length === 0) {
    throw new Error("Type the direction's second end first, such as underwater.");
  }
  await postJson(`${VIBES_PATH}/${id}/attachments`, {
    kind: ATTACHMENT_KIND.direction,
    near: near === "" ? null : near,
    far,
  });
  page.nearInput.value = "";
  page.farInput.value = "";
  await showRegions(id);
  status.say(
    "Added the direction. Session pages show where each candidate sits on it once the page is opened again.",
  );
});

// The children are made in the newest open session, so they appear on a page the owner knows;
// a brief whose sessions are all stopped gets a new one.
const breed = oneAtATime(async () => {
  const id = savedId();
  const sketchIds = [Number(page.parentA.value), Number(page.parentB.value)];
  if (!sketchIds.every((sketchId) => sketchId > 0)) throw new Error("Choose two sketches first.");
  if (sketchIds[0] === sketchIds[1]) throw new Error("Choose two different sketches.");
  const estimate = await getJson(BREED_ESTIMATE_PATH);
  if (!confirm(breedCostText(DEFAULT_BREEDS, estimate))) return;
  const vibe = await getJson(`${VIBES_PATH}/${id}`);
  const session =
    [...vibe.sessions].reverse().find((/** @type {any} */ row) => row.stoppedAt === null) ??
    (await postJson(`${VIBES_PATH}/${id}/sessions`, {}));
  try {
    await postJson(`${sessionPath(session.id)}/breeds`, { sketchIds, count: DEFAULT_BREEDS });
  } catch (error) {
    // The same breed already running: its session page follows it.
    if (!(error instanceof ApiError && error.status === 409 && error.body?.jobId)) throw error;
  }
  location.assign(`./session.html?id=${session.id}`);
  return leaving();
});

const startSession = oneAtATime(async () => {
  const session = await postJson(`${VIBES_PATH}/${savedId()}/sessions`, {});
  location.assign(`./session.html?id=${session.id}`);
  return leaving();
});

page.constraintBox.replaceChildren(...constraintFields().map(fieldElement));
page.targetBox.replaceChildren(...targetFields().map(targetElement));
page.draft.oninput = () => checkedForm();
page.draft.onsubmit = (event) => {
  event.preventDefault();
  status.run(save);
};
page.noteForm.onsubmit = (event) => {
  event.preventDefault();
  status.run(addNote);
};

page.startButton.onclick = () => status.run(startSession);
page.regionRangesButton.onclick = () => status.run(setRangesFromRegion);
page.attachButton.onclick = () => status.run(attach);
page.directionButton.onclick = () => status.run(addDirection);
page.breedButton.onclick = () => status.run(breed);

if (vibeId === null) {
  page.pageTitle.textContent = "New brief";
  page.savedOnly.hidden = true;
  page.saveButton.textContent = "Create the brief";
  page.saveButton.title =
    "Saves the new brief and opens its page, where you can start a session. Nothing is asked of the model.";
  checkedForm();
  status.say("Name the brief, describe the music, and set any rules and ranges.");
  page.briefName.focus();
} else {
  page.saveButton.textContent = "Save as a new version";
  status.run(async () => {
    await load(vibeId);
    status.say("Press Start a session to get candidates, or edit the brief and save.");
  });
}
