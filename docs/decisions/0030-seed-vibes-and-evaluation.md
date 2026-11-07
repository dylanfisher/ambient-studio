# 0030. Three seed vibes, and an owner-started evaluation that stores one report per run

- **Date:** 2026-11-06
- **Status:** accepted; provisional: owner to confirm; amended by
  [0034](0034-feature-ranges-as-soft-targets.md) (the seed vibes' feature ranges)

## Context

Phase 2's acceptance 1 asks whether at least 90% of generated genomes validate after at most one
repair round, over at least 48 genomes across at least 3 vibes, where "validate" means the schema
([0005](0005-genome-schema-table.md)) and the vibe's linter ([0020](0020-vibe-constraints-and-linter.md))
both pass. The run must go through the server's omlx queue ([0022](0022-omlx-queue.md)) and
generation ([0024](0024-prompt-parse-repair-generation.md)), report the rate before and after
repair per vibe with a 95% Wilson interval, give the schema-only rate beside it, and count
truncated answers as their own reason. omlx serves a live site from the same machine, so nothing
may start a run but the owner (AGENTS.md). The store keeps an `evaluations` row per finished job
([0021](0021-store-tables-and-append-only.md)), the runner runs one job at a time
([0026](0026-job-runner-and-excerpt-renders.md)), and the owner settled on 2026-11-06 that phase 2
ships three seed vibes written by the plan's builder, for the owner to edit or replace.

## Decision

**Seed vibes** are JSON files in `src/domain/vibes/`, each in the shape `POST /api/vibes` takes,
listed in `SEED_VIBES` (`src/domain/seed-vibes.js`). All three target −16 LUFS
([0018](0018-default-loudness-target.md)) and have no beat. Each has feature ranges and no other
soft target (amended 2026-11-07). Between
them they set every constraint kind but `bpm`, each sets a kind the others don't, and a test
builds one genome per seed from the goldens that passes its linter, so no seed asks for what no
genome can meet.

| Seed | Constraints | Why |
|---|---|---|
| `cold-dorian`, a slow drone and pad in D dorian | `tuning` 12-tet, `scale` dorian, `key` 2, `pulse` none, `duration` 300–900 s, `allowedVoices` drone and pad, `padChords` 1.5, `brightness` 0.1–0.45 | The only seed with a key, so the root-degree rule is measured; the pad ceiling (hold at least 40 s) is what makes it slow; a low brightness ceiling is what makes it dark. A voice whitelist of two types tests whether the model keeps to a short list. |
| `bell-field`, sparse struck bells | `tuning` colundi, `scale` core18, `pulse` none, `duration` 240–600 s, `allowedVoices` bell, pad and drone, `bellNotes` 6, `brightness` 0.3–0.7, `cost` 400 | The tuning is a table of fixed frequencies rather than ratios on a root, many of them in whole-number ratios to each other (264, 320, 360, 384, 528 Hz), so no key applies and the model must leave `key` out. The bell ceiling (6 a minute, under the voice's safe 8) makes it sparse; the cost ceiling is the one kind that rests on the engine's own sum. |
| `tidal-noise`, a warm noise bed | `pulse` none, `duration` 480–900 s, `bannedVoices` bell and pad, `grains` 6, `brightness` 0.1–0.4, `cost` 300 | No tuning, scale or key, so pitch is the model's choice; a banned list instead of an allowed one; a ceiling on the granular cloud, which it may add as haze; the lowest cost ceiling and the longest minimum, for a bed meant to run a long time. |

**Loading a seed** (`POST /api/seed-vibes/:seedId`, body `{}`) creates a normal vibe through the
same draft check as any vibe, so it is append-only like the rest. `GET /api/seed-vibes` lists the
seeds, each with `vibeId`, the vibe it is loaded as or null. A seed counts as loaded while a vibe
not removed has the seed's draft (name, brief, constraints, soft targets, compared deeply) as its
first revision; loading it again is a 409 naming that vibe. Later edits append revisions and don't
free the seed; removing the vibe does. Editing a seed's file makes it a new seed, which loads
again.

**The evaluation** is a job (`kind` `evaluation`) added only by `POST /api/evaluations` with
`{vibeIds, count}`: at least one vibe, none twice, each existing; `count` is per vibe, 1 to 64,
and the page's default is 16 (`EVALUATION_COUNT` in `src/domain/evaluation-size.js`). A second
evaluation while one is queued or running is a 409. The job draws one stream seed from the app's
`random` and runs `generateCandidates` for each vibe in order with it (request groups are named
per vibe, 0024), outside any session (`sessionId` null), with no locks and the recordings index a
session job reads. Cancelling the job (`POST /api/jobs/:jobId/cancel`) cancels the omlx queue, as
the candidate job does. Stopping a session leaves it running (0027).

**A request that fails in the queue** (a cancel, a busy omlx past its wait, a timeout, an error
status, a refused `response_format`) stops the run, as it stops a batch in 0024. The report of
what was made is still stored, with `stopped` holding the error, and then the job fails with it,
so the job line says what happened and the page still has the numbers. Any other error (an
invalid vibe, a prompt over budget) fails the job and stores nothing.

**What is stored.** `params`: `vibeIds`, `count`, `seed`, `model`, `sendResponseFormat`,
`maxTokens`. `report` (`evaluationReport` in `src/domain/evaluation-report.js`):

- `vibes`, one per vibe asked for, in order, with its `vibeId`, `revisionId`, `name` and
  `requestGroup`, and `overall`, each a tally: `requested`, `made`, `answered`;
  `valid.beforeRepair` and `valid.afterRepair` (schema and linter); `schemaValid` likewise
  (schema alone); `truncated`; `requestFailed`; and `rejects.firstTry` and `rejects.afterRepair`,
  counts of `noJson`, `invalidJson`, `severalObjects`, `schemaErrors` and `lintErrors`. Each rate
  is `{count, of, share, low, high}`, `low` and `high` its 95% Wilson interval
  (`wilsonInterval`, checked against Newcombe 1998, Table I).
- `latencyMs` and `firstTokenMs`, each `{firstTry, repair}` of nearest-rank percentiles `{count,
  p50, p90, p95, max}` over the stored generations, failed requests left out; null when there
  are none.
- `responseFormat`: `notSent` when the config leaves it off, `refused` when a generation's error
  is the queue's refusal, `accepted` when a request carrying it was answered, `noAnswer` when it
  was sent and nothing was answered.
- `stopped`: the error that stopped the run, or null.

**How the rates count.** The denominator is `answered`: candidates whose first request was
answered. A failed request is the transport's failure, not the model's, so it is counted apart,
like truncation (0024). "Before repair" reads the reason the first answer got, which
`generateCandidates` passes to an `onCandidate` callback as each candidate is stored, since a
repaired candidate's row holds only the repair's verdict. A candidate whose repair failed in the
queue counts as invalid after repair. A tally with nothing answered has null rates, not 0 of 0.
Truncated answers get no repair, so they are invalid both before and after.

**The page** (`evaluation.html`) checks the vibes loaded from seeds, starts a run with Shift+S and
a confirm, cancels with `c`, polls the job every `POLL_MS` (0028), and shows each stored report,
newest first, with `j` and `k`. The vibe list gains the seeds (Enter loads the focused one) and
`e` for the evaluations.

**The `randomGenome` baseline** is a test helper (`test/support/random-genome-baseline.js`) that
scripts the fake omlx to answer every request, repairs included, with a `randomGenome` genome, so
a run through the same pipeline passes the schema at 100% and shows what the linter makes of
unconstrained genomes. It never runs against omlx.

## Alternatives considered

- **Seeds as JS modules** — rejected: as data they belong beside the genome fixtures, in the shape
  the route takes, and as code every voice type and tuning id in them reads as a second copy of the
  engine's own.
- **A `seedId` column on vibes** — rejected: it needs a migration of an irreplaceable table, and
  the first revision already says where the vibe came from.
- **Refusing a seed once any vibe has its name** — rejected: a name is the first thing the owner
  edits, and an unrelated vibe could share it.
- **Loading a seed again as a second vibe** — rejected: a double click would leave two vibes the
  owner can't tell apart, and append-only rows can only be marked removed, never deleted.
- **A count across all vibes** — rejected: per vibe gives each vibe the same sample, and the
  acceptance reads "16 a vibe".
- **Rendering each valid genome in the run** — rejected: "valid" is the schema and the linter, and
  renders would hold the event loop between omlx requests, which inflates the first-token reading
  (0026).
- **Storing nothing when a run stops** — rejected: a refused `response_format` or a busy omlx is
  what the owner most needs a record of.
- **Retrying the next vibe after a failed request** — rejected: the next request would most likely
  fail the same way and add load to a busy omlx (0024).
- **A normal-approximation interval** — rejected: it leaves 0–1 and has zero width at 100%, where
  the rates are expected to sit.
- **Interpolated percentiles** — rejected: nearest rank reports a value that was measured.
- **The baseline as a server option** — rejected: the plan asks for it in tests, and a server path
  that answers without omlx would be one more thing a config could switch on by mistake.

## Consequences

- The owner starts the run: config `omlx.model` set to the id omlx serves, the three seeds loaded
  from the vibe list, then 16 per vibe from the evaluation page. With `queue.sendResponseFormat`
  true the first request shows whether omlx takes it; if refused, the stored report says so and a
  second run with it false measures the rates.
- The report's percentiles are what 0022 asks for to calibrate `firstTokenThresholdMs` and
  `minPrefillTokensPerSecond`; its truncation count says whether `maxTokens` needs raising.
- `bpm` is set by no seed, so its lint rule is measured only by an owner-made vibe with a beat.
- A seed whose constraints stop validating after a schema change fails its load with the
  validator's errors, and the seed test fails first.
- An evaluation's candidates and generations are ordinary rows with source `llm` and no session;
  phase 8 can read them as it reads a session's.

## Amendments

- 2026-11-06: from step 2n ([0032](0032-plain-language-pages.md)). The evaluation page is
  "Model test", started with a button and a confirm instead of Shift+S, and off until the test
  finishes. Its results are in plain words: "Worked first time", "Worked after one fix", each with
  its 95% Wilson interval said as "with this few tries, the true rate is probably between 64% and
  96%"; "Cut off before finishing"; time per request as the median, 9 in 10 and the slowest
  (p95 is no longer shown); "Model was asked for JSON format: not sent / accepted / refused"; and
  a sentence on what the result means. "Working well" in that sentence is phase 2's 90% after one
  fix; "low first time" is under 50%. The seed vibes are "starting points" on the dashboard, added
  with a button. The stored report is unchanged.
- 2026-11-06: from step 2m ([0031](0031-fewer-waits-after-first-evaluation.md)).
  - **`params.thinking`.** An evaluation's `params` records `queue.thinking`, the value sent as
    `chat_template_kwargs.enable_thinking` with every request.
  - **`report.reasoning`.** The report gains `reasoning: {answered, withReasoning}`: of the
    generations that were answered, how many came back with reasoning text. With thinking off, a
    `withReasoning` above 0 says omlx or the template ignored the switch.
  - **A second evaluation.** `POST /api/evaluations` while any evaluation is queued or running is
    a 409 with body `{error, jobId}`, `jobId` naming the unfinished job and `error` the sentence
    "An evaluation is already queued or running (job N). Wait for it to finish, or cancel it."
- 2026-11-07: from step 3b ([0034](0034-feature-ranges-as-soft-targets.md)). Each seed vibe has
  feature ranges at `softTargets.features`, calibrated on lint-passing draws as 0034 records,
  and no other soft target; 3h's builder may not change them. Since the seed's draft is compared
  deeply, each edited file is a new seed: a vibe the owner loaded before keeps `{}` and no
  longer counts as the seed, which shows as not loaded and loads again as a new vibe.
