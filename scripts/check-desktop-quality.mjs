import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(repoRoot, "ele-rs");
const collectorManifest = path.join(desktopRoot, "Cargo.toml");
const tauriManifest = path.join(desktopRoot, "src-tauri/Cargo.toml");

const steps = [
  ["Desktop npm dependency audit", "npm", ["audit", "--audit-level=moderate"], desktopRoot],
  ["Desktop frontend build", "npm", ["run", "build"], desktopRoot],
  ["Collector format", "cargo", ["fmt", "--manifest-path", collectorManifest, "--", "--check"], repoRoot],
  ["Collector clippy", "cargo", ["clippy", "--locked", "--manifest-path", collectorManifest, "--all-targets", "--", "-D", "warnings"], repoRoot],
  ["Collector tests", "cargo", ["test", "--locked", "--manifest-path", collectorManifest], repoRoot],
  ["Desktop format", "cargo", ["fmt", "--manifest-path", tauriManifest, "--", "--check"], repoRoot],
  ["Desktop clippy", "cargo", ["clippy", "--locked", "--manifest-path", tauriManifest, "--all-targets", "--", "-D", "warnings"], repoRoot],
  ["Desktop tests", "cargo", ["test", "--locked", "--manifest-path", tauriManifest], repoRoot],
  ["Collector dependency audit", "cargo", ["audit", "--file", path.join(desktopRoot, "Cargo.lock")], repoRoot],
  // The collector audit just refreshed this database; use the same snapshot for
  // both lockfiles rather than introducing a second network fetch mid-gate.
  ["Desktop dependency audit (same freshly fetched database)", "cargo", ["audit", "--no-fetch", "--file", path.join(desktopRoot, "src-tauri/Cargo.lock")], repoRoot],
];

for (const [title, command, args, cwd] of steps) {
  console.log(`\n> ${title}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

console.log("\nDesktop quality checks passed.");
