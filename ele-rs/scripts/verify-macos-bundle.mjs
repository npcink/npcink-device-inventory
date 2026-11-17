import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || !process.argv[2]) {
  throw new Error("Run on macOS: npm run check:macos-bundle -- <installer.dmg>");
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(desktopRoot, "src-tauri/tauri.conf.json"), "utf8"));
const dmg = path.resolve(process.argv[2]);
const run = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const mountPoint = await mkdtemp(path.join(os.tmpdir(), "npcink-macos-verify-"));
let mounted = false;

try {
  run("hdiutil", ["verify", dmg]);
  run("hdiutil", ["attach", dmg, "-readonly", "-nobrowse", "-mountpoint", mountPoint]);
  mounted = true;
  const apps = (await readdir(mountPoint)).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw new Error("Expected exactly one application in the disk image");
  const app = path.join(mountPoint, apps[0]);
  const info = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")]));
  if (info.CFBundleIdentifier !== config.identifier || info.CFBundleShortVersionString !== config.version) {
    throw new Error("Bundle identifier/version does not match current source configuration");
  }
  const architectures = run("lipo", ["-archs", path.join(app, "Contents/MacOS", info.CFBundleExecutable)]);
  if (architectures !== "arm64") throw new Error(`Expected Apple Silicon arm64, received ${architectures}`);
  // A linker-only signature can verify the binary while leaving the app bundle
  // unsealed. Require the resource envelope and validate the complete bundle.
  await access(path.join(app, "Contents/_CodeSignature/CodeResources")).catch(() => {
    throw new Error("App bundle has no sealed resource signature (linker-only signing is insufficient)");
  });
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const signature = spawnSync("codesign", ["-dv", "--verbose=4", app], { encoding: "utf8" });
  if (signature.status !== 0) throw new Error(signature.stderr || "Cannot read code signature");
  if (!signature.stderr.split("\n").includes(`Identifier=${config.identifier}`)) {
    throw new Error("Code signature identifier does not match the application bundle");
  }
  const assessment = spawnSync("spctl", ["--assess", "--type", "execute", "--verbose=2", app], { encoding: "utf8" });
  if (assessment.error) throw assessment.error;
  // A complete ad-hoc signature proves integrity, not Developer ID trust.
  // Report Gatekeeper rejection separately; never describe it as acceptance.
  console.log(JSON.stringify({
    file: path.basename(dmg),
    version: info.CFBundleShortVersionString,
    identifier: info.CFBundleIdentifier,
    architectures,
    sha256: createHash("sha256").update(await readFile(dmg)).digest("hex"),
    diskImageVerified: true,
    bundleSignatureVerified: true,
    signature: signature.stderr.includes("Signature=adhoc") ? "ad-hoc" : "certificate",
    gatekeeperAccepted: assessment.status === 0,
    gatekeeperAssessment: (assessment.stderr || assessment.stdout).trim().replaceAll(app, apps[0]),
  }, null, 2));
} finally {
  if (mounted) run("hdiutil", ["detach", mountPoint]);
  await rmdir(mountPoint);
}
