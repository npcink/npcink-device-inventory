import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseChecksums, verifyChecksums } from "./release-checksums.mjs";

test("rejects unsafe, duplicate and incomplete checksum entries", () => {
  const hash = "a".repeat(64);
  for (const name of ["../bad", "..\\bad", "/bad", "a b", "SHA256SUMS"]) assert.throws(() => parseChecksums(`${hash}  ${name}`));
  assert.throws(() => parseChecksums(`${hash}  file\n${hash}  file`));
  assert.throws(() => parseChecksums(`${hash}  latest.json`));
});

test("accepts the exact candidate set and rejects tampered or extra assets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "npcink-release-hashes-"));
  try {
    const files = ["npcink-device-inventory.zip", "latest.json", "latest-desktop.json", "candidate.json"];
    const lines = [];
    for (const file of files) {
      await writeFile(path.join(dir, file), file);
      lines.push(`${createHash("sha256").update(file).digest("hex")}  ${file}`);
    }
    await writeFile(path.join(dir, "SHA256SUMS"), lines.join("\n") + "\n");
    assert.equal((await verifyChecksums(dir)).length, 4);
    await writeFile(path.join(dir, "latest.json"), "changed");
    await assert.rejects(verifyChecksums(dir), /hash mismatch/);
    await writeFile(path.join(dir, "latest.json"), "latest.json");
    await writeFile(path.join(dir, "extra.exe"), "unverified");
    await assert.rejects(verifyChecksums(dir), /asset list/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
