# 0077. Sections and transitions hold the owner's text, stored with the arrangement and never rendered

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the 300-character limit, text on more than
  one line, and the two fields' place and labels in the chosen section's panel. Amends
  [0061](0061-tracks-and-the-timeline.md) (the arrangement's section and transition keys, the
  timeline's panel and blocks) and [0067](0067-proposed-track.md) (the proposal's answer gets
  empty text before it is checked)

## Context

Phase TD develops sketches inside a track: the owner writes, for each section, what should
happen there, and for each join, how one part should become the next. Later steps send those
words to the model (TD.3 develops a section from its text; TD.6 has a proposal write text for
every part). Step TD.1 only stores, edits and shows them. An arrangement is stored with every key
present (0061), so a new key on a section or transition is a change to an irreplaceable table's
shape (0021) and ships with a migration. A track's render is cached by its recipe's key (0062),
and words must never cause a new render.

## Decision

**The shape.** Every section and every transition has `text` (`TEXT_KEY` in
`arrangement-schema.js`), its last key: a string of at most `MAX_TEXT_CHARS`, 300 characters,
`""` when the owner wrote nothing.

```json
{ "sketchId": 4, "offset": 30, "seconds": 240, "text": "only the low drone, very quiet" }
{ "kind": "morph", "seconds": 12, "curve": "smooth", "text": "" }
```

`validateArrangement` refuses a missing key (`$.sections[1].text: missing`), a value that isn't
a string (`must be text, got 5`) and one over the limit (`must be at most 300 characters, got
301`), each at its JSON path. Text may run over several lines and isn't trimmed: it is stored as
typed, since the validator reports rather than rewrites (0020). 300 characters is two or three
sentences, enough for what should happen in one part, and keeps a whole track's text (20
sections and 19 transitions, about 12 000 characters at most) small next to the 8 192-token
context the later prompts share with a genome.

**The migration.** `0012-section-text.sql` rewrites every `track_revisions` row, adding
`"text": ""` as the last key of each section and transition with SQLite's JSON functions and
leaving every other value as it was; an empty arrangement is unchanged. The append-only triggers
are made again after it (0021). It is tested over a database built with 0001 to 0011, holding a
revision with a morph, a crossfade and a lane.

**Not in the render.** The recipe (`trackRecipe`) names each section's sketch, window and genome
and each transition as `renderedTransition` gives it, so text never reaches it or `recipeKey`. A
revision in 0011's shape, the same revision with `text: ""` everywhere, and one with words all
give the same recipe and key, tested. The section's player caches its audio on the page by the
window (sketch, offset, seconds) alone, so writing text doesn't render the window again. The
engine version stays 2.

**The proposal.** The prompt doesn't ask the model for text in this step. `checkProposal` gives
each section and transition object in the answer `text: ""` when it has none, before
`validateArrangement`; text the model writes anyway is checked like the owner's and kept when
valid. The answer itself is left as written, for the repair round to quote.

**Edits.** `setSectionText` and `setTransitionText` (`timeline-edits.js`) change only the text
they name. A new section and its new crossfade have empty text; turning a crossfade into a morph
or back keeps its text; a transition's text stays with its place when sections move, as its
seconds do (0061), and is removed with it when a section is removed. A finished steer finds its
section by its window, not its text (0066's `steerSwap`), so words written during the run don't
stop the swap, and the swap keeps them.

**The page.** The chosen section's panel has two text fields: "What should happen in this
section", and below the transition line, "How section N should become section N+1" for the
transition the panel already shows, hidden with one section. Each takes the edit when it loses
the focus, as the number fields do, and holds at most 300 characters. They are textareas, so no
timeline key fires while one has the focus (0061). A block on the timeline shows the start of its
section's text under its name, up to 40 characters cut at a word, on one line.

## Alternatives considered

- **`text` optional, or null for none** — rejected: 0061 stores every key, and one form for "no
  words" means TD.3 and the prompts never test for two.
- **Filling a missing `text` in the validator, so old revisions read without a migration** —
  rejected, as 0061 rejected filling a transition's default: a stored arrangement would differ
  from what was sent, and irreplaceable data changes shape only through a migration (0021).
- **One line, as the arc** — rejected: the owner's description of a part reads naturally as a
  few sentences, and the later prompts quote it as a block.
- **Overwriting any text the model writes with `""`** — rejected: dropping a value the answer
  gave without a word hides it; checking it as the owner's is the same rule everywhere.
- **Saving text on every keystroke** — rejected: each edit redraws the timeline and reads the
  sections' measures again; a change on leaving the field matches the number fields.

## Consequences

- TD.3 reads a section's `text`, and TD.6's proposal writes text for every part, changing
  `checkProposal`'s filling and the prompt's answer format.
- A body sent to `POST …/section-audio` or `…/measures` is a whole section, `text` included, as
  the page sends it.
- A change to how text is stored needs another migration over this shape.
