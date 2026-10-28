import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const directory = path.join(process.cwd(), "vite-admin/dist");
const manifest = JSON.parse(await readFile(path.join(directory, ".vite/manifest.json"), "utf8"));
const sizes = new Map(await Promise.all(Object.entries(manifest).map(async ([key, chunk]) => [key, (await stat(path.join(directory, chunk.file))).size])));
const dependencies = (key, visited = new Set()) => {
  if (visited.has(key)) return visited;
  if (!manifest[key]) throw new Error(`Missing chunk in build manifest: ${key}`);
  visited.add(key);
  for (const dependency of manifest[key].imports || []) dependencies(dependency, visited);
  return visited;
};
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entry) throw new Error("Missing application entry in build manifest");
const shell = dependencies(entry);
const defaultWorkspace = dependencies("src/pages/assets/AssetWorkspace.tsx", new Set(shell));
const budgets = [
  ["Entry module", new Set([entry]), 100_000],
  ["Shell with static dependencies", shell, 500_000],
  ["Default asset workspace with shell", defaultWorkspace, 1_150_000],
  ["Excel export library", new Set(["node_modules/exceljs/dist/exceljs.min.js"]), 1_000_000],
  ["All JavaScript chunks", new Set(Object.keys(manifest)), 2_400_000],
];
for (const [label, keys, limit] of budgets) {
  const bytes = [...keys].reduce((total, key) => {
    if (!sizes.has(key)) throw new Error(`Missing budgeted chunk: ${key}`);
    return total + sizes.get(key);
  }, 0);
  if (bytes > limit) throw new Error(`${label}: ${bytes} bytes exceeds ${limit} bytes`);
  console.log(`Bundle budget passed: ${label} ${bytes}/${limit} bytes`);
}
