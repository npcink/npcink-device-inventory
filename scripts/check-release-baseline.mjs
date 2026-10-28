import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { assertNewRelease } from "./release-version-baseline.mjs";

const tag = process.env.RELEASE_TAG;
const previousTag = process.env.PREVIOUS_RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY || "npcink/npcink-device-inventory";
if (!/^v\d+\.\d+\.\d+$/.test(tag || "") || !/^v\d+\.\d+\.\d+$/.test(previousTag || "")) {
  throw new Error("RELEASE_TAG and PREVIOUS_RELEASE_TAG must be stable version tags");
}
// A draft is also immutable: rerunning must use the existing candidate, not replace it.
try {
  execFileSync("gh", ["api", `repos/${repository}/releases/tags/${tag}`], { stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  if (!String(error.stderr).includes("HTTP 404")) throw error;
  const previousDesktop = JSON.parse(execFileSync("git", ["show", `${previousTag}:ele-rs/package.json`], { encoding: "utf8" }));
  const currentDesktop = JSON.parse(await readFile("ele-rs/package.json", "utf8"));
  assertNewRelease({
    pluginVersion: tag.slice(1), desktopVersion: currentDesktop.version,
    previousPluginVersion: previousTag.slice(1), previousDesktopVersion: previousDesktop.version,
    desktop: process.env.DESKTOP_RELEASE === "true",
  });
  console.log(`Unpublished release/version baseline passed: ${previousTag} -> ${tag}`);
  process.exit(0);
}
throw new Error(`Release ${tag} already exists; refusing to replace candidate or published assets`);
