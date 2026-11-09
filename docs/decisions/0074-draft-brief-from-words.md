# 0074. The model drafts or reworks a brief from the owner's words, filling the form unsaved

- **Date:** 2026-11-08
- **Status:** accepted; the owner confirmed that the form's unsaved values are what a rework
  sends, that a new brief's requests aren't stored, the 1 000-character limit on the words, and
  that saved targets the form doesn't show are kept as they are. Amends [0024](0024-prompt-parse-repair-generation.md) (a third answer through
  `sendRequest` and the shared parse step, `judgeAnswer`) and [0067](0067-proposed-track.md)
  (`judgeProposal` now calls `judgeAnswer`)

## Context

Writing a brief by hand means choosing among 14 constraint kinds and 7 feature ranges whose
numbers the owner doesn't think in. The owner wants to type how a brief should be ("slow, dark,
underwater drone, almost no rhythm, a little bell now and then") and have the model fill in the
name, description, rules and ranges; and, for a saved brief, to say how it should change
("colder and sparser, drop the bells") and get the whole draft back revised. omlx serves a
live site: one request at a time through the queue, short contexts (0022). A brief is a vibe
in the store, and every save appends a revision (0021).

## Decision

**Describe the brief** sits at the top of the brief form: a text box and a button, Fill in the
brief on a new brief and Rework the brief on a saved one. A confirm states the request (one or
two requests to the model, the answer fills the form, nothing is saved until Save) and its time
from the median of recent request times, the breed estimate's route, as Propose's does
(`requestsTimeText`). The answer **fills the form, unsaved**: name, description, every rule and
every range. The owner reviews and edits it and presses the existing Save, which saves a new
revision or creates the brief. Drafting writes no revision.

**What a rework sends** is the form as it is now, unsaved edits included, since that is what the
owner sees and what Save would write; it must pass the form's own checks first. A new brief's
form sends nothing when it is empty, and its values when anything is filled in. The saved soft
targets' keys other than the ranges are not sent and stay as Save keeps them.

**Routes and the job.** `POST /api/brief-drafts {words, current}` for a new brief and
`POST /api/vibes/:id/drafts {words, current}` for a saved one. `words` is 1 to 1 000 characters
(`MAX_CHARS.draftWords`); `current` is null or a draft checked by the save route's `readDraft`,
with a blank name and description allowed. The route builds the prompt, refuses one over its
budget (a 400), refuses a second unfinished draft (a 409 naming it), and adds a `draft-brief`
job. Cancelling it cancels the omlx queue, as a proposal's does: the runner runs one job at a
time, so the queue holds only this job's requests. The job's result is
`{draft, repaired, generationId}`, read by the page from the finished job.

**The prompt** (`buildDraftBriefPrompt` in `src/domain/draft-brief-prompt.js`) is two messages.
- *system*: the task, the answer format `{name, brief, constraints, softTargets: {features}}`
  (the draft's own fields, `VIBE_DRAFT_FIELD`, moved to `src/domain/vibe-draft.js` for this),
  the name's and description's limits, and every constraint kind from `CONSTRAINT_KINDS`: its
  value's shape from its descriptor (`valueText`), and the line the candidates' prompt writes
  for one value (`kind.text`), so the model reads each kind in the words the candidates' model
  will. Then the voice types with their descriptions, each tuning's keys and scales from the
  genome schema text (`pitchLines`), and every range feature from `TARGET_FEATURES` with its
  bounds in `rangeWords`. Set a kind or a range only where the words call for it.
- *user*: for a new brief, the words as a JSON string; for a rework, the brief now as JSON, the
  ranges alone under its soft targets, then the words, asking for the whole brief again with
  what the words don't change kept.
- *The budget*: the first prompt gets half the context budget (4 096 of 8 192), leaving the
  other half for the repair, as 0024 does. With a 200-character name, a 4 000-character
  description and 1 000 characters of words it is about 2 650 tokens; the test holds it under
  2 800. There is nothing to trim, so a prompt over the budget is refused.

**The check** (`judgeDraftBrief` in `src/domain/check-draft-brief.js`): an answer cut off at
`max_tokens`, with no JSON, invalid JSON or several objects is rejected with no repair, the
step it shares with a proposal (`judgeAnswer`). A parsed one is held to the four fields
(rule `answer`), its name and description to non-empty strings within the save route's limits,
its constraints to `validateConstraints` and its soft targets to `validateTargets` with
`features` their only key, the validators Save uses. Each finding's path starts at the answer
and its rule is the field it is under.

**The repair** is one round, for a parsed answer with findings: the first prompt, the parsed
answer as compact JSON, and every finding as `- path (rule): message`, asking for the whole
corrected object (0024). A repair over the context budget isn't sent. When the draft is still
invalid, or had nothing to repair, the job fails listing every finding, the page shows it in the
job's box, and the form is left as it was.

**Requests and storage.** A rework's requests go through `sendRequest`: one `generations` row
each, of the brief's current revision, round 0 and round 1 naming the first in `repairsId`, with
the exact prompt, under the request group `vibe-<vibeId>-draft-<seed>` (operator `draft`, as a
proposal names `arrange`). The prompt may hold unsaved edits; it is stored as sent. A new
brief's requests go straight to the queue and aren't stored: a generation row needs a vibe
revision, and there is none yet. The sampling is the stream's first draw.

## Alternatives considered

- **Saving the model's draft as a revision** — rejected: the owner asked to review and edit it
  first, and the revision list would fill with drafts never kept.
- **Sending the saved revision for a rework** — rejected: the owner reworks what the page shows;
  unsaved edits would be lost from what the model reads and then overwritten in the form.
- **Storing a new brief's requests** — rejected for now: `generations.vibeRevisionId` is
  `NOT NULL`, and making it nullable is a migration of irreplaceable rows for prompts that train
  nothing. Creating the vibe first would save a brief the owner hasn't pressed Save on.
- **Rules and ranges as words the server turns into values** — rejected: the answer would need
  a second parser, and the validators already say exactly what is wrong for the repair.
- **Describing every kind from scratch in the prompt** — rejected: the kind's own `text` and
  descriptor already say it, and a new kind then reaches the prompt with no change here.

## Consequences

- A new constraint kind or range feature appears in the prompt with no change to it.
- The model can set rules the owner didn't ask for; the form shows every one before Save, and
  "What the model is told" under the rules says them in the candidates' words.
- New-brief drafts don't count toward the request-time estimate; reworks do.
- The 1 000-character limit and the prompt's wording are guesses until the owner has used it.
