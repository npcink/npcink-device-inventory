import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(path.join(tmpdir(), "npcink-analysis-pagination-"));
try {
  const output = path.join(directory, "analysis.mjs");
  await build({
    entryPoints: ["src/services/analysis.ts"], outfile: output, bundle: true, platform: "node", format: "esm",
    plugins: [{ name: "comparison-api-fixture", setup(builder) {
      builder.onResolve({ filter: /^\.\/v3$/ }, () => ({ path: "comparison-api", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const getComparisonObservations = (...args) => globalThis.npcinkComparisonPage(...args);" }));
    } }],
  });
  const { fetchComparisonObservations } = await import(pathToFileURL(output).href);
  const controller = new AbortController();
  const calls = [];
  const pages = [
    { data: [{ id: 11 }, { id: 10 }], pagination: { nextAfterAssetId: 25, throughAssetId: 100 } },
    { data: [], pagination: { nextAfterAssetId: 50, throughAssetId: 100 } },
    { data: [{ id: 90 }], pagination: { nextAfterAssetId: null, throughAssetId: 100 } },
  ];
  globalThis.npcinkComparisonPage = async (...args) => { calls.push(args); return pages.shift(); };
  assert.deepEqual(await fetchComparisonObservations(controller.signal), [{ id: 11 }, { id: 10 }, { id: 90 }]);
  assert.deepEqual(calls, [[0, 0, controller.signal], [25, 100, controller.signal], [50, 100, controller.signal]]);
  for (const next of [0, -1, 101, 1.5, NaN]) {
    globalThis.npcinkComparisonPage = async () => ({ data: [], pagination: { nextAfterAssetId: next, throughAssetId: 100 } });
    await assert.rejects(fetchComparisonObservations(), /分页游标无效/);
  }
  globalThis.npcinkComparisonPage = async () => { throw new DOMException("Cancelled", "AbortError"); };
  await assert.rejects(fetchComparisonObservations(controller.signal), { name: "AbortError" });
  console.log("Analysis cursor pagination, empty pages, invalid cursors and cancellation passed.");
} finally {
  delete globalThis.npcinkComparisonPage;
  await rm(directory, { recursive: true, force: true });
}
