# 0019. One JSON config file, every key required

- **Date:** 2026-11-06
- **Status:** accepted; amended by [0041](0041-sidecar-process.md) and
  [0042](0042-clap-embeddings.md) (the sidecar keys), and by [0044](0044-bayesian-bradley-terry.md)
  (the `models` folder), [0024](0024-prompt-parse-repair-generation.md) (the
  `textEmbeddings` folder), [0050](0050-reference-uploads.md) (the `references` and
  `referenceCache` folders) and [0062](0062-track-render-and-export.md) (the `trackRenders` and `exports` folders)

## Context

Phase 2 adds the first settings: where omlx is and which model to ask for, the queue's limits,
where the app keeps its data, where the owner's field recordings are, and the server's address.
The owner's real data lives in `~/.config/ambient-studio/` and
`~/Library/Application Support/Ambient Studio/`, and AGENTS.md forbids tests and agent runs from
touching either. Principle 5 rules out defaults that hide a missing value.

## Decision

`src/config/config.js` is the one module that reads the config file and the environment.
`loadConfig()` reads JSON from `$AMBIENT_STUDIO_CONFIG` when it is set, else
`~/.config/ambient-studio/config.json`, checks it, and returns it; `loadConfig(file)` reads a
given file. `src/config/paths.js` derives the data folders from the root.

**Keys.** Every one is required; a key the module doesn't know is refused too, so a misspelled
key fails instead of being ignored.

| Key | Type |
|---|---|
| `omlx.baseUrl` | an `http://` or `https://` URL |
| `omlx.model` | non-empty string, the model id sent with each request |
| `omlx.apiKey` | non-empty one-line string, the studio's omlx key (the one secret; file mode 600) |
| `queue.requestTimeoutMs`, `queue.firstTokenThresholdMs`, `queue.minGapMs`, `queue.backoffBaseMs`, `queue.maxWaitMs` | whole milliseconds, at least 1 |
| `queue.maxTokens`, `queue.contextBudgetTokens` | whole tokens, at least 1 |
| `queue.minPrefillTokensPerSecond` | whole tokens a second, at least 1: the slowest prefill the first-token threshold and timeout allow for (0022) |
| `queue.sendResponseFormat` | boolean: whether requests carry a JSON-schema `response_format` |
| `sidecar.requestTimeoutMs` | whole milliseconds, at least 1: each sidecar request's limit ([0041](0041-sidecar-process.md)) |
| `sidecar.checkpointCache` | folder path the CLAP checkpoint is fetched into, or `null` until the owner sets one ([0042](0042-clap-embeddings.md)) |
| `dataRoot` | folder path |
| `fieldRecordings` | folder path, or `null` until the owner sets one |
| `server.host` | non-empty string |
| `server.port` | whole number from 1 to 65535 |

A missing key, a wrong type or range, an unknown key, an unreadable file or invalid JSON throws an
`Error` whose message starts with the file's path and names the key by its dotted path
(`queue.minGapMs`). Nothing has a default in code.

**Paths.** A path that is `~` or starts with `~/` has that prefix replaced by `os.homedir()`
(which follows `$HOME`); any other path must be absolute. `~user/` is not expanded and so is
refused as relative, and so is a relative path, since what it is relative to would depend on the
folder the server was started from. Paths are normalized, which drops a trailing slash. The same
rules apply to `$AMBIENT_STUDIO_CONFIG`; set but empty, it throws.

`paths(dataRoot)` returns `database` (`studio.db`), `renderCache` (`renders/`), `ratedAudio`
(`rated_audio/`) and `backups` (`backups/`), each directly under the root. It computes paths and
creates nothing; the store and job runner make their own folders.

**Example file.** `src/config/example.json` is the template the owner copies to
`~/.config/ambient-studio/config.json`. Its `dataRoot` is
`~/Library/Application Support/Ambient Studio/`, `fieldRecordings` is `null`, omlx is
`http://127.0.0.1:8000` with a placeholder model id the owner replaces, and the server listens on
`0.0.0.0:4180` so mbp2015 and mbp2026 reach it over the LAN. Its queue numbers are set and
justified in [0022](0022-omlx-queue.md).
`sendResponseFormat` is `false` until the evaluation run (2l) shows whether omlx accepts it.

**Test guard.** While Vitest runs, `loadConfig` refuses a config file, `dataRoot` or
`fieldRecordings` that is one of the owner's two folders or inside one, and checks the config
file's path before reading it. "Vitest runs" means `process.env.VITEST === "true"`: Vitest sets
it in its main process before starting workers, so every worker and any child process a test
spawns inherits it. The folders are checked under both `os.homedir()` and
`os.userInfo().homedir`, the account's home from the user database, so a test that points
`$HOME` at a temp folder can't slip past, and compared without case, because macOS volumes are
case-insensitive by default.
`test/support/temp-root.js` makes a temp folder with a config in it whose `dataRoot` is that
folder, built from `example.json` with an optional edit, so every test that needs a config
starts there.

**Environment rule.** Nothing in `src/` outside `src/config/` reads `process.env`, by
`process.env`, `process["env"]` or `import { env } from "node:process"`. `scripts/arch.js`
enforces it, and `scripts/arch-test` plants each form in the server tier. The rule covers `src/`
only: `scripts/` and `test/` are tools, and a test stubs variables with `vi.stubEnv`.

## Alternatives considered

- **Defaults in code with the file overriding them** — rejected by principle 5: a missing key would
  run on a value nobody chose, and the queue's numbers protect a live site.
- **Environment variables for each setting** — rejected: the owner keeps one file to edit, and
  the queue alone has nine numbers.
- **Ignoring unknown keys** — rejected: a typo of a required key is caught as missing, but a stale
  key left after a rename would sit in the file looking as if it did something.
- **Detecting tests by `NODE_ENV === "test"`** — rejected: Vitest sets it only when it is unset,
  and other tools set it too. `VITEST` is set by Vitest alone.
- **Expanding `~` with the account's home only** — rejected: following `$HOME` matches what a
  shell does with the same path and lets a test point `~` at a temp folder.
- **Guarding every run, not only tests** — rejected: the server has to read the owner's folders
  when the owner runs it. An agent's manual run is kept out by pointing `$AMBIENT_STUDIO_CONFIG`
  at a config made the way `temp-root.js` makes one.

## Consequences

- A new setting is a new key in the schema in `config.js`, in `example.json` and in this table,
  in the same commit; the owner's file then fails to load until they add it, which is the point.
- Code that needs a setting takes the loaded `Config`, or a part of it, as an argument; it never
  reads the environment or the file itself.
- The guard checks paths as written, not where symlinks lead.
- The README tells the owner to copy `example.json`.

## Amendments

- 2026-11-06: the example's queue numbers, placeholders until now, are set by 0022 (step 2d).
- 2026-11-06: added `queue.minPrefillTokensPerSecond` (step 2d), so the first-token threshold
  and the timeout grow with the prompt's length instead of calling a long prompt busy (0022).
- 2026-11-06: added `omlx.apiKey`, a non-empty one-line string: the studio's own omlx key,
  revocable apart from the live site's. It is the app's one secret and lives only in the owner's
  config file, never in the repo. `loadConfig` refuses a file that group or others can read
  (mode & 0o077), naming it and saying to run `chmod 600`. No config error quotes the key's value
  or the file's text, so an unparseable file reports only that it isn't valid JSON. The example
  holds a placeholder, and `temp-root.js` writes a dummy key at mode 600.
- 2026-11-06: added `queue.thinking`, a boolean: whether each request asks the model's chat
  template to think first, sent as `chat_template_kwargs.enable_thinking`. The example sets it
  `true`, which keeps what requests did before ([0031](0031-fewer-waits-after-first-evaluation.md)).
- 2026-11-07: added `sidecar.requestTimeoutMs`, each sidecar request's limit from writing it
  to its answer. The example sets 120 000 ms ([0041](0041-sidecar-process.md)).
- 2026-11-07: added `sidecar.checkpointCache`, the folder the CLAP checkpoint is fetched into,
  or `null`, which turns embedding off. The example sets `null`; a test that sets it uses a
  folder in its temp root, and the owner-folder guard applies to it like any folder key
  ([0042](0042-clap-embeddings.md)).
- 2026-11-07: from step 4d ([0044](0044-bayesian-bradley-terry.md)). `paths(dataRoot)` adds
  `models` (`models/`), where each preference model is a file named by its model key.
- 2026-11-07: from step 4h ([0024](0024-prompt-parse-repair-generation.md)). `paths(dataRoot)`
  adds `textEmbeddings` (`text-embeddings/`), derived, where each vibe brief's CLAP embedding is
  a file named by the SHA-256 of its producer and text.
- 2026-11-07: from step 5a ([0050](0050-reference-uploads.md)). `paths(dataRoot)` adds
  `references` (`references/`), the owner's uploaded recordings, irreplaceable and backed up,
  each named by its SHA-256; and `referenceCache` (`reference-cache/`), derived: peak strips,
  playback MP3s of spans, and uploads still being checked.
- 2026-11-07: from step 6c ([0062](0062-track-render-and-export.md)). `paths(dataRoot)` adds `trackRenders`
  (`track-renders/`), derived: each track's newest render and its seam previews, and a render's
  temp files while it runs; and `exports` (`exports/`), a folder per export the owner starts.
  Neither is backed up: an export renders again from its manifest.
