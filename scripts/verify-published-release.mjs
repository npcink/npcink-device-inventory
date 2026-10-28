import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { parseChecksums, verifyChecksums } from "./release-checksums.mjs";
import path from "node:path";
import os from "node:os";

const repository = process.env.GITHUB_REPOSITORY || "npcink/npcink-device-inventory";
const tag = process.env.TAG_NAME || process.env.RELEASE_TAG || "";
const outputDir = path.resolve(process.argv[2] || "published-assets");
const isDraft = process.argv.includes("--draft");
if (!tag) fail("TAG_NAME or RELEASE_TAG is required.");
const metadata = JSON.parse(execFileSync("gh", ["release", "view", tag, "--repo", repository, "--json", "isDraft,tagName,assets"], { encoding: "utf8" }));
if (metadata.isDraft !== isDraft || metadata.tagName !== tag) fail("Release does not match the requested draft/public state.");

await mkdir(outputDir, { recursive: true });
if ((await readdir(outputDir)).length) fail("Use an empty output directory so stale artifacts cannot satisfy verification.");
if (isDraft) {
  execFileSync("gh", ["release", "download", tag, "--repo", repository, "--dir", outputDir], { stdio: "inherit" });
} else {
  const checksumText = await download("SHA256SUMS");
  await writeFile(path.join(outputDir, "SHA256SUMS"), checksumText);
  for (const entry of parseChecksums(checksumText.toString("utf8"))) {
    const content = await download(entry.name);
    await writeFile(path.join(outputDir, entry.name), content);
  }
}
const entries = await verifyChecksums(outputDir);
const expectedNames = [...entries.map((entry) => entry.name), "SHA256SUMS"].sort();
if (JSON.stringify(metadata.assets.map((asset) => asset.name).sort()) !== JSON.stringify(expectedNames)) {
  fail("Remote release asset list differs from SHA256SUMS.");
}
const candidate = JSON.parse(await readFile(path.join(outputDir, "candidate.json"), "utf8"));
const expectedCommit = execFileSync("git", ["rev-parse", `${tag}^{commit}`], { encoding: "utf8" }).trim();
if (candidate.schema !== "npcink-release-candidate-v1" || candidate.tag !== tag || candidate.commit !== expectedCommit) {
  fail("Candidate metadata does not match release tag/commit.");
}
if (!isDraft) {
  // Compare with the independent build-run proof, not a potentially replaced
  // checksum file on the Release itself.
  if (!/^\d+$/.test(candidate.run_id || "")) fail("Missing candidate build-run identity.");
  const run = JSON.parse(execFileSync("gh", ["api", `repos/${repository}/actions/runs/${candidate.run_id}`], { encoding: "utf8" }));
  if (run.head_sha !== expectedCommit || run.path !== ".github/workflows/release.yml" || run.event !== "push" || run.conclusion !== "success") {
    fail("Candidate build run must have succeeded for the release commit.");
  }
  const proofDir = await mkdtemp(path.join(os.tmpdir(), "npcink-candidate-proof-"));
  try {
    execFileSync("gh", ["run", "download", candidate.run_id, "--repo", repository, "--name", `candidate-proof-${tag}`, "--dir", proofDir], { stdio: "inherit" });
    for (const name of ["SHA256SUMS", "candidate.json"]) {
      if (!(await readFile(path.join(outputDir, name))).equals(await readFile(path.join(proofDir, name)))) {
        fail(`Published ${name} differs from the original candidate build proof.`);
      }
    }
  } finally { await rm(proofDir, { recursive: true, force: true }); }
}
console.log(`Verified ${entries.length} candidate assets at ${candidate.commit}.`);

async function download(name) {
  const url = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, { redirect: "follow" });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (attempt === 5) fail(`Unable to download ${name}: HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

function fail(message) {
  throw new Error(message);
}
