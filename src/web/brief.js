// The brief page (decisions 0028 and 0032): the name, the description and a rules form built
// from 2b's table, saved as a new revision; the brief's sessions, notes, ratings and revisions.
// With no `id` in the query it makes a new brief. A brief is a vibe in the API and the store,
// and its description is the vibe's `brief` field.
/** @import { ConstraintField } from "./constraint-fields.js" */
import { FORM } from "../domain/constraint-schema.js";
import { constraintsText } from "../domain/constraints-text.js";
import { MACRO_DIRECTIONS } from "../domain/rating-values.js";
import { validateConstraints } from "../domain/validate-constraints.js";
import { getJson, postJson, VIBES_PATH } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import {
  constraintFields,
  fieldTitle,
  fieldValues,
  rangeInput,
  readConstraints,
} from "./constraint-fields.js";
import { elementsById } from "./element-by-id.js";
import { formatTime } from "./format-time.js";
import { oneAtATime } from "./one-at-a-time.js";
import { outcomeText } from "./outcome-text.js";
import { statusLine } from "./status-line.js";

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
  softTargets: HTMLTextAreaElement,
  draftErrors: HTMLUListElement,
  saveButton: HTMLButtonElement,
  savedOnly: HTMLElement,
  startButton: HTMLButtonElement,
  noteButton: HTMLButtonElement,
  sessionList: HTMLUListElement,
  noteList: HTMLUListElement,
  noteForm: HTMLFormElement,
  noteText: HTMLTextAreaElement,
  ratingList: HTMLUListElement,
  noRatings: HTMLElement,
  revisionList: HTMLUListElement,
});
const idText = new URLSearchParams(location.search).get("id");
const vibeId = idText === null ? null : Number(idText);

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

/** The form's constraints, checked: the set, or null with the errors shown. */
function checkedConstraints() {
  const data = new FormData(page.draft);
  const raw = readConstraints(
    (name) => String(data.get(name) ?? ""),
    (name) => data.getAll(name).map(String),
  );
  const checked = validateConstraints(raw);
  if (!checked.ok) {
    page.draftErrors.replaceChildren(
      ...checked.errors.map((error) => {
        const item = document.createElement("li");
        item.textContent = `${error.path}: ${error.message}`;
        return item;
      }),
    );
    page.constraintsText.textContent = "";
    return null;
  }
  page.draftErrors.replaceChildren();
  page.constraintsText.textContent = `What the model is told: ${constraintsText(checked.constraints)}`;
  return checked.constraints;
}

/** The form as the draft a create or revision route takes. */
function readDraft() {
  const constraints = checkedConstraints();
  if (constraints === null) {
    throw new Error("The rules have errors; see the list above Save.");
  }
  /** @type {unknown} */
  let softTargets;
  try {
    softTargets = JSON.parse(page.softTargets.value);
  } catch (error) {
    throw new Error(
      `The soft targets aren't JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
  return {
    name: page.briefName.value,
    brief: page.briefDescription.value,
    constraints,
    softTargets,
  };
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
    ...sketches.map((row) => {
      const notes = row.notes ? `: “${row.notes}”` : "";
      const tags = row.tags.length > 0 ? ` [${row.tags.join(", ")}]` : "";
      return { at: row.createdAt, text: `Sketch of candidate ${row.candidateId}${notes}${tags}` };
    }),
  ].sort((x, y) => y.at - x.at);
  page.ratingList.replaceChildren(...items.map(({ at, text }) => lineItem(text, at)));
  page.noRatings.hidden = items.length > 0;
}

/** @param {number} id */
async function load(id) {
  const [vibe, { revisions }, ratings] = await Promise.all([
    getJson(`${VIBES_PATH}/${id}`),
    getJson(`${VIBES_PATH}/${id}/revisions`),
    getJson(`${VIBES_PATH}/${id}/ratings`),
  ]);
  const { revision } = vibe;
  document.title = `${revision.name} · Ambient Studio`;
  page.pageTitle.textContent = revision.name;
  page.briefName.value = revision.name;
  page.briefDescription.value = revision.brief;
  page.softTargets.value = JSON.stringify(revision.softTargets);
  fillConstraints(revision.constraints);
  checkedConstraints();

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
  page.revisionList.replaceChildren(
    ...[...revisions].reverse().map((/** @type {any} */ row, i) => {
      const item = cloneTemplate("revision-item", {
        summary: HTMLElement,
        description: HTMLElement,
        constraints: HTMLElement,
      });
      item.summary.textContent = `${formatTime(row.createdAt)}: ${row.name}${i === 0 ? " (current)" : ""}`;
      item.description.textContent = row.brief;
      item.constraints.textContent = constraintsText(row.constraints);
      return item.root;
    }),
  );
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

const startSession = oneAtATime(async () => {
  const session = await postJson(`${VIBES_PATH}/${savedId()}/sessions`, {});
  location.assign(`./session.html?id=${session.id}`);
  return leaving();
});

page.constraintBox.replaceChildren(...constraintFields().map(fieldElement));
page.draft.oninput = () => checkedConstraints();
page.draft.onsubmit = (event) => {
  event.preventDefault();
  status.run(save);
};
page.noteForm.onsubmit = (event) => {
  event.preventDefault();
  status.run(addNote);
};

page.startButton.onclick = () => status.run(startSession);

if (vibeId === null) {
  page.pageTitle.textContent = "New brief";
  page.savedOnly.hidden = true;
  page.saveButton.textContent = "Create the brief";
  page.saveButton.title =
    "Saves the new brief and opens its page, where you can start a session. Nothing is asked of the model.";
  checkedConstraints();
  status.say("Name the brief, describe the music, and set any rules.");
  page.briefName.focus();
} else {
  page.saveButton.textContent = "Save as a new version";
  status.run(async () => {
    await load(vibeId);
    status.say("Press Start a session to get candidates, or edit the brief and save.");
  });
}
