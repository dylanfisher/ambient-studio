# 0025. A node:http server with a route table, static tiers and ranged WAVs

- **Date:** 2026-11-06
- **Status:** accepted; amended by [0048](0048-quick-ab-player-mp3.md) (audio is MP3) and
  [0050](0050-reference-uploads.md) (the upload body, and `sendMp3`) and
  [0055](0055-search-by-ear.md) (a same-origin beacon may stop a search by ear)

## Context

Phase 2's studio runs on mbp2021 and is used from Safari 17.6 on mbp2015 and from a browser on
mbp2026, over the LAN by IP (spec, "Machines"). The UI is plain HTML and ES modules with no build
step, and its modules import the engine and domain tiers by relative path (map.md). Candidates
are heard as server-rendered WAVs, and Safari's `<audio>` asks for byte ranges and won't seek
without them. Steps 2h, 2i and 2j add jobs, routes and pages on top of this one. 0001 chose
`node:http` and no framework.

## Decision

**Server.** `src/server/main.js` is `./scripts/dev`'s entry. `startServer(config, {routes,
log})` creates the data root, opens the store, listens on `server.host` and `server.port` and
returns `{origin, store, stop}`. Run as a program it takes no arguments, prints the URL by each
LAN IPv4 address when bound to `0.0.0.0`, and stops on SIGINT and SIGTERM. `stop()` closes every
connection, idle keep-alive ones included, waits for the requests in flight to settle and the
server to close, then closes the store, so the process exits with no open handles.

**Route table.** `src/server/routes.js` holds `ROUTES`, a list of `{method, path, handle}`; each
later step adds its entries there. A path is literal segments and `:name` segments; the first
route whose path and method match wins, so a literal path goes before a `:name` one. A GET route
answers HEAD too. A path that matches with another method is a 405 with `Allow`. A handler gets
`{request, response, params, query, body, app}`, where `app` is `{config, paths, store, log}`
and a step adding a long-lived part (2h's job runner) adds it to `App` and `startServer`. A
handler returns a value, sent as a 200 JSON body, or `undefined` once it has sent its own
response; returning `undefined` with nothing sent is a 500. JSON API routes go under `/api/`.

**Requests.** The path is read raw, not through a URL parser, which would turn `/%2e%2e/x` into
`/x`. Each segment is percent-decoded, and a path with an empty, `.` or `..` segment, a bad
escape, or a segment that decodes to `/`, `\` or NUL is a 404 before any route or file is
looked at. `body()` reads at most 1 MiB (`MAX_BODY_BYTES`): a larger `Content-Length`, or a
chunked body that passes it, is a 413. The rest of the body is read and dropped and the
connection kept: closing it on a client still sending resets the connection, and the client
loses the 413 (29 of 600 oversize requests did on mbp2021; none do now). Node's
`requestTimeout` bounds how long a client can keep sending. A body not labeled
`application/json` is a 415, and one that doesn't parse is a 400 whose message gives the parse
error.

**Errors.** Every error the dispatcher sends is a JSON body `{error: message}`.
`HttpError(status, message)` is a 4xx with its message and is not logged. Anything else is a 500
whose body is only `"internal error"`, because a message can hold a server path; its stack goes
to `log` with the method and path. A failure after the headers went out destroys the connection.

**Static files.** After the routes, GET and HEAD serve `src/web/` at `/` (`/` is
`index.html`), `src/engine/` at `/engine/` and `src/domain/` at `/domain/`, so a web module's
`../engine/x.js` resolves to a served file. Only listed extensions are served: `.js` and `.json`
from every folder, plus `.html`, `.css` and `.svg` from `src/web/`. `.js` is
`text/javascript; charset=utf-8`, since Safari refuses a module served as anything else. A
directory is a 404, never a listing. A file's real path, symlinks followed, must be inside its
folder. A name that is too long, a symlink loop, an unreadable file, a NUL in the name, or a
file removed between the check and the read is a 404, not a 500 (`file-inside.js`). Responses
carry `nosniff` and `Cache-Control: no-cache`, so a reload while
`./scripts/dev` restarts picks up edits.

**Audio.** `GET /audio/:renderId` serves the renders row with that id. The id must be a decimal
integer without a leading zero. The row's `file` is joined to the render-cache folder and its
real path must be inside that folder and be a regular file: a `..`, an absolute path or a
symlink that leads out is a 404, and so is a missing row or file. Responses are `audio/wav` with
`Accept-Ranges: bytes`. Ranges follow RFC 9110 §14:

| Range | Answer for a file of N bytes |
|---|---|
| none, another unit, unparseable, `a-b` with b < a | 200, the whole file |
| `bytes=a-b` | 206, `a` to `min(b, N−1)` |
| `bytes=a-` | 206, `a` to the end |
| `bytes=-n` | 206, the last `min(n, N)` bytes |
| `a` ≥ N, or `-0` | 416 with `Content-Range: bytes */N` |
| several ranges | 200, the whole file |
| any, with `If-Range` | 200, the whole file |

A listener that drops the stream (a seek, or enough buffered), or is gone before it starts, is
not logged.

**Binding and no auth.** The example config binds `0.0.0.0:4180`, every interface, because the
owner listens from two other machines on the home LAN. There is no login: the app holds no
secrets (AGENTS.md), and anyone who can reach the port is on the owner's network.
The studio server itself still has no auth; the one secret, the omlx key (0019), is outbound
only and is never served or logged.

**Cross-site requests and DNS rebinding.** No login means the browser itself is the risk: a page
on another site, open in the owner's browser, can send requests to the studio's LAN address.
Two rules close that:

- **JSON-only bodies.** A body not labeled `application/json` is a 415. A cross-origin
  `application/json` request needs a CORS preflight, and the server sends no CORS headers, so
  the browser never sends the request a page on another site asks for. A form post or a
  `text/plain` fetch, which skip the preflight, are refused.
- **A Host allowlist.** A rebinding page points its own DNS name at this machine, so its requests
  are same-origin and skip CORS, but they carry its name as `Host`. Before any route or file,
  every request's `Host` must name this machine: `localhost`, `127.0.0.1`, `[::1]`, its host
  name with or without `.local`, or an address of one of its interfaces right now, read from
  `os.networkInterfaces()` per request because the LAN address can change. Any port is allowed.
  Anything else, a missing `Host` included, is a **421 Misdirected Request**: the RFC 9110 status
  for a request this server isn't configured to answer for that host, which a 403 would misstate
  as a permission problem. Opening the studio by its LAN IP, from mbp2015 or mbp2026, sends that
  IP as `Host` and is answered.

So no route may accept a body in another content type, and no route may send CORS headers;
either one reopens the hole. A name the owner adds (a DNS alias for the studio) has to be added
to `allowed-host.js` first.

## Alternatives considered

- **A framework (Express, Fastify)** — rejected: a new dependency (AGENTS.md 7) for a table of a
  dozen routes, and 0001 chose `node:http`.
- **One route file per area, registered by each module** — rejected for now: one array in
  `routes.js` is the whole table in one place; split it when it is long enough to need it.
- **Normalizing the path with `new URL()`** — rejected: it resolves `%2e%2e` to `..` and drops
  it, so a traversal attempt would serve another file instead of being refused.
- **multipart/byteranges for several ranges** — rejected: RFC 9110 lets a server answer with the
  whole file, `<audio>` asks for one range at a time, and a multipart body is a second code path
  with no caller.
- **ETag and Last-Modified with If-Range** — rejected: rows are keyed by an id SQLite can reuse
  after a render is replaced, so a validator would have to hash or stat the file; without one,
  If-Range gets the whole file as the RFC requires.
- **A 403 for a foreign Host** — rejected: 421 says the server doesn't answer for that name,
  which is the actual reason; 403 reads as "you may not".
- **The Host allowlist from config** — rejected: the LAN address is assigned by the router and
  changes, and a config key for it would go stale; the interfaces are the current truth.
- **Binding 127.0.0.1 behind a proxy, or a shared token** — rejected: the spec has the owner on
  other machines, and a token protects nothing when the app has no secrets.
- **Streaming static files** — rejected: the served modules are a few kB each; read and send
  keeps one code path with an exact `Content-Length`.

## Consequences

- A route, job or page in a later step is an entry in `ROUTES`, a field on `App`, or a file in
  `src/web/`; none touches `main.js` beyond `startServer`.
- `test/support/http-client.js` starts the real server on an ephemeral port of 127.0.0.1 in a
  temp root and sends paths as written, so tests cover traversal the way a raw client sends it.
- Anyone on the LAN can use the studio, including starting generation, which queues requests to
  omlx. If the studio is ever reachable from outside the home network, it needs auth first.
- A render-cache file is served only through its row; a WAV with no row can't be fetched.

## Amendments

- 2026-11-07: from step 4i ([0048](0048-quick-ab-player-mp3.md)). `/audio/:renderId` serves
  render-cache MP3s as `audio/mpeg`, with the same byte ranges; a row whose file is not an MP3
  is a 404 saying to render the excerpt again.
- 2026-11-07: from step 5a ([0050](0050-reference-uploads.md)). `POST /api/references` is
  the one route whose body isn't JSON: `application/octet-stream` up to 1 GiB, streamed to a
  file, with the file's name in an `X-File-Name` header. Neither is a type or header a
  cross-site page can send without a CORS preflight, which the server still never answers, so
  the JSON-only rule above now reads "no route may accept a body a cross-site page can send
  without a preflight". The byte-range code moved into `sendMp3` (`send-mp3.js`), which the
  audio route and the reference audio route both call; `wrongType` is the one content-type
  check.
- 2026-11-07 (5f, [0055](0055-search-by-ear.md)): one route takes a body that isn't JSON:
  `POST /api/sessions/:id/ear-search/stop` takes the Quick A/B page's closing beacon, a
  `text/plain` string, only with an `Origin` naming the server's own host, since a page on
  another site can send a text body without a preflight; any other text body is a 403.
