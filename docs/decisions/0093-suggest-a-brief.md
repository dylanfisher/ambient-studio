# 0093. The model suggests a new brief from the owner's briefs, added on Approve

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the wording, the 600-character excerpt of
  each brief, and that Approve saves without opening the form. Amends
  [0074](0074-draft-brief-from-words.md) (a third route into the same `draft-brief` job)

## Context

The owner wants the model to look at the briefs already written and suggest a new one: what the
set is missing, another take on one of them, or something interesting. They read the suggestion
and press Approve to have it created. 0074 already drafts a whole brief from words with one
request and one repair, checked by the validators Save uses. omlx contexts are short (0022), and
the owner's briefs can hold 4 000-character descriptions each.

## Decision

**Suggest a brief** sits at the top of the dashboard's Briefs list: a text box, which may be
left empty, and a button. A confirm states the request and its time, as 0074's does. The answer
shows as a card with the name, the description, and the rules and ranges in the words the
candidates' model reads (`constraintsText`, `targetsText`), with **Approve** and **Dismiss**.
Approve posts the draft to the existing `POST /api/vibes` and reloads the list; nothing is saved
before it.

**The route** is `POST /api/brief-suggestions {words}`, `words` 0 to 1 000 characters
(`MAX_CHARS.draftWords`), trimmed. It adds the same `draft-brief` job as a new brief's draft, so
one brief draft runs at a time across both pages (the 409 is shared). The result adds
`briefsRead` and `briefsTotal` to 0074's, and the status line says how many briefs were read.
Like a new brief's draft, its requests aren't stored: there is no vibe revision to store them
with.

**The prompt** (`buildSuggestBriefPrompt`) is 0074's system message, with a user message quoting
each brief that isn't removed, newest edit first, one compact JSON object a line: its name, its
description cut to `OTHER_BRIEF_CHARS` (600) with an ellipsis, and its rules. Ranges are left
out. Then come the words, or with none a line asking for what the set most lacks, and the ask:
one new brief that is none of these, whose description's first sentence says what it adds. The
oldest briefs are dropped until the prompt fits half the context budget (0024), and the result
says how many were left. With no briefs, or when not even one fits, the route answers 400.

## Alternatives considered

- **Filling the brief form for the owner to edit and Save** — rejected: the owner asked for
  Approve to create the brief. A saved brief is edited on its page like any other.
- **A separate `why` field in the answer** — rejected for now: it would need its own answer
  format and check apart from 0074's. The description's first sentence says what the brief adds.
- **Every brief whole in the prompt** — rejected: a few 4 000-character descriptions fill the
  budget. 600 characters carries the mood and sounds, and the newest briefs come first.
- **Quoting the ranges too** — rejected: they are numbers the model can't compare across briefs
  without the words, and they would cost budget better spent on more briefs.

## Consequences

- An approved suggestion is a brief like any other, its first revision the model's draft.
- A suggestion started while the brief page drafts gets that job's 409. The dashboard follows
  the other job and then asks the owner to press Suggest again.
- A suggestion left on the card is lost on reload; it was never saved.
- The 600-character excerpt and the prompt's wording are guesses until the owner has used it.
