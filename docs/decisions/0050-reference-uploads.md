# 0050. Reference uploads: formats, files, regions, and ffmpeg decoding

- **Date:** 2026-11-07
- **Status:** accepted; provisional: owner to confirm. Amends
  [0019](0019-config-file-and-paths.md) (two data folders),
  [0021](0021-store-tables-and-append-only.md) (two tables, the backup's new folder) and
  [0025](0025-http-server-and-audio.md) (one body that isn't JSON)

## Context

Phase 5 lets the owner aim generation and search at parts of a reference recording (plan, phase
5, settled 2026-11-07): upload a file, mark regions, and let later steps measure each region
(5b), describe it in the prompt (5c) and steer toward its embedding (5g). The owner settled
that uploaded audio never plays in a render, that uploads and regions are irreplaceable, and
that a brief's attached regions live in a table 5c adds. Field recordings are decoded by
node-web-audio-api's `decodeAudioData`, measured on WAV, FLAC and AIFF only (0029); references
also arrive as MP3, AAC, ALAC, Vorbis and Opus. ffmpeg 9.0.2 and lame are installed. Every body
the server reads is JSON up to 1 MiB (0025), and the pages work in Safari 17.6.

## Decision

**Formats and limits.** An upload is kept when ffprobe reads it as one of: WAV or AIFF (any PCM
codec), FLAC, MP3, AAC or ALAC in M4A, Ogg Vorbis, or Opus; it is 10 s to 60 min long
(`REFERENCE_SECONDS`); it has exactly one audio stream (cover art is a video stream and doesn't
count) of 1 or 2 channels; and ffmpeg decodes it to the end. The body is at most 1 GiB
(`MAX_UPLOAD_BYTES`). `ACCEPTED_FORMATS` (`src/server/reference-formats.js`) is the one table:
each format's demuxer, codecs, extension and label.

**The route.** `POST /api/references` takes the file's bytes as an `application/octet-stream`
body, its name percent-encoded in `X-File-Name` (`src/domain/reference-upload.js`, read by the
page and the server). `receiveUpload` streams the body to `reference-cache/upload-<uuid>`,
hashing it on the way. In order:

| Check | Answer |
|---|---|
| no name, a bad escape, over 200 characters, or a control character | 400, the body read and dropped |
| another content type | 415 |
| declared or sent over 1 GiB | 413, the rest read and dropped so the client sees it |
| empty | 400 |
| a live row has these bytes | 200 `{reference, added: false}`, nothing probed |
| ffprobe refuses it, or the length, channels or streams are out | 400 naming the reason |
| ffmpeg can't decode it to the end (measuring the peaks) | 400; ffmpeg's message, which names a server path, goes to the log |
| otherwise | moved to `references/<sha256><extension>`, a row added, 200 `{reference, added: true}` |

The temp file is removed in every case. The name is stored as text only; the kept file is named
by its hash and the extension of the format ffprobe found.

**Security.** No text the owner sends reaches a path or a CLI argument: the paths given to
ffmpeg and ffprobe are made by the server from a hash and a fixed extension, and the bounds of
a region are numbers checked before they are formatted. The CLIs run through `execFile` or
`spawn` with an argument array, never a shell. Both take `-protocol_whitelist file` and
`-format_whitelist` with the accepted demuxers only (`READ_OPTIONS`), so a file that is really
an HLS playlist or a concat list can't make ffmpeg open other files or URLs. Every call has a
timeout (`FFMPEG_TIMEOUT_MS`): 30 s for a probe, 60 s for a region's decode, 300 s for the peak
strip's decode of up to an hour; lame has 60 s (`LAME_TIMEOUT_MS`), where a 5-minute region
takes about 2 s. `application/octet-stream` and the custom header each
make a cross-site `fetch` need a CORS preflight, which the server never answers, so 0025's
cross-site argument still holds; the Host allowlist applies as before.

**Location and naming.** `paths(dataRoot)` adds `references` (`references/`, irreplaceable,
backed up) and `referenceCache` (`reference-cache/`, derived: peaks, playback MP3s, and uploads
being checked). The same bytes twice give one file and one row. Removing a file marks its row
and leaves its bytes; uploading the same bytes again adds a new row naming the same file.

**Tables** (`0008-references.sql`), both irreplaceable:

- `reference_files`: `sha256`, `fileName` (the owner's), `format` (an `ACCEPTED_FORMATS` key),
  `file` (relative to `references/`), `durationSeconds`, `channels` (1 or 2), `sampleRate` (the
  file's own), `sizeBytes`. A partial unique index keeps one live row per `sha256`.
- `reference_regions`: `referenceFileId`, `startSeconds`, `endSeconds` (after the start),
  `label`, `note` ("" for none), `replacesId`.

A region's bounds never change. Changing one marks it `replaced` and adds a row naming it in
`replacesId`; removing one marks it `removed`. Removing a file marks its live regions
`file removed` in the same transaction, so a later step never reads a region of a removed
file. `reference-store.js` holds the functions.

**Regions.** 1 s to 5 min (`REGION_SECONDS`, `src/domain/reference-region.js`), inside the
file's probed length, stored to the millisecond (`regionSeconds`, beside `regionProblem`). The
page rounds the same way before it sends a region or asks for a span's audio, whose query
takes at most three decimals, so a stored region always plays. `regionProblem` is the one check: the route runs it, and the page runs it
before sending. The longest region bounds one decode's memory: 5 min of 48 kHz stereo floats is
115 MB, and its 24-bit PCM for lame 86 MB more. Labels take up to 200 characters, notes 2 000
(`MAX_CHARS`). Routes: `POST /api/references/:id/regions`, `POST
/api/reference-regions/:id/replace` and `…/remove`, `POST /api/references/:id/remove`, and
`GET /api/references` and `GET /api/references/:id` (a removed file is a 404).

**ffmpeg is the one decoder of references.** `decodeWithFfmpeg(path, start, end)` runs
`ffmpeg -i <path> -ss <start> -t <length> -f f32le -ac 2 -ar 48000 -`. `-ss` after `-i`
decodes from the start and drops what comes before: slower than an input seek, but exact to the
frame. Measured on 12 s fixtures of all eight formats at 44.1 kHz, a 3.25 s region gave
156 000 frames in each; with `-ss` before `-i` the AAC fixture gave 352 frames fewer, and MP3
and Vorbis other samples, so the slower seek stays. A mono file plays in both channels, as
0029's voice does.

A region always holds `round((end − start) × 48000)` frames. ffprobe's length for MP3, AAC and
Opus is an estimate (an Opus fixture probed 6.5 ms longer than it decodes, its pre-skip), so a
region ending at the probed end can come up short. A shortfall of at most `END_SLACK_SECONDS`
(0.1 s) is padded with silence; more, or more frames than named, throws with both counts.
ffmpeg stops short only at the file's real end, so a region well inside the file never pads. 0029's `decodeRecording` stays for the recordings folder.

**Peaks.** `measurePeaks` streams a decode at 8 kHz stereo and keeps the loudest sample in
each of 1 000 equal slices (`PEAK_COUNT`), so an hour's file never sits in memory. They are
kept as `reference-cache/<sha256>-peaks.json` at upload, and `GET /api/references/:id/peaks`
measures them again when the file is missing or holds another count.

**Playback.** `GET /api/references/:id/audio?start=&end=` answers the MP3 of a span: the
bounds rounded to the millisecond, decoded by `decodeWithFfmpeg`, encoded by 4i's `writeMp3`
at 320 kbps (0048), and kept as `reference-cache/<sha256>-<start ms>-<end ms>.mp3`. It is sent
by `sendMp3`, moved out of the audio route with the same byte ranges, which Safari needs to
seek. Requests for one span while its MP3 is being made share one decode. The audio is the
decode as it is, not normalized: it is what 5b measures before it
normalizes.

**The page** (`references.html`, in every page's nav, so on the dashboard and each brief). An
upload field; the list of recordings, oldest first; and an open recording (`?id=`) with:

- a peak strip on a canvas, scaled to the file's loudest slice, with saved regions shaded
  lightly and the span in the form darker;
- start and end fields that take `75.5` or `1:15.5`; dragging across the strip fills them, as a
  shortcut, and the fields stay the way to set a region (`region-form.js`, no DOM);
- one excerpt player (0048) that plays the times in the form or a saved region;
- a label and a note, and a list of regions with Play, Change and Remove.

A load the audio element refuses is asked again with `fetch`, so the status line shows the
server's reason.

**Non-goal.** Uploaded audio never plays in a render, track or export. The recording voice
(0029) plays only the configured recordings folder, and nothing copies an upload there. Stems
from a reference, matching its melody or harmony, and sending its audio to omlx are out too.

**Checked** in headless Chromium against a server in a temp root, with a 40 s MP3 fixture:
the upload opened the recording, the strip drew, a drag filled `0:10.02` and `0:20.04`, Play
these times played 10.02 s, a save without a label said what was missing, save, change and
remove each updated the list, and a span past the end said why. Safari 17.6 is the owner's
check: canvas 2D, pointer events with `setPointerCapture`, `touch-action` and a `File` as a
`fetch` body all predate it.

## Alternatives considered

- **`multipart/form-data`** — rejected: a form post skips the CORS preflight, which reopens
  0025's cross-site hole, and parsing multipart is a second code path for one file.
- **`decodeAudioData` for references** — rejected: measured on three formats only (0029), and
  it decodes a whole file into memory at once.
- **Trusting the extension of the owner's file name** — rejected: it is text the owner sent, so
  it would reach a path; the extension comes from what ffprobe found.
- **`-ss` before `-i`** — rejected: measured, the AAC fixture came back 352 frames short and
  MP3 and Vorbis gave other samples than a full decode.
- **Returning fewer frames at the file's end** — rejected: 5b cuts a region into windows by
  frame count, and a region that holds what its bounds name keeps that arithmetic in one place.
- **Keeping one row per upload, duplicates included** — rejected: the plan asks for one row
  for the same bytes, and two rows would make 5b analyse the same file twice.
- **A region MP3 named by region id** — rejected: the page plays unsaved times too, so the cache
  is keyed by the span, which also serves every region with the same bounds.
- **Deleting a removed file's bytes** — rejected: uploads are irreplaceable.

## Consequences

- 5b decodes regions with `decodeWithFfmpeg` and adds its analysis rows keyed by region; 5c's
  attachment table names live regions, and an attached region the owner changes is a new row.
- A new irreplaceable table needs a row in `fillStore`, which now uploads and marks one.
- The reference cache grows with every span played and nothing evicts it yet; it is derived and
  can be deleted whole.
- A 1 GiB upload over Wi-Fi needs to finish inside Node's default 300 s `requestTimeout`:
  about 27 Mbit/s. A slower link fails the upload; raising the timeout would need a record.

## Amendments

- 2026-11-07: from the step's review, before merge. Bounds are stored and sent to the
  millisecond; a region ending at a lossy file's probed end is padded by up to 0.1 s of
  silence; every ffmpeg, ffprobe and lame call has a timeout; ffmpeg and ffprobe read local
  files only; requests for one span share one decode; cache eviction waits.
