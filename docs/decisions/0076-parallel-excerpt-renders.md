# 0076. Render a job's independent excerpts three at a time

- **Date:** 2026-11-08
- **Status:** accepted; provisional: owner to confirm the limit. Amends
  [0026](0026-job-runner-and-excerpt-renders.md) (the excerpt job's renders and cancel, and a
  second render of one excerpt), [0037](0037-nudge-and-branch.md) (the nudge job's renders and
  progress), [0054](0054-model-in-the-loop-cma-es.md) (a point's measured seconds) and
  [0057](0057-map-elites-archive-and-map.md) (the fill's control).

## Context

Searches, steers, nudges and fills spend almost all their time on excerpt renders: about 2 s to
render a 25 s excerpt and 0.2 s to embed it, against milliseconds for the models. A default
96-point search with its control costs about 21 minutes of renders per brief
([0059](0059-optimizer-evaluation.md)), and a 200-step fill about 15
([0057](0057-map-elites-archive-and-map.md)). Every job rendered one excerpt at a time. A CPU
profile showed the Node main thread about 81% idle during a render, since the native
`node-web-audio-api` render thread does the work, so renders started together in one process
overlap. [0010](0010-event-windows-control-grid-memory.md)'s amendments measured that even 48
concurrent 30 s renders in one process never refused a suspend; the refusal race needed many
worker threads. [0026](0026-job-runner-and-excerpt-renders.md) keeps one job at a time, and
omlx serves a live public site from the same machine, so the CPU has to keep headroom.

## Decision

**A batch of independent excerpts renders `RENDER_CONCURRENCY` (3) at a time** in the job's
own process, through `renderBatch` in `src/server/render-batch.js`. Results come back in the
items' order. A cancel or a failure starts no more items and waits for those in flight, so
nothing of the batch still writes once it settles. It then throws the signal's reason on a
cancel, the one error when one item failed, or an `AggregateError` naming each when several
did. Items start in order, and each item's synchronous part runs before its first await, so a
nudge's rows are stored in the children's order as before.

**Where it applies:** the paths whose renders don't read each other's results.

| Path | Batch |
|---|---|
| search and steer (`renderAndEmbed`) | a CMA-ES generation, and each population-sized chunk of the control |
| nudge | the job's children |
| fill | the control's nudges; the fill's own steps stay one at a time, since each picks its start from the map the previous step changed |
| excerpts job (`renderExcerpts`) | the excerpts asked for |

The candidates, explore and breed jobs, the evaluation and the search by ear stay as they were:
their renders sit between omlx requests or wait on the owner's choice
([0031](0031-fewer-waits-after-first-evaluation.md)). Embeds go through the same sidecar
client, which already takes several requests in flight; an item's embed overlaps the next
item's render because each item renders and then embeds.

**Measured** on mbp2021 under `nice -n 10`, with the other builder's tests running (load
average 3.8 to 5.1): `renderExcerpt` of `example.json` at 12 seeds, one process per row, cache
cold. A second run at 8 seeds gave the same order (1.0, 1.55, 1.79, 2.09, 2.09 times).

| At once | Wall (s) | Per excerpt (s) | Speed-up | Peak RSS (MiB) |
|---|---|---|---|---|
| 1 | 36.1 | 3.01 | 1.00 | 286 |
| 2 | 23.4 | 1.95 | 1.54 | 410 |
| 3 | 19.0 | 1.58 | 1.90 | 478 |
| 4 | 17.1 | 1.42 | 2.11 | 519 |
| 6 | 15.4 | 1.28 | 2.34 | 697 |

**The limit is 3, the knee:** the third render adds 0.36 to the speed-up, the fourth 0.21 and
each past it about 0.1, while every one takes another core from omlx. Peak RSS at 3 is a third
of 0010's 1.5 GiB ceiling. It is a constant, not a config key: it describes this code on this
machine, and the owner has no reason to set it per run.

**Two renders of one excerpt at once share one.** Two candidates can share a genome row, and so
an excerpt. `putRender` replaces a row of the same window, so the first caller would have held
a render id that no longer exists. `renderExcerpt` keeps each render in flight by its cached
file's path, and a call for that excerpt while it renders waits for it and returns its row as
cached. The rated-audio capture already handles a taken name (0026).

**A point's seconds are its share of the batch.** Each evaluation's own render and embed times
overlap the others', so `wallShares` (in `src/domain/search-cost.js`) scales a batch's times
to add up to its wall time. The search, steer and fill confirms' medians then say what a point
costs the job. `BENCH_SECONDS` stays the one-at-a-time figure, since the breed confirm renders
one at a time; a first search's confirm before any run overstates by up to the speed-up.

## Alternatives considered

- **Worker threads** — rejected: 0010 found the suspend-refusal race needs many threads, and a
  render's samples and features would cross the thread boundary as copies, as 0026 said. One
  process already overlaps.
- **Jobs side by side** — rejected, as in 0026: a generation's omlx requests would share the
  event loop with renders, and the queue's first-token reading would measure the renders.
- **A per-job or config limit** — rejected: no job benefits from a different limit, and a key
  the owner can turn up takes cores from the live site.
- **4 at once**, the cap the step allowed — rejected: 11% faster than 3 for one more core.
- **A pipeline of render and embed stages** — rejected: render-then-embed per item already
  overlaps one item's embed with another's render.
- **Batching the fill's own steps** — rejected: it changes which elite each step nudges, so a
  fill would no longer be the one 0057 describes.

## Consequences

- A search, a steer, a fill's control and a nudge spend about half as long rendering.
- Render row ids within a batch follow the order renders finish, not the items' order. The
  audio, features and file of each item are the same as one at a time, and a test checks it.
- Progress reports come after each item finishes; the step names the next to finish, so a
  report's step never goes back.
- A cancel waits for up to three renders in flight instead of one; they run side by side, so
  it takes about as long.
- A higher limit is a change to this record: measure again with the table's method.
