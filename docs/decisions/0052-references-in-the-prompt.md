# 0052. References in the prompt: the attachment table, the section, the vocabulary, trimming

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amended by
  [0056](0056-directions-sliders-reference-target.md) (the `direction` kind). Amends
  [0024](0024-prompt-parse-repair-generation.md) (a section after the ranges, its place in the
  trimming order, `attachmentIds` on each generation) and
  [0034](0034-feature-ranges-as-soft-targets.md) (what goes beside the ranges lives outside
  `softTargets`)

## Context

Use (b) of a reference region, settled by the owner on 2026-11-07, guides generation: the
region is described in the first prompt as numbers and words. 5a stores regions
([0050](0050-reference-uploads.md)) and 5b measures them on excerpt-long windows at a brief's
loudness, with a CLAP embedding ([0051](0051-region-analysis-and-ranges.md)). The plan first put
a brief's attached regions in `softTargets.references`, so each change made a new revision. The
owner overrode that on 2026-11-07: "A brief's attached regions, directions and axes live in their
own append-only table keyed by vibe, not in `softTargets`, so changing them makes no new brief
revision; each generation still records which ones it read." 5g adds directions and 5h axes to
the same table. The context budget is 8 192 tokens at 3.5 characters a token (0022), and 0038's
seed-sized prompt with a base and six examples is about 4,300.

## Decision

**The table** (`0010-vibe-attachments.sql`, `src/server/attachment-store.js`), irreplaceable:
`vibe_attachments` holds `vibeId`, `kind`, `regionId`, `details` (JSON) and the removed marks. The
CHECK admits three kinds: `reference` now, and `direction` and `axis`, which 5g and 5h write
without another migration. A reference names a region (a CHECK) and has `details` `{}`; a direction
puts its two ends in `details`, and an axis its feature or direction, ends and bins, with
`regionId` set for an axis on similarity to a region. A partial unique index keeps one live row
per vibe and region. Detaching marks the row `detached`; attaching again adds a row. A region
that is changed, removed, or whose recording is removed is detached from every vibe in the same
transaction (`region replaced`, `region removed`, `recording removed`), so a live attachment
always names a live region. A changed region is a new row that has to be measured, so it is
attached again by hand.

**Each generation records what it read.** `generations.attachmentIds` is a JSON list of
`vibe_attachments` ids, as `exampleIds` lists examples: the attachments whose section the prompt
held after trimming. Rows from before the migration read `[]`. A column rather than a link
table, because the list is written once with the row and read with it, as `exampleIds` is. A
revision and a repair replay the first try's prompt, so they copy its list.

**Attaching** (`POST /api/vibes/:id/attachments`, `{kind: "reference", regionId}`). Each of these
is a 400 that names the region: no such region, a removed one ("region 5 ("hum") was replaced"),
one with no analysis at the brief's current loudness under this server's `PRODUCER` ("isn't
analyzed at this brief's loudness, −14 LUFS; analyze it first"), one attached already. A third
region is a 400 too: `MAX_REFERENCES` is 2 (`src/domain/attachment-kind.js`).
`POST /api/vibe-attachments/:id/detach` detaches one; `GET /api/vibes/:id/attachments` lists the
live ones with each region's file name, bounds, and whether it is measured and embedded at the
brief's loudness. None of them makes a revision.

**The section** (`referencesText`, `src/domain/references-text.js`) comes after the ranges and
before the locks, so the model reads the regions beside the numbers measured the same way:

```
Parts of reference recordings the owner attached to this vibe, measured the way the ranges are. Aim at their measurements; don't copy the recordings, which the engine can't play:
Reference 1, its label as a JSON string: "dawn hum"
Its note, as a JSON string: "the low hum under the birds, before the wind starts"
Medians over its 4 windows: loudness range: 3.4 LU, spectral centroid: 412 Hz, centroid spread: 61 Hz, onset rate: 0.12 a second, low-end share: 0.61, stereo width: 0.07, spectral flatness: 0.03
Words nearest its sound: low, droning, warm, slow, dark
```

- The label and note are the owner's text, quoted as JSON strings (0038's rule), with U+2028 and
  U+2029 escaped too, so neither can end its line or open a section. An empty note has no line.
- The medians are per feature over the windows that measured it, by nearest rank, so each is a
  value a window read; written by `featureEntryText`, which `featuresText` uses, so a region's
  numbers read as an excerpt's do. Only the range table's features are given: the two raw levels
  of a mastered recording say nothing a genome can match (0051). A feature no window heard is
  "none measurable".
- The words line is left out when the sidecar has no checkpoint, as excerpts then go unembedded.
  With a checkpoint, a region whose sound was analyzed under another one, or under none, stops
  the job naming the region and saying to press Measure, which reruns 0051's Analyze job: it
  embeds again under the new checkpoint without measuring again.

**Generation reads it** (`promptReferences`, `src/server/prompt-references.js`). The candidates
job, which explore reuses, reads the vibe's live reference attachments and each region's
analysis at the current revision's loudness. An attached region with no analysis there (the
brief's loudness changed, or the engine or feature producer did) stops the job before any omlx
request, naming the region and saying to measure it again or detach it: the owner attached
those measurements, and a prompt without them would look like it had them. The evaluation (0030)
passes none, so its runs stay comparable with earlier ones. Revisions and repairs replay the
first try's prompt, section included, and 5i's breeding prompt is to read it the same way.

**The vocabulary** (`REFERENCE_WORDS`, `src/domain/reference-words.js`): 60 plain words a
listener would use ("dark", "airy", "pulsing", "underwater", "hissing"). A region gets the five
(`WORDS_PER_REFERENCE`) whose CLAP text embedding is nearest its embedding by cosine, nearest
first. Each word is embedded alone, through 4h's `embedText`, whose file cache is keyed by the
checkpoint's producer and the text, so the sidecar embeds each word once per checkpoint: 60
requests the first time a region with an embedding is in a prompt, none after. A sidecar failure
there fails the job naming the word, as one embedding the brief does.

**Trimming.** Over the budget, examples go first, from the end; then references, from the end;
then the base. Each part kept is the most of the later parts that still fit, as 0038 brings the
examples back once the base goes: dropping a reference lets examples that fit return, and
dropping the base lets references and examples return. `buildPrompt` returns `referenceIds`.

**Token cost**, measured on `buildPrompt` at 3.5 characters a token: the section is about 160
tokens for one region with a short label and note, about 250 for two, and about 1,500 for two at
the longest label (200 characters) and note (2 000). 0038's seed-sized prompt with a base and
six examples goes from 4,306 tokens to 4,555 with two typical regions and 5,801 with two of the
longest, under the 8,192.

**The brief page** has a card, "Regions for the model to aim at": each attached region with
what the model is told, Measure, which runs the Analyze job at the brief's loudness, and Detach; a
chooser of the regions it can still attach, and Attach, which measures the region first when it
needs it. The texts are `src/web/attached-regions.js`, with no DOM.

## Alternatives considered

- **`softTargets.references` in a new revision** — overruled by the owner: attaching or
  detaching would make a revision, and the revision list would fill with changes that aren't to
  the brief.
- **A link table from generations to attachments** — rejected: the list is written once with
  the generation and read with it, and `exampleIds` is the neighbor that does the same.
- **One table per kind** — rejected: 5g and 5h would each add a migration, and phase 6 reads all
  three kinds per vibe.
- **No CHECK on `kind`** — rejected: the table is irreplaceable, and a typo in a kind would be
  stored forever; the three names come from the plan.
- **Moving an attachment to a changed region's successor** — rejected: the successor has new
  bounds and no analysis, so the prompt couldn't describe it.
- **Leaving out a region with no analysis and generating anyway** — rejected (AGENTS.md,
  principle 5): the owner would read a stored prompt without the region they attached.
- **Words written by hand per region, or by the model** — rejected by the plan: the words are
  measured.
- **Every feature, raw levels included** — rejected, as in 0051.
- **Trimming references before examples** — rejected by the plan: the owner chose a region on
  purpose, and the examples are retrieved.

## Consequences

- 5g writes `direction` rows and 5h `axis` rows in this table with their `details`, and validates
  them in the server, not in `validateTargets`; 5g's reference target reads the region's
  embedding through the same attachments.
- Changing the brief's loudness, or bumping the engine or a feature file, leaves attached regions
  unmeasured until the owner presses Measure; until then asking for candidates fails with the
  reason.
- A prompt with two of the longest regions leaves about 2,400 tokens; a revision follow-up of it
  is under the budget (`buildPrompt`'s acceptance test), but a larger base could trim examples
  sooner.
- The words reflect CLAP's text-to-audio space, not a listener's; whether they read right is an
  owner check.

## Amendments

- 2026-11-07: from step 5g ([0056](0056-directions-sliders-reference-target.md)).
  `ATTACHMENT_KIND` gains `direction`. A direction names no region, and its `details` are
  `{near, far}`: each end one line of text of at most 100 characters, the near end null for the
  brief's own description as text, the two ends different. `addAttachment`'s per-kind check takes
  the region too, and refuses any other shape. A brief holds at most 4 (`MAX_DIRECTIONS`).
  `POST /api/vibes/:id/attachments` takes `{kind: "direction", near?, far}`, and
  `GET /api/vibes/:id/attachments` lists `directions` beside `references`; the detach route
  removes either. The prompt doesn't read directions, so `generations.attachmentIds` still lists
  only references; each steer point records the directions and regions it read in
  `operatorParams.steer`.
