import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const assetsDir = path.resolve(process.argv[2] || "artifacts");
const files = (await listFiles(assetsDir))
  .filter((file) => path.basename(file) !== "SHA256SUMS")
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

const names = new Set();
const lines = [];
for (const file of files) {
  const name = path.basename(file);
  if (names.has(name)) fail(`Duplicate release asset name: ${name}`);
  names.add(name);
  const hash = createHash("sha256").update(await readFile(file)).digest("hex");
  lines.push(`${hash}  ${name}`);
}

if (!lines.length) fail("No release assets found.");
await writeFile(path.join(assetsDir, "SHA256SUMS"), `${lines.join("\n")}\n`);
console.log(`Wrote SHA256SUMS for ${lines.length} release assets.`);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    })
  );
  return nested.flat();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
