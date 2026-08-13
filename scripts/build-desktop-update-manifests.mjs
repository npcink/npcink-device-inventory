import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.resolve(repoRoot, process.argv[2] || "artifacts");
const repo = process.env.GITHUB_REPOSITORY || process.env.RELEASE_REPOSITORY || "npcink/npcink-device-inventory";
const tag = process.env.TAG_NAME || process.env.RELEASE_TAG || "";

if (!tag) {
  console.error("TAG_NAME or RELEASE_TAG is required.");
  process.exit(1);
}

const desktopPackage = JSON.parse(await readFile(path.join(repoRoot, "ele-rs/package.json"), "utf8"));
const version = String(desktopPackage.version || "").trim();
if (!version) {
  console.error("Missing ele-rs/package.json version.");
  process.exit(1);
}

const files = await listFiles(artifactsDir);
const macDmg = findOne(files, (file) => file.endsWith(".dmg"));
const macUpdater = findOne(files, (file) => file.endsWith(".tar.gz"));
const winInstaller = findOne(files, (file) => file.endsWith(".exe"));

const platforms = {};
if (macUpdater) {
  platforms["darwin-aarch64"] = {
    signature: await readSignature(macUpdater),
    url: releaseAssetUrl(repo, tag, path.basename(macUpdater)),
  };
}
if (winInstaller) {
  platforms["windows-x86_64"] = {
    signature: await readSignature(winInstaller),
    url: releaseAssetUrl(repo, tag, path.basename(winInstaller)),
  };
}

if (!platforms["darwin-aarch64"] || !platforms["windows-x86_64"]) {
  console.error("Missing signed desktop updater artifacts for darwin-aarch64 or windows-x86_64.");
  console.error(JSON.stringify({ macUpdater, winInstaller, files: files.map((file) => path.relative(artifactsDir, file)) }, null, 2));
  process.exit(1);
}

const pubDate = new Date().toISOString();
const releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`;
const notes = `Npcink Device Agent ${version}. See ${releaseUrl}`;

await writeFile(
  path.join(artifactsDir, "latest.json"),
  `${JSON.stringify(
    {
      version,
      notes,
      pub_date: pubDate,
      platforms,
    },
    null,
    2
  )}\n`
);

await writeFile(
  path.join(artifactsDir, "latest-desktop.json"),
  `${JSON.stringify(
    {
      schema: "npcink-device-agent-updates-v1",
      version,
      notes,
      pubDate,
      releaseUrl,
      downloads: {
        macosAarch64: macDmg
          ? {
              label: "Mac Apple Silicon",
              url: releaseAssetUrl(repo, tag, path.basename(macDmg)),
            }
          : null,
        windowsX64: winInstaller
          ? {
              label: "Windows x64",
              url: releaseAssetUrl(repo, tag, path.basename(winInstaller)),
            }
          : null,
      },
    },
    null,
    2
  )}\n`
);

console.log(`Built desktop update manifests for ${version}`);

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

function findOne(candidates, predicate) {
  return candidates.filter(predicate).sort()[0] || "";
}

async function readSignature(file) {
  const signatureFile = `${file}.sig`;
  return (await readFile(signatureFile, "utf8")).trim();
}

function releaseAssetUrl(ownerRepo, releaseTag, fileName) {
  return `https://github.com/${ownerRepo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(releaseAssetName(fileName))}`;
}

function releaseAssetName(fileName) {
  return fileName.replace(/\s+/g, ".");
}
