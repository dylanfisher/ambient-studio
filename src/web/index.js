// The dashboard (decisions 0028, 0030 and 0032): how the studio works, every brief, newest edit
// first, each linking to its page; and the starting points, each added as a brief once. A brief
// is a vibe in the API and the store.
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { getJson, postJson, SEED_VIBES_PATH, VIBES_PATH } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { formatTime } from "./format-time.js";
import { oneAtATime } from "./one-at-a-time.js";
import { statusLine } from "./status-line.js";
import "./topbar-jobs.js";

const status = statusLine();
const page = elementsById({
  briefList: HTMLUListElement,
  noBriefs: HTMLElement,
  seedList: HTMLUListElement,
  engineVersion: HTMLElement,
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
  return vibes.length;
}

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
