import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCommand } from "./windows-command-runner.mjs";

async function withReport(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "npcink-smoke-中文-"));
  try {
    await run({ file: process.execPath, args: [], stdout: path.join(dir, "stdout.json"), stderr: path.join(dir, "stderr.txt"), timeout_ms: 5000 }, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("preserves UTF-8, stderr and argument boundaries without executing shell characters", () => withReport(async (request) => {
  const args = ["中文路径\\", "single'quote", 'double"quote', "space and & $(echo nope)", ""];
  request.args = ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1))); process.stderr.write('正常诊断：16 GB × 2');", "--", ...args];
  const result = await runCommand(request);
  assert.equal(result.exit_code, 0);
  assert.deepEqual(JSON.parse(await readFile(request.stdout, "utf8")), args);
  assert.equal(await readFile(request.stderr, "utf8"), "正常诊断：16 GB × 2");
}));

test("retains native failure code, startup error and partial logs", () => withReport(async (request) => {
  request.args = ["-e", "process.stdout.write('partial'); process.stderr.write('failure'); process.exit(7)"];
  assert.equal((await runCommand(request)).exit_code, 7);
  assert.equal(await readFile(request.stdout, "utf8"), "partial");
  request.file = path.join(os.tmpdir(), "npcink-command-does-not-exist");
  const missing = await runCommand(request);
  assert.notEqual(missing.exit_code, 0);
  assert.equal(missing.failure, "start_error");
}));

test("timeout preserves emitted data and terminates descendants", () => withReport(async (request, dir) => {
  const marker = path.join(dir, "orphan-ran.txt");
  const childSource = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'leaked'), 2500); setInterval(() => {}, 1000)`;
  const script = path.join(dir, "parent.cjs");
  await writeFile(script, `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], {stdio:'inherit'}); process.stdout.write('before timeout'); setInterval(() => {}, 1000);`);
  request.args = [script];
  request.timeout_ms = 1000;
  const result = await runCommand(request);
  assert.equal(result.failure, "timeout");
  assert.equal(result.timed_out, true);
  assert.notEqual(result.exit_code, 0);
  assert.ok(result.wall_elapsed_ms < 12000);
  assert.equal(await readFile(request.stdout, "utf8"), "before timeout");
  await new Promise((resolve) => setTimeout(resolve, 2800));
  await assert.rejects(readFile(marker), { code: "ENOENT" });
}));
