# 0068. The Model test page says where the taste model stands, read from the data

- **Date:** 2026-11-08
- **Status:** accepted. Amends [0042](0042-clap-embeddings.md) (the embed job's scan is shared)
  and [0044](0044-bayesian-bradley-terry.md) (a read route beside the fit job's)

## Context

The embed and fit jobs (0042, 0044) show progress in a box that follows a running job. After a
reload the page follows only unfinished jobs, so a finished analysis or fit leaves no trace, and
the owner can't tell whether the work was kept or has to be run again. It was kept: embeddings
are rows, models are files under their keys, and both jobs skip what is already there. The
job list is held in memory, so a restart forgets it, and it can't answer this question.

## Decision

`GET /api/preference-models` returns where the taste model stands, read from the store and the
models folder:

- **analysis:** how many excerpts the embed job would analyze now, counted by the scan the job
  itself runs (`excerptsToEmbed`), and when the newest embedding was made.
- **fit:** when the newest model file was written (its modification time), and each brief's
  state from `currentModel`, the function the brief page's summary and the ranking use.

The Model test page shows both as a line each under Analyze the sound and Fit the taste model,
on load and when either job ends: how many excerpts wait, or that none do; and whether the model
is up to date for every brief, or which briefs' models are out of date.

With no embedding yet, the count needs no producer, so the sidecar isn't asked; with no model
file, `currentModel` asks it nothing either. A page opened in a studio that never analyzed a
sound doesn't start the sidecar, as [0047](0047-what-you-like.md) holds for the brief page.

## Consequences

- The fit time is the newest model file's, so a fit that kept every file doesn't change it; the
  line then still says up to date, which is what the owner needs.
- A brief can read out of date with no new ratings of its own: its prior is fitted on every
  other brief's ratings (0044), so a rating anywhere changes its key.
