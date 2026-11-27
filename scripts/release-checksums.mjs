import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export function parseChecksums(text) {
  const names = new Set();
  const entries = text.trim().split(/\r?\n/).map((line) => {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/);
    if (!match || names.has(match[2])) throw new Error("Invalid or duplicate SHA256SUMS entry");
    names.add(match[2]);
    return { hash: match[1], name: match[2] };
  });
  if (names.has("SHA256SUMS")) throw new Error("SHA256SUMS must not checksum itself");
  for (const required of ["npcink-device-inventory.zip", "latest.json", "latest-desktop.json", "candidate.json"]) {
    if (!names.has(required)) throw new Error(`Missing checksummed release asset: ${required}`);
  }
  return entries;
}

export async function verifyChecksums(dir) {
  const entries = parseChecksums(await readFile(path.join(dir, "SHA256SUMS"), "utf8"));
  const actualNames = (await readdir(dir)).sort();
  const expectedNames = [...entries.map((entry) => entry.name), "SHA256SUMS"].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error("Release asset list differs from SHA256SUMS");
  for (const entry of entries) {
    const actual = createHash("sha256").update(await readFile(path.join(dir, entry.name))).digest("hex");
    if (actual !== entry.hash) throw new Error(`Release asset hash mismatch: ${entry.name}`);
  }
  return entries;
}
