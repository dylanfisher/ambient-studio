#!/usr/bin/env node
// Writes the golden-render hashes for the current ENGINE_VERSION (decision 0009): renders every
// genome in src/engine/genomes/, raw and through the export, and adds an entry of each kind to
// test/fixtures/golden/v<N>/ for each golden that has none. An existing entry is never
// overwritten; a changed render needs a new engine version. Runs on mbp2021 only.
import { ENGINE_VERSION } from "../src/engine/engine-version.js";
import {
  currentEnvironment,
  GOLDEN_DIR,
  renderNormalized,
  renderRaw,
  writeGoldens,
} from "../test/support/golden.js";

const kinds = [
  { kind: "raw", render: renderRaw },
  { kind: "normalized", render: renderNormalized },
];
for (const { kind, render } of kinds) {
  const { written, kept } = await writeGoldens({
    dir: GOLDEN_DIR,
    version: ENGINE_VERSION,
    kind,
    env: currentEnvironment(),
    render,
  });
  for (const path of written) console.log(`wrote the ${kind} entry in ${path}`);
  for (const path of kept) console.log(`kept ${path}: it already has this machine's ${kind} entry`);
}
