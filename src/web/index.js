// The dashboard (decisions 0028, 0030 and 0032): how the studio works, every brief, newest edit
// first, each linking to its page; a brief the model suggests from them, added on Approve
// (0093); and the starting points, each added as a brief once. A brief is a vibe in the API and
// the store.
/** @import { BriefDraft } from "../domain/draft-brief-prompt.js" */
import { constraintsText } from "../domain/constraints-text.js";
import { RANGES_KEY } from "../domain/target-schema.js";
import { targetsText } from "../domain/targets-text.js";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import {
  BREED_ESTIMATE_PATH,
  BRIEF_SUGGESTIONS_PATH,
  getJson,
  postJson,
  SEED_VIBES_PATH,
  VIBES_PATH,
} from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { suggestCostText, suggestedText } from "./draft-brief-text.js";
import { elementsById } from "./element-by-id.js";
import { formatTime } from "./format-time.js";
import { jobControl } from "./job-control.js";
import { oneAtATime } from "./one-at-a-time.js";
import { runJob } from "./run-job.js";
import { statusLine } from "./status-line.js";
import "./topbar-jobs.js";

const status = statusLine();
const page = elementsById({
  briefList: HTMLUListElement,
  noBriefs: HTMLElement,
  seedList: HTMLUListElement,
  engineVersion: HTMLElement,
  suggestWords: HTMLTextAreaElement,
  suggestButton: HTMLButtonElement,
  suggestBoxes: HTMLElement,
  suggestion: HTMLElement,
  suggestionName: HTMLElement,
  suggestionDescription: HTMLElement,
  suggestionRules: HTMLElement,
  approveButton: HTMLButtonElement,
  dismissButton: HTMLButtonElement,
});
page.engineVersion.textContent = `Engine version ${ENGINE_VERSION}.`;

/** The most of a description's first line the list shows. */
const DESCRIPTION_SHOWN = 240;

/** @param {string} description */
const firstLine = (description) => {
  const line = description.split("\n")[0] ?? "";
  return line.length > DESCRIPTION_SHOWN ? `${line.slice(0, DESCRIPTION_SHOWN)}…` : line;
};

async function loadBriefs() {
  /** @type {{ vibes: any[] }} */
  const { vibes } = await getJson(VIBES_PATH);
  const sorted = [...vibes].sort((a, b) => b.revision.createdAt - a.revision.createdAt);
  page.briefList.replaceChildren(
    ...sorted.map((vibe) => {
      const item = cloneTemplate("brief-item", {
        link: HTMLAnchorElement,
        description: HTMLElement,
        edited: HTMLElement,
      });
      item.link.href = `./brief.html?id=${vibe.id}`;
      item.link.textContent = vibe.revision.name;
      item.link.title = `Opens the brief ${vibe.revision.name}, to edit it, start a session or read its ratings.`;
      item.description.textContent = firstLine(vibe.revision.brief);
      item.edited.textContent = `Edited ${formatTime(vibe.revision.createdAt)}`;
      return item.root;
    }),
  );
  page.noBriefs.hidden = vibes.length > 0;
  briefCount = vibes.length;
  return vibes.length;
}

/** How many briefs the list shows, for the suggestion's confirm. */
let briefCount = 0;

/** The model's suggestion on show, or null for none. */
/** @type {BriefDraft | null} */
let suggested = null;

const suggestControl = jobControl(page.suggestButton);

/** @param {BriefDraft | null} draft */
function showSuggestion(draft) {
  suggested = draft;
  page.suggestion.hidden = draft === null;
  if (draft === null) return;
  page.suggestionName.textContent = draft.name;
  page.suggestionDescription.textContent = draft.brief;
  page.suggestionRules.textContent = [
    constraintsText(draft.constraints),
    targetsText(draft.softTargets[RANGES_KEY] ?? {}),
  ]
    .filter((text) => text !== "")
    .join("\n\n");
}

/**
 * Asks the model for a new brief from the owner's briefs and words, after a confirm, and shows
 * it to approve (decision 0093). Nothing is saved.
 */
async function suggestBrief() {
  if (!confirm(suggestCostText(briefCount, await getJson(BREED_ESTIMATE_PATH)))) return;
  showSuggestion(null);
  const finished = await runJob(status, {
    path: BRIEF_SUGGESTIONS_PATH,
    body: { words: page.suggestWords.value.trim() },
    controls: [suggestControl],
    boxes: page.suggestBoxes,
    started:
      "Asking the model to suggest a brief from yours. Nothing is saved until you press Approve.",
  });
  if (finished === null) return;
  if (finished.refused !== null) {
    status.say(`${finished.refused} That job has finished; press Suggest a brief again.`);
    return;
  }
  showSuggestion(finished.result.draft);
  status.say(suggestedText(finished.result));
}

// One at a time, and off while it posts, so a double click adds the brief once.
const approve = oneAtATime(async () => {
  if (suggested === null) throw new Error("There is no suggestion to approve.");
  page.approveButton.disabled = true;
  try {
    const vibe = await postJson(VIBES_PATH, suggested);
    showSuggestion(null);
    await loadBriefs();
    status.say(`Added ${vibe.revision.name} as a brief. Open it to edit it or start a session.`);
  } finally {
    page.approveButton.disabled = false;
  }
});

page.suggestButton.onclick = () => status.run(suggestBrief);
page.approveButton.onclick = () => status.run(approve);
page.dismissButton.onclick = () => {
  showSuggestion(null);
  status.say("Dropped the suggestion. Nothing was saved.");
};

async function loadSeeds() {
  /** @type {{ seeds: any[] }} */
  const { seeds } = await getJson(SEED_VIBES_PATH);
  page.seedList.replaceChildren(
    ...seeds.map((seed) => {
      const item = cloneTemplate("seed-item", {
        name: HTMLElement,
        description: HTMLElement,
        add: HTMLButtonElement,
        added: HTMLAnchorElement,
      });
      item.name.textContent = seed.name;
      item.description.textContent = seed.brief;
      if (seed.vibeId === null) {
        // One at a time, and off while it posts, so a double click adds the brief once.
        const add = oneAtATime(async () => {
          item.add.disabled = true;
          try {
            await addSeed(seed.id, seed.name);
          } finally {
            item.add.disabled = false;
          }
        });
        item.add.onclick = () => status.run(add);
      } else {
        item.add.hidden = true;
        item.added.hidden = false;
        item.added.href = `./brief.html?id=${seed.vibeId}`;
        item.added.textContent = "Added as a brief; open it";
      }
      return item.root;
    }),
  );
}

/**
 * @param {string} id
 * @param {string} name
 */
async function addSeed(id, name) {
  await postJson(`${SEED_VIBES_PATH}/${encodeURIComponent(id)}`, {});
  await Promise.all([loadBriefs(), loadSeeds()]);
  status.say(`Added ${name} as a brief. Open it to start a session.`);
}

status.run(async () => {
  const [count] = await Promise.all([loadBriefs(), loadSeeds()]);
  status.say(
    count === 0
      ? "No briefs yet. Write one, or add a starting point."
      : `${count} brief${count === 1 ? "" : "s"}. Open one to start a session.`,
  );
});
