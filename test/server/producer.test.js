// The renders row's producer key (decision 0026): the engine version and the extractor's source.
import { expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { PRODUCER, producerOf } from "../../src/server/producer.js";

test("names the engine version and hashes the extractor's files", () => {
  expect(PRODUCER).toMatch(new RegExp(`^engine-${ENGINE_VERSION} features-[0-9a-f]{64}$`));
});

test("changes with a file's text, a file's path, and the engine version", () => {
  const sources = [
    { path: "src/domain/a.js", text: "export const a = 1;\n" },
    { path: "src/domain/b.js", text: "export const b = 2;\n" },
  ];
  const base = producerOf(2, sources);
  expect(producerOf(2, structuredClone(sources))).toBe(base);
  const edited = sources.map((s, i) => (i === 1 ? { ...s, text: "export const b = 3;\n" } : s));
  const moved = sources.map((s, i) => (i === 0 ? { ...s, path: "src/domain/c.js" } : s));
  const others = [producerOf(2, edited), producerOf(2, moved), producerOf(3, sources)];
  expect(new Set([base, ...others]).size).toBe(4);
});
