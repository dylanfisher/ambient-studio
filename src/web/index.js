// The vibe list (decisions 0028 and 0030): every vibe, newest edit first, each linking to its
// page; and the seed vibes, each loaded as a new vibe once.
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { getJson, postJson, SEED_VIBES_PATH, VIBES_PATH } from "./api.js";
import { bindKeys } from "./bind-keys.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { formatTime } from "./format-time.js";
import { oneAtATime } from "./one-at-a-time.js";
import { statusLine } from "./status-line.js";

const status = statusLine();
const page = elementsById({
  vibeList: HTMLUListElement,
  noVibes: HTMLElement,
  seedList: HTMLUListElement,
  engineVersion: HTMLElement,
});
page.engineVersion.textContent = `Engine version ${ENGINE_VERSION}.`;

/** The most of a brief's first line the list shows. */
const BRIEF_SHOWN = 240;

/** @param {string} brief */
const firstLine = (brief) => {
  const line = brief.split("\n")[0] ?? "";
  return line.length > BRIEF_SHOWN ? `${line.slice(0, BRIEF_SHOWN)}…` : line;
};

/**
 * The vibes' links, then each seed's load button or link, in the order j and k move through.
 * @returns {HTMLElement[]}
 */
const items = () =>
  [
    ...page.vibeList.querySelectorAll("a"),
    ...[...page.seedList.querySelectorAll("button, a")].filter(
      (element) => !(/** @type {HTMLElement} */ (element).hidden),
    ),
  ].map((element) => /** @type {HTMLElement} */ (element));

/** @param {number} step +1 for the next item, -1 for the previous */
function move(step) {
  const all = items();
  if (all.length === 0) throw new Error("Nothing to choose yet; press n to make a vibe.");
  const at = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  const next = at === -1 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length;
  all[next]?.focus();
}

bindKeys(
  {
    list: {
      nextVibe: () => move(1),
      previousVibe: () => move(-1),
      openVibe: () => {
        const focused = items().find((item) => item === document.activeElement) ?? items()[0];
        if (!focused) throw new Error("No vibes yet; press n to make one.");
        focused.click();
      },
      newVibe: () => location.assign("./vibe.html"),
      toEvaluations: () => location.assign("./evaluation.html"),
    },
  },
  "list",
  status.run,
);

async function loadVibes() {
  /** @type {{ vibes: any[] }} */
  const { vibes } = await getJson(VIBES_PATH);
  const sorted = [...vibes].sort((a, b) => b.revision.createdAt - a.revision.createdAt);
  page.vibeList.replaceChildren(
    ...sorted.map((vibe) => {
      const item = cloneTemplate("vibe-item", {
        link: HTMLAnchorElement,
        brief: HTMLElement,
        edited: HTMLElement,
      });
      item.link.href = `./vibe.html?id=${vibe.id}`;
      item.link.textContent = vibe.revision.name;
      item.brief.textContent = firstLine(vibe.revision.brief);
      item.edited.textContent = `Edited ${formatTime(vibe.revision.createdAt)}`;
      return item.root;
    }),
  );
  page.noVibes.hidden = vibes.length > 0;
  return vibes.length;
}

async function loadSeeds() {
  /** @type {{ seeds: any[] }} */
  const { seeds } = await getJson(SEED_VIBES_PATH);
  page.seedList.replaceChildren(
    ...seeds.map((seed) => {
      const item = cloneTemplate("seed-item", {
        name: HTMLElement,
        brief: HTMLElement,
        load: HTMLButtonElement,
        loaded: HTMLAnchorElement,
      });
      item.name.textContent = seed.name;
      item.brief.textContent = seed.brief;
      if (seed.vibeId === null) {
        // One at a time, so a double press can't post the seed twice.
        const load = oneAtATime(() => loadSeed(seed.id, seed.name));
        item.load.onclick = () => status.run(load);
      } else {
        item.load.hidden = true;
        item.loaded.hidden = false;
        item.loaded.href = `./vibe.html?id=${seed.vibeId}`;
        item.loaded.textContent = `Loaded as vibe ${seed.vibeId}; open it`;
      }
      return item.root;
    }),
  );
}

/**
 * @param {string} id
 * @param {string} name
 */
async function loadSeed(id, name) {
  const vibe = await postJson(`${SEED_VIBES_PATH}/${encodeURIComponent(id)}`, {});
  await Promise.all([loadVibes(), loadSeeds()]);
  status.say(`Loaded the seed ${name} as vibe ${vibe.id}.`);
  page.vibeList.querySelector("a")?.focus();
}

status.run(async () => {
  const [count] = await Promise.all([loadVibes(), loadSeeds()]);
  status.say(`${count} vibe${count === 1 ? "" : "s"}. Press j to move.`);
  items()[0]?.focus();
});
