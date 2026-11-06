# 0001. Plain JS on Node with built-ins, a Python sidecar for ML

- **Date:** 2026-11-05
- **Status:** accepted

## Context

Ambient Studio runs on one machine (mbp2021) and is used over the LAN from older browsers,
including Safari on macOS 12 (mbp2015). The engine is one Web Audio module that has to render
offline in Node and preview live in a browser from the same file. The ML parts (CLAP, preference
models, optimizers, mlx-lm) only have mature libraries in Python. The owner's house style lives in
`~/projects/app-conventions`. It is written for Swift apps, so only its language-neutral decisions
apply.

## Decision

- **JavaScript (ESM) on Node 26.12.1**, typed with JSDoc and checked by `tsc` in strict mode. The
  browser and Node run exactly the files in the repo: no bundler, no build step, no type stripping.
- **pnpm** for packages; **`node:sqlite`** in WAL mode and **`node:http`**, so the server's
  runtime dependencies start with only `node-web-audio-api`.
- **Vitest** for JS tests, for its `--changed` and output; **Biome** to format and lint.
- **A uv-managed Python 3.12 sidecar** in `sidecar/`, with ruff, strict pyright and pytest. It is
  a separate process the server calls; nothing imports it.
- **Tiers** `engine → domain → server | web`, plus `config`, enforced by `scripts/arch` with no
  dependency. Browser tiers import only relative paths.
- **Single-source checks:** jscpd plus a repeated-literal scan (`scripts/dupes`), and knip for
  unused exports.

Ported from app-conventions (`guide/`): settings in `~/.config/<app>/config.json` read by one
module, app data under Application Support rooted in one paths value, SQLite in WAL mode, as few
dependencies as possible, 100-column lines, one gate that runs every step, a `commit-msg` hook,
Conventional Commits, an orchestrated plan in `docs/plan.md`, review scaled to the change, and
agents never pushing. Decided fresh: everything language-specific above, and the data rule in
AGENTS.md, which keeps ratings and other irreplaceable rows rather than rebuilding them (the
persistence guide's own stated exception).

## Alternatives considered

- **TypeScript with a build** — rejected because the engine must load unchanged in the browser,
  and a build step for the UI is what the spec asks to avoid.
- **TypeScript on the server only, run through Node's type stripping** — rejected because it
  splits the code into two styles, and `engine.js` must stay JS anyway.
- **better-sqlite3** — rejected because it is a native addon to rebuild on every Node upgrade, and
  `node:sqlite` covers what one local user needs.
- **`node:test`** — rejected in favor of Vitest, because it has no `--changed` and the inner loop
  depends on one.
- **Prettier + ESLint** — rejected because they need five or more packages and two configs, where
  Biome is one package and one config.
- **dependency-cruiser** — rejected because a package is too much for five import rules.
- **Python 3.13** — rejected for now because CLAP's and mlx-lm's dependency wheels lag behind it.

## Consequences

- Types live in JSDoc, which is wordier than TypeScript syntax. `tsc` 7 checks it strictly.
- Browser tiers can't use npm packages. Anything the UI needs is either written here or vendored
  as a file in `src/web/`, after asking.
- The gate needs both pnpm and uv. `./scripts/setup` checks for both.
- Python tooling runs through `uv run --frozen` inside `sidecar/`, so the lockfile is the only
  source of Python versions.
