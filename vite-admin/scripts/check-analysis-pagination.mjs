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
  await build({
    entryPoints: ["src/pages/shared/assets.tsx"], outfile: output, bundle: true, platform: "node", format: "esm",
    plugins: [{ name: "assets-api-fixture", setup(builder) {
      builder.onResolve({ filter: /^@\/services\/v3$/ }, () => ({ path: "assets-api", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const getAssets = (...args) => globalThis.npcinkAssetPage(...args);" }));
    } }],
  });
  const { AssetBatchLimitError, fetchAllAssets } = await import(`${pathToFileURL(output).href}?assets`);
  const assetCalls = [];
  globalThis.npcinkAssetPage = async (params, signal) => {
    assetCalls.push({ params, signal });
    return { data: [{ id: params.page }], pagination: { totalItems: 21, totalPages: 2 } };
  };
  assert.deepEqual(await fetchAllAssets({ includeHardware: true }, { signal: controller.signal }), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(assetCalls.map(({ params, signal }) => [params.page, params.pageSize, signal]), [[1, 20, controller.signal], [2, 20, controller.signal]]);
  assetCalls.length = 0;
  globalThis.npcinkAssetPage = async (params) => {
    assetCalls.push(params);
    return { data: [], pagination: { totalItems: 501, totalPages: 26 } };
  };
  await assert.rejects(fetchAllAssets({ includeHardware: true }), AssetBatchLimitError);
  assert.equal(assetCalls.length, 1, "Oversize hardware result must not fetch subsequent pages");
  globalThis.npcinkAssetPage = async (params) => {
    assert.equal(params.pageSize, 100);
    assert.equal(params.includeHardware, false);
    return { data: [], pagination: { totalItems: 2001, totalPages: 21 } };
  };
  await assert.rejects(fetchAllAssets({ includeHardware: false }, { maxAssets: 2000 }), AssetBatchLimitError);
  globalThis.npcinkAssetPage = async () => ({ data: [], pagination: { totalItems: 0, totalPages: 0 } });
  assert.deepEqual(await fetchAllAssets(), []);
  for (const response of [
    { data: [], pagination: { totalItems: 1, totalPages: NaN } },
    { data: null, pagination: { totalItems: 0, totalPages: 0 } },
    { data: Array(21).fill({ id: 1 }), pagination: { totalItems: 21, totalPages: 2 } },
  ]) {
    globalThis.npcinkAssetPage = async () => response;
    await assert.rejects(fetchAllAssets({ includeHardware: true }), /分页响应无效/);
  }
  console.log("Asset pagination: projection, cancellation signal, page sizes and hard limits passed.");
  console.log("Analysis cursor pagination, empty pages, invalid cursors and cancellation passed.");
} finally {
  delete globalThis.npcinkComparisonPage;
  delete globalThis.npcinkAssetPage;
  await rm(directory, { recursive: true, force: true });
}
