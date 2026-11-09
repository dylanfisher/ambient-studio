# 0084. One words operator turns the owner's words into values for a named field set

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the prompt's wording, the 300-character
  limit, and the shift's repair round. Amends [0075](0075-steer-search-by-ear.md) (the shift's
  words run on this operator, with one repair) and [0074](0074-draft-brief-from-words.md) (the
  brief draft stays apart, for the reasons below; its 409 check is shared as `refuseUnfinished`);
  amended by [0092](0092-words-beside-a-job.md) (the shift's words run as a words job in the
  runner's words lane, and a words job cancels only its own requests) and by
  [0085](0085-session-and-brief-in-words.md) (a `candidate` scope, the route's `candidateId`, and
  sets that narrow to fit)

## Context

The owner, 2026-11-09: "in majority of situations the parameters are hidden behind a toggle
(e.g. collapsed) and we use language in almost all contexts to describe and control
parameters. the goal is LLM language as the tool." Two routes already read words into values:
a brief drafted from words (0074) and a search by ear's shift (0075). Phase WF adds more: a
candidate's locks and macros, a steer's setting, a section's length and transition, and a lane
(plan WF.3, WF.5). Each would otherwise write its own prompt, check and repair. omlx serves a
live site: one request at a time through the queue, short contexts (0022).

## Decision

**The prompt** (`buildWordsPrompt` in `src/domain/words-prompt.js`) is two messages. The system
message says the task, how values are written (`low..high` with the unit, `int` for whole
numbers, `a|b|c` for choices, `valueText`'s notation) and the answer:
`{"changes": {"<field>": <value>, …}, "said": "<one plain sentence saying what you changed>"}`.
The user message says what the fields set, the brief's description, a reading of what is being
changed when there is one (lines, such as `sketchReading`'s), each field as
`- name: description; values; now <value>`, and the owner's words as a JSON string, at most
300 characters (`WORDS_CHARS`). The model names only the fields the words speak of.

**The check** (`judgeWords` in `src/domain/check-words.js`) is built on `judgeAnswer`: a cut-off
answer, one with no JSON, invalid JSON or several objects is rejected with no repair (0024). A
parsed one may hold only `changes` and `said` (rule `answer`); each change must name a field
asked about and pass that field's descriptor through `checkValue`, so a number out of range, a
fraction for an int and a value not among the choices are each a finding at `$.changes.<field>`
(rule `changes`); `said` must be a non-empty string (`$.said`, rule `said`). One repair round,
for a parsed answer with findings, quotes every finding as a follow-up turn (0024, 0036). An
answer still invalid fails listing them.

**The field sets** (`WORDS_SETS` in `src/domain/words-sets.js`) are named. Each says what its
fields set, its scope, and its fields as descriptors (`fields(paths)`, where a set whose fields
are the paths something moves takes them, and a set of fixed fields ignores them). The scope
says where the values now come from, and so which route asks it:

- `page`: the page sends the values now, unsaved, as the brief draft's rework sends its form
  (0074). The words route checks them against the descriptors.
- `ear-search`: the running search by ear's steering. Only the search's own route asks it.

The only set now is `shift` (scope `ear-search`), each searched path from -1 to 1
(`EAR_SHIFT`, which `checkSteering` now reads its bounds from). WF.3 and WF.5 add the page sets.

**The route and job.** `POST /api/vibes/:vibeId/words {set, words, current}`. It refuses an
unknown set (400 naming the sets), a set whose scope isn't `page` (400 saying where it is
asked), values now that are missing, unknown or invalid (400 naming each), a prompt over half
the context budget (400; the other half is the repair's, 0024), and a second `words` job while
one is unfinished (409 naming it, `refuseUnfinished`). It adds a `words` job (`JOB_KIND.words`,
titled "Reading your words as settings" in the top bar, 0073). The job sends one request and at
most one repair through `sendRequest`: one `generations` row each, of the brief's current
revision, under the request group `vibe-<id>-words-<seed>` (`OPERATOR.words`). Cancelling it
cancels the omlx queue, as the brief draft's does: the runner runs one job at a time, so the
queue holds only this job's requests. A cancelled job returns nothing. Its result is
`{changes, said, repaired, generationId}`; the page fills its fields unsaved and nothing else
is written. There is no confirm dialog: the request starts only from the owner's button, one at
a time, and shows in the top bar with a cancel.

**The shift (0075) runs on the operator, from its own route.** `POST …/ear-search/shift-words`
builds the words prompt for the `shift` set: each searched path, its value now from the run's
steering, and as the reading where the best so far sits on each path. It calls the same request
function (`askWords` in `src/server/ask-words.js`) inline, not as a job, because the search by
ear is itself a job that holds the runner until it ends, so a `words` job would wait behind it.
Its request group keeps the operator `shift`, so stored rows still say what they were for. The
answer's changes are merged over the run's shift and checked by `checkSteering`; the route
returns `{shift, said, generationId}`, and the page sets its sliders as before. Three things
change: the answer now has its repair round (0075 had none); an answer still invalid is a
502 listing the findings in place of the single reason; and words now edit the shift instead of
replacing it. Under 0075 a path the answer left out went to 0; now it keeps the run's last-sent
value, so "more of b" after a shift toward `a` keeps `a`, and clearing it takes words that say
so. The values the model reads as "now" are the run's sent steering, not sliders the owner
dragged and hasn't sent. Edits fit words as the main control (one change at a time); the owner
can overrule.

**The brief draft (0074) stays apart.** Its answer is a whole brief, not values for fields: a
name, a description, constraints whose values are objects, lists and ranges, and feature ranges
as `[low or null, high or null]` pairs. Leaving a kind out removes it, where a field set's
changes only set values; the check is Save's own validators, whose paths go into the repair;
and a new brief has no revision, so its requests aren't stored and no vibe route can hold them.
Flattening it into fields would lose the validators' messages and add a way to clear a field.
Its tests pass unchanged; only its 409 check moved into `refuseUnfinished`.

**Tests changed.** `test/domain/shift-prompt.test.js` is removed with `shift-prompt.js`; its
cases are held by `test/domain/check-words.test.js` (an unknown field, a value out of range, an
extra key, prose, a cut-off answer) and the shift's server test (zeros dropped). In
`test/server/ear-search-job.test.js`, "words for a shift go to the model once…": the scripted
answers are in the new shape; the prompt assertion reads `the best so far sits at 0.NN of 0 to
1` and the field line in place of `now 0.NN`; the route also returns `said`; and the answer
naming `nowhere` is answered twice, its repair asserted, and the error matched as "still invalid
after one repair … `$.changes.nowhere (changes): unknown field`" in place of "couldn't be read
as a shift: the shift names nowhere".

**The budget.** With the largest set (the shift at 12 paths of 64 characters), a full sketch
reading (800 tokens), the shift's position lines, a 4 000-character brief and 300 characters of
words, the first prompt is about 3 120 tokens; the test holds it under 3 200, below the 4 096
that is half the context budget.

## Alternatives considered

- **The page sends the field definitions** — rejected: the route would check the answer
  against whatever the page said, and a field the engine doesn't have could reach the model.
- **Running the shift as a `words` job** — rejected: the search by ear holds the one job
  runner while it waits for the owner's choices, so the job would start only after the search
  ended. Letting a model-only job run beside another was rejected too: the queue's cancel is
  global, so cancelling the words job would cancel the other job's requests.
- **A context id on the words route now** (a candidate or sketch whose reading goes in the
  prompt) — not taken: no page set exists yet to say which reading it needs. The prompt takes
  the reading; WF.3 adds the id with the sets that use it.
- **Moving the brief draft onto the operator** — rejected, for the reasons under Decision.
- **No repair for the shift, as 0075 had** — rejected: one operator has one check, and a repair
  costs one more short request only when the first answer was wrong.

## Consequences

- A new field set is a registry entry with descriptors; the prompt, the check and the repair
  come with it.
- The shift's words request still doesn't show in the top bar or take a cancel, since it isn't
  a job.
- The words route has no `page` set until WF.3; its test adds one by mocking the registry.
- The 300-character limit and the prompt's wording are guesses until the owner has used it.
