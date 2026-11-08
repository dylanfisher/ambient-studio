// The References page (decision 0050): upload a recording, open one, and mark regions on it.
// The peak strip is drawn on a canvas from the server's peaks; dragging across it fills the
// start and end fields, which are the way to set a region with the keyboard. The one player
// plays the times in the form or a saved region, as an MP3 the server makes from the decode.
// `?id=<reference>` opens a recording.
/** @import { RegionFields } from "../domain/reference-region.js" */
import { regionProblem } from "../domain/reference-region.js";
import {
  getJson,
  postJson,
  REFERENCES_PATH,
  referencePath,
  regionPath,
  uploadFile,
} from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { mountPlayer, playAudio } from "./excerpt-player.js";
import {
  dragRegion,
  formatSeconds,
  parseSeconds,
  REGION_INPUT,
  readRegion,
  regionValues,
  spanQuery,
} from "./region-form.js";
import { statusLine } from "./status-line.js";

/**
 * A kept recording, as the reference routes send it.
 * @typedef {object} Reference
 * @property {number} id
 * @property {string} fileName
 * @property {string} format
 * @property {number} durationSeconds
 * @property {number} channels
 * @property {number} sampleRate
 */

/** @typedef {RegionFields & { id: number }} Region */

/** Pixels a pointer must move on the strip before it counts as a drag rather than a click. */
const DRAG_PIXELS = 3;

const status = statusLine();
const page = elementsById({
  fileInput: HTMLInputElement,
  uploadButton: HTMLButtonElement,
  referenceList: HTMLUListElement,
  noReferences: HTMLElement,
  referenceView: HTMLElement,
  referenceHeading: HTMLElement,
  referenceFacts: HTMLElement,
  removeReferenceButton: HTMLButtonElement,
  peakStrip: HTMLCanvasElement,
  regionAudio: HTMLAudioElement,
  regionForm: HTMLFormElement,
  regionFormHeading: HTMLElement,
  playFormButton: HTMLButtonElement,
  saveRegionButton: HTMLButtonElement,
  cancelEditButton: HTMLButtonElement,
  regionList: HTMLUListElement,
  noRegions: HTMLElement,
});
/** The region form's fields, by the names `readRegion` reads. */
const fieldsById = /** @type {Record<string, HTMLInputElement | HTMLTextAreaElement>} */ (
  elementsById({
    [REGION_INPUT.start]: HTMLInputElement,
    [REGION_INPUT.end]: HTMLInputElement,
    [REGION_INPUT.label]: HTMLInputElement,
    [REGION_INPUT.note]: HTMLTextAreaElement,
  })
);
mountPlayer(page.regionAudio, status.fail);

/** The open recording, its live regions and its peaks, or null on the list alone. */
let open = /** @type {{ reference: Reference, regions: Region[], peaks: number[] } | null} */ (
  null
);
/** The saved region the form is changing, or null for a new one. */
let editing = /** @type {Region | null} */ (null);

/** @param {string} name */
const fieldValue = (name) => fieldsById[name]?.value ?? "";

/** @param {Reference} reference */
function factsText({ format, durationSeconds, channels, sampleRate }) {
  const layout = channels === 1 ? "mono" : "stereo";
  return `${format.toUpperCase()}, ${formatSeconds(durationSeconds)} long, ${layout}, ${sampleRate / 1000} kHz`;
}

/** @param {RegionFields} region */
const timesText = ({ startSeconds, endSeconds }) =>
  `${formatSeconds(startSeconds)} to ${formatSeconds(endSeconds)}`;

/**
 * The span the start and end fields hold, or null while they don't hold one.
 * @returns {{ startSeconds: number, endSeconds: number } | null}
 */
function typedSpan() {
  const startSeconds = parseSeconds(fieldValue(REGION_INPUT.start));
  const endSeconds = parseSeconds(fieldValue(REGION_INPUT.end));
  if (startSeconds === null || endSeconds === null) return null;
  if (!(endSeconds > startSeconds)) return null;
  return { startSeconds, endSeconds };
}

/** Draws the peaks, the saved regions faintly, and the span in the form on top. */
function draw() {
  if (!open) return;
  const { peaks, reference, regions } = open;
  const canvas = page.peakStrip;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("the browser gave no 2D canvas for the peak strip");
  context.scale(ratio, ratio);
  const style = getComputedStyle(canvas);
  const color = (/** @type {string} */ name) => style.getPropertyValue(name).trim();
  /** @param {number} seconds */
  const x = (seconds) => (seconds / reference.durationSeconds) * width;
  /** @param {{ startSeconds: number, endSeconds: number }} span */
  const shade = ({ startSeconds, endSeconds }) =>
    context.fillRect(x(startSeconds), 0, x(endSeconds) - x(startSeconds), height);

  context.fillStyle = color("--secondary");
  for (const region of regions) if (region.id !== editing?.id) shade(region);
  const span = typedSpan();
  if (span) {
    context.fillStyle = color("--ring");
    shade(span);
  }
  context.fillStyle = color("--foreground");
  const step = width / peaks.length;
  const middle = height / 2;
  // Scaled to the file's loudest slice, so a quiet recording still shows its shape.
  const loudest = peaks.reduce((most, peak) => Math.max(most, peak), 0) || 1;
  for (const [i, peak] of peaks.entries()) {
    const half = Math.max(0.5, (peak / loudest) * middle);
    context.fillRect(i * step, middle - half, Math.max(1, step - 0.5), 2 * half);
  }
}

/** @param {Region | null} region the saved region to change, or null to start a new one */
function startEditing(region) {
  editing = region;
  const values = region
    ? regionValues(region)
    : Object.fromEntries(Object.values(REGION_INPUT).map((name) => [name, ""]));
  for (const [name, value] of Object.entries(values)) {
    const field = fieldsById[name];
    if (field) field.value = value;
  }
  page.regionFormHeading.textContent = region ? `Changing “${region.label}”` : "New region";
  page.cancelEditButton.hidden = region === null;
  draw();
}

/** @param {{ startSeconds: number, endSeconds: number }} span */
function play({ startSeconds, endSeconds }) {
  if (!open) return;
  const problem = regionProblem(startSeconds, endSeconds, open.reference.durationSeconds);
  if (problem) throw new Error(problem);
  const query = spanQuery({ startSeconds, endSeconds });
  page.regionAudio.src = `${referencePath(open.reference.id)}/audio?${query}`;
  status.say(`Playing ${timesText({ startSeconds, endSeconds, label: "", note: "" })}.`);
  playAudio(page.regionAudio, status.fail);
}

// The audio element reports a failed load without the server's reason; asking again reads it.
page.regionAudio.addEventListener("error", () => {
  const source = page.regionAudio.currentSrc;
  if (source === "") return;
  status.run(async () => {
    const reply = await fetch(source);
    if (!reply.ok) throw new Error((await reply.json()).error);
    throw new Error("The region's audio didn't load. Try Play again.");
  });
});

function showRegions() {
  if (!open) return;
  page.regionList.replaceChildren(
    ...open.regions.map((region) => {
      const item = cloneTemplate("region-item", {
        label: HTMLElement,
        times: HTMLElement,
        note: HTMLElement,
        play: HTMLButtonElement,
        edit: HTMLButtonElement,
        remove: HTMLButtonElement,
      });
      item.label.textContent = region.label;
      item.times.textContent = timesText(region);
      item.note.textContent = region.note;
      item.note.hidden = region.note === "";
      item.play.onclick = () => status.run(() => play(region));
      item.edit.onclick = () => startEditing(region);
      item.remove.onclick = () =>
        status.run(async () => {
          if (!window.confirm(`Remove the region “${region.label}”?`)) return;
          await postJson(`${regionPath(region.id)}/remove`, {});
          if (editing?.id === region.id) startEditing(null);
          await loadRegions();
          status.say(`Removed “${region.label}”.`);
        });
      return item.root;
    }),
  );
  page.noRegions.hidden = open.regions.length > 0;
  draw();
}

/**
 * Reads the open recording's regions again.
 */
async function loadRegions() {
  if (!open) return;
  const { regions } = await getJson(referencePath(open.reference.id));
  open.regions = regions;
  showRegions();
}

/** @param {number} id */
async function openReference(id) {
  const [{ reference, regions }, { peaks }] = await Promise.all([
    getJson(referencePath(id)),
    getJson(`${referencePath(id)}/peaks`),
  ]);
  open = { reference, regions, peaks };
  page.referenceView.hidden = false;
  page.referenceHeading.textContent = reference.fileName;
  page.referenceFacts.textContent = factsText(reference);
  startEditing(null);
  showRegions();
}

async function loadList() {
  const { references } = await getJson(REFERENCES_PATH);
  page.referenceList.replaceChildren(
    .../** @type {Reference[]} */ (references).map((reference) => {
      const item = cloneTemplate("reference-item", { link: HTMLAnchorElement, facts: HTMLElement });
      item.link.textContent = reference.fileName;
      item.link.href = `./references.html?id=${reference.id}`;
      item.facts.textContent = factsText(reference);
      return item.root;
    }),
  );
  page.noReferences.hidden = references.length > 0;
}

page.uploadButton.onclick = () =>
  status.run(async () => {
    const file = page.fileInput.files?.[0];
    if (!file) throw new Error("Choose a recording to upload first.");
    page.uploadButton.disabled = true;
    try {
      status.say(`Uploading ${file.name}…`);
      const { reference, added } = await uploadFile(REFERENCES_PATH, file);
      window.location.href = `./references.html?id=${reference.id}&${added ? "added" : "known"}`;
    } finally {
      page.uploadButton.disabled = false;
    }
  });

page.removeReferenceButton.onclick = () =>
  status.run(async () => {
    if (!open) return;
    const { fileName, id } = open.reference;
    const asked = `Remove ${fileName} and its regions from the list? The studio keeps the file.`;
    if (!window.confirm(asked)) return;
    await postJson(`${referencePath(id)}/remove`, {});
    window.location.href = "./references.html";
  });

page.playFormButton.onclick = () =>
  status.run(() => {
    const span = typedSpan();
    if (!span) throw new Error("Type a start, and an end after it, to play.");
    play(span);
  });

page.cancelEditButton.onclick = () => startEditing(null);

page.regionForm.onsubmit = (event) => {
  event.preventDefault();
  status.run(async () => {
    if (!open) return;
    const read = readRegion(fieldValue, open.reference.durationSeconds);
    if (!read.ok) throw new Error(read.message);
    const path = editing
      ? `${regionPath(editing.id)}/replace`
      : `${referencePath(open.reference.id)}/regions`;
    const { region } = await postJson(path, { ...read.region });
    startEditing(null);
    await loadRegions();
    status.say(`Saved “${region.label}”, ${timesText(region)}.`);
  });
};

for (const name of [REGION_INPUT.start, REGION_INPUT.end]) {
  fieldsById[name]?.addEventListener("input", draw);
}

// Dragging across the strip fills the start and end; the fields stay the way to set them.
/** Where the pointer went down, in pixels from the strip's left edge, while it is down. */
let dragFrom = /** @type {number | null} */ (null);
/** @param {PointerEvent} event */
const stripX = (event) => event.clientX - page.peakStrip.getBoundingClientRect().left;
page.peakStrip.addEventListener("pointerdown", (event) => {
  if (!open) return;
  dragFrom = stripX(event);
  page.peakStrip.setPointerCapture(event.pointerId);
});
page.peakStrip.addEventListener("pointermove", (event) => {
  if (!open || dragFrom === null || Math.abs(stripX(event) - dragFrom) < DRAG_PIXELS) return;
  const span = dragRegion(
    dragFrom,
    stripX(event),
    page.peakStrip.clientWidth,
    open.reference.durationSeconds,
  );
  const start = fieldsById[REGION_INPUT.start];
  const end = fieldsById[REGION_INPUT.end];
  if (start) start.value = formatSeconds(span.startSeconds);
  if (end) end.value = formatSeconds(span.endSeconds);
  draw();
});
for (const type of ["pointerup", "pointercancel"]) {
  page.peakStrip.addEventListener(type, () => {
    dragFrom = null;
  });
}
window.addEventListener("resize", draw);

status.run(async () => {
  await loadList();
  const query = new URLSearchParams(window.location.search);
  const id = Number(query.get("id"));
  if (Number.isInteger(id) && id > 0) {
    await openReference(id);
    if (query.has("added")) status.say(`Kept ${open?.reference.fileName}. Mark its regions below.`);
    else if (query.has("known")) {
      status.say(`That file was already here, as ${open?.reference.fileName}.`);
    } else status.say("");
  } else status.say("");
});
