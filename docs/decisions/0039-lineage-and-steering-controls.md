# 0039. Lineage and the steering controls: a vibe's tree as nested lists, and locks, ranges, explore and nudge on each card

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0032](0032-plain-language-pages.md) (the session card's new controls, the lineage page, the
  nudge and explore job titles).

## Context

Phase 3 gave candidates parents and operators: a revision under its first try (0036), a nudge's
children (0037) and an explore's variations (0038) under their base, in any session of the vibe.
Locks (0035) and ranges (0034) existed only as routes and stored values, and explore and nudge
were reachable only by HTTP. Acceptance 4 asks for a lineage page that shows a vibe's session
candidates as a tree, every node playable, with "explore from here" on each. The owner tests on
Safari 17.6, and pages are plain HTML and ES modules with a title on every control (0032).

## Decision

**The lineage route.** `GET /api/vibes/:vibeId/lineage` lists every live candidate of every
session of the vibe, oldest first, as `{nodes}`. Each node is:

| Field | What |
|---|---|
| `id`, `sessionId`, `genomeId`, `seed`, `createdAt` | as stored |
| `parentIds` | as stored, with an unchanged revision's id replaced by its first try's |
| `operator`, `operatorParams`, `intent`, `rejectReason` | as stored; a nudge's step size and an explore's direction and `baseTrimmed` are in `operatorParams` |
| `pair` | the candidates route's `{firstTryId, revisionId, shownId}` or null (0036) |
| `excerpt` | `{renderId, url, duration}` of the current excerpt, or null |
| `marks` | `{thumbs, compared}`: the live thumbs direction or null, and the number of A/B ratings with this genome and seed on a side |
| `sketch` | whether a live sketch was kept from it |

Left out: evaluation candidates (no session, found by listing the vibe's sessions), 3h's
control-arm candidates (operator `revise-control`, `OPERATOR.reviseControl` in
`src/domain/operator.js`, left out by name even when they carry a session), and unchanged
revisions, folded into their first try as the session page folds them. A node made from an
unchanged revision sits under its first try. Rejected candidates are left out unless
`?includeRejected=true`; any value but `true` or `false` is a 400.

**The tree.** `lineageTree(nodes)` (`src/web/lineage-tree.js`, no DOM) nests each node under its
first parent. A parent must come before its child in the list, as it does in id order, so the
tree can't loop; a node whose parent isn't listed (removed, or an evaluation candidate a request
named by HTTP) is a root that names it.

**The lineage page** (`lineage.html`) draws the tree as nested `<ul>`s, each child list indented
with a rule. Each node shows its id, an operator badge (first try, revised, nudged, variation),
its thumbs, sketch and pair marks, its intent, how it was made (`originText`), a player, and the
explore and nudge controls. A rejected node shows why instead of a player and has no controls,
since it can't be a base. Rejected nodes are behind a "Show rejected candidates" switch, which
reads the route again with `includeRejected`. A reload adds new nodes and updates the rest in
place, so a playing excerpt or a typed direction survives a job's progress; the switch draws
the tree again from the start, since rejected nodes fall between the others. The page is opened
from the brief page (the Sessions card) and the session page (beside Stop the session).

**Where children go.** Explore and nudge need a session (0037: the children belong to the session
the request is sent to). The lineage page sends to the session it was opened from while that is
open, and otherwise to the vibe's newest open session, and says which. With every session
stopped the buttons are off and their title says to start one on the brief page. The page
follows the job and draws its children as they arrive; rating stays on the session page.

**On each session card:**

- **How it was made.** The card shows its row id (`#14`, the lineage page's name for it) and a
  line from `originText` (`src/web/origin-text.js`): a first try, the model's revision of
  candidate 3, a small nudge of candidate 3, or the model's variation of candidate 3 toward
  “slower”, with a line when its base was trimmed. A nudge child's intent line says it has none
  of its own instead of "The model gave no intent". A rejected nudge draw is listed as a draw
  that broke the rules or landed on a genome already made, and the rejected list's summary
  counts model answers and nudge draws apart. Every text the owner or the model wrote is set
  with `textContent`.
- **The ranges readout.** `rangesReadout(features, ranges, checks)` (`src/web/ranges-readout.js`)
  gives one row per range the brief sets, with the value at the prompt's rounding and the range
  in the prompt's words, and marks a miss exactly where `checkTargets` finds one. Its line also
  names each render check the excerpt fails, and its count of misses is `excerptMisses`'s, ranges
  and checks together, as the shown-card rule counts them. Each row reads
  "Misses: …" or "Inside: …", so a miss isn't shown by color alone. A card is read against the
  ranges of the brief version it was made under (`vibeRevisionId`, now on the candidates route),
  as the revision pass and the shown-card rule read it, so the readout agrees with which card of
  a pair is shown. The readout is hidden when the version sets no ranges and every check passes.
- **Locks.** A "Locks" disclosure lists the vibe's live locks, each with Unlock, and a select of
  what can be locked on this candidate (`lockChoices`, `src/domain/lock-choices.js`, moved down
  from `src/web` by 0085 for the locks words set): the whole piece's values, the macros, and each voice whole or one parameter at a time, only what the
  genome holds. After a lock, `macroOffer(macros, locks)` (`src/web/macro-offer.js`) takes the
  route's `macros` less those already locked and, when any are left, the card asks "A locked
  value still follows the macros, and brightness and space move this one. Lock them too, so it
  sounds the same?", with "Lock those macros too" (one lock request per macro, from the same
  candidate) and "Leave them free". The list is the vibe's, so every card shows the same locks.
- **Explore and nudge.** `steerControls` (`src/web/steer-controls.js`) builds both pages'
  controls from a `steer-controls` template: a direction field (at most `DIRECTION_CHARS`, 200,
  and checked against `NOT_ONE_LINE` before it is sent; both now in
  `src/domain/explore-direction.js`, which the server reads too) with "Explore from here", and a
  step size select built from `STEP_SIZE` with "Nudge from here". Each request sends its count,
  `DEFAULT_EXPLORES` (4) or `DEFAULT_NUDGES` (8), now in `src/domain/explore-direction.js` and
  `src/domain/nudge.js`, where the server reads its defaults too, and `steerTitles()` writes
  both buttons' titles from the same constants, so a title can't name another count than the
  one sent. The template is copied into `session.html` and `lineage.html`: `cloneTemplate`
  reads a `<template>` of the page it runs in, and with no build step, sharing one would need a
  new mechanism (fetching an HTML fragment, or building the markup in script), which costs more
  than keeping the two copies equal. Each button is off from its click until its job
  finishes, as 0032's job buttons are, and a 409 naming the same job follows that job. A
  direction typed and not sent holds the card's pair swap, as an unsent note does (0036).
- **What holds a card.** `createCardHold().held({unsentText, pending})` (`src/web/card-hold.js`)
  is the one decision: the focus, a pressed pointer, unsent text (note, tags or direction), or
  something pending, which is a rating or lock request in flight or a macro offer not yet
  answered. A click on Lock in Safari leaves no focus in the card, so without `pending` a poll
  could hide the card, and the offer with it, before the owner sees it. The swap runs again
  when the request ends and when the offer is answered or dismissed.

**Job titles.** `jobProgress` names a nudge job "Nudging a candidate" and an explore job "The
model's variations of a candidate"; before this a page following either threw on the unknown
kind.

## Alternatives considered

- **A drawn graph (canvas or SVG)** — rejected: nested lists are read by a screen reader and
  walked with Tab without extra work, and a tree with one parent a node needs no crossing edges.
- **One shared explore panel for the selected node** — rejected for the reason 0032 rejected a
  shared rating panel: a direction meant for one node could be sent from another.
- **Reading a card against the vibe's current ranges** — rejected: after the owner edits the
  ranges the readout could say the shown card of a pair misses more than the hidden one.
- **A count field beside each button** — not done: the server's defaults fit a sitting, and two
  more fields per card crowd it. Easy to add if the owner wants other counts.
- **Locks shown once at the top of the session page** — rejected for now: the plan puts them on
  the cards, beside the control that makes them, and the owner sees what a lock holds next to
  the candidate it came from.
- **Building the tree on the server** — rejected: the route stays a flat list a test reads
  easily, and nesting is a page concern tested on its own.
- **Leaving control-arm candidates out by their missing session alone** — rejected: 3h may store
  them with a session, and the plan asks they never show; the operator name is the rule.

## Consequences

- A new operator needs words in `origin-text.js` (`originText` and `operatorLabel` throw on one
  they don't know) and a decision on whether the lineage shows it.
- A new reject reason needs words in `rejectText`, or its test fails.
- The lineage route reads every session's candidates and each one's excerpt row, so a vibe with
  thousands of candidates makes a slow page. Paging can come with phase 5's optimizers.
- The lineage page plays excerpts but doesn't rate them, so played fraction and time taken stay
  measured only on the session page.
- A change to the `steer-controls` template has to be made in both pages.
