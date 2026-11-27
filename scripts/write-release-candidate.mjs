import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const tag = process.env.TAG_NAME;
if (!/^v\d+\.\d+\.\d+$/.test(tag || "")) throw new Error("TAG_NAME must be a stable version tag");
const commit = execFileSync("git", ["rev-parse", `${tag}^{commit}`], { encoding: "utf8" }).trim();
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (commit !== head) throw new Error("Candidate tag must identify the checked-out commit");
const desktop = JSON.parse(await readFile("ele-rs/package.json", "utf8"));
const candidate = {
  schema: "npcink-release-candidate-v1", tag, commit,
  plugin_version: tag.slice(1), desktop_version: desktop.version,
  run_id: process.env.GITHUB_RUN_ID,
  mode: process.env.DESKTOP_RELEASE === "true" ? "desktop" : "plugin",
  previous_tag: process.env.PREVIOUS_RELEASE_TAG,
};
await writeFile(path.resolve(process.argv[2] || "artifacts", "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
