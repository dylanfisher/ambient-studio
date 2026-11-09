// The map page (decision 0057): a brief's candidates placed by their sound on the axes chosen on
// the brief page, as a table of cell buttons, each showing its best candidate. The arrow keys
// move between cells, click or Enter opens one and plays its candidate through the excerpt
// player, and the open cell has explore, nudge and keep as sketch. Fill the map asks first with
// its cost and follows the job, reading the map again as the job moves. New candidates go to
// one open session of the brief: the one the page was opened from, or the newest.
/** @import { MapCell } from "./map-grid.js" */
/** @import { SteerControls } from "./steer-controls.js" */
import { DEFAULT_FILL_BUDGET, exploreSteps, MAX_FILL_BUDGET } from "../domain/fill-settings.js";
/** @import { StepSeconds } from "../domain/search-cost.js" */
import { fillCostText } from "../domain/search-cost.js";
import { getJson, postJson, SEARCH_ESTIMATE_PATH, sessionPath, VIBES_PATH } from "./api.js";
import { briefJobs, briefQuery, NO_OPEN_SESSION, targetSession } from "./brief-jobs.js";
import { elementsById } from "./element-by-id.js";
import { mountPlayer, playAudio } from "./excerpt-player.js";
import { jobControl } from "./job-control.js";
import { latestOnly } from "./latest-only.js";
import {
  arrowMove,
  axisLine,
  cellAudio,
  cellKey,
  cellText,
  coverageText,
  mapRows,
  openText,
} from "./map-grid.js";
import { statusLine } from "./status-line.js";
import { steerControls } from "./steer-controls.js";
import "./topbar-jobs.js";

const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  briefLink: HTMLAnchorElement,
  coverageLine: HTMLElement,
  sessionLine: HTMLElement,
  sessionLink: HTMLAnchorElement,
  budgetInput: HTMLInputElement,
  shareInput: HTMLInputElement,
  controlSwitch: HTMLInputElement,
  fillButton: HTMLButtonElement,
  jobBox: HTMLElement,
  axisAcross: HTMLElement,
  axisUp: HTMLElement,
  layerField: HTMLElement,
  layerName: HTMLElement,
  layerSelect: HTMLSelectElement,
  noMap: HTMLElement,
  grid: HTMLTableElement,
  openBox: HTMLElement,
  openLine: HTMLElement,
  openAudio: HTMLAudioElement,
  sketchButton: HTMLButtonElement,
  openSteer: HTMLElement,
});
const { vibeId, fromSession } = briefQuery(status, location.search);

/**
 * The map as `GET /api/vibes/:id/archive` gives it.
 * @typedef {object} MapView
 * @property {string | null} reason
 * @property {boolean} model
 * @property {any[]} axes
 * @property {number[]} shape
 * @property {number} total
 * @property {number} filled
 * @property {number} placed
 * @property {number} unplaced
 * @property {MapCell[]} cells
 */

/** @type {MapView | null} */
let map = null;
/** @type {number[] | null} the cell the keyboard is on */
let focused = null;
/** @type {MapCell | null} */
let opened = null;
/** @type {SteerControls | null} */
let steer = null;
/**
 * Each opened cell's controls, by candidate, kept when another cell opens, so a job one of them
 * started still holds its button when the owner comes back.
 * @type {Map<number, SteerControls>}
 */
const steers = new Map();
/** @type {number | null} the open session new candidates go to */
let target = null;
const fill = jobControl(page.fillButton);

page.budgetInput.min = "1";
page.budgetInput.max = String(MAX_FILL_BUDGET);
page.budgetInput.value = String(DEFAULT_FILL_BUDGET);
page.shareInput.value = "0";
mountPlayer(page.openAudio, status.fail);

/** The layer of the third axis the table shows, or 0 with two axes. */
const layer = () => Number(page.layerSelect.value || 0);

/** Draws the table from `map`, keeping the keyboard's cell. */
function drawGrid() {
  if (map === null) return;
  const { shape, model } = map;
  const rows = mapRows(map, layer());
  if (focused === null || focused.length !== shape.length) focused = shape.map(() => 0);
  if (shape.length === 3) focused = focused.with(2, layer());
  const at = cellKey(focused);
  // A reload while the owner moves through the cells keeps the keyboard on its cell.
  const hadFocus = page.grid.contains(document.activeElement);
  page.grid.replaceChildren(
    ...rows.map(({ cells }) => {
      const row = document.createElement("tr");
      for (const { index, cell } of cells) {
        const td = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = cell === null ? "map-cell empty" : "map-cell";
        const { text, title } = cellText(cell, model);
        button.textContent = text;
        button.title = title;
        button.dataset.cell = cellKey(index);
        button.setAttribute(
          "aria-label",
          `Cell ${index.map((bin) => bin + 1).join(", ")}: ${title}`,
        );
        // One cell takes the Tab key; the arrows move from it.
        button.tabIndex = cellKey(index) === at ? 0 : -1;
        if (opened !== null && cell?.candidateId === opened.candidateId) {
          button.setAttribute("aria-pressed", "true");
        }
        button.onclick = () => {
          focused = index;
          openCell(cell, index);
        };
        td.append(button);
        row.append(td);
      }
      return row;
    }),
  );
  if (hadFocus) focusCell(focused);
}

/** @param {readonly number[]} index */
function focusCell(index) {
  focused = [...index];
  for (const button of page.grid.querySelectorAll("button")) {
    const here = button.dataset.cell === cellKey(index);
    button.tabIndex = here ? 0 : -1;
    if (here) button.focus();
  }
}

page.grid.addEventListener("keydown", (event) => {
  if (map === null || focused === null) return;
  const next = arrowMove(focused, event.key, map.shape);
  if (next === null) return;
  event.preventDefault();
  focusCell(next);
});

/**
 * Opens a cell: plays its best candidate and offers explore, nudge and keep as sketch on it.
 * @param {MapCell | null} cell
 * @param {readonly number[]} index
 */
function openCell(cell, index) {
  if (cell === null) {
    status.say(
      `Cell ${index.map((bin) => bin + 1).join(", ")} is empty: no candidate lands there yet.`,
    );
    return;
  }
  opened = cell;
  page.openBox.hidden = false;
  const where = index.map((bin) => bin + 1).join(", ");
  page.openLine.textContent = `Candidate #${cell.candidateId}, cell ${where}. ${openText(cell, map?.model ?? false)}`;
  const url = new URL(cellAudio(cell), location.href).href;
  if (page.openAudio.src !== url) page.openAudio.src = cellAudio(cell);
  playAudio(page.openAudio, status.fail);
  steer =
    steers.get(cell.candidateId) ??
    steerControls({
      candidateId: cell.candidateId,
      sessionId: () => target,
      start,
      run: status.run,
    });
  steers.set(cell.candidateId, steer);
  page.openSteer.replaceChildren(steer.root);
  showSteer();
  drawGrid();
  focusCell(index);
}

/** Turns the job buttons off when there is no open session to send to. */
function showSteer() {
  const why = target === null ? NO_OPEN_SESSION : null;
  steer?.off(why);
  page.sketchButton.disabled = why !== null;
  if (!fill.held()) {
    page.fillButton.disabled = why !== null || map === null || map.reason !== null;
  }
}

/** Reads the map and draws it. */
async function readMap() {
  /** @type {MapView} */
  const read = await getJson(`${VIBES_PATH}/${vibeId}/archive`);
  map = read;
  const [across, up, third] = read.axes;
  page.axisAcross.textContent = across ? `Across, low to high: ${axisLine(across)}.` : "";
  page.axisUp.textContent = up ? `Up, low to high: ${axisLine(up)}.` : "";
  page.layerField.hidden = third === undefined || read.reason !== null;
  if (third !== undefined && read.reason === null) {
    page.layerName.textContent = `Slice of the third axis: ${axisLine(third)}`;
    const chosen = page.layerSelect.value;
    const bins = /** @type {number} */ (read.shape[2]);
    page.layerSelect.replaceChildren(
      ...Array.from({ length: bins }, (_, bin) => new Option(`${bin + 1} of ${bins}`, String(bin))),
    );
    if (chosen !== "" && Number(chosen) < bins) page.layerSelect.value = chosen;
  }
  page.noMap.hidden = read.reason === null;
  page.noMap.textContent = read.reason ?? "";
  page.coverageLine.textContent = read.reason === null ? coverageText(read) : "";
  if (read.reason === null) drawGrid();
  else page.grid.replaceChildren();
  showSteer();
}

/**
 * One read at a time, and one more after the last call: a fill moves its count every step, and
 * each read can ask the sidecar to score every excerpt on the map.
 */
const loadMap = latestOnly(readMap);

page.layerSelect.onchange = () => drawGrid();

const { start, resume } = briefJobs({
  status,
  boxes: page.jobBox,
  reload: () => loadMap(),
  done: "The job is done. Its candidates are on the map; rate them on the session page.",
  started: () =>
    `Started in session ${target}. The map shows the new candidates as they are ready.`,
  settle: () => showSteer(),
});

page.fillButton.onclick = () =>
  status.run(async () => {
    if (target === null) throw new Error("Start a session from the brief page first.");
    const budget = Number(page.budgetInput.value);
    if (!Number.isInteger(budget) || budget < 1 || budget > MAX_FILL_BUDGET) {
      throw new Error(`The fill's steps must be a whole number from 1 to ${MAX_FILL_BUDGET}.`);
    }
    const percent = Number(page.shareInput.value);
    if (!(percent >= 0 && percent <= 100)) {
      throw new Error("The steps that ask the model must be from 0 to 100 percent.");
    }
    const exploreShare = percent / 100;
    const control = page.controlSwitch.checked;
    /** @type {{ seconds: StepSeconds, measured: boolean }} */
    const { seconds, measured } = await getJson(SEARCH_ESTIMATE_PATH);
    const asked = fillCostText(budget, exploreSteps(budget, exploreShare), seconds, {
      measured,
      control,
    });
    if (!confirm(asked)) return;
    await start(fill, `${sessionPath(target)}/fills`, { budget, exploreShare, control });
  });

page.sketchButton.onclick = () =>
  status.run(async () => {
    if (opened === null || target === null) return;
    await postJson(`${sessionPath(target)}/sketches`, {
      candidateId: opened.candidateId,
      renderId: opened.renderId,
      notes: "",
      tags: [],
    });
    status.say(`Candidate #${opened.candidateId} kept as a sketch. The brief page lists it.`);
  });

status.run(async () => {
  const vibe = await getJson(`${VIBES_PATH}/${vibeId}`);
  page.briefLink.href = `./brief.html?id=${vibeId}`;
  page.briefLink.textContent = vibe.revision.name;
  page.pageTitle.textContent = `Map of ${vibe.revision.name}`;
  document.title = `Map, ${vibe.revision.name} · Ambient Studio`;
  target = targetSession(vibe.sessions, fromSession);
  page.sessionLink.hidden = target === null;
  if (target !== null) page.sessionLink.href = `./session.html?id=${target}`;
  page.sessionLine.textContent =
    target === null
      ? "Every session of this brief is stopped, so filling, explore and nudge are off. Start a session from the brief page."
      : `The fill and the open cell's explores and nudges go to session ${target}.`;
  await loadMap();
  await resume(target);
  status.say(
    map?.reason ??
      "Click a cell, or press Enter on it, to play its candidate. The arrow keys move between cells.",
  );
});
