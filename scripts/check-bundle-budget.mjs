import { stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const budgets = [
  ["vite-admin/dist/index.js", 1_400_000],
  ["vite-admin/dist/exceljs.min.js", 1_000_000],
];

for (const [relative, limit] of budgets) {
  const file = path.join(root, relative);
  const size = (await stat(file)).size;
  if (size > limit) {
    throw new Error(`${relative} is ${size} bytes; budget is ${limit} bytes`);
  }
  console.log(`Bundle budget passed: ${relative} ${size}/${limit} bytes`);
}
