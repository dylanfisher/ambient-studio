# Agent rules for orchestrated work

How a session that orchestrates hands work to builder and reviewer subagents. Read AGENTS.md
first; these rules add to it. A session working alone, without subagents, can skip this file.

This is a starting shape, not a finished process. Change it as the project shows what it needs,
and write down why when a rule comes from something that went wrong.

## Roles and settings

| Setting | This project |
|---|---|
| Integration branch: where finished work lands | `main` |
| Builders running at once | 2 — mbp2021 also serves omlx to a live site; builders iterate with `--low` |
| Review | Scaled to the change (see Orchestrator 10) |
| Plan and progress log | `docs/plan.md`, committed |
| Models | Opus for a builder implementing a plan phase that changes several files; Sonnet (the default) for reviews, fixes, searches, checks and mechanical edits |

## Plans

- The plan is a list of steps, each small enough for one builder, with an ID (`3a`, `CV.2`) that
  branches, commits and reports use.
- Each step says what it builds, which decision records govern it, and how it will be verified.
- The orchestrator marks a step done with the sha it merged as. Owner feedback and checks to do
  by hand go in the progress log, dated, quoting the owner's words.
- A choice the plan didn't settle, product behavior included, is decided by the builder and
  recorded (Builders 8). Stop and ask only for what AGENTS.md reserves for the owner (a new
  dependency, omlx settings, a secret) or an API that can't do what the step assumes, and move on
  to a step that doesn't depend on it.
- A check that needs ears or another machine (does it sound right, does it play on mbp2015) is
  logged as **pending** with what to listen or look for. The run moves on and lists every pending
  check at the end.

## Builders

1. When another agent writes at the same time, work in your own worktree, on a branch named for
   the step, based on the integration branch, and confirm the sha you started from. A builder
   running alone, or a subagent making a small fix, works in the main checkout.
2. Write the test first and see it fail.
3. Iterate with `./scripts/test --changed`. Before committing, run the format and lint steps of
   `./scripts/check` and `./scripts/test --changed <base>`, skipping any your diff can't fail
   (AGENTS.md). Don't run the full `./scripts/check`: the orchestrator runs it at merge.
4. Use only the decision-record number the orchestrator gave you.
5. Scratch files go in your session's scratchpad. Don't write to `tmp/`; the orchestrator owns it.
6. Commit on your branch, following docs/writing.md. Never push.
7. Report: commit sha(s), what changed, each test added and how it failed before the change,
   judgment calls, and anything the owner should check by hand.
8. When you meet a choice the plan and the records don't settle, pick one, write it up in an
   accepted decision record (the number you were given), and list it in your report so the owner
   can overrule it. Don't stop to ask.
9. Give any measurement that runs by hand (a probe, a bench) a wall-clock cap of five minutes. If
   it hits the cap, stop it, measure a shorter version, and report the trend. One uncapped probe
   in step 1a took 37 of the step's 45 minutes and still didn't finish.
10. Never shape data or code to get past a checker. When `dupes.js` flags the same text with two
    meanings, add an entry to `scripts/dupes-allow.txt`; when it flags one fact written twice,
    import it from one place.
11. Render an excerpt in a test only when the render is what the test checks. To give a test a
    candidate row, seed it in the store, and let a model answer with no genome when its child
    isn't checked. An excerpt costs 4–10 s under `--low`, and in phase 3 server tests that
    rendered only to make rows passed the 30 s timeout three times. A test that must run a job
    over a real excerpt mocks `render-offline.js` with `test/support/memo-render.js`, which renders
    each distinct window once per file.

## Reviewers

1. Check out the builder's sha in a throwaway worktree, and remove it at the end. Write no product
   code and commit nothing.
2. Run `./scripts/test --changed <base>`, where `<base>` is the commit the step sits on.
3. A test that waits on real time is a finding. So is a path a user can reach with no test that
   drives it through the real parts.
4. Report PASS or FAIL. For each finding: file:line, the problem, a concrete failure scenario,
   and whether it blocks. Keep nits apart from blockers.

## Orchestrator

1. You don't write product code. You brief, merge, run the gate, and keep the plan and log.
2. Give each builder its decision-record number, so parallel builders never take the same one.
3. Before a brief, find the decision records that govern the step (docs/map.md) and quote them.
   Don't describe a decided approach from memory. When a step reaches another system (omlx, the sidecar), read that
   system's own settings, secrets hidden, and put what they require in the brief; phase 2 learned
   only at the end that omlx refuses requests without a key.
4. When two briefs touch the same idea, name in each what the other adds, and tell the later one
   to build on it. Two builders working blind each define it. Name an owner for every helper both could need (shared constants,
   test helpers); in phase 1 two voice builders each wrote the same three.
5. Fixes for a FAIL go back to a builder, and a fresh reviewer checks them. After a second FAIL
   with the same cause, don't send a third patch round: narrow the scope, change the design, or
   ask the owner.
6. Merge onto the integration branch, then run `./scripts/check` if the merge changed anything
   it reads. When the merge touches the render path, run the test suite a second time: builders
   test at two workers, and a race that only shows at full parallelism passed every builder in
   phase 1 and failed the first full run. Tag (`engine-v<N>`) only after the gate passes. A flaky test that fails a merge
   gets a hunt for its cause, not a rerun.
7. After a merge, remove the worktree and delete the branch. At the end of each phase and before a
   session ends, run `git worktree list` and remove every worktree no running agent is using, and
   `git worktree prune`. Left behind, worktrees cost gigabytes and slow every search of the repo.
8. Save the owner's screenshots in `tmp/shots/` as they arrive, named for what they show, and give
   builders the paths. Describe what to match next to the image, never instead of it.
9. Before a session ends or moves machines, write `tmp/handoff.md`: what merged, what's in
   flight and on which branch, what waits on the owner, and the next steps in order.
10. Spawn reviewers only for a large change: a new subsystem, a new stored data shape or config
    key, the omlx or sidecar boundary, concurrency, or a diff over about 300 lines or across
    tiers. Add a security pass when the change parses input, writes files or opens the network,
    and a performance pass when it touches the render path. Give each reviewer numbered
    questions. For anything smaller, read the diff yourself and run the gate if it
    reads what changed.
11. Log each subagent's tokens, tool calls and wall time in the progress log. Every three or four
    merged steps, and at each phase end, write a retrospective entry in the log: tokens and wall
    time per step, where they went (reading, test iteration, review rounds, waiting on probes),
    and what changes in the briefs or these rules because of it. Make the change in the same
    commit. Each retrospective also confirms that every checker in `./scripts/check` still skips
    `tmp/`, `.claude/worktrees/`, `node_modules/` and `.venv/`.
