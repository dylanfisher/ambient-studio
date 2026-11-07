# AGENTS.md

Instructions for AI coding agents working in this repo. Humans: see [README.md](README.md).

**Keep this file under 700 words.** Anything longer lives in `docs/` and is linked from here.

## Stack

- **Language:** JavaScript (ESM) on Node 26.12.1 (`.nvmrc`), typed with JSDoc and checked by `tsc --strict`; Python 3.12 in `sidecar/`
- **Package manager:** pnpm (`packageManager` in package.json); uv for `sidecar/`
- **Framework:** none. `node:http` and `node:sqlite` (WAL) on the server; plain HTML/CSS/ES modules in the browser, no build step; Web Audio via `node-web-audio-api` offline
- **Test framework:** Vitest; pytest in `sidecar/`
- **Layout:** `src/{engine,domain,config,server,web}`, tests mirrored under `test/`; Python in `sidecar/src`, tests in `sidecar/tests` — tiers and search recipes: [docs/map.md](docs/map.md)
- **Reference docs:** [docs/reference.md](docs/reference.md) says which local source answers which question. Check it before the web.

## Commands

| Task | Command |
|---|---|
| Install / bootstrap | `./scripts/setup` |
| Run locally | `./scripts/dev` |
| Run tests | `./scripts/test` |
| Run the tests for what you changed | `./scripts/test --changed` (add `--low` while omlx is serving) |
| Fix formatting | `./scripts/format` |
| **Full gate** | `./scripts/check` |

`./scripts/check` is the gate — see Definition of done. Iterate with `./scripts/test --changed`; run `check` once, at the end. **Run a check only when it can fail on your diff.** Name the step that reads what you changed; if none does (`.claude/`, `tmp/`), skip it and say so. Work split across subagents follows [docs/agent-rules.md](docs/agent-rules.md).

## Principles

Non-negotiable, regardless of stack. Rationale: [docs/principles.md](docs/principles.md).

1. **Single source of truth.** Every fact — a constant, type, config value, copy string — is defined once and imported. Never re-declare, never re-derive. **Search before you create** — [docs/map.md](docs/map.md) has the recipes.
2. **Match the surrounding code.** Consistency beats personal preference. Read a neighboring file before writing a new one; map.md says which one is the neighbor.
3. **DRY on the third occurrence, not the second.** Premature abstraction costs more than duplication.
4. **Smallest change that solves the problem.** No drive-by refactors, renames, or reformatting outside the task.
5. **Fail loudly.** No empty catches, no silent fallbacks, no defaults that mask a missing value.
6. **Delete, don't comment out.** Git remembers.
7. **No new dependencies without asking first.** Say what it's for and what it replaces.
8. **Style is the formatter's job.** If a tool enforces it, it does not belong in this file or in review.
9. **Tests are deterministic.** No waiting on real time: inject the clock or wait on a condition. A flaky test gets a hunt for the cause, not a rerun.

## Boundaries

- **omlx is shared with a live public site.** Reach it only through the server's queue: one request
  in flight, back off when it's busy, short contexts, model id from config. Never change its
  settings or load or swap models.
- **Nothing runs in the background.** Generation, sidecar jobs and LoRA training start only when
  the owner starts them; training uses its own small model, never omlx. Tests use fakes for omlx
  and the sidecar.
- **Renders are reproducible.** A change that alters the audio an existing genome + seed renders
  bumps the engine version.
- **Never touch the owner's real data** in `~/.config/ambient-studio/` or
  `~/Library/Application Support/Ambient Studio/`. Tests, and any run an agent starts, root
  paths in a temp folder.
- **Commit locally; never push or call `gh`.** The owner pushes; the repo is public.
- **Pre-release, derived data** (renders, features, embeddings, preference models) has one shape:
  no version fields or migrations; data that doesn't match is discarded and rebuilt.
  **Irreplaceable data** (vibes, genomes, ratings, sketches, tracks, albums, notes) is append-only:
  mark rows removed, never delete, and a shape change ships with a migration.
- The app's one secret is the studio's omlx key, kept only in the owner's config file (mode 600)
  and never committed, logged, stored or printed. If another appears, stop and ask.

## Definition of done

- `./scripts/check` passes clean, when the change touches anything it reads.
- New behavior has a test that fails without the change.
- No new dependencies, no new files outside the agreed layout, no TODOs left behind.
- A choice a reader would otherwise reopen, behavior included, has a record in `docs/decisions/`.
- Comments, docs, and commit messages follow [docs/writing.md](docs/writing.md).
