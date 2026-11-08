# 0048. Quick A/B, one excerpt player, and MP3 playback audio

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0025](0025-http-server-and-audio.md) (`audio/mpeg`),
  [0026](0026-job-runner-and-excerpt-renders.md) (the render cache holds MP3s, and capture renders
  again) and [0032](0032-plain-language-pages.md) (keys on the Quick A/B page). Amended by
  [0046](0046-ranking-wildcards-pair-picker.md) (a third order, Best questions) and
  [0055](0055-search-by-ear.md) (a search-by-ear mode)

## Context

The owner asked (step 4i, plan progress log 2026-11-07): "we need a way to automate a/b testing
quickly, e.g. randomly select a series of a/b and have me test them quickly. use wasd and
left/right keys to allow playing one vs the other and choose left or right etc ... candidates and
all audio players should use a minimal audio player so i can see the whole seek bar (native audio
player is too compacted). make sure candidate audio and any temporary/review audio is saved as
smaller file size, e.g. mp3 320 or similar ... automated a/b could potentially keep the chosen one
until you choose another, e.g. find the best by discarding until a new best is chose."

The owner's answers settled the pool (one session's candidates, started from the session page),
the order, the keys, MP3 at 320 kbps through the `lame` CLI, and that the one file kept per rated
excerpt stays FLAC with its PCM hash. Excerpts were cached as 24-bit WAVs (0026), served with byte
ranges (0025), and `captureRatedAudio` turned the cached WAV into the rated FLAC. 0032 removed
every key at the owner's earlier request. 4c's training sets read A/B ratings by session
([0043](0043-training-sets-and-model-key.md)).

## Decision

**MP3 playback audio.** `writeMp3` (`src/server/write-mp3.js`) pipes the 24-bit PCM from
`encodePcm24` into `lame -r --bitwidth 24 -b 320 --cbr` on stdin as raw samples, mono or joint
stereo, so no WAV is written first. `LAME`, `MP3_KBPS` (320) and `MP3_EXTENSION` are defined
there once. lame is found on PATH, as flac is (0012); Homebrew installs it in
`/opt/homebrew/bin`, and `./scripts/setup` checks for it. A non-zero exit throws with lame's
stderr. lame writes a LAME tag with the encoder delay, so decoders (and `lame --decode` in the
tests) give back exactly the samples encoded, and both sides of a pair start at the same point.

**The render cache holds only MP3s.** An excerpt is rendered, normalized and measured as before,
and its heard audio cached as `<…>-<producer hash>.mp3`. `cachedFile` (`render-excerpt.js`) is the
one test for a usable cached file: it names an MP3 and the file exists. A row whose file is a WAV
from before this record counts as not cached: the candidate list shows no excerpt, Render missing
excerpts renders it again, the replaced row's WAV is deleted, and `/audio/:renderId` answers a
WAV row with a 404 saying to render it again. No migration: renders are derived. The audio route
serves `audio/mpeg` with the same byte ranges, which Safari needs to seek.

**Capture renders the excerpt again.** The cache keeps no lossless copy, so
`captureRatedAudio` gets the exact normalized PCM from `renderHeardAgain`, which renders the
render row's window, checks it and normalizes it as `renderExcerpt` does (the features are not
measured again). That PCM is what was heard: renders are reproducible under one producer (0009),
the capture already refuses a render of another producer, and a genome's field recordings are
found by hash (0029). As a check that costs nothing extra, the gain and the render checks must
come out equal to the row's, or the capture throws and keeps nothing. The PCM is written as a
WAV in the capture's temp folder and encoded to FLAC as before, so the FLAC and its hash are made
the same way. The rating routes pass the recordings index lazily (`jobRecordings`), read only
when an excerpt is rendered again. A second rating of the same excerpt reuses the row and
renders nothing. When a capture fails after making its temp folder and removing that folder
fails too, the error names both, the capture's first, so the cleanup can't hide the cause.

**Measured** on mbp2021 under `nice -n 10`, at a load average of 2.5 with a parallel builder
running, two seeds each:

| | drone golden | `example.json` |
|---|---|---|
| cached excerpt, was a WAV | 7 200 044 B | 7 200 044 B |
| cached excerpt, MP3 now | 1 002 240 B | 1 002 240 B |
| rated FLAC (unchanged) | 924–929 kB | 3.50–3.57 MB |
| rendering an excerpt, MP3 included | 1.48–1.51 s | 2.99–3.04 s |
| first capture of an excerpt (was about 150 ms) | 0.78–0.80 s | 2.27–2.29 s |
| a later capture of the same excerpt | 0.1 ms | 0.1 ms |

lame takes about 0.18 s for a 25 s excerpt. An MP3 is a seventh of the WAV it replaces; the
first capture costs roughly the excerpt's render time less its feature measurement (0.57 s).

**One excerpt player** (`src/web/excerpt-player.js`). `mountPlayer(audio, onError)` turns off an
`<audio>` element's native controls and builds beside it a Play/Pause button, the time and
duration (`0:12 / 0:25`), and a range input from 0 to `SEEK_STEPS` (1000) across the card.
Dragging shows where it will land without moving playback; letting go (`change`) sets
`currentTime`, so the played tracker sees `seeking`/`seeked` as before (0028). A new `src` resets
it through `emptied`. Every play goes through `playAudio`, which ignores the AbortError a pause
or a new source gives a play still starting (switching sides fast does it constantly) and
reports any other refusal. The session cards, the session page's comparison, the lineage page and the
Quick A/B page all use it; no page has `<audio controls>`, which a test checks. CSS hides the
player when its audio element is hidden.

**The Quick A/B page** (`quick-ab.html?id=<session>`), opened by a Quick A/B link on the session
page. The pool is the session's candidates with an excerpt; `poolOf` in `quick-ab-session.js`
is the one place 4j leaves the hidden ones out. The order (`quick-ab-order.js`, no DOM, its
draws injected):

- **Champion** (the default): the pool is shuffled; the first is the champion and the rest
  challengers in turn. Choosing a side keeps that side as champion against the next challenger.
  A tie keeps the champion. A skip uses up the challenger: it has had its turn, and the next
  challenger comes. The pool runs out when every candidate has had a turn (n − 1 pairs).
- **Random**, a checkbox: each pair is drawn from the pairs not yet rated, on the page or by a
  live rating of this session from before (read from `GET /api/vibes/:vibeId/ratings`, matched
  to candidates by genome and seed).
- Neither mode draws a pair already rated on the page. A rating that failed to save doesn't
  count as rated, but its pair is held out of every draw until Retry saves it or Discard drops
  it, so a pair can't end up with two live ratings; once discarded it can be drawn again.
- Switching mode applies from the next pair: the pair shown stays, half heard or not.
  Switching to champion starts a new round of every other candidate against the champion so
  far, skipping pairs already rated.
- Undo (Z) puts back the pair and the champion from before the last rating, so that pair is
  shown again; Z again goes back further. The mode stays as the switch shows it.
- When the pool runs out, the page says so and names the last one chosen.

Each pair is drawn by the existing `POST …/ab-pairs`, so the sides come from a logged seed, and
each rating goes through `POST …/ab-ratings` under the session's id with that seed, built by
`abRatingBody` (`ab-rating.js`, shared with the session page's comparison). Ratings rows are
unchanged, so 4c's training sets read them as they read any other.

**Saving in the background** (`quick-ab-session.js`, no DOM, tested over a fake fetch). Because
capture takes a second or two, the page shows the next pair at once and queues each rating; the
queue sends one at a time. A line under the progress says how many are saving and lists each
that failed, with its error and a Discard button, until a Retry saves it or Discard gives it
up; a later choice doesn't clear it. A fault in the page's render while a save is sent is
reported and never leaves a save queued, sending or unsettled. Leaving
the page while any rating is queued, sending or failed asks first (`beforeunload`). Undo waits
for the last rating's send, saying so on the status line, then asks the server to remove it, and only when that succeeds
takes it off the page and restores the order; a failed remove leaves everything in place and
shows why. Undo of a rating that never saved removes nothing on the server. When a pair's
sides can't be drawn (`POST …/ab-pairs` fails), the pair stays the order's current pair, the
choice buttons and keys do nothing, and Retry draws it again. One action runs at a time, so a
key pressed while the next pair loads does nothing. A mode switch made while the pool loads is
kept. The page doesn't start the next pair
playing by itself.

**Keys, on this page only** (`quick-ab-keys.js`, the one table): ← and → play the left or right
excerpt from the point of the side heard last (`switchPlayback`), A chooses left, D right, S about
the same, W skip, Space pauses or plays the side heard last, Z undoes. Each has a button that
does the same and shows its key in a `<kbd>` from the table. Keys are read by
`KeyboardEvent.code`, the physical key, so Shift, Caps Lock and the keyboard layout don't change
them; Cmd, Ctrl and Alt leave a key to the browser, and so does a key pressed while an input
method is composing. A held key acts once. An arrow sets the other side's time at once when its
metadata has loaded, and on `loadedmetadata` otherwise. The listener runs in
the capture phase and takes the key's default, so Space on a focused button or the checkbox, and
an arrow on a focused seek bar, does the page's action. While a text field, textarea, select or
editable content has the focus, every key goes to it. This amends 0032 for this page because the
owner asked for keys here; every other page stays as 0032 has it.

## Alternatives considered

- **Keeping the normalized PCM (a WAV or FLAC) in the cache until it is rated or replaced** —
  rejected: capture would stay at about 150 ms, but every unrated excerpt would keep a lossless
  file of 3–7 MB beside its MP3, and the owner's goal was that unrated audio is MP3 only.
- **Decoding the MP3 for the rated FLAC** — rejected: lossy, so it isn't what was rendered, and
  its hash could not be checked against a render.
- **Rendering again inside a job** — rejected: the runner runs one job at a time, so a rating
  would wait behind a candidates job for minutes. The render runs off the event loop (the
  longest stall measured during a 1.2 s render was 50 ms), and normalize and the checks block it
  for about 150 ms.
- **lame at a fixed path** — rejected: flac is found on PATH (0012), and a fixed path breaks on a
  Mac where Homebrew lives in `/usr/local`.
- **VBR** — rejected: the owner asked for 320; constant bit rate also makes a byte range map
  evenly to a time, which helps Safari seek.
- **A custom seek bar drawn in a `div`** — rejected: a range input works with the keyboard and
  pointer in Safari 17.6 with no code, and `accent-color` (Safari 15.4) styles it.
- **Putting a skipped challenger back at the end** — rejected: repeated skips would never run the
  pool out; a skip is stored as a skip, and random mode can still draw that candidate.
- **Waiting for each rating before the next pair** — rejected: it would add the capture's second
  or two to every choice.
- **Undo restoring the mode too** — rejected in review: the switch would flip under the owner's
  hand; undo is about the rating.
- **Redrawing the pair on a mode switch** — rejected in review: it threw away a pair half heard.

## Consequences

- The first rating of an excerpt takes about as long as rendering it; in champion mode the
  champion is captured once, so each later choice renders one excerpt.
- Old WAV renders are rendered again on the next excerpts job or Render missing excerpts, and
  their files deleted then. WAVs orphaned by migration 0003 are still left as they were.
- A change to the engine or features re-renders cached excerpts as before; rated excerpts are
  captured from what this producer renders, which is what was heard while the producer is the
  same.
- `lame` is a new system tool: `./scripts/setup` fails until it is installed (`brew install lame`).
- A new page in `src/web/` needs the player for any audio, or the titles test fails.

## Amendments

- 2026-11-07: from the step's review, before merge. Failed saves stay listed until Retry and
  block leaving the page; undo takes a rating off the page only after the server removed it; a
  failed pair draw waits for Retry; a mode switch keeps the pair shown and undo keeps the mode;
  plays ignore AbortError; keys are read by `code`; random mode leaves out the session's earlier
  live ratings; a failed capture cleanup no longer hides the capture's error.
- 2026-11-07: from the step's second review, before merge. A pair with a failed save is held
  out of the draw until Retry or Discard, so it can't be rated twice; each failed save has a
  Discard. Undo says it waits for a save still sending; a render fault during a save can't
  leave a save stuck; the mode set during a load is kept.
- 2026-11-07 (4f, [0046](0046-ranking-wildcards-pair-picker.md)): a third order, Best questions,
  asks the pair the taste model is least sure how to order, under the same rules: no pair rated
  on the page or earlier in the session, none held by a failed save. The switch is three radio
  buttons; Best questions is off in a session the taste model hasn't ranked.
- 2026-11-07 (5a, [0050](0050-reference-uploads.md)): `writeMp3` kills lame after 60 s
  (`LAME_TIMEOUT_MS`); a 25 s excerpt takes about 0.18 s and a 5-minute reference region about
  2 s.
- 2026-11-07 (5f, [0055](0055-search-by-ear.md)): a fourth way to use the page,
  `quick-ab.html?id=<session>&ear`, opened by Search by ear on a candidate. It is champion mode
  against a search instead of the pool: the search's best stays, and each challenger is a new
  point the search drew. Each choice is saved by `POST …/ab-ratings` with the same body, so its
  row is a Quick A/B rating like any other, and is then named to the search. Unlike the other
  modes a choice is sent before the next pair shows, since the search draws from it, and Undo is
  off. The order switch is hidden and a Stop the search button ends the run. Keys and the
  player are unchanged.
