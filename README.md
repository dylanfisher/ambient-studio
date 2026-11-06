# Ambient Studio

A local studio for prototyping ambient music: a local LLM proposes parameter sets for a generative
Web Audio engine, and your ratings steer it toward a vibe you describe.

You describe a **vibe**: a brief plus hard constraints, such as "cold, tidal, slow; D dorian; no
percussion; 60–90 s swells; −20 LUFS". The LLM writes **genomes**, JSON parameter sets for the
engine. The server renders and measures short excerpts, and you listen, rate, lock and branch.
Per-vibe preference models and optimizers learn from each rating. Results you keep become
**sketches**, sketches become **tracks**, and tracks become **albums**, exported as WAV or FLAC
with enough metadata to re-render them exactly.

Single-user and run on demand. The server and all rendering and training run on one Mac; the UI is
used from other machines on the LAN.

## Requirements

- macOS, with Node 26.12.1 (`.nvmrc`), pnpm and uv (`brew install pnpm uv`)
- An OpenAI-compatible LLM server. The URL and model id are set in
  `~/.config/ambient-studio/config.json`

## Use it

```sh
./scripts/setup   # install dependencies and the commit-msg hook
./scripts/dev     # run the studio
./scripts/check   # the gate: format, lint, types, tier rules, duplicates, unused code, tests
```

Data (the database, renders, exports) lives in `~/Library/Application Support/Ambient Studio/`.

## Layout

| Path | Holds |
|---|---|
| `src/engine/` | The Web Audio engine: genome schema, voices, macros, `render()`. Runs in Node and the browser. |
| `src/domain/` | Pure logic shared by server and UI: constraint linting, features, prompts, arrangement. |
| `src/config/` | The one module that reads settings. |
| `src/server/` | HTTP server, SQLite store, LLM queue, offline rendering, export. |
| `src/web/` | The studio UI, plain HTML/CSS/JS with no build step. |
| `sidecar/` | Python: CLAP embeddings, preference models, optimizers, LoRA training. |
| `test/` | JS tests, mirroring `src/`. |
| `docs/` | [Product spec](docs/spec.md), [code map](docs/map.md), [decisions](docs/decisions/), [writing](docs/writing.md), [agent rules](docs/agent-rules.md), [reference sources](docs/reference.md). |

Built mostly by AI coding agents; their instructions are in [AGENTS.md](AGENTS.md).
