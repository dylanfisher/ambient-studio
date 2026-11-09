// The timeline page's material card and arc (decision 0066): the brief's sketches with their
// positions on its directions, the map's elites by cell to place, a steer of the chosen section
// along a direction, and an attached region drawn under the timeline as the arc target beside
// each section's measured features. Every action has a button and a key (`material-keys.js`).
// It reads the archive, the steering and the attachments once the page opens and again after a
// steer, since each can ask the sidecar; it writes only through the sketch route, the steer
// route and the page's own Save.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { Features } from "../domain/extract-features.js" */
/** @import { FeatureName } from "../domain/feature-names.js" */
/** @import { StepSeconds } from "../domain/search-cost.js" */
/** @import { ArcWindow } from "./arc-layout.js" */
/** @import { ActionSketch, Toward } from "./material-actions.js" */
/** @import { MaterialAction } from "./material-keys.js" */
/** @import { DirectionRow, EliteRow, MaterialPanel, PanelArchive, PanelRegion, PanelSketch } from "./material-panel.js" */
/** @import { SteeringView } from "./steer-sliders.js" */
/** @import { StatusLine } from "./status-line.js" */
import { steerCostText } from "../domain/search-cost.js";
import { DEFAULT_STEER_BUDGET } from "../domain/search-settings.js";
import { TARGET_FEATURES } from "../domain/target-schema.js";
import {
  getJson,
  postJson,
  regionPath,
  SEARCH_ESTIMATE_PATH,
  sessionPath,
  trackPath,
  VIBES_PATH,
} from "./api.js";
import { arcLayout } from "./arc-layout.js";
import { NO_OPEN_SESSION, targetSession } from "./brief-jobs.js";
import { elementsById } from "./element-by-id.js";
import { jobControl } from "./job-control.js";
import { keyButtons } from "./key-buttons.js";
import { latestOnly } from "./latest-only.js";
import {
  keepSteered,
  NO_SECTION,
  placeElite,
  STEER_LEAVE,
  SWAP,
  steerBody,
  steerSwap,
  swapSketch,
  TOWARD,
} from "./material-actions.js";
import { bindMaterialKeys, MATERIAL_KEYS } from "./material-keys.js";
import { materialPanel } from "./material-panel.js";
import { NOT_STARTED } from "./owner-job.js";
import { runJob } from "./run-job.js";
import { timelineLayout } from "./timeline-layout.js";

/**
 * The measures the arc can draw, first first: the ones a brief's ranges name. The raw levels
 * are left out, since every window and section is normalized to the brief's loudness.
 */
const ARC_FEATURES = Object.values(TARGET_FEATURES).map(({ feature }) => feature);

/**
 * @typedef {object} MaterialHost what the timeline page gives the card
 * @property {StatusLine} status
 * @property {number} trackId
 * @property {() => { vibe: { id: number }, sketches: PanelSketch[], developments: { id: number, offset: number }[] } | null} view the track as
 *   last read
 * @property {() => Arrangement | null} draft the timeline as the owner has it now
 * @property {() => number | null} selected the chosen section
 * @property {() => boolean} unsaved whether the timeline differs from the opened version
 * @property {() => number} opened how many times a version was opened by hand from the list
 * @property {(made: { arrangement: Arrangement, index: number }) => void} place puts a new
 *   arrangement on the timeline with the given section chosen
 * @property {() => Promise<PanelSketch[]>} readSketches reads the brief's sketches again,
 *   keeping the timeline as it is
 * @property {(arrangement: Arrangement, note: string) => Promise<void>} save saves the
 *   arrangement as the newest version
 */

/**
 * @param {MaterialHost} host
 * @returns {{ load: () => Promise<void>, draw: (valid: boolean) => void, remeasure: () => void }}
 */
export function materialCard(host) {
  const { status, trackId } = host;
  const page = elementsById({
    materialSketches: HTMLUListElement,
    eliteLine: HTMLElement,
    eliteSelect: HTMLSelectElement,
    eliteAbout: HTMLElement,
    eliteNumbers: HTMLElement,
    steerLine: HTMLElement,
    directionSelect: HTMLSelectElement,
    steerJobBox: HTMLElement,
    arcRegionSelect: HTMLSelectElement,
    arcFeatureSelect: HTMLSelectElement,
    arc: HTMLElement,
    arcLine: HTMLElement,
  });
  const buttons = keyButtons(MATERIAL_KEYS);
  const steerControls = [jobControl(buttons.steerFar), jobControl(buttons.steerNear)];
  page.arcFeatureSelect.replaceChildren(
    ...ARC_FEATURES.map(({ label }, i) => new Option(label, String(i))),
  );

  /** @type {PanelArchive | null} */
  let archive = null;
  /** @type {SteeringView | null} */
  let steering = null;
  /** @type {PanelRegion[]} */
  let regions = [];
  /** @type {number | null} the open session elites are kept and steers run in */
  let sessionId = null;
  /** @type {MaterialPanel | null} */
  let panel = null;
  /** Each region's windows once read, null when it has no analysis at the brief's loudness. */
  const regionWindows = /** @type {Map<number, ArcWindow[] | null>} */ (new Map());
  /** The sections the measures were read for, as JSON, and what was read. */
  let measured = { key: "", values: /** @type {(Features | null)[]} */ ([]) };
  /** Whether the timeline was valid at the last draw, so its sections can be measured. */
  let valid = false;

  const vibeId = () => {
    const view = host.view();
    if (view === null) throw new Error("the material card was read before its track");
    return view.vibe.id;
  };

  /** Reads the map, the steering, the attachments and the open session, then draws. */
  async function load() {
    const id = vibeId();
    const [vibe, attached] = await Promise.all([
      getJson(`${VIBES_PATH}/${id}`),
      getJson(`${VIBES_PATH}/${id}/attachments`),
    ]);
    sessionId = targetSession(vibe.sessions, null);
    regions = attached.references.map((/** @type {PanelRegion} */ { id, regionId, label }) => ({
      id,
      regionId,
      label,
    }));
    page.arcRegionSelect.replaceChildren(
      ...regions.map(({ regionId, label }) => new Option(label, String(regionId))),
    );
    redraw();
    // Each read can ask the sidecar, so a slow or failing one doesn't hold the others.
    await Promise.all([
      status.run(async () => {
        steering = await getJson(`${VIBES_PATH}/${id}/steering`);
        redraw();
      }),
      status.run(async () => {
        archive = await getJson(`${VIBES_PATH}/${id}/archive`);
        redraw();
      }),
      status.run(readRegion),
    ]);
  }

  /** The region the arc draws, or null when none is attached. */
  const chosenRegion = () =>
    page.arcRegionSelect.value === "" ? null : Number(page.arcRegionSelect.value);

  /** Reads the chosen region's windows once. */
  async function readRegion() {
    const regionId = chosenRegion();
    if (regionId === null || regionWindows.has(regionId)) return;
    const read = await getJson(`${regionPath(regionId)}/analysis?vibeId=${vibeId()}`);
    regionWindows.set(regionId, read.analysis?.windows ?? null);
    redraw();
  }

  /** Reads each section's measured features when the sections changed since the last read. */
  const readMeasures = latestOnly(async () => {
    const sections = host.draft()?.sections ?? [];
    const key = JSON.stringify(sections);
    if (!valid || key === measured.key) return;
    /** @type {{ measures: (Features | null)[] }} */
    const read = await postJson(`${trackPath(trackId)}/measures`, { sections });
    measured = { key, values: read.measures };
    redraw();
  });

  /** @returns {EliteRow | undefined} */
  const chosenElite = () => panel?.elites.find(({ key }) => key === page.eliteSelect.value);

  /** @returns {DirectionRow | undefined} */
  const chosenDirection = () =>
    panel?.directions.find(({ id }) => String(id) === page.directionSelect.value);

  /**
   * Fills a select with options, keeping the chosen one when it is still there.
   * @param {HTMLSelectElement} select
   * @param {[string, string][]} options value and label
   */
  function fillSelect(select, options) {
    const chosen = select.value;
    select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    if (options.some(([value]) => value === chosen)) select.value = chosen;
    select.disabled = options.length === 0;
  }

  /**
   * Turns a button off with `why` as its title, or on with its own title when `why` is null.
   * @param {HTMLButtonElement} button
   * @param {string | null} why
   * @param {string} idle
   */
  function offWhen(button, why, idle) {
    button.disabled = why !== null;
    button.title = why ?? idle;
  }
  const idle = /** @type {Record<MaterialAction, string>} */ (
    Object.fromEntries(Object.entries(buttons).map(([name, button]) => [name, button.title]))
  );

  /** Draws the card and the arc from what was last read. */
  function redraw() {
    const view = host.view();
    if (view === null) return;
    panel = materialPanel({ sketches: view.sketches, archive, steering, regions });

    page.materialSketches.replaceChildren(
      ...panel.sketches.map(({ name, words, line }) => {
        const item = document.createElement("li");
        item.className = "item";
        item.textContent = name;
        for (const [text, numbers] of /** @type {const} */ ([
          [words, false],
          [line, true],
        ])) {
          if (text === "") continue;
          const where = document.createElement("p");
          where.className = "small muted";
          where.textContent = text;
          if (numbers) where.dataset.numbers = "";
          item.append(where);
        }
        return item;
      }),
    );

    page.eliteLine.textContent = panel.elitesLine;
    fillSelect(
      page.eliteSelect,
      panel.elites.map(({ key, label }) => [key, label]),
    );
    const elite = chosenElite();
    page.eliteAbout.textContent = elite ? elite.about : "";
    page.eliteNumbers.textContent = elite ? elite.numbers : "";
    offWhen(
      buttons.placeElite,
      elite === undefined
        ? "Turned off: the map has no elite to place."
        : elite.sketchId === null && sessionId === null
          ? NO_OPEN_SESSION
          : null,
      idle.placeElite,
    );

    fillSelect(
      page.directionSelect,
      panel.directions.map(({ id, text }) => [String(id), text]),
    );
    const direction = chosenDirection();
    const selected = host.selected();
    const why =
      direction === undefined
        ? "Turned off: this brief has no direction to steer along. Add one on the brief page."
        : direction.reason !== null
          ? `Turned off: this direction can't be steered along yet: ${direction.reason}`
          : selected === null
            ? NO_SECTION
            : host.unsaved()
              ? "Turned off until the timeline is saved: the steered sketch is saved as a new version."
              : sessionId === null
                ? NO_OPEN_SESSION
                : null;
    page.steerLine.textContent =
      why === null && direction
        ? `Steers section ${/** @type {number} */ (selected) + 1} from where its sketch sits on ${direction.text}, a quarter of the brief's spread at a time.`
        : (why ?? "");
    for (const [name, control] of /** @type {const} */ ([
      ["steerFar", steerControls[0]],
      ["steerNear", steerControls[1]],
    ])) {
      if (!control?.held()) offWhen(buttons[name], why, idle[name]);
    }
    if (direction) {
      buttons.steerFar.firstChild?.replaceWith(`Steer toward “${direction.far}”`);
      buttons.steerNear.firstChild?.replaceWith(`Steer back from “${direction.far}”`);
    }
    drawArc();
  }

  /** Draws the chosen region stretched over the track, beside each section's measures. */
  function drawArc() {
    const draft = host.draft();
    const regionId = chosenRegion();
    buttons.arcRegion.disabled = regions.length < 2;
    page.arcRegionSelect.disabled = regions.length === 0;
    page.arc.replaceChildren();
    if (regionId === null) {
      page.arc.hidden = true;
      page.arcLine.textContent =
        "No region is attached to this brief. Attach one on the brief page to draw it here as the arc to aim the track at.";
      return;
    }
    const windows = regionWindows.get(regionId);
    if (windows === undefined) {
      page.arcLine.textContent = "Reading the region's measures…";
      return;
    }
    if (windows === null) {
      page.arc.hidden = true;
      page.arcLine.textContent =
        "This region has no measures at the brief's loudness. Measure it again on the brief page.";
      return;
    }
    const layout = draft === null ? null : timelineLayout(draft);
    const sections = draft?.sections ?? [];
    const sameSections = measured.key === JSON.stringify(sections);
    const arc = arcLayout({
      length: valid && layout ? layout.length : 0,
      windows,
      blocks: layout?.blocks ?? [],
      measures: sections.map((_, i) => (sameSections ? (measured.values[i] ?? null) : null)),
      feature: /** @type {FeatureName} */ (ARC_FEATURES[Number(page.arcFeatureSelect.value)]),
    });
    page.arc.hidden = arc.windows.length === 0;
    page.arcLine.textContent = arc.line;
    /** @param {import("./arc-layout.js").ArcMark} mark @param {string} kind */
    const markOf = ({ span, top, title }, kind) => {
      const mark = document.createElement("div");
      mark.className = `arc-mark ${kind}`;
      mark.style.left = `${span.left}%`;
      mark.style.width = `${span.width}%`;
      mark.style.top = `${top}%`;
      mark.title = title;
      return mark;
    };
    page.arc.replaceChildren(
      ...arc.windows.filter(({ top }) => top !== null).map((mark) => markOf(mark, "arc-window")),
      ...arc.sections.filter(({ top }) => top !== null).map((mark) => markOf(mark, "arc-measure")),
    );
  }

  /** Places the chosen elite after the chosen section, keeping it as a sketch first. */
  async function place() {
    const elite = chosenElite();
    const draft = host.draft();
    const view = host.view();
    if (elite === undefined || draft === null || view === null) return;
    const made = await placeElite(draft, host.selected(), elite, {
      sketches: view.sketches,
      sessionId,
      keep: postJson,
      reload: host.readSketches,
    });
    host.place(made);
    status.say(
      `${made.made ? `Kept candidate #${elite.cell.candidateId} as sketch ${made.sketch.id} and added` : `Added sketch ${made.sketch.id}`} it as section ${made.index + 1}. Save to keep it.`,
    );
  }

  /**
   * Steers the chosen section along the chosen direction, after a confirm with its cost, then
   * keeps the best point as a sketch and saves it in the section's place as a new version.
   * @param {Toward} toward
   */
  async function steer(toward) {
    const draft = host.draft();
    const at = host.selected();
    const direction = chosenDirection();
    const view = host.view();
    if (draft === null || at === null || !direction || view === null || sessionId === null) return;
    const from = /** @type {Section} */ (draft.sections[at]);
    const row = panel?.sketches.find(({ sketch }) => sketch.id === from.sketchId);
    if (!row) throw new Error(`sketch ${from.sketchId} isn't one of this brief's sketches`);
    const placed = row.positions.find(({ directionId }) => directionId === direction.id) ?? {
      directionId: direction.id,
      position: null,
    };
    /** @type {{ seconds: StepSeconds, measured: boolean }} */
    const { seconds, measured: timed } = await getJson(SEARCH_ESTIMATE_PATH);
    const asked = `${steerCostText(DEFAULT_STEER_BUDGET, seconds, { measured: timed })} The best point is kept as a sketch and saved in section ${at + 1}'s place as a new version of this track. ${STEER_LEAVE}`;
    if (!confirm(asked)) {
      status.say(NOT_STARTED);
      return;
    }
    const session = sessionId;
    const openedThen = host.opened();
    try {
      const finished = await runJob(status, {
        path: `${sessionPath(session)}/steers`,
        body: steerBody(row.sketch.candidateId, placed, toward),
        controls: steerControls,
        boxes: page.steerJobBox,
        started: `Steering section ${at + 1} in session ${session}. ${STEER_LEAVE}`,
      });
      if (finished === null) return;
      if (finished.refused) {
        status.say("That steer was for another choice. Press the steer button again.");
        return;
      }
      // Off again while the best point is kept and saved, so a second press can't steer twice.
      for (const control of steerControls) control.wait();
      /** @type {ActionSketch} */
      const kept = await keepSteered(finished.result, {
        sessionId: session,
        candidates: async () => (await getJson(`${sessionPath(session)}/candidates`)).candidates,
        keep: postJson,
      });
      await host.readSketches();
      await swapIn({ from, at, openedThen }, kept, direction.text);
      void status.run(load);
    } finally {
      for (const control of steerControls) control.release();
      redraw();
    }
  }

  /**
   * Puts the steered sketch in the place of the section it was steered from, and saves it as a
   * new version unless the timeline has changes the owner hasn't saved.
   * @param {{ from: Section, at: number, openedThen: number }} started the section, its place
   *   and the count of versions opened by hand when the steer started
   * @param {ActionSketch} kept
   * @param {string} along the direction's words
   */
  async function swapIn({ from, at, openedThen }, kept, along) {
    const draft = host.draft();
    if (draft === null) return;
    const swap = steerSwap({
      arrangement: draft,
      from,
      at,
      openedThen,
      openedNow: host.opened(),
      unsaved: host.unsaved(),
    });
    if (swap.kind === SWAP.skip) {
      status.say(
        `Kept the steered sound as sketch ${kept.id} but didn't swap it in: ${swap.reason}. Add it from the list.`,
      );
      return;
    }
    const { index } = swap;
    const swapped = swapSketch(draft, index, kept.id, host.view()?.developments ?? []);
    if (swap.kind === SWAP.edit) {
      host.place({ arrangement: swapped, index });
      status.say(`Put sketch ${kept.id} in section ${index + 1}. Save to keep it.`);
      return;
    }
    await host.save(swapped, `Section ${index + 1} steered along ${along}`);
    status.say(`Saved sketch ${kept.id}, steered along ${along}, in section ${index + 1}.`);
  }

  /** Steps a select to its next option, back to the first after the last. */
  function stepSelect(/** @type {HTMLSelectElement} */ select) {
    if (select.options.length === 0) return;
    select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
  }

  const actions = /** @type {Record<MaterialAction, () => void>} */ ({
    placeElite: () => {
      if (!buttons.placeElite.disabled) void status.run(place);
    },
    steerFar: () => {
      if (!buttons.steerFar.disabled) void status.run(() => steer(TOWARD.far));
    },
    steerNear: () => {
      if (!buttons.steerNear.disabled) void status.run(() => steer(TOWARD.near));
    },
    arcFeature: () => {
      stepSelect(page.arcFeatureSelect);
      redraw();
    },
    arcRegion: () => {
      stepSelect(page.arcRegionSelect);
      redraw();
      void status.run(readRegion);
    },
  });
  for (const [name, action] of Object.entries(actions)) {
    buttons[/** @type {MaterialAction} */ (name)].onclick = action;
  }
  bindMaterialKeys(document, actions, () => document.activeElement);
  page.eliteSelect.onchange = () => redraw();
  page.directionSelect.onchange = () => redraw();
  page.arcFeatureSelect.onchange = () => redraw();
  page.arcRegionSelect.onchange = () => {
    redraw();
    void status.run(readRegion);
  };

  return {
    load,
    draw(isValid) {
      valid = isValid;
      redraw();
      void status.run(readMeasures);
    },
    remeasure() {
      measured = { key: "", values: [] };
      void status.run(readMeasures);
    },
  };
}
