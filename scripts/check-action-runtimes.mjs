import { readFile } from "node:fs/promises";
import path from "node:path";

const workflows = ["quality.yml", "preview.yml", "release.yml"];
const obsolete = [
  "actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
  "shivammathur/setup-php@bf6b4fbd49ca58e4608c9c89fba0b8d90bd2a39f",
];

for (const workflow of workflows) {
  const content = await readFile(path.join(".github/workflows", workflow), "utf8");
  for (const action of obsolete) {
    if (content.includes(action)) {
      console.error(`${workflow} still uses obsolete Node.js 20 action revision: ${action}`);
      process.exit(1);
    }
  }
}

console.log("GitHub Actions runtime check passed.");
