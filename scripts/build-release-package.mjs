import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteAdminDir = path.join(repoRoot, "vite-admin");
const slug = "npcink-device-inventory";
const releaseDir = path.join(repoRoot, "release");
const submissionDir = path.join(repoRoot, "sj");
const stagingRoot = path.join(repoRoot, ".release-build");
const stagingPlugin = path.join(stagingRoot, slug);
const output = path.join(releaseDir, `${slug}.zip`);
const packageDir = path.join(releaseDir, slug);
const submissionZip = path.join(submissionDir, `${slug}.zip`);
const submissionManifest = path.join(submissionDir, "package-manifest.json");
const shouldBuildSubmissionPackage = process.argv.includes("--submission");

const rootFiles = [
  "index.php",
  "npcink-device-inventory.php",
  "uninstall.php",
  "README.txt",
  "README.md",
  "LICENSE",
  "LICENSE.txt",
];

const adminSourceFiles = [
  "vite-admin/eslint.config.js",
  "vite-admin/index.html",
  "vite-admin/package-lock.json",
  "vite-admin/package.json",
  "vite-admin/postcss.config.js",
  "vite-admin/tsconfig.json",
  "vite-admin/tsconfig.node.json",
  "vite-admin/vite.config.ts",
];

const runtimeDirs = [
  "admin",
  "includes",
  "languages",
  "vite-admin/dist",
  "vite-admin/src",
];

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingPlugin, { recursive: true });
await mkdir(releaseDir, { recursive: true });

execFileSync("npm", ["run", "build"], { cwd: viteAdminDir, stdio: "inherit" });

for (const file of rootFiles) {
  await cp(path.join(repoRoot, file), path.join(stagingPlugin, file));
}

for (const file of adminSourceFiles) {
  const destination = path.join(stagingPlugin, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(repoRoot, file), destination);
}

for (const dir of runtimeDirs) {
  await cp(path.join(repoRoot, dir), path.join(stagingPlugin, dir), { recursive: true });
}

await assertVersionMatchesReadme();
await removeReleaseJunk(stagingPlugin);

await rm(output, { force: true });
execFileSync("zip", ["-qr", output, slug], { cwd: stagingRoot });
await rm(packageDir, { recursive: true, force: true });
if (shouldBuildSubmissionPackage) {
  await mkdir(submissionDir, { recursive: true });
  await cp(output, submissionZip);
  await updateSubmissionManifest(output);
} else {
  await rm(submissionZip, { force: true });
}
await rm(stagingRoot, { recursive: true, force: true });
execFileSync("node", ["scripts/check-wordpress-org-review-rules.mjs", "release/npcink-device-inventory.zip"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`Built ${path.relative(repoRoot, output)}`);
if (shouldBuildSubmissionPackage) {
  console.log(`Copied ${path.relative(repoRoot, submissionZip)}`);
}

async function assertVersionMatchesReadme() {
  const pluginFile = await readFile(path.join(stagingPlugin, "npcink-device-inventory.php"), "utf8");
  const readmeFile = await readFile(path.join(stagingPlugin, "README.txt"), "utf8");
  const pluginVersion = pluginFile.match(/^[ \t*]*Version:\s*([^\s]+)/m)?.[1] || "";
  const stableTag = readmeFile.match(/^Stable tag:\s*([^\s]+)/m)?.[1] || "";

  if (!pluginVersion || !stableTag || pluginVersion !== stableTag) {
    console.error(
      `Plugin Version and README.txt Stable tag must match. Version=${pluginVersion || "missing"}, Stable tag=${stableTag || "missing"}`
    );
    process.exit(1);
  }
}

async function removeReleaseJunk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.name === ".DS_Store" || entry.name === "__MACOSX") {
      await rm(entryPath, { recursive: true, force: true });
      continue;
    }

    if (entry.isDirectory()) {
      await removeReleaseJunk(entryPath);
    }
  }
}

async function updateSubmissionManifest(zipPath) {
  const manifest = JSON.parse(await readFile(submissionManifest, "utf8"));
  const metadata = await zipMetadata(zipPath);
  const pluginSource = await readFile(path.join(repoRoot, "npcink-device-inventory.php"), "utf8");
  const header = (name) => pluginSource.match(new RegExp(`^[ \\t*]*${name}:\\s*(.+)$`, "m"))?.[1].trim() || "";
  manifest.plugin = {
    ...manifest.plugin,
    name: header("Plugin Name"),
    version: header("Version"),
    requires_at_least: header("Requires at least"),
    tested_up_to: header("Tested up to"),
    requires_php: header("Requires PHP"),
    license: header("License"),
  };
  if (manifest.package?.sha256 !== metadata.sha256) {
    // A new ZIP must not inherit successful verification claims from a previous package.
    manifest.verification = { status: "requires_verification", package_sha256: metadata.sha256 };
  }
  manifest.package = {
    ...manifest.package,
    sha256: metadata.sha256,
    entry_count: metadata.entryCount,
    file_count: metadata.fileCount,
    uncompressed_bytes: metadata.uncompressedBytes,
    compressed_bytes: metadata.compressedBytes,
  };
  await writeFile(submissionManifest, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function zipMetadata(zipPath) {
  const buffer = await readFile(zipPath);
  const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
  const listedEntries = Array.from(
    listing.matchAll(/^\s*(\d+)\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/gm)
  );
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    entryCount: entries.length,
    fileCount: entries.filter((entry) => !entry.endsWith("/")).length,
    uncompressedBytes: listedEntries.reduce((total, match) => total + Number(match[1]), 0),
    compressedBytes: (await stat(zipPath)).size,
  };
}
