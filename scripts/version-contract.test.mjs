import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("version gate rejects a Tauri API minor incompatible with the resolved Rust crate", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "npcink-version-gate-"));
  try {
    const files = [
      "scripts/check-version-contract.mjs", "npcink-device-inventory.php", "README.txt",
      "ele-rs/package.json", "ele-rs/package-lock.json", "ele-rs/Cargo.toml", "ele-rs/Cargo.lock",
      "ele-rs/src-tauri/tauri.conf.json", "ele-rs/src-tauri/Cargo.toml", "ele-rs/src-tauri/Cargo.lock",
      "ele-rs/src/collector/mod.rs", "ele-rs/scripts/windows-smoke-test.ps1",
    ];
    for (const file of files) {
      const dest = path.join(dir, file);
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(path.join(repo, file), dest);
    }
    const run = () => spawnSync(process.execPath, [path.join(dir, "scripts/check-version-contract.mjs")], { encoding: "utf8", env: { ...process.env, RELEASE_TAG: "" } });
    assert.equal(run().status, 0);
    const lockPath = path.join(dir, "ele-rs/package-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.packages["node_modules/@tauri-apps/api"].version = "2.11.1";
    await writeFile(lockPath, JSON.stringify(lock));
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Tauri JS API \/ Rust major.minor/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
