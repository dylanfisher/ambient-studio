// The vibe list (decision 0028): every vibe, newest edit first, each linking to its page.
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { getJson, VIBES_PATH } from "./api.js";
import { bindKeys } from "./bind-keys.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { formatTime } from "./format-time.js";
import { statusLine } from "./status-line.js";

const status = statusLine();
const page = elementsById({
  vibeList: HTMLUListElement,
  noVibes: HTMLElement,
  engineVersion: HTMLElement,
});
page.engineVersion.textContent = `Engine version ${ENGINE_VERSION}.`;

/** The most of a brief's first line the list shows. */
const BRIEF_SHOWN = 240;

/** @returns {HTMLAnchorElement[]} */
const links = () => [...page.vibeList.querySelectorAll("a")];

/** @param {number} step +1 for the next vibe, -1 for the previous */
function move(step) {
  const all = links();
  if (all.length === 0) throw new Error("No vibes yet; press n to make one.");
  const at = all.indexOf(/** @type {HTMLAnchorElement} */ (document.activeElement));
  const next = at === -1 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length;
  all[next]?.focus();
}

bindKeys(
  {
    list: {
      nextVibe: () => move(1),
      previousVibe: () => move(-1),
      openVibe: () => {
        const focused = links().find((link) => link === document.activeElement) ?? links()[0];
        if (!focused) throw new Error("No vibes yet; press n to make one.");
        location.assign(focused.href);
      },
      newVibe: () => location.assign("./vibe.html"),
    },
  },
  "list",
  status.run,
);

status.run(async () => {
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
      const brief = vibe.revision.brief.split("\n")[0] ?? "";
      item.brief.textContent =
        brief.length > BRIEF_SHOWN ? `${brief.slice(0, BRIEF_SHOWN)}…` : brief;
      item.edited.textContent = `Edited ${formatTime(vibe.revision.createdAt)}`;
      return item.root;
    }),
  );
  page.noVibes.hidden = vibes.length > 0;
  status.say(`${vibes.length} vibe${vibes.length === 1 ? "" : "s"}. Press j to move.`);
  links()[0]?.focus();
});
