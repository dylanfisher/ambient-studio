import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    // Render tests are CPU-bound, and the gate runs every file at once on a machine that also
    // serves a live site; under that load several took 4 s of the 5 s default and failed one
    // gate run in a few. A limit here only has to catch a hang. Speed is the bench's job (0016).
    testTimeout: 30_000,
    // A beforeAll that renders shared excerpts takes as long as a render test.
    hookTimeout: 30_000,
  },
});
