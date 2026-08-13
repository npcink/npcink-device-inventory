import { execFileSync } from "node:child_process";
import { needsDesktopRelease } from "./release-scope.mjs";

const cases = [
  {
    name: "plugin-only paths",
    paths: ["vite-admin/src/pages/index.tsx", "includes/v3/rest/class-npcink-device-inventory-assets-controller.php"],
    expected: false,
  },
  {
    name: "desktop source change",
    paths: ["ele-rs/src/main.ts"],
    expected: true,
  },
  {
    name: "desktop manifest change",
    paths: ["scripts/build-desktop-update-manifests.mjs"],
    expected: true,
  },
  {
    name: "release integrity change",
    paths: ["scripts/verify-release-assets.mjs"],
    expected: true,
  },
  {
    name: "release workflow change",
    paths: [".github/workflows/release.yml"],
    expected: true,
  },
  {
    name: "release scope change",
    paths: ["scripts/release-scope.mjs"],
    expected: true,
  },
];

const detectEnv = { ...process.env, RELEASE_TAG: "v2.8.0" };
delete detectEnv.GITHUB_OUTPUT;

for (const testCase of cases) {
  const actual = needsDesktopRelease(testCase.paths);
  if (actual !== testCase.expected) {
    console.error(`Release scope fixture failed: ${testCase.name}`);
    process.exit(1);
  }
}

const v280 = JSON.parse(
  execFileSync("node", ["scripts/detect-release-scope.mjs"], {
    encoding: "utf8",
    env: detectEnv,
  })
);

if (v280.mode !== "plugin" || v280.previousTag !== "v2.7.9") {
  console.error("Release scope fixture failed: v2.8.0 should be classified as a plugin-only release.");
  process.exit(1);
}

console.log("Release scope checks passed.");
