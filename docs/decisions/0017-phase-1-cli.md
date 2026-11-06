# 0017. Phase 1 exposes rendering as a CLI command

- **Date:** 2026-11-05
- **Status:** accepted

## Context

Phase 1 has to render and export before the server, store and UI exist (phase 2). The owner needs
a way to make files to listen to, and phase 2's routes need the same functions.

## Decision

By the owner's choice on 2026-11-05, `./scripts/render` is a thin wrapper that runs a CLI module
in `src/server`:

```
./scripts/render <genome.json> --seed N --duration S --out DIR [--offset S] [--no-flac]
./scripts/render --from <export.json> --out DIR
```

It writes a WAV, a FLAC and the export's sidecar JSON to `DIR`. `--from` re-renders an earlier
export and fails if the samples differ from the hash it recorded. `--out` is required: there is no
config file or app-data folder until phase 2, and a default directory would hide a missing value.
The CLI parses arguments and prints; rendering and export live in `src/server` functions that the
phase 2 routes call unchanged.

## Alternatives considered

- **A minimal HTTP page as well** — rejected as starting server and web work a phase early; the
  owner copies files to mbp2015 to listen in phase 1.
- **A live browser preview in phase 1** — rejected for now; the preview is optional in the spec,
  and the arch check already keeps the engine free of Node imports.

## Consequences

- The CLI module is a knip entry, added to `knip.json` with it.
- An agent running the CLI points `--out` at its scratchpad, never at the owner's data folders.
