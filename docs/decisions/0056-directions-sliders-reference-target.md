# 0056. CLAP directions, sliders, the steer job and the reference target

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm the weights, the slider's meaning and the
  default budget. Amends [0031](0031-fewer-waits-after-first-evaluation.md) (the steer's
  conflict rule and progress step), [0034](0034-feature-ranges-as-soft-targets.md) (directions
  are not in `softTargets`), [0052](0052-references-in-the-prompt.md) (the `direction` kind's
  details) and [0053](0053-search-space-ask-tell.md) (`searchScore` takes terms)

## Context

Use (c) of a reference region, settled by the owner on 2026-11-07, steers by sound: the region's
CLAP embedding is a target that search and sliders move toward. Acceptance 7 asks that a typed
direction become a slider, that each card show its position on it, and that a steer job toward
either end move its shown children's mean position that way. The plan first saved directions in
`softTargets.directions`; the owner overrode that on 2026-11-07: they are rows of the append-only
`vibe_attachments` table keyed by vibe (0052), so changing them makes no brief revision, and each
generation or steer records which ones it read. 5e ([0054](0054-model-in-the-loop-cma-es.md))
built the search job, which refuses a brief with no taste model; on 2026-11-07 that brief had
0 A/B ratings. Excerpt embeddings are unit vectors under the sidecar's producer (0042), a
region's is the unit mean of its windows' (0051), and text embeddings come through 4h's
`embedText` file cache.

## Decision

**A direction** is a `vibe_attachments` row of kind `direction` with no region and `details`
`{near, far}`: each end one line of at most 100 characters (`DIRECTION_END_CHARS`), the near end
null when omitted, the two ends different. `addAttachment` holds the check, and the route turns
its message into a 400. A brief holds at most 4 (`MAX_DIRECTIONS`), one slider each. The brief
page's card "Directions for the sliders" adds them (From, To) and removes them with the shared
detach route.

**Its vector** (`directionVector`, `src/domain/direction-vector.js`) is the unit difference of
the far end's embedding less the near end's. Each typed end is embedded with `embed_text`
through `embedText`'s cache, so the sidecar embeds a text once per checkpoint. **The default near
end** is the unit mean of the vibe's excerpt embeddings: the direction then points from what the
brief already sounds like toward the text. The vibe's excerpts (`vibeExcerptEmbeddings`) are
every render of one of its genomes as an excerpt (25 s) at the current revision's loudness under
this server's `PRODUCER`, with an embedding under the embedder's producer.

**A position** is the excerpt's dot product with the direction (`projection`), read on the
vibe's scale (`vibeScale`, `scaledPosition`, `src/domain/vibe-scale.js`): 0 at the vibe's least
excerpt and 1 at its most, and past either end for a sound beyond them. With fewer than 2
excerpts (`MIN_SCALE_EXCERPTS`), or excerpts that all project alike, a direction has no scale: the
card says it "can't be placed yet" and why, its slider is off, and a steer naming it is a 409.
With no excerpt at all, a direction with no near end has no vector either. A region's nearness
is its cosine similarity to the excerpt, read on the same kind of scale.

**The card.** `GET /api/vibes/:id/steering` gives each direction and each attached region its
reason, if any, and each excerpt's position by render id (`steeringView`). It asks the sidecar
nothing when the brief has neither; with no checkpoint it gives the reason and no positions. The
session page reads it on load and when a job finishes, not on each poll, since it can start the
sidecar. Each card's row says where it sits ("Where it sits, from 0 (this brief's least) to 1
(its most): “dry” to “underwater” 0.63"); behind More controls each direction has a slider from
its near end to its far end, starting at the card's position (held in 0 to 1, in steps of 0.05),
each attached region a "Toward this region" box, then a points field and Steer from here.

**The slider is a target, not a push.** The setting is where on the vibe's scale the owner wants
the sound. Only the sliders the owner moved are sent, and the boxes ticked; at least one, or a
400. Setting 1 aims at the vibe's most so far; a steer's children are then excerpts of the vibe,
so the next read's scale widens and the slider can go further.

**The objective.** `searchScore(mean, variance, terms)` is 0053's lower bound plus the weighted
terms; with no terms it is the bound exactly, so a plain search scores as before. A steer's
terms (`steerTerms`, `src/domain/steer-terms.js`): for each direction, −|position − setting| at
weight 10 (`DIRECTION_WEIGHT`); for each region, its scaled nearness at weight 10
(`REGION_WEIGHT`). The model's score has weight 1, so a sound a tenth of the vibe's spread from
the setting costs as much as one unit of the taste model. With a current fitted model the score
is `searchScore(mean, variance, terms)`; without one (none, out of date, or unreadable) it is the
terms alone (`termsScore`), and the job's result says `model: false`.

**The steer job** (`steerJob`, `src/server/steer-job.js`) is 5e's `searchJob` with its own
scorer, operator `steer` (source `optimizer`), no control arm and no raw paths: CMA-ES over the
free macros from the base, budget default **32** (`DEFAULT_STEER_BUDGET`), at most 400. Each point
stores `operatorParams.steer`, the directions with their settings and the regions it read. The
session shows its best 4 apart in sound, the rest folded under them, as a search's
(`searchPlaces` reads its run). Its confirm (`steerCostText`) gives 5e's estimate and says
nothing goes to the language model. `POST /api/sessions/:id/steers` takes `{candidateId, budget?,
directions?: [{id, setting}], regions?: [id]}`; each id must be a live attachment of the brief of
its kind (a 400), named once. It refuses with a 409, before adding a job, a brief with no
checkpoint and a chosen direction or region with no vector or scale, saying why; it doesn't ask
for a taste model, which is the one place 5e's no-model refusal is relaxed. The job reads the
steering again when it starts and fails with the same reason if it changed.

**The reference target** is the region term: "toward this region" on a card, for a region
attached to the brief (0052) whose analysis at the brief's loudness was embedded under the
sidecar's checkpoint; otherwise its box is off and says to press Measure.

**Phase 6** reads the same pure functions over stored embeddings: `directionVector`,
`projection`, `vibeScale` and `scaledPosition` for a section's position on a direction or an
automation lane's target, and `regionSimilarity` for nearness to a region.

## Alternatives considered

- **`softTargets.directions` in a new revision** — overruled by the owner (0052).
- **The slider as a push, maximizing the projection toward "more"** — rejected: a slider's
  middle would then mean nothing, and the owner can't say "a little drier than this". A target
  on the vibe's scale reads the same on every card.
- **Raw projections or cosines on the card** — rejected: CLAP's numbers differ by hundredths
  between excerpts and say nothing alone; 0 to 1 over the brief's own excerpts does.
- **Sending every slider, moved or not** — rejected: an untouched slider would pin the steer to
  the card's place on that direction, which the owner didn't ask for.
- **Refusing a steer with no taste model, as a search is** — rejected by the plan: a brief with no
  ratings should still steer by sound.
- **Projection with the model at equal weight** — rejected: the plan asks for a small weight on
  the model, and the model's scores are in its own units.
- **Region nearness as a raw cosine** — rejected: cosines to one region spread by a few
  hundredths, so its term would vanish beside a direction's; on the vibe's scale both run 0 to 1.
- **A separate optimizer for steering** — rejected: 5e's job already has the budget, progress,
  cancel and shown points; only the scorer differs.
- **Embedding a direction's ends when it is added** — rejected: the route would need the
  sidecar, and the cache makes the first read embed them once anyway.

## Consequences

- A direction with no near end moves as the brief's excerpts change, and every scale moves with
  them; a steer reads both when it starts and keeps them for its run. The positions on a card
  can change after any job, which the page shows when it reads them again.
- CLAP's text and audio embeddings sit apart in its space (the modality gap), so a direction from
  the excerpts' mean to a text points partly along that gap; whether it reads as "more
  underwater" is an owner check. Two typed ends cancel most of the gap.
- With no checkpoint set, nothing can be placed or steered; the session page says why.
- Steer runs share the search folder, its run numbers and its estimate.
- The weights are guesses until the owner has steered: if a model score that disagrees with the
  slider wins, raise them.
