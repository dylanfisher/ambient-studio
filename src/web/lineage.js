// The lineage page (decision 0039): every candidate of a brief's sessions as nested lists, each
// under the one it was made from, playable, with explore and nudge controls on each. The
// new candidates go to one open session of the brief: the one the page was opened from, or the
// newest. Rejected candidates show only behind the switch.
/** @import { Branch } from "./lineage-tree.js" */
/** @import { SteerControls } from "./steer-controls.js" */
import { getJson, VIBES_PATH } from "./api.js";
import { briefJobs, briefQuery, NO_OPEN_SESSION, targetSession } from "./brief-jobs.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { mountPlayer } from "./excerpt-player.js";
import { TONE } from "./job-view.js";
import { lineageTree } from "./lineage-tree.js";
import { intentText, operatorLabel, originText, rejectText } from "./origin-text.js";
import { statusLine } from "./status-line.js";
import { steerControls } from "./steer-controls.js";

const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  briefLink: HTMLAnchorElement,
  sessionLine: HTMLElement,
  sessionLink: HTMLAnchorElement,
  rejectedSwitch: HTMLInputElement,
  jobBox: HTMLElement,
  noNodes: HTMLElement,
  tree: HTMLUListElement,
});
const { vibeId, fromSession } = briefQuery(status, location.search);

/**
 * A node as `GET /api/vibes/:id/lineage` gives it.
 * @typedef {object} LineageNode
 * @property {number} id
 * @property {number} sessionId
 * @property {number[]} parentIds
 * @property {string | null} operator
 * @property {any} operatorParams
 * @property {string | null} intent
 * @property {string | null} rejectReason
 * @property {{ firstTryId: number, revisionId: number, shownId: number } | null} pair
 * @property {{ renderId: number, url: string, duration: number } | null} excerpt
 * @property {{ thumbs: string | null, compared: number }} marks
 * @property {boolean} sketch
 */

const NODE_PARTS = Object.freeze({
  heading: HTMLElement,
  operator: HTMLElement,
  thumbs: HTMLElement,
  sketch: HTMLElement,
  pair: HTMLElement,
  sessionLink: HTMLAnchorElement,
  intent: HTMLElement,
  origin: HTMLElement,
  audio: HTMLAudioElement,
  missing: HTMLElement,
  steer: HTMLElement,
  children: HTMLUListElement,
});

/**
 * A node on the page. It is updated in place on a reload, so an excerpt playing or a direction
 * being typed in it carries on.
 * @typedef {object} Shown
 * @property {LineageNode} node
 * @property {ReturnType<typeof cloneTemplate<typeof NODE_PARTS>>} parts
 * @property {SteerControls | null} steer null for a rejected node, which can't be a base
 */

/** @type {Map<number, Shown>} */
let shown = new Map();
/** @type {number | null} the open session new candidates go to */
let target = null;

/** @param {number} id */
const nameOf = (id) => `candidate #${id}`;

/** @param {Shown} entry */
function showNode(entry) {
  const { node, parts } = entry;
  parts.heading.textContent = `Candidate #${node.id}`;
  parts.operator.textContent = operatorLabel(node.operator);
  parts.sessionLink.href = `./session.html?id=${node.sessionId}`;
  parts.sessionLink.textContent = `session ${node.sessionId}`;
  parts.origin.textContent = originText(node, nameOf);
  const { thumbs } = node.marks;
  parts.thumbs.hidden = thumbs === null;
  parts.thumbs.textContent = thumbs === null ? "" : `Thumbs ${thumbs}`;
  parts.thumbs.className = `badge ${thumbs === "up" ? TONE.good : TONE.bad}`;
  parts.sketch.hidden = !node.sketch;
  parts.pair.hidden = node.pair === null;
  parts.pair.textContent =
    node.pair?.shownId === node.id ? "Shown of its pair" : "The other of its pair is shown";
  if (node.rejectReason !== null) {
    const meant = node.intent ? `, meant as “${node.intent}”` : "";
    parts.intent.textContent = `Rejected: ${rejectText(node)}${meant}.`;
    parts.audio.hidden = true;
    parts.missing.hidden = true;
    return;
  }
  parts.intent.textContent = intentText(node);
  const { excerpt } = node;
  parts.audio.hidden = !excerpt;
  parts.missing.hidden = Boolean(excerpt);
  parts.missing.textContent =
    "No excerpt yet: it is rendered by the job that made it, or by Render missing excerpts on its session page.";
  const url = excerpt ? new URL(excerpt.url, location.href).href : "";
  // Only a new render changes the source, so a reload doesn't stop an excerpt playing.
  if (excerpt && parts.audio.src !== url) parts.audio.src = excerpt.url;
}

/** Turns the explore and nudge buttons off when there is no open session to send to. */
function showSteer() {
  const why = target === null ? NO_OPEN_SESSION : null;
  for (const entry of shown.values()) entry.steer?.off(why);
}

const { start, resume } = briefJobs({
  status,
  boxes: page.jobBox,
  reload: () => loadTree(),
  done: "The job is done. Its candidates are in the tree; rate them on the session page.",
  started: () => `Started in session ${target}. The new candidates appear here as they are ready.`,
  settle: () => showSteer(),
});

/**
 * @param {LineageNode} node
 * @returns {Shown}
 */
function makeNode(node) {
  const parts = cloneTemplate("lineage-node", NODE_PARTS);
  mountPlayer(parts.audio, status.fail);
  const steer =
    node.rejectReason === null
      ? steerControls({ candidateId: node.id, sessionId: () => target, start, run: status.run })
      : null;
  if (steer) parts.steer.append(steer.root);
  parts.audio.addEventListener("play", () => {
    for (const other of shown.values())
      if (other.parts.audio !== parts.audio) other.parts.audio.pause();
  });
  parts.audio.addEventListener("error", () =>
    status.fail(
      new Error(
        `The excerpt of candidate #${node.id} didn't play: media error ${parts.audio.error?.code}`,
      ),
    ),
  );
  return { node, parts, steer };
}

/**
 * Adds the branches' nodes not yet on the page to `list`, and updates the others in place. A
 * new node is always the newest under its parent, so appending keeps the order.
 * @param {Branch<LineageNode>[]} branches
 * @param {HTMLUListElement} list
 */
function place(branches, list) {
  for (const { node, children, parentMissing } of branches) {
    let entry = shown.get(node.id);
    if (entry) entry.node = node;
    else {
      entry = makeNode(node);
      shown.set(node.id, entry);
      list.append(entry.parts.root);
    }
    showNode(entry);
    if (parentMissing !== null) {
      entry.parts.origin.textContent += ` Candidate #${parentMissing} isn't shown: it is rejected (see the switch above), was removed, or was made outside a session.`;
    }
    place(children, entry.parts.children);
  }
}

/** Reads the lineage and draws what changed. */
async function loadTree() {
  const rejected = page.rejectedSwitch.checked;
  /** @type {{ nodes: LineageNode[] }} */
  const { nodes } = await getJson(`${VIBES_PATH}/${vibeId}/lineage?includeRejected=${rejected}`);
  place(lineageTree(nodes), page.tree);
  page.noNodes.hidden = nodes.length > 0;
  showSteer();
}

page.rejectedSwitch.onchange = () =>
  status.run(async () => {
    // Rejected nodes fall between the others, so the tree is drawn again from the start.
    for (const entry of shown.values()) entry.parts.audio.pause();
    shown = new Map();
    page.tree.replaceChildren();
    await loadTree();
    status.say(
      page.rejectedSwitch.checked
        ? "Rejected candidates are shown, each with why."
        : "Rejected candidates are hidden.",
    );
  });

status.run(async () => {
  const vibe = await getJson(`${VIBES_PATH}/${vibeId}`);
  page.briefLink.href = `./brief.html?id=${vibeId}`;
  page.briefLink.textContent = vibe.revision.name;
  page.pageTitle.textContent = `Lineage of ${vibe.revision.name}`;
  document.title = `Lineage, ${vibe.revision.name} · Ambient Studio`;
  target = targetSession(vibe.sessions, fromSession);
  page.sessionLink.hidden = target === null;
  if (target !== null) page.sessionLink.href = `./session.html?id=${target}`;
  page.sessionLine.textContent =
    target === null
      ? "Every session of this brief is stopped, so explore and nudge are off. Start a session from the brief page."
      : `Explores and nudges from here go to session ${target}${fromSession !== null && fromSession !== target ? `, since session ${fromSession} is stopped` : ""}.`;
  await loadTree();
  await resume(target);
  status.say(
    shown.size === 0
      ? "No candidates yet."
      : "Play a candidate, then explore or nudge from it to make more from there.",
  );
});
