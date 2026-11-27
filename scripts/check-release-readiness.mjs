import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteAdminDir = path.join(repoRoot, "vite-admin");
const releaseZip = path.join(repoRoot, "release/npcink-device-inventory.zip");
const submissionZip = path.join(repoRoot, "sj/npcink-device-inventory.zip");
const submissionManifest = path.join(repoRoot, "sj/package-manifest.json");
const shouldCheckSubmissionPackage = process.argv.includes("--submission");
const slug = "npcink-device-inventory";
const steps = [
  {
    title: "Release tooling regression tests",
    command: "npm",
    args: ["run", "check:release-tools"],
    cwd: repoRoot,
  },
  {
    title: "Admin production and development dependency audit",
    command: "npm",
    args: ["audit", "--audit-level=moderate"],
    cwd: viteAdminDir,
  },
  {
    title: "Version contract",
    command: "npm",
    args: ["run", "check:versions"],
    cwd: repoRoot,
  },
  {
    title: "Release scope fixtures",
    command: "npm",
    args: ["run", "check:release-scope"],
    cwd: repoRoot,
  },
  {
    title: "Frontend hardware audit fixture",
    command: "npm",
    args: ["run", "check:hardware-audit"],
    cwd: viteAdminDir,
  },
  {
    title: "Analysis cursor pagination fixture",
    command: "npm",
    args: ["run", "check:analysis-pagination"],
    cwd: viteAdminDir,
  },
  {
    title: "Frontend lint",
    command: "npm",
    args: ["run", "lint"],
    cwd: viteAdminDir,
  },
  {
    title: "Frontend production build",
    command: "npm",
    args: ["run", "build"],
    cwd: viteAdminDir,
  },
  {
    title: "Frontend bundle budgets",
    command: "npm",
    args: ["run", "check:bundle-budget"],
    cwd: repoRoot,
  },
  {
    title: "WordPress.org review rules",
    command: "node",
    args: ["scripts/check-wordpress-org-review-rules.mjs"],
    cwd: repoRoot,
  },
  {
    title: "Plugin regression fixtures",
    command: "npm",
    args: ["run", "check:fixtures"],
    cwd: repoRoot,
  },
  {
    title: "PHPStan",
    command: "composer",
    args: ["run", "phpstan"],
    cwd: repoRoot,
  },
  {
    title: "PHPCS",
    command: "composer",
    args: ["run", "phpcs"],
    cwd: repoRoot,
  },
  {
    title: "Desktop quality and dependency audit",
    command: "npm",
    args: ["run", "check:desktop-quality"],
    cwd: repoRoot,
  },
  {
    title: "Whitespace check",
    command: "git",
    args: ["diff", "--check"],
    cwd: repoRoot,
  },
];

for (const step of steps) {
  runStep(step);
}

const zipPaths = shouldCheckSubmissionPackage ? [releaseZip, submissionZip] : [releaseZip];

for (const zipPath of zipPaths) {
  if (!existsSync(zipPath)) {
    console.error(`Missing release package: ${path.relative(repoRoot, zipPath)}`);
    process.exit(1);
  }

  runStep({
    title: `Package structure: ${path.relative(repoRoot, zipPath)}`,
    command: "node",
    args: ["scripts/check-release-package.mjs", path.relative(repoRoot, zipPath)],
    cwd: repoRoot,
  });

  runStep({
    title: `WordPress.org review rules: ${path.relative(repoRoot, zipPath)}`,
    command: "node",
    args: ["scripts/check-wordpress-org-review-rules.mjs", path.relative(repoRoot, zipPath)],
    cwd: repoRoot,
  });

  await compareBuiltAssets(zipPath);
}

if (!shouldCheckSubmissionPackage && existsSync(submissionZip)) {
  console.error(`Unexpected submission package for release-only check: ${path.relative(repoRoot, submissionZip)}`);
  console.error("Run npm run build:release to keep only release/npcink-device-inventory.zip.");
  process.exit(1);
}

const releaseHash = sha256(releaseZip);

if (shouldCheckSubmissionPackage) {
  const submissionHash = sha256(submissionZip);
  if (releaseHash !== submissionHash) {
    console.error("Release packages differ.");
    console.error(`release: ${releaseHash}`);
    console.error(`sj:      ${submissionHash}`);
    process.exit(1);
  }
  await verifySubmissionManifest(submissionZip, submissionHash);
}

console.log("");
console.log("Release readiness check passed.");
console.log(`Package hash: ${releaseHash}`);

function runStep({ title, command, args, cwd }) {
  console.log("");
  console.log(`> ${title}`);
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
}

function sha256(filePath) {
  return execFileSync("shasum", ["-a", "256", filePath], { encoding: "utf8" })
    .trim()
    .split(/\s+/)[0];
}

async function compareBuiltAssets(zipPath) {
  // Verify every generated chunk, including dynamic imports and the build manifest.
  const builtAssetFiles = (await readdir(path.join(viteAdminDir, "dist"), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(repoRoot, path.join(entry.parentPath, entry.name)));
  for (const relativeFile of builtAssetFiles) {
    const localPath = path.join(repoRoot, relativeFile);
    if (!existsSync(localPath)) {
      console.error(`Missing built asset: ${relativeFile}`);
      process.exit(1);
    }

    const zipEntry = `${slug}/${relativeFile}`;
    const localContent = await readFile(localPath);
    const zipContent = execFileSync("unzip", ["-p", zipPath, zipEntry], {
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!localContent.equals(zipContent)) {
      console.error(`Package asset is stale: ${path.relative(repoRoot, zipPath)}:${zipEntry}`);
      console.error("Run npm run build:release and sync the generated zip before publishing.");
      process.exit(1);
    }
  }
}

async function verifySubmissionManifest(zipPath, zipHash) {
  const manifest = JSON.parse(await readFile(submissionManifest, "utf8"));
  const expected = manifest.package || {};
  const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
  const listedEntries = Array.from(
    listing.matchAll(/^\s*(\d+)\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/gm)
  );
  const actual = {
    sha256: zipHash,
    entry_count: entries.length,
    file_count: entries.filter((entry) => !entry.endsWith("/")).length,
    uncompressed_bytes: listedEntries.reduce((total, match) => total + Number(match[1]), 0),
    compressed_bytes: statSync(zipPath).size,
  };

  for (const [field, value] of Object.entries(actual)) {
    if (expected[field] !== value) {
      console.error(`Submission manifest mismatch for ${field}: expected=${expected[field]} actual=${value}`);
      process.exit(1);
    }
  }
  console.log("Submission package manifest matches the built zip.");
}
