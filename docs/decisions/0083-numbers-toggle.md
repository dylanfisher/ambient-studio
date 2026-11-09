# 0083. One numbers toggle per page, closed by default

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the label words, the one button per page
  and the session's second row. Amends [0032](0032-plain-language-pages.md) (a page shows its
  raw numbers only behind the toggle; the session's Details and Locks disclosures) and
  [0049](0049-session-table-hiding-marks.md) (the session row's More controls). Amended by
  [0085](0085-session-and-brief-in-words.md) (`originText` leaves the allowlist on the session
  and lineage pages, and a search point's score moves behind the toggle).

## Context

The owner, 2026-11-09: "in majority of situations the parameters are hidden behind a toggle
(e.g. collapsed) and we use language in almost all contexts to describe and control
parameters. the goal is LLM language as the tool." Phase WF's first step (plan WF.1) hides the
raw numbers; later steps describe them in words (WF.3) and set them from words (WF.4).

Before this, each page showed its numbers in full: the brief's rules form and ranges, the
session's count, rank, positions, search budgets and steer sliders, the map's fill settings and
coverage, Quick A/B's shift sliders, the references' region times, and the model test's tables.
Disclosure was done three ways: native `<details>` (the session's Locks and Details), a
hand-made `hidden` toggle (the session row's More controls, 0049), and sections the code hides.
The oldest browser is Safari 17.6, and the pages have no build step.

## Decision

**The widget.** `src/web/numbers-toggle.js`. Each page that has numbers holds one button,
`#numbersToggle`, in its page head under the help paragraph. It reads "Show the numbers" when
closed and "Hide the numbers" when open, carries `aria-expanded`, and has the title
`NUMBERS_TITLE`, a full sentence as 0032 asks. It is a plain `<button>`, so Tab, Enter and
Space work as on any other. Pressing it sets or removes `data-numbers-open` on the page root,
and `studio.css` hides every element marked `data-numbers` while the root lacks it. The
stylesheet does the hiding, not the module, so parts a module clones from a template later (a
session row, a lineage node, a model test card) follow the page's state with no extra code.
Closed is the default.

**Per page, one button.** The state is one per page, and so is the button: it opens or closes
every marked part on the page at once, and sits in the same place on every page. A button per
card was rejected (below). A part marked `data-numbers` can be a field, its label, a line, a
badge, a fieldset or a whole block; the mark goes on the smallest element that holds only
numbers, so the words and the action buttons beside it stay in view.

**Remembered.** The open state is kept in `localStorage` under `numbers open on <page>`, the
value `open`, removed when closed: a per-viewer convenience, never data. Every read and write is
in a try/catch, and so is the reach for `localStorage` itself, which throws when the browser
blocks site data. A failure, or a stored value other than `open`, leaves the page closed and is
logged to the console, not swallowed. `sessionStorage` (0049's scroll) was not used, because a
choice to see the numbers should last past the tab.

**What moved behind it, by page:**

| Page | Behind the toggle | Still in view, and why |
|---|---|---|
| Session | the How many field; each row's rank badge and positions line; the ranges readout; the locks (was a `<details>`); the measurements and rule checks (was Details); the search budget, With a control and Search by ear's count; the steer sliders, their help line and budget | each row's second row is now always shown: its intent, the Less / More choices, note, tags and Keep as sketch, the explore direction and step size, and every action button. How it was made (`originText`) stays, search score included, until WF.3 says it in words |
| Brief | the rules form, the ranges form, Set ranges from a region, the other saved targets as JSON, the proposal's Minutes | the description, the words field and Fill in the brief, `constraintsText` and `targetsText` ("What the model is told"), the arc and region; the ratings list (allowed, below); the earlier versions' disclosure as it was |
| Lineage | the search budget, With a control and Search by ear's count | each node's intent and `originText`, the direction and step size, every action |
| Map | the fill's steps, share and With a control; the coverage line; the open cell's search settings | the cells, the axis captions and the open cell's line (allowed, below), the Fill and session buttons |
| Quick A/B | the shift sliders | the variation choice, the words field and Set the sliders from these words, Center the sliders and the steering line, which say the leanings in words |
| References | the region form's Start and End; each region's times; each region's analysis line | the recording's facts, the strip, Play these times, label, note and every action |
| Model test | the candidates per brief and evaluations per search fields; Start from; each result card's facts; a result's settings line, tallies, times per request and response format | every summary and "what this means" line, every action |
| Dashboard | nothing: it shows no numbers, so it has no toggle | |
| Track | nothing yet: the track page is phase TD's until WF.5 | |

The session row's More controls button and its hand-made toggle are gone, and so are the
Locks and Details `<details>`; the numbers toggle replaces all three. Hidden candidates,
Rejected candidates and the brief's earlier versions stay native `<details>`: they hold
candidates and history, not numbers. Every page's help paragraph is unchanged and in view,
except the session's sentence on More controls, which now says what the second row holds and
what Show the numbers adds.

**The test.** `test/web/page-numbers.test.js` reads every page's HTML, templates included, as
`titles.test.js` does. It lists each `input[type=number]`, `input[type=range]` and `<pre>`, and
the parts named in `SHOWS_NUMBERS` that show a number in text (an id or a `data-part`, such as
`positions` or `coverageLine`), and fails on any not behind the toggle: not marked and not
inside a marked element, or, for a template's part, not cloned only into marked containers
(`CLONED_INTO`). Its allowlist, each with a reason: the track page whole, until WF.5; the
brief's ratings list (the record of ratings, its heard values move to words in WF.3) and an
earlier version's rules and ranges (written in words, inside its own disclosure); the map's
cells, axis captions and open cell's line (the map itself and its labels); and `originText` on
the session and lineage pages. An allowlist entry that names something already behind the
toggle fails, so the list can't go stale. The same test checks that a page has the button
exactly when it has a marked part, that the button starts closed with the shared title and
label, and that the page's module starts it.

## Alternatives considered

- **A button per card or region** — rejected: with one state per page, as the plan asks,
  pressing one card's button would open every card's numbers, which reads as a fault. Separate
  states per card would make "the page remembers it" mean a list of cards, and a cloned row's
  button would need its state set at every clone site.
- **Keeping More controls and putting the numbers inside it** — rejected: More controls hid the
  word controls (the Less / More choices, note, explore direction) along with the numbers,
  which is the opposite of words first. The rows are taller for it; the owner may want the
  second row folded again once WF.4's word controls land.
- **Hiding with the `hidden` attribute from the module** — rejected: modules already set
  `hidden` on many of the same elements (a ranges box with nothing to show, a region analysis
  not run yet), so two writers would fight over one attribute, and every clone site would need
  a call.
- **Native `<details>`** — rejected: its open state is per element, it can't hold a table cell
  or a field inside a row, and remembering it still needs code.
- **Leaving count fields (How many, Minutes, a search budget) in view** — rejected for now:
  each has a default that the page sends when the field is hidden, and the plan lists them as
  raw numbers. WF.4 can ask for a length or a count in words.

## Consequences

- A new number field or number-showing part outside a `data-numbers` element fails
  `page-numbers.test.js`; a new part that shows a number in text needs its key in
  `SHOWS_NUMBERS`.
- A hidden field still holds its value and is still sent, so a page with the numbers closed
  sends the defaults or whatever was typed there last.
- Help text that points at a hidden field (the references page's "type them below") reads
  correctly only with the numbers open; WF.3 and WF.4 rewrite those parts.
- The `steer-controls` template still matches in every page that has it (0039).
