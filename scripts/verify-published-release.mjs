import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repository = process.env.GITHUB_REPOSITORY || "npcink/npcink-device-inventory";
const tag = process.env.TAG_NAME || process.env.RELEASE_TAG || "";
const outputDir = path.resolve(process.argv[2] || "published-assets");
if (!tag) fail("TAG_NAME or RELEASE_TAG is required.");

await mkdir(outputDir, { recursive: true });
const checksumText = await download("SHA256SUMS");
await writeFile(path.join(outputDir, "SHA256SUMS"), checksumText);

const entries = checksumText
  .toString("utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const match = line.match(/^([a-f0-9]{64})  ([^/]+)$/);
    if (!match) fail(`Invalid SHA256SUMS line: ${line}`);
    return { hash: match[1], name: match[2] };
  });

for (const entry of entries) {
  const content = await download(entry.name);
  const actual = createHash("sha256").update(content).digest("hex");
  if (actual !== entry.hash) fail(`Published asset hash mismatch: ${entry.name}`);
  await writeFile(path.join(outputDir, entry.name), content);
  console.log(`Downloaded and verified: ${entry.name}`);
}

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
  console.error(message);
  process.exit(1);
}
