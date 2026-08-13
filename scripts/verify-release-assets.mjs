import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.resolve(repoRoot, process.argv[2] || "artifacts");

const files = await listFiles(assetsDir);
const byName = new Map();
for (const file of files) {
  const name = path.basename(file);
  if (byName.has(name)) fail(`Duplicate release asset name: ${name}`);
  byName.set(name, file);
}

const latest = await readJson(required("latest.json"));
const latestDesktop = await readJson(required("latest-desktop.json"));
const pluginZip = required("npcink-device-inventory.zip");
const mac = platformAsset(latest, "darwin-aarch64", ".tar.gz");
const windows = platformAsset(latest, "windows-x86_64", ".exe");

downloadAsset(latestDesktop, "macosAarch64", ".dmg");
downloadAsset(latestDesktop, "windowsX64", ".exe");
assertManifestSignature(mac);
assertManifestSignature(windows);

execFileSync("unzip", ["-t", pluginZip], { stdio: "inherit" });

const tempDir = await mkdtemp(path.join(os.tmpdir(), "npcink-updater-key-"));
try {
  const config = await readJson(path.join(repoRoot, "ele-rs/src-tauri/tauri.conf.json"));
  const encodedKey = String(config?.plugins?.updater?.pubkey || "").trim();
  if (!encodedKey) fail("Missing updater public key in tauri.conf.json.");
  const publicKeyFile = path.join(tempDir, "updater.pub");
  await writeFile(publicKeyFile, Buffer.from(encodedKey, "base64"));

  await verifySignature(publicKeyFile, mac.file, mac.signatureFile, tempDir);
  await verifySignature(publicKeyFile, windows.file, windows.signatureFile, tempDir);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("Release asset integrity checks passed.");

function required(name) {
  const file = byName.get(name);
  if (!file) fail(`Missing release asset: ${name}`);
  return file;
}

function platformAsset(manifest, platform, suffix) {
  const entry = manifest?.platforms?.[platform];
  if (!entry) fail(`Missing updater platform: ${platform}`);
  const name = assetName(entry.url, suffix, `latest.json ${platform}`);
  return {
    file: required(name),
    signatureFile: required(`${name}.sig`),
    manifestSignature: String(entry.signature || "").trim(),
  };
}

function downloadAsset(manifest, key, suffix) {
  const entry = manifest?.downloads?.[key];
  if (!entry) fail(`Missing desktop download: ${key}`);
  required(assetName(entry.url, suffix, `latest-desktop.json ${key}`));
}

function assetName(url, suffix, label) {
  let name;
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    fail(`${label} contains an invalid URL: ${url}`);
  }
  if (!name.endsWith(suffix)) fail(`${label} must reference a ${suffix} asset: ${name}`);
  return name;
}

async function assertManifestSignature(asset) {
  if (!asset.manifestSignature) fail(`Missing manifest signature for ${path.basename(asset.file)}`);
  const signature = (await readFile(asset.signatureFile, "utf8")).trim();
  if (signature !== asset.manifestSignature) {
    fail(`Manifest signature does not match ${path.basename(asset.signatureFile)}`);
  }
}

async function verifySignature(publicKeyFile, file, signatureFile, tempDir) {
  const encodedSignature = (await readFile(signatureFile, "utf8")).trim();
  const decodedSignatureFile = path.join(tempDir, `${path.basename(signatureFile)}.minisig`);
  await writeFile(decodedSignatureFile, Buffer.from(encodedSignature, "base64"));
  execFileSync(
    "minisign",
    ["-V", "-p", publicKeyFile, "-m", file, "-x", decodedSignatureFile, "-q"],
    { stdio: "inherit" }
  );
  console.log(`Verified updater signature: ${path.basename(file)}`);
}

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

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
