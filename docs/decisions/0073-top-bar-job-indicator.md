# 0073. A sticky top bar that shows the running job; notes can be removed

- **Date:** 2026-11-08
- **Status:** accepted. Amends [0032](0032-plain-language-pages.md) (the top bar) and
  [0021](0021-store-tables-and-append-only.md) (a note can be marked removed).

## Context

The owner asked for three things: the top bar to stay in view as a page scrolls, over a blurred,
translucent background; an indicator at its right end while a job runs; and a way to remove a
note for the model on the brief page. A job's progress was shown only in the boxes of the page
that started it, so a job started on one page was invisible from every other.

## Decision

The top bar is `position: sticky` over a translucent `--topbar-glass` with a backdrop blur. Every
page imports `topbar-jobs.js`, which reads `GET /api/jobs` every `POLL_MS` while the page is in
view and shows the running job, or the oldest waiting one, with its percent, a bar, and how many
more wait. It only reads; Cancel stays in the page's own boxes. A note is removed with
`POST /api/vibes/:vibeId/notes/:noteId/remove`, which marks the row removed, so later prompts
leave it out.

## Alternatives considered

- **Poll only while a page's own job runs** — rejected: a job started on another page, or from
  another computer, would never show, which is the case the indicator is for.
- **A Cancel button in the indicator** — rejected for now: cancelling from a page that didn't
  start the job leaves no box saying what was kept.
- **Deleting a note's row** — rejected: notes are irreplaceable data and append-only (AGENTS.md).

## Consequences

Each open page in view reads the job list once a second, even when nothing runs. The list is in
memory and sent without results, so this is cheap; a hidden tab stops reading until it is shown.
