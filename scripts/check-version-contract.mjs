import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginFile = await read("npcink-device-inventory.php");
const readmeFile = await read("README.txt");
const desktopPackage = JSON.parse(await read("ele-rs/package.json"));
const tauriConfig = JSON.parse(await read("ele-rs/src-tauri/tauri.conf.json"));
const collectorManifest = await read("ele-rs/Cargo.toml");
const desktopManifest = await read("ele-rs/src-tauri/Cargo.toml");

const pluginVersion = pluginFile.match(/^[ \t*]*Version:\s*([^\s]+)/m)?.[1] || "";
const pluginConstant = pluginFile.match(/NPCINK_DEVICE_INVENTORY_VERSION',\s*'([^']+)'/)?.[1] || "";
const stableTag = readmeFile.match(/^Stable tag:\s*([^\s]+)/m)?.[1] || "";
assertEqual(pluginConstant, pluginVersion, "plugin version constant");
assertEqual(stableTag, pluginVersion, "README stable tag");

const desktopVersion = String(desktopPackage.version || "");
assertEqual(String(tauriConfig.version || ""), desktopVersion, "Tauri config version");
assertEqual(tomlVersion(collectorManifest), desktopVersion, "collector Cargo version");
assertEqual(tomlVersion(desktopManifest), desktopVersion, "desktop Cargo version");
const desktopLock = JSON.parse(await read("ele-rs/package-lock.json"));
assertEqual(desktopLock.version, desktopVersion, "desktop npm lock version");
assertEqual(desktopLock.packages?.[""]?.version, desktopVersion, "desktop npm root lock version");
const tauriRustLock = await read("ele-rs/src-tauri/Cargo.lock");
const tauriRustEntry = tauriRustLock.split("[[package]]").find((block) => block.includes('name = "tauri"\n'));
const tauriRustVersion = tomlVersion(tauriRustEntry || "");
const tauriApiVersion = desktopLock.packages?.["node_modules/@tauri-apps/api"]?.version || "";
assertEqual(tauriApiVersion.split(".").slice(0, 2).join("."), tauriRustVersion.split(".").slice(0, 2).join("."), "Tauri JS API / Rust major.minor");
assertEqual(desktopLock.packages?.[""]?.dependencies?.["@tauri-apps/api"], desktopPackage.dependencies?.["@tauri-apps/api"], "Tauri API npm dependency lock");
for (const [file, names] of [
  ["ele-rs/Cargo.lock", ["npcink-device-agent"]],
  ["ele-rs/src-tauri/Cargo.lock", ["npcink-device-agent", "npcink-device-agent-desktop"]],
]) {
  const lock = await read(file);
  for (const name of names) {
    const entry = lock.split("[[package]]").find((block) => block.includes(`name = "${name}"\n`));
    assertEqual(tomlVersion(entry || ""), desktopVersion, `${file} ${name} version`);
  }
}
const [collectorSource, windowsSmoke] = await Promise.all([
  read("ele-rs/src/collector/mod.rs"),
  read("ele-rs/scripts/windows-smoke-test.ps1"),
]);
const inventorySchema = collectorSource.match(/const INVENTORY_SCHEMA:\s*&str\s*=\s*"([^"]+)"/)?.[1] || "";
const smokeSchema = windowsSmoke.match(/\$payload\.collector\.schema -ne "([^"]+)"/)?.[1] || "";
assertEqual(smokeSchema, inventorySchema, "Windows smoke inventory schema");

const releaseTag = String(process.env.RELEASE_TAG || "").trim();
if (releaseTag) {
  assertEqual(releaseTag, `v${pluginVersion}`, "release tag");
}

console.log(`Version contract passed: plugin=${pluginVersion}, desktop=${desktopVersion}.`);

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

function tomlVersion(source) {
  return source.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || "";
}

function assertEqual(actual, expected, label) {
  if (!actual || actual !== expected) {
    console.error(`Version contract failed: ${label}=${actual || "missing"}, expected ${expected || "missing"}.`);
    process.exit(1);
  }
}
