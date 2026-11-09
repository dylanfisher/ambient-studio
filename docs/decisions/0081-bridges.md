# 0081. A bridge is a development written between two sections, held to both ends, and two halves across a change of key

- **Date:** 2026-11-09
- **Status:** accepted; provisional: owner to confirm the 120 s default and its bounds, the 16 s
  weaves, the two halves and their 8 s crossfade, the voices counted as having no pitch, where
  the bridge's words go, and the key B. Amends [0079](0079-develop-a-section.md) (a development
  may be a bridge, marked in its row; the develop prompt and check gain a bridge's parts; the
  develop route refuses while a bridge is written) and [0080](0080-weave-transitions.md) (a
  bridge's joins are weaves of a stated length, checked to hold before the bridge is stored);
  amended by [0082](0082-develop-the-whole-track.md) (a bridge's state at its cap keeps every
  value the check compares and may pass the cap for them; a skipped bridge names its join; the
  bridge route refuses while every section is developed; the worst prompt is 4,077 tokens)

## Context

Step TD.5, acceptance 5 of phase TD: "A passage written for a join starts in the outgoing
section's end state and ends in the incoming one's start state, so both its joins morph or weave
instead of falling back to a crossfade; it can carry a change of key or tuning that a morph
can't." The owner asked that parts of a track "meld together seamlessly in unique ways in the
track builder, not just crossfade", and that "develop in track mode is where you can put
together sketches and describe how you want them to develop in the track."

What the engine allows: a genome has one `tuning`, one `scale`, one `key`, one `pulse` and one
`bpm` (`genome-schema.js`), read when a voice is built, so **a single genome can't change key**.
A morph or a weave falls back to a crossfade when the two sides differ in any of these (0064).
It also splits a voice whose type, choices, flags, recording or fixed numbers differ, and falls
back past `MAX_VOICES`, `MAX_POINTS` or a renamed id over 16 characters. TD.3's develop operator
writes one genome of a section's length from its sketch, read from the neighbors' states where
they meet it (0079); a genome lasts at least 60 s.

## Decision

**The action.** Bridge (B) on the chosen section's transition, with a seconds field beside it.
The route `POST /api/tracks/:trackId/bridge {revisionId, transition, seconds}` checks the saved
version and lays out the bridge with `bridgePlan`, then runs a `bridge-join` job
(`JOB_KIND.bridge`), refused while a develop or another bridge job is unfinished, since each is
placed by windows the other may change. The develop route refuses the same way.

**Its length** (`BRIDGE_SECONDS`): the owner's, 120 s by default, from 60 s (a genome's least,
`DEVELOP_LEAST`'s) to `MAX_DURATION`, 900 s. A bridge of two halves (below) needs 120 s. The
plan refuses a bridge that would make the track longer than `MAX_TRACK_SECONDS`.

**Its sketch.** Every development names a sketch. A bridge of one part names the outgoing
section's sketch, written from it, at its seed. Its `offset` is where the outgoing section ends
on that sketch, or the sketch's last stretch of the bridge's length when it ends there, so Play
the plain sketch continues the outgoing sketch. The second of two halves names the incoming
sketch, at the stretch of its length leading into where the incoming section starts.

**Its words.** The bridge is written from the transition's text, which the development row
keeps as its `text`. Placed, each part's section text is those words, and the new weaves have
none.

**The joins.** `bridgedArrangement` puts the parts between the two sections, each playing its
development from 0, and replaces the transition with a weave on each side
(`BRIDGE_JOIN_SECONDS`, 16 s: twice `MORPH_LEAST`, so 12 s of movement before the 4 s handover)
with `MORPH_CURVE`. A weave is at most half the shorter section, so beside a section under 32 s
it is half the section, and a section under 16 s can't take one: the plan refuses.

**The end rules** (`checkBridge` in `check-bridge.js`, run by `checkDevelopment` with the lint
when the ask holds `ends`), each a finding with a JSON path the repair quotes (0024):

- `bridgeStart`: every voice sounding where the outgoing section ends (`meetingState`'s
  `sounds` on the section's fitted genome) is held with the same id, type and every setting
  `fixedParams` names, starts at 0 and lasts at least the weave; no other voice sounds at 0; the
  join globals (`JOIN_GLOBALS`: tuning, scale, key, pulse, bpm) are the section's.
- `bridgeEnd`: every voice sounding where the incoming section starts is held the same way, up
  to the bridge's end and from at least the weave before it; no other voice sounds at the end.
  A voice both ends name with different settings is held at the start and left to split at the
  end, as a weave does, since one voice holds one set.
- The fixed globals (width, reverb decay, delay time, loudness, ceiling) both sections share are
  the bridge's too; when they differ, one join hands them over as every morph does.
- `bridgeJoin`: once every other rule holds, both weaves are built with `morphGenome` exactly as
  the track will play them, and one that would fall back is a finding quoting its reason
  (`$`). So a stored bridge's joins hold, tested with `sectionMorph` on both sides.

**No tolerance.** Fixed numbers and choices compare exactly, because the morph's matcher compares
them with `===` and any tolerance would pass a bridge whose voice then splits. Levels and every
value that may be a trajectory aren't held to the ends: a weave moves every shared value across
its seconds, so a gap there is a move, not a fallback. The prompt writes every value the check
compares exactly (each voice's settings that can't move, and the shared fixed globals) with
every digit it has, as `exactText`, the digits `show()` quotes in a repair, so a model that copies
the prompt passes the first time, tested with 4.567 and 2.345. Levels and moving values are
written at three significant digits, as the readings write them (0078), since nothing compares
them.

**Across a key.** When the two sections differ in a join global, the bridge is two halves, each
its own development and request: the first in the outgoing section's globals, the second in the
incoming one's, with an 8 s crossfade between them (`BRIDGE_MIDDLE_SECONDS`, a new transition's
default). The second request reads the first's answer. When tuning, scale or key differ, only
voices that read none of them (`KEYLESS`: noise, recording, cymbal) may sound over the
crossfade's span of each half (`bridgeMiddle`), and the second half starts holding exactly the
voices the first ends with (`bridgeStart`), so what plays across the crossfade is the same voices
with the same settings. Any other voice type, a new one included, counts as carrying pitch. The
first half's prompt asks it to keep one voice with no pitch to its end, but the check doesn't
require one: with none, the halves cross in silence, which a brief that bans noise and has no
recording or cymbal leaves as the only way, and the prompt says so. When
only pulse or bpm differ, no voice reads them, so any voice may cross. Each half's outer join is
checked to hold as above; the middle is a crossfade, which never falls back.

**The prompt.** `buildDevelopPrompt` with `bridge`: the section's place as a bridge or a half,
the owner's words for the join, the sketch, its readings, the two states it starts and ends in
under their headings, the rules its ends are checked by, and the ask. The states are
`meetingState` with `fixed`, adding each sounding voice's settings that can't move and aren't
their defaults, at every digit, capped at `BRIDGE_STATE_TOKENS`, 270 each. At its largest (TD.3's worst parts,
the second half with every join global differing, five shared globals, both states at their caps
from `worstGenome`, `field-recording.json` as the sketch) it is 4,071 tokens of 4,096 with the
lineage's reading left out, tested.

**Storage.** `0015-development-bridge.sql` adds `bridge` (0 or 1, default 0) to `developments`,
so every stored row reads as no bridge, tested over 0014's shape; a new row always gives it. A
section is a bridge when its development is one: the arrangement's shape doesn't change. The
block's name ends "bridge", and the panel says "It plays bridge N", with its words. A bridge is a
development, so it never becomes a sketch. Play the plain sketch on a bridge plays its sketch
from its `offset`; Develop on it develops it as a section, without the end rules.

**The job.** Every part is written before any is stored, in one transaction, so a cancel or a
failure (one still invalid after its repair) stores no development; the requests are logged as
generations, as every operator's are. It returns the development ids and the plan; the page
places them by `bridgeSwap`: `steerSwap`'s rules for the outgoing section, and both neighbors must
still play the same windows of the same genomes (sketch, offset, seconds and `developmentId`),
since the ends were checked against them, and the track with the bridge in must still fit
`MAX_TRACK_SECONDS`. Otherwise the swap is skipped saying why, and the bridge stays stored among
the track's developments, which TD.6 lists. Saved as "Bridge between sections N and M".

## Alternatives considered

- **One genome carrying the key change** — impossible: a genome has one key, and the weave out of
  it would fall back.
- **Letting a morph or weave run across a key when no pitched voice sounds** — rejected: it
  changes what stored arrangements render (one that crossfades today would weave), and the
  incoming voices would play in the outgoing key during the move.
- **One request writing both halves** — rejected: twice the answer for one repair round, and
  the second half couldn't be checked against the first until both parse.
- **A bridge marked on the section** (`bridge: true` beside `developmentId`) — rejected: a
  migration over every stored revision and every section literal, for a fact the development
  already holds; going back to the plain sketch would also have to clear it.
- **A tolerance on levels or moving values** — rejected: the weave moves them; checking them
  would cost repairs and buy nothing the join needs.
- **A shorter default (60 s)** — rejected: it can't hold two halves, and a 60 s bridge moves for
  only 28 s between its two 16 s weaves.
- **Common tones instead of voices with no pitch** — rejected for now: whether a pitched voice
  plays a common tone depends on its events, which the check can't read without rendering.

## Consequences

- Measured by test: `test/domain/check-bridge.test.js` (each rule and its path, the clash, a join
  that would fall back, both joins weaving once placed, the two halves and their middle);
  `test/domain/develop-prompt.test.js` (the bridge's parts, the budget); through the routes,
  `test/server/bridge-section.test.js` (acceptance 5 with a repair quoting a `bridgeEnd` finding,
  both joins `sectionMorph` ok, a bridge between two keys, a cancel storing nothing, the refusals);
  `test/server/development-store.test.js` (the migration).
- A bridge of two halves crossfades in its middle by design. When the brief bans every voice with
  no pitch and the sketches have no recording, the halves can only cross on silence.
- TD.6's whole-track development doesn't write bridges; a bridge between two developed sections
  reads their developments' states.
