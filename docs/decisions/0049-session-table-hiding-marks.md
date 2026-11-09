# 0049. The session table, hiding candidates, and A/B marks

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0028](0028-session-ui-pages-and-keys.md) (the session page lists candidates as a table) and
  [0042](0042-clap-embeddings.md) (the session page shows `notEmbedded`). Amended by
  [0046](0046-ranking-wildcards-pair-picker.md) (the roots' order in a ranked session) and
  [0083](0083-numbers-toggle.md) (the second row is always shown, its numbers behind the
  page's numbers toggle, and More controls is gone)

## Context

The owner asked (step 4j, plan progress log 2026-11-07): "session cards should be more compact
if possible. it should be obvious if a candidate came from a parent, so you can see lineage when
they are all listed on session page. perhaps a table layout would work better, with revised
candidates nested underneath. ... when doing a a/b and then going back to session view, we
should remember where in the scroll on session view we were. if i've already a/b a candidate it
should have a indication. ... each time a a/b is chose it should get a marker for chosen, and a
marker for not chose. e.g. chosen 4 times gets 4 markers. candidates should have a way to easily
hide them, e.g. rate it and then close it, goes to a hidden panel that you can open and view
again if you want."

The session page was a grid of cards, every control on each (0032, 0039). Candidates carry their
parents (0037), and a first try and its revision show as one card that links the other (0036).
Quick A/B draws from `poolOf` (0048). Irreplaceable data is append-only (0021), and the owner's
choices are irreplaceable. The oldest browser is Safari 17.6.

## Decision

**The table.** `session.html` lists candidates in a `<table>`, one `<tbody>` per candidate: its
row, and a second row with the less-used controls, closed until the row's More controls opens
it. The row holds the name, row id, thumbs and sketch badges and how it was made; the excerpt
player and the played share; the A/B marks; and thumbs, Compare, Hide and More controls. The
second row holds the intent, the ranges readout, the Less / More choices, the note, tags and
Keep as sketch, explore and nudge, the locks and the details. Every control the card had is
still there. Below 720 px each row's cells stack. A "card" in `session.js` is now that `<tbody>`.

**Nesting.** `candidateRows` (`src/web/candidate-rows.js`, no DOM) orders the rows with 0039's
`lineageTree`: each candidate under its first parent, at any depth, each depth indented 1.5 rem
with a `↳`. A revised pair takes one place, its two `<tbody>`s side by side with the pair swap
showing one, and a child of either member nests under that place. A candidate whose parent is
of another session, or hidden, is a root; its "how it was made" line still names the parent.
On a reload the page moves only the rows out of place (`placeRows`), so a row that stays put is
never taken out of the page while it plays.

**A/B marks.** `abMarks` (`src/web/ab-marks.js`, no DOM) counts, from the brief's live A/B
ratings in this session, matched by genome and seed: a win when the candidate's side was chosen,
a loss when the other was, and every rating as compared. Ties and skips count only as compared;
an undone rating counts nothing (the ratings route already leaves it out, and the count skips a
row with `removedAt` set too). A rating names only what was heard (genome, seed and window, 0021),
never a candidate, so the marks are the excerpt's: two candidates of one session with the same
genome and seed render the same excerpt and share their marks. Matching through `rated_audio`
adds nothing, since its row holds the same genome, seed and window. A candidate with no genome
has no excerpt, and counting its marks throws. The row shows "Not compared" or "Compared N", then one ▲ per win
and one ▼ per loss, green and red, each group with a title and label in words ("Chosen 4 times
in A/B."). Above `MAX_MARKS` (5) a group shows one mark and the count (`▲×12`). The page reads
the ratings again after each rating, as it did for the old "Compared N times".

**Hiding.** Migration 0007 adds `candidate_hides`: one row per hide or unhide (`candidateId`,
`hidden` 0 or 1), never changed, with the `removedAt` and `removedReason` every irreplaceable
table has and nothing sets. A candidate is hidden when its newest row says so; unhiding appends
a row, so the history stays. `setHidden` (`src/server/hide-store.js`) appends rows only for the
candidates whose state changes, in one transaction. `POST /api/sessions/:id/hidden` takes
`{candidateIds, hidden}`, 1 to 64 ids each of the session (a 400 otherwise, storing nothing), and
answers the session's hidden ids. It works on a stopped session, since hiding is not a rating.
Hiding is a fact about a revised pair, which takes one place on the page: the route expands an
id of either member to both, written in the one transaction, and `GET …/candidates` gives each
candidate `hidden`, true for both members of a pair when either is hidden. The page's Hide and
Show again, and Quick A/B's `poolOf`, read that.

- The page's Hide moves the row into the Hidden candidates panel at the foot of the page, where
  it can be played and rated and has Show again. A pair is hidden whole, so the table never
  holds half a pair. Hiding pauses the row and unmarks it if it was marked for A/B. A Hide
  pressed while the row's last change is still saving is an error on the status line.
- Hidden candidates leave the table, the session page's Compare (off on a hidden row, with a
  title saying why), and Quick A/B (`poolOf`).
- They stay in the lineage page and in training sets: hiding says nothing about how good a
  candidate is, so it is not a rating and nothing that learns reads it.

**Scroll.** `scrollMemory` (`src/web/scroll-memory.js`) keeps the page's `scrollY` in
`sessionStorage`, per tab and per session: a per-viewer convenience, not data. It is saved only
on the way out to a comparison: when the A/B view opens, and on a plain click of the Quick A/B
link (`keepOnClick`; a click that opens another tab keeps nothing). It is taken once: when the
A/B view closes, and after the candidates and locks load. The page opened from any other link,
or reloaded, starts at the top. `history.scrollRestoration` is `manual`, since
the browser's own restore would land before the rows exist. A page brought back from the
back-forward cache is already where it was, so `pageshow` with `persisted` drops the kept
place. More controls opened before leaving are closed on a reload, so the place can be off by
their height.

**Not embedded.** A finished candidates or explore job whose result has `notEmbedded` shows the
reason in its job box, under its step (`jobProgress(…).notEmbedded`). It is the job's reason,
not one per candidate: the job decides once, at its first excerpt, and every excerpt it renders
shares it. The lineage and model test pages' job boxes have the same line.

**What holds a row.** `card-hold.js` is unchanged, and still the one decision whether a
candidate's row may be swapped by its pair: the focus inside its `<tbody>`, a pointer pressed in
it, unsent text (note, tags, direction), or something pending (a rating, a hide or a lock in
flight, an offer not yet answered). The `<tbody>` gets the focus, pointer and click events, which
bubble through the table's rows as they did through the card.

**Checked** in headless Chromium against a test server in a temp root, with five candidates
three deep, nine seeded A/B ratings and one hidden: the rows came in tree order with depths 0,
1, 2, 0; the marks read `Compared 9 ▲×7 ▼` and `Compared 8 ▲ ▼×7`; Hide moved a row and its
child became a root, and Show again put it back; closing the A/B view and coming back from Quick
A/B (which listed 4 of the 5) restored the scroll. Safari 17.6 is the owner's check: no feature
used is newer than what 0028 lists, and CSS custom properties in `calc()`, `:not([hidden])` and
`sessionStorage` all work there.

## Alternatives considered

- **Nested lists, as the lineage page draws them** — rejected: the owner asked for a table, and
  columns line the players and marks up so a long session reads at a glance.
- **A `hidden` column on candidates, or marking the hide row removed on unhide** — rejected:
  candidates rows can't change (0021), and removing the hide would lose when it was hidden.
  An event per change keeps the whole history in one table.
- **One hide per member of a pair** — rejected: two requests could leave half a pair hidden,
  and the pair swap could then show the hidden one in the table. The route expands the hide,
  so a request from any client hides the whole pair.
- **Keeping the scroll on every `pagehide`** — rejected in review: the page opened later from
  the brief page would land mid-table; only a trip to compare comes back to the same row.
- **Counting marks on the server** — rejected for now: the page already reads the brief's
  ratings for the badges and the old compared count, and a pure function is tested on its own.
- **Showing every mark however many** — rejected: twenty marks push the row wide; past five the
  number says it in less room.
- **Refusing a hidden candidate in `POST …/ab-pairs`** — not done: the pair route takes render
  ids, and every page that draws pairs already leaves hidden candidates out.

## Consequences

- A new irreplaceable table needs a row in `fillStore`, which now hides its candidate.
- Phase 5's optimizer runs (4j's table "folded under them") nest under their base by this rule.
- A change to the `steer-controls` template is still made in both pages (0039).

## Amendments

- 2026-11-07: from the step's review, before merge. The scroll is kept only on the way to the
  A/B view or Quick A/B; the hide route expands a hide to the whole revised pair and the
  candidates route reports the pair's state; marks are the excerpt's, and a candidate with no
  genome throws; a Hide pressed while the row is saving is an error, not ignored.
- 2026-11-07 (4f, [0046](0046-ranking-wildcards-pair-picker.md)): in a session ranked by the
  taste model, the roots follow the ranking, a revised pair by its better member, and unranked
  roots come after; children keep their place under their parent. Ranked rows carry a rank and
  score badge, and a wildcard a second badge.
