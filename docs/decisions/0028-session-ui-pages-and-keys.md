# 0028. Three static pages, one key table, and played time measured from the audio element

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

Step 2j puts a keyboard-first UI over the session API ([0027](0027-session-api-and-ratings.md)):
the owner makes and edits vibes, asks for candidates, hears them and rates them, from Safari
17.6 on mbp2015 (macOS 12, the oldest supported Mac) and a current browser on mbp2026. The
server serves `src/web/`, `src/engine/` and `src/domain/` as files with no build step, answers
only JSON bodies, and sends no CORS headers ([0025](0025-http-server-and-audio.md)). Ratings
carry a played fraction and a time taken that the page measures and the server only
range-checks (0027). Jobs live in memory and are read by polling (0026).

## Decision

**Pages.** Three HTML files, each with one module, linked by query strings:

| Page | Shows |
|---|---|
| `index.html` | the vibe list, newest edit first |
| `vibe.html?id=N` (no `id` makes a new vibe) | name, brief, the constraints form, soft targets as JSON; sessions, notes, every rating of the vibe, revisions |
| `session.html?id=N` | the job line, the candidate grid, the rating panel, rejected candidates; the A/B view in place of the grid |

Markup lives in each page's HTML, with `<template>`s for repeated items; modules look elements
up once by id (`elementsById`) and template parts by `data-part` (`cloneTemplate`), both of
which throw when the HTML and the module disagree. Every API call goes through `api.js`; a non-2xx
reply throws the server's message, and every action's error is shown on the page's status line
and logged.

**The constraints form** is built from `CONSTRAINT_KINDS` (0020) by `constraint-fields.js`: a
fixed name is a select, a fixed number or a ceiling a number input, a range two, a voice list a
checkbox per registered type. An empty field leaves the kind out. The page runs 2b's
`validateConstraints` on every input, lists its errors by path, shows the prompt's text for a
valid set with `constraintsText`, and won't post an invalid one; the server checks again.

**Keys.** `key-map.js` is the one table of every page's keys, and the page lists it next to
its content. `bind-keys.js` refuses a page whose handlers and table disagree, and wires each
`data-action` button to the same handler as its key. A key with Cmd, Ctrl or Alt goes to the
browser, except Cmd/Ctrl+Enter. While a text field, select or checkbox has focus, only Esc
(leave the field) and Cmd/Ctrl+Enter fire. Held keys don't repeat an action, and a held Enter
or Space outside typing is dropped with its default action, so it can't click a focused button
again and again or submit the vibe form once per repeat; Space in a text field and Enter in a
textarea keep their repeats. The listener runs in the capture phase, so Space on a focused
button or audio element plays or pauses the selected excerpt instead.

**One at a time.** Every rating action (thumbs, more or less, sketch), opening an A/B pair,
rating it, asking for candidates, rendering excerpts, starting a session and saving either
vibe form does nothing while its own last run is still posting (`one-at-a-time.js`). A quick
`u u`, `f f` or `x x` posts once. An action that navigates to a new page stays held until the
page is replaced.

**Selection and focus.** `candidate-selection.js` holds the selected candidate and its clock.
The owner chooses a candidate with `j` / `k`, a click, or by starting its audio; the focus moves
to the card only when it is a new choice and no form control has the focus. When a reload
replaces the selected card (its excerpt landed), the selection and its clock carry over and the
focus stays where it was, so a note being typed never turns into rating keys.

| Page | Keys |
|---|---|
| vibe list | `j` / `k` next and previous vibe, `Enter` open it, `n` new vibe |
| vibe | `b` brief, `c` constraints, `n` note, Cmd/Ctrl+Enter save the form the focus is in, Esc leave the field, `s` start a session and open it, `o` open the newest open session, `l` the vibe list |
| session | `j` / `k` next and previous candidate, Space play or pause, `,` / `.` back and forward 5 s, `u` / `d` thumbs up and down with the note, `n` note, `t` sketch tags, Esc leave the field, `[` / `]` previous and next macro, `=` or `+` more like this, `-` less like this, `s` keep as sketch with the note and tags, `x` mark for A/B (the second mark opens the pair), `g` ask for candidates, `e` render missing excerpts, `c` cancel the session's job, `Q` stop the session, `v` the vibe page |
| A/B | `1` / `2` play the left and right side, Space play or pause, `,` / `.` seek, `f` left is better, `j` right is better, `t` tie, `s` skip, Esc close without rating |

Stopping a session is Shift+Q and asks to confirm, since it cancels the job and refuses later
ratings. Starting a session leaves the vibe's other open sessions open (0027 left that to the
UI): `o` reopens the newest one.

**Played fraction** (`played-tracker.js`, no DOM) is the union of the intervals played over the
excerpt's duration from the API, as 0027 defines it. The audio element's events feed it:
`playing` starts an interval at `currentTime`, `timeupdate` extends it, `pause` and `ended` close
it at `currentTime`, and `seeking` closes it where playback last was, since `currentTime` is
already the new position when `seeking` fires. A jump backwards with no seek event starts a new
interval rather than spanning the gap. A candidate keeps one tracker for its render while the
page is open; an A/B pair gets fresh ones per side. The listeners are added with an
`AbortSignal`, which the A/B view aborts before it reuses its two audio elements for the next
pair.

**Time taken** runs on `performance.now()`. For a candidate it is from when the candidate was
chosen, or from the owner's last rating of it, to this rating: each thumbs, more or less, and
sketch restarts the clock, and so does the A/B view closing, so listening to a pair doesn't count
toward the next rating of the selected card. For an A/B pair it is from when the pair was shown.
The page doesn't cap it: a rating more than a day later is refused by the server's range check
with its message, and choosing the candidate again restarts the clock.

**Job status** is polled with `GET /api/jobs/:jobId` every **1 000 ms** while the job hasn't
finished (`finishedAt` is null), each read waiting for the last. The page reloads the candidates
when the excerpt count in `progress` moves and when the job finishes, keeping each card whose
render id is unchanged so a reload never cuts an excerpt that is playing. On load, the page polls
every unfinished job the session lists. Polling runs only while a job the owner started is
running.

**Browsers.** Written for Safari 17.6. A script walked each page's module graph (9 modules for
the list, 54 for the vibe page, 26 for the session page) and the stylesheet for features Safari
17.6 lacks (iterator helpers, `Promise.try`, `RegExp.escape`, `URL.parse`, `Float16Array`,
`using`, `requestIdleCallback`, the Navigation API, `field-sizing`, anchor positioning) and found
none; the newest features used are `Object.hasOwn`, `Array.prototype.at` and `:focus-visible`
(Safari 15.4) and `Error` causes (15). No import maps, CSS nesting or `light-dark()`. The
excerpts are 24-bit PCM WAV served with byte ranges, which Safari plays and seeks. The pages
were driven by key presses in headless Chromium against a server in a temp root: play, seek,
thumbs, macro feedback, an A/B tie, a sketch with a note, each stored with its played fraction
and time taken. Safari itself is the owner's check on mbp2015.

## Alternatives considered

- **One single-page app with a router** — rejected: three pages with query strings need no
  router, a reload lands where the owner was, and the browser's back button works.
- **Building markup in JS** — rejected: tag and class names would be spread through the modules;
  templates keep the markup in the HTML and the module checks the parts it uses.
- **Server-sent events or a long poll for job status** — rejected for phase 2: the routes are
  plain JSON, a job takes minutes, and a 1 s poll on the LAN is a few hundred bytes. 1 s shows
  each excerpt within a second of its render; 250 ms would quadruple the reads for nothing the
  owner can see.
- **Measuring played time with a wall clock while not paused** — rejected: it counts buffering
  stalls and replays, and 0027 defines the fraction by the excerpt's timeline.
- **Clamping time taken to a day on the page** — rejected: the server's limit isn't importable
  from the web tier, and a copied limit would drift; the server's refusal says what happened.
- **Stopping a vibe's open sessions when a new one starts** — rejected for now: the owner may
  have the vibe open in both browsers.
- **Single-letter keys for every macro** — rejected: six macros would take six more letters;
  `[` and `]` choose the macro and `=` and `-` rate it.

## Consequences

- A new action is a row in `key-map.js` and a handler on its page, or the page throws on load;
  the page's key list updates itself.
- The rating values (`THUMBS`, `MACRO_DIRECTIONS`, `OUTCOMES`) moved to
  `src/domain/rating-values.js` so the page sends what the server checks; the server's limit on
  time taken is still server-only.
- A page uses only the domain and engine modules it imports; `test/web/pages.test.js` loads
  each page through the server and fetches every module it reaches, so a module the server
  can't serve fails a test instead of a browser.
- The played fraction counts only what the page saw: plays in another tab or browser are
  separate, and reloading the page starts a candidate's tracker at 0.

## Amendments

- 2026-11-06: from the step's review, before merge. A grid reload no longer moves the focus,
  and no choice takes it from a form control; rating actions, pair opens and form saves run one
  at a time; held Enter and Space are dropped; time taken restarts after each rating of a card
  and when the A/B view closes.
