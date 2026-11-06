#!/usr/bin/env node
// Writes the raw golden-render hashes for the current ENGINE_VERSION (decision 0009): renders
// every genome in src/engine/genomes/ and adds an entry to test/fixtures/golden/v<N>/ for each
// golden that has none. An existing entry is never overwritten; a changed render needs a new
// engine version. Runs on mbp2021 only.
import { ENGINE_VERSION } from "../src/engine/engine-version.js";
import { currentEnvironment, GOLDEN_DIR, renderRaw, writeGoldens } from "../test/support/golden.js";

const { written, kept } = await writeGoldens({
  dir: GOLDEN_DIR,
  version: ENGINE_VERSION,
  kind: "raw",
  env: currentEnvironment(),
  render: renderRaw,
});
for (const path of written) console.log(`wrote ${path}`);
for (const path of kept) console.log(`kept ${path}: it already has this machine's entry`);
