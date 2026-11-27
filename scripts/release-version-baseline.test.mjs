import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNewRelease } from "./release-version-baseline.mjs";

const base = { pluginVersion: "3.2.4", desktopVersion: "0.4.5", previousPluginVersion: "3.2.3", previousDesktopVersion: "0.4.4", desktop: true };
test("requires new versions for both parts of a desktop release", () => {
  assert.doesNotThrow(() => assertNewRelease(base));
  assert.throws(() => assertNewRelease({ ...base, pluginVersion: "3.2.3" }));
  assert.throws(() => assertNewRelease({ ...base, desktopVersion: "0.4.4" }));
  assert.throws(() => assertNewRelease({ ...base, desktopVersion: "0.3.9" }));
});
test("plugin-only release retains desktop and versions compare numerically", () => {
  assert.doesNotThrow(() => assertNewRelease({ ...base, desktop: false, desktopVersion: "0.4.4" }));
  assert.throws(() => assertNewRelease({ ...base, desktop: false }));
  assert.doesNotThrow(() => assertNewRelease({ ...base, pluginVersion: "3.2.10", previousPluginVersion: "3.2.9" }));
  assert.throws(() => assertNewRelease({ ...base, pluginVersion: "3.2.4-rc.1" }));
});
