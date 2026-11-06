# 0002. Render offline with node-web-audio-api, pinned at 2.2.0

- **Date:** 2026-11-05
- **Status:** accepted

## Context

The engine is one Web Audio module that must render offline in Node and preview live in a
browser from the same file ([0001](0001-stack.md)). Node has no Web Audio API of its own.
AGENTS.md requires the owner's approval for each dependency, and renders must be reproducible:
the same genome, seed and engine version give the same samples.

## Decision

Add `node-web-audio-api` at exactly `2.2.0` (no caret) as the first runtime dependency, with the
owner's approval on 2026-11-05. It is a Rust implementation of Web Audio exposed through N-API,
shipped as a prebuilt darwin-arm64 binary. `src/server` creates the `OfflineAudioContext` and
passes it to `render()`; `src/engine` never imports the package.

Upgrading it is a step of its own: re-run the golden-render test
([0009](0009-engine-version-golden-hashes.md)) and bump the engine version if the hashes move.

## Alternatives considered

- **A DSP renderer written here in JS** — rejected because the browser preview would then run
  different code from the offline render, and the engine would have to be written twice.
- **Headless Chromium (Puppeteer or Playwright)** — rejected for its size, its start-up time on
  every render, and because the browser can change its audio code under us on any update.
- **A caret range (`^2.2.0`)** — rejected because a lockfile refresh could change rendered
  samples without anyone choosing to.

## Consequences

- Renders are bit-reproducible only on mbp2021 with this package version. The browser preview
  is close but not identical, which is acceptable because it is optional and never stored.
- Where this package differs from browsers is answered from its README and source in
  `node_modules/node-web-audio-api/` ([reference.md](../reference.md)).
- Step 1a confirms, before any engine code, that two renders of the same graph match byte for
  byte, which native nodes are present, and whether `OfflineAudioContext.suspend()` works. If
  any of these fail, the plan changes before phase 1 goes further.
