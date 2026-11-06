# Code map

Where things live, and how to find one before you build a second. Read this before creating any
new file.

This file describes **shape, not contents** — conventions and search commands, never an inventory.
An inventory would be a second copy of facts the code already holds, it would rot within a week,
and it would have no error message when it diverged. If you catch yourself listing what exists
here, stop: the grep is the list.

## Find before you create

The single rule that matters. AGENTS.md principles 1–3 (single source of truth, match the
surrounding code, DRY on the third occurrence) all depend on it — none of them can be followed
against a codebase you haven't searched.

| Before adding… | Run |
|---|---|
| any named thing | `rg -i '<name>' --type js --type py` |
| an engine voice, node graph or macro | `ls src/engine/` and `rg 'export (function\|const\|class)' src/engine/` |
| a domain helper (lint, features, prompts, arrangement) | `rg 'export (function\|const\|class)' src/domain/` |
| a route, store query or job | `rg -n '<path or table>' src/server/` |
| a UI view or widget | `ls src/web/` |
| a config value | `rg '<key>' src/config/` — config is read in one module only |
| a type | `rg '@typedef \{.*\} <Name>\|@typedef <Name>' src/` — JSDoc types, defined once |
| a sidecar function | `rg '^(async )?def <name>\|^class <Name>' sidecar/src/` |
| a change to how something behaves | `rg -il '<topic>' docs/decisions/` — read the record that governs it first |

`rg` finds a name; the `LSP` tool finds a symbol. Before changing, moving or removing an export,
run its `findReferences` to list every caller, including ones that import it under another name,
and use `hover` for the type `tsc` infers. Setup: [reference.md](reference.md).

If a search turns up something close but not identical, that's the second occurrence. Use it or
duplicate it — do not abstract yet (principle 3).

## Tiers

| Tier | Path | What belongs here | May import from |
|---|---|---|---|
| **engine** | `src/engine` | The generative engine: genome schema, voices, macros, `render()`. Written against the Web Audio API and given its `AudioContext`, so the same file runs offline in Node and live in the browser. Deterministic given a seed, so no `Math.random` or `Date.now`. | nothing |
| **domain** | `src/domain` | Pure project logic both sides need: the linter, feature math, prompt building, arrangement and album arc. No I/O. | engine |
| **config** | `src/config` | The one module that reads the config file and environment, and throws on a missing key. | nothing |
| **server** | `src/server` | Everything with I/O: HTTP routes, the SQLite store, the omlx queue, offline rendering, export, the sidecar client. | domain, engine, config |
| **web** | `src/web` | The studio UI: HTML, CSS and ES modules served as-is, with no build step. | domain, engine |
| **sidecar** | `sidecar/src` | Python: CLAP embeddings, preference models, optimizers, LoRA training. A separate process the server calls; nothing imports it. | its own package only |

**Dependency direction is one-way: server and web → domain → engine.** Never upward, and never
between server and web, which talk only over HTTP. engine, domain and web are loaded by the
browser without a bundler, so they import only relative paths: no `node:` modules, no package
names.

`scripts/arch.js` enforces this table and is the only place the rules are written as code; it runs
as the `arch` step of `./scripts/check`. Change the table and the script together, and plant the
new rule in `scripts/arch-test`.

## Naming

- One thing per file; the filename is the thing's name.
- File names singular and kebab-case: `src/engine/granular-cloud.js`. Python modules snake_case.
- Tests mirror the tree: `src/server/store.js` is tested in `test/server/store.test.js`, and
  `sidecar/src/ambient_sidecar/clap.py` in `sidecar/tests/test_clap.py`. Shared test helpers
  live in `test/support/`.
- Types are JSDoc `@typedef`s in the module that owns the value, imported with
  `@import` where used. A shape both tiers share (a genome) lives in `src/engine/`.
- Stored JSON (genomes, arrangements, constraints) uses camelCase keys, matching the JS.

## Promotion

Things move up a tier deliberately, never by accident:

- **Third occurrence** → extract to the lowest tier that all three callers can reach (principle 3).
- **Server code turns out to be pure** and the web needs it → move it down to domain.
- **Domain code grows I/O** → it was never domain; move it up to server.

A promotion is its own commit, separate from whatever work revealed it (principle 4).

## Decision records

`docs/decisions/NNNN-slug.md`, copied from `0000-template.md`. Every choice a reader would otherwise reopen gets one: an approach, a rejected
alternative, and behavior the owner or a builder decided ("A/B ties count as half a win",
"wildcards are 1 in 8 candidates"). Expect about one per feature. Records double as the behavior
spec, and a brief quotes the one that governs its step.

- **Find the governing record before changing a behavior** (the recipe above). A change that
  contradicts one amends it in the same commit.
- **Amend, don't pile up.** A refinement edits the record in place and adds a dated line under
  `## Amendments`. A later record that changes part of an earlier one names it in its own Status,
  and the earlier record's Status says `amended by NNNN` and what. `superseded by` is for a record
  whose decision no longer holds at all.
- **Numbers are taken in order and never reused.** When several agents work at once, the
  orchestrator hands out the numbers ([agent-rules.md](agent-rules.md)); a builder never picks
  its own, or two branches take the same one and one gets renumbered.

## Untracked state — `tmp/`

Git ignores `tmp/`. It holds working state that has to outlive a session but isn't part of the
project: a plan in progress, `tmp/handoff.md`, the owner's screenshots in `tmp/shots/`, and
cloned reference docs in `tmp/docs/` ([reference.md](reference.md)). A session's scratchpad is
wiped when the session ends or crashes; `tmp/` is not. Nothing in the build or tests reads it.

<!-- paths: src/engine src/domain src/config src/server src/web sidecar/src -->
<!-- ↑ scripts/check verifies every path above exists. Keep it in sync with the Tiers table;
     a rename that misses this line fails the gate, which is the point. -->
