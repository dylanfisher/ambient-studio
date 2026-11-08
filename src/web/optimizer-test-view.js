// The optimizer test's section of the model test page (decision 0059): tick briefs, optionally
// name the candidates to start from, confirm the cost, follow the job with its cancel, and show
// the newest stored test, one card per brief, with links to rate each session's spot-check pairs
// in Quick A/B. A test already running when the page opens is followed, so a reload keeps it.
/** @import { statusLine } from "./status-line.js" */
import { OPTIMIZER_TEST } from "../domain/optimizer-report.js";
import { optimizerTestCostText } from "../domain/search-cost.js";
import { DEFAULT_SEARCH_BUDGET, MAX_SEARCH_BUDGET } from "../domain/search-settings.js";
import { getJson, OPTIMIZER_TESTS_PATH } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { factRows } from "./fact-rows.js";
import { formatTime } from "./format-time.js";
import { baseIds, optimizerFacts, optimizerSummary } from "./optimizer-test-text.js";
import { ownerJob } from "./owner-job.js";

/**
 * Wires the section and shows the newest stored test.
 * @param {ReturnType<typeof statusLine>} status the page's status line
 * @param {readonly { id: number, revision: { name: string } }[]} vibes the briefs to offer
 */
export function optimizerTestView(status, vibes) {
  const page = elementsById({
    optimizerChoices: HTMLElement,
    optimizerBudget: HTMLInputElement,
    optimizerButton: HTMLButtonElement,
    optimizerWhen: HTMLElement,
    optimizerJobBox: HTMLElement,
    optimizerNone: HTMLElement,
    optimizerResults: HTMLElement,
  });
  page.optimizerBudget.value = String(DEFAULT_SEARCH_BUDGET);
  page.optimizerBudget.max = String(MAX_SEARCH_BUDGET);
  /** @type {{ vibeId: number, name: string, input: HTMLInputElement, bases: HTMLInputElement }[]} */
  const choices = vibes.map((vibe) => {
    const choice = cloneTemplate("optimizer-choice", {
      input: HTMLInputElement,
      name: HTMLElement,
      bases: HTMLInputElement,
    });
    choice.input.title = `Includes the brief ${vibe.revision.name} in the next optimizer test.`;
    choice.name.textContent = vibe.revision.name;
    page.optimizerChoices.append(choice.root);
    return { vibeId: vibe.id, name: vibe.revision.name, input: choice.input, bases: choice.bases };
  });
  /** @type {{ seconds: { render: number, embed: number }, measured: boolean } | null} */
  let estimate = null;
  /** @param {any[]} tests oldest first */
  function show(tests) {
    const newest = tests.at(-1) ?? null;
    page.optimizerNone.hidden = newest !== null;
    page.optimizerWhen.textContent =
      newest === null
        ? ""
        : `Last run ${formatTime(newest.createdAt)}, ${newest.params.budget} evaluations a search.` +
          (tests.length > 1 ? ` ${tests.length - 1} earlier tests are stored.` : "");
    page.optimizerResults.replaceChildren(
      ...(newest?.report.vibes ?? []).map((/** @type {any} */ vibe) => {
        const card = cloneTemplate("optimizer-card", {
          title: HTMLElement,
          summary: HTMLElement,
          facts: HTMLElement,
          links: HTMLElement,
        });
        card.title.textContent = vibe.name;
        card.summary.textContent = optimizerSummary(vibe);
        const facts = optimizerFacts(vibe);
        card.facts.replaceChildren(...factRows(facts));
        card.facts.hidden = facts.length === 0;
        card.links.replaceChildren(
          ...(vibe.sessions ?? [])
            .filter((/** @type {any} */ s) => s.unrated > 0)
            .map((/** @type {{ sessionId: number, unrated: number }} */ { sessionId, unrated }) => {
              const { root } = cloneTemplate("optimizer-spot-link", {});
              const link = /** @type {HTMLAnchorElement} */ (root);
              link.href = `./quick-ab.html?id=${sessionId}&spot`;
              link.textContent = `Rate ${unrated} blind pair${unrated === 1 ? "" : "s"} in session ${sessionId}`;
              link.title = `Opens Quick A/B on session ${sessionId} with the optimizer test's pairs still to rate, neither side named.`;
              return link;
            }),
        );
        card.links.hidden = card.links.childElementCount === 0;
        return card.root;
      }),
    );
  }

  /** The body the test starts with, once the owner confirms its cost; null when declined. */
  function body() {
    const ticked = choices.filter((choice) => choice.input.checked);
    if (ticked.length === 0) throw new Error("Tick at least one brief for the optimizer test.");
    const chosen = ticked.map(({ vibeId, name, bases }) => ({
      vibeId,
      candidateIds: baseIds(bases.value, name),
    }));
    const budget = Number(page.optimizerBudget.value);
    if (!Number.isInteger(budget) || budget < 1 || budget > MAX_SEARCH_BUDGET) {
      throw new Error(
        `Evaluations per search must be a whole number from 1 to ${MAX_SEARCH_BUDGET}.`,
      );
    }
    if (estimate === null) {
      throw new Error("The time estimate hasn't loaded yet; try again in a moment.");
    }
    const asked = optimizerTestCostText(
      chosen.length,
      OPTIMIZER_TEST.runs,
      budget,
      estimate.seconds,
      estimate,
    );
    return confirm(asked) ? { vibes: chosen, budget } : null;
  }

  const job = ownerJob(status, {
    button: page.optimizerButton,
    boxes: page.optimizerJobBox,
    path: OPTIMIZER_TESTS_PATH,
    started: "The optimizer test started.",
    done: "The optimizer test is done; its result is below. Rate the blind pairs to finish it.",
    body,
    onEnd: load,
  });

  async function load() {
    const listed = await getJson(OPTIMIZER_TESTS_PATH);
    estimate = listed.estimate;
    show(listed.tests);
    if (listed.job) status.run(() => job.follow(listed.job));
  }

  return load();
}
