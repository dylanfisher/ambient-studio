# 0032. Plain-language studio pages: buttons instead of keys, "brief" for vibe, progress and one job per action

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm

## Context

After the first model test the owner asked for the studio pages to change (step 2n, plan
progress log 2026-11-06). In the owner's words: remove "the vim style keybindings and instead
use a more traditional nav structure and UI pattern"; "all buttons, links, actions, and anything
interactive should have a title attr tooltip describing what it does in detail"; "i'm not
familiar with model testing, so this needs to be refactored with more basic language"; a smaller
font in a shadcn-like style; a dashboard card that explains the process; "always include more
information about progress"; a short muted line on each page saying how to use it; "rename vibes
to something else"; and "any action to queue a job should only ever be able to be triggered once
per unique action". Later the same day: "need a way to undo something. e.g. if i add more
brightness, then less brightness, those both show attached to the card. i would think they
cancel each other out."

Step 2m changes the server at the same time (record 0031): a candidates job renders its own
excerpts, a job identical to one queued or running is a 409 naming it, job progress gains a
`step` sentence, and a new thumbs or macro choice replaces the candidate's earlier one, with
routes to remove a feedback row or an A/B rating. The pages here are written for the server with
2m; the progress text still reads a missing `step`, but the choices and their removal need 2m.

## Decision

**Navigation.** Every page has a top bar: Ambient Studio (the dashboard), Briefs (the dashboard's
brief list, `./#briefs`) and Model test. The current page's link has `aria-current="page"`; the
brief and session pages mark Briefs and add a breadcrumb back to the brief. Every action is a
button or a link; Tab, Enter and Space on them are the keyboard support. `key-map.js`,
`bind-keys.js` and their test are deleted, and so are the seek and play-toggle helpers only the
keys used. Choosing a candidate (by playing it or using one of its controls) never moves the
focus, so a reload or a click can't take it from a note being typed.

**Pages.**

| Page | What changed |
|---|---|
| `index.html`, the dashboard | Starts with a "How the studio works" card: write a brief, start a session (the model writes candidates and the studio renders 25 s excerpts by itself), listen and rate, keep sketches, and check the model with a model test; each step links where it is done. Then the briefs and the three starting points (the seed vibes). |
| `brief.html` (was `vibe.html`) | The brief's name, its **Description** (the vibe's `brief` field), the rules form, Save, Start a session, notes for the model, ratings and sketches, earlier versions. Soft targets sit under an "Advanced" disclosure. |
| `session.html` | One card per candidate with its own controls: a thumbs toggle pair, Compare, a `Less | — | More` choice per macro, a note, sketch tags and Keep as sketch; measurements and rule findings under Details. The job area shows each job's progress. |
| `evaluation.html`, "Model test" | Explains in plain words what a test does, starts one, follows it, and shows each result. |

Each page starts with a muted help paragraph: what it is for, what to do on it, and how to get to
something to listen to, a rated candidate or a kept sketch.

**Words.** The pages say "brief" where they said "vibe", "rules" for hard constraints, "version"
for revision, "model test" for evaluation and "Compare" for A/B. The JSON field names, the API
routes, the database, the seed ids and the module names other than the page's own stay as they
are: renaming them would touch the server, which 2m changes at the same time, and stored rows
that are append-only. One place still shows the word: the line under the rules form quotes the
prompt's own constraints text, which says "vibe", because it is what the model is told. Lint
findings under a candidate's Details also come from the domain tier's messages unchanged.

**Titles.** Every link, button, field, checkbox, select, `summary` and `audio` element has a
`title` of a full sentence saying what happens, including any wait and whether the model is
asked. `test/web/titles.test.js` reads every page's HTML, templates included, and fails on one
without; titles the modules set (a rules field's from `fieldTitle`, a macro choice's from
`macroTitles`, a job button's while it waits) are tested through those functions.

**Progress.** A job shows in a box from the page's `job-progress` template (`job-view.js`): what
the job is, a state badge, how long it has run or waited or took, a bar from `done / total`, and
its step. `jobProgress` (`job-progress.js`, no DOM) writes the `step` sentence when the server
sends one, and "3 of 8 done." when `step` is null or missing, as main sends today. A running job
with no count yet gets a sliding bar and "Started; no count yet." Elapsed time uses the server's
`startedAt` and the browser's clock, so a clock skew between machines shows in it. A job kind or
state the page doesn't know is an error, not a blank line.

**One job per action.** A button that starts a job (Ask for new candidates, Render missing
excerpts, Start the model test) is off from the click until that job finishes
(`job-control.js`), and its title then names the job it waits for. On a 409 that names a job,
`startJob` (`api.js`) reads that job and the page follows it, showing the server's sentence; it is
not shown as a failure. Any other error turns the button back on. On the session page the ask
button is off while any job of the session is unfinished, since the runner runs one job at a time
anyway. Render missing excerpts is a recovery action: it shows only when a candidate has no
excerpt and no job of the session is running.

**Choices on a card.** A candidate's current choices are the `feedback` field of its entry in
`GET /api/sessions/:id/candidates` (0031): its live thumbs and one live row per macro. That is
the one source for the fact; the page does not work out which row is newest. The page reads it
again after each change. Thumbs are a toggle pair: pressing the active one again removes its
row (`POST …/feedback/:feedbackId/remove`); pressing the other posts a new row. A macro's `—`
removes its row; Less or More posts one; the choice already shown sends nothing. A remove marks
every live row of that candidate, kind and macro undone, so a pair of live rows made before 2m
cannot bring an older choice back. After an A/B rating an Undo button removes it
(`POST …/ab-ratings/:ratingId/remove`). While a card's request is pending every control on that
card is off, with a title saying so; a failed request puts the controls back to what the server
last confirmed and the status line says why. The A/B count on a card and the sketch badge still
read the brief's ratings.

**Look.** `studio.css` uses zinc greys on white (and their dark counterparts under
`prefers-color-scheme: dark`), cards with a 1px border, an 8px radius and a faint shadow, 14px
body text and 12–13px small and muted text, the system font stack, a 2px focus ring, primary,
secondary, outline and destructive buttons, segmented choices, badges and progress bars. The
structure follows shadcn/ui; no code is taken from it. Still no nesting, `:has()` or
`light-dark()` (0028).

## Alternatives considered

- **Keeping the keys beside the buttons** — rejected: the owner asked for the keys to go, and a
  second way to act doubles what every title and help line must explain.
- **A separate briefs page** — rejected for now: the dashboard already lists the briefs under its
  process card, and a second page would show the same list.
- **Renaming the API and the stored names to "brief"** — rejected: it needs a migration of
  append-only tables and touches the server while 2m changes it; the words the owner reads are
  what was asked for.
- **One shared rating panel for the selected candidate** — rejected: the owner asked for clear
  buttons on each card, and a shared note sent to whichever card was clicked could land on the
  wrong one.
- **Replacing a card when its excerpt lands** — rejected: a note typed into it would be lost. The
  card is updated in place.
- **Per-card clocks for time taken** — not done: time taken still runs from when the card was
  chosen (played or used) or last rated. Rating a card other than the one chosen last chooses it,
  so that rating's time taken is near 0 s. The owner can ask for per-card clocks if the number
  matters.
- **Picking the newest live row on the page** (`liveChoices`, from the brief's ratings) —
  rejected: a clear then showed an older live row, and it made the page a second source for what
  the server decides. The server removes all of them and reports the live state.
- **Showing every feedback row on the card** — rejected: the owner reads two opposite choices as
  cancelling out; the card shows the current one, and the brief page still lists every row.

## Consequences

- A new control needs a title or `titles.test.js` fails; a new macro needs words in
  `macro-words.js` or the same test fails.
- `test/web/pages.test.js` lists `brief.html` in place of `vibe.html`; an old bookmark to
  `vibe.html` is a 404.
- The pages read job progress through `jobProgress` only, so a new job kind needs a title there.
- A job button is turned back on when following its job fails (a poll that throws), and the
  status line shows the error; a reload follows the job again if it still runs.
