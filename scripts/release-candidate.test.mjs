import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = path.dirname(fileURLToPath(import.meta.url));
test("draft and public downloads bind to the source commit and independent build proof", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "npcink-candidate-flow-"));
  try {
    const assets = path.join(root, "remote-assets");
    const proof = path.join(root, "original-build-proof");
    const bin = path.join(root, "bin");
    for (const dir of [assets, proof, bin, path.join(root, "ele-rs")]) await mkdir(dir);
    await writeFile(path.join(root, "ele-rs/package.json"), JSON.stringify({ version: "0.4.5" }));
    const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(["init"]);
    git(["add", "ele-rs/package.json"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Fixture candidate"]);
    git(["tag", "v3.2.4"]);
    const commit = git(["rev-parse", "HEAD"]);
    const env = { ...process.env, TAG_NAME: "v3.2.4", GITHUB_RUN_ID: "123", DESKTOP_RELEASE: "true", PREVIOUS_RELEASE_TAG: "v3.2.3", GITHUB_REPOSITORY: "fixture/project" };
    const run = (script, args, extra = {}) => spawnSync(process.execPath, [path.join(scripts, script), ...args], { cwd: root, env: { ...env, ...extra }, encoding: "utf8" });
    assert.equal(run("write-release-candidate.mjs", [assets]).status, 0);
    const candidate = JSON.parse(await readFile(path.join(assets, "candidate.json"), "utf8"));
    assert.equal(candidate.commit, commit);
    assert.equal(candidate.desktop_version, "0.4.5");
    for (const file of ["npcink-device-inventory.zip", "latest.json", "latest-desktop.json"]) await writeFile(path.join(assets, file), "fixture bytes");
    const checksums = () => {
      const result = run("write-release-checksums.mjs", [assets]);
      assert.equal(result.status, 0, result.stderr);
    };
    checksums();
    for (const name of ["SHA256SUMS", "candidate.json"]) await cp(path.join(assets, name), path.join(proof, name));
    // Emulate GitHub transport only; use real generation, git identities and
    // verification scripts. No external release is created or modified.
    const gh = `#!/usr/bin/env node
const fs=require('fs'), path=require('path');
const args=process.argv.slice(2), assets=process.env.FIXTURE_ASSETS, proof=process.env.FIXTURE_PROOF;
if(args[0]==='release' && args[1]==='view') console.log(JSON.stringify({isDraft:process.env.FIXTURE_DRAFT==='1',tagName:'v3.2.4',assets:fs.readdirSync(assets).map(name=>({name}))}));
else if(args[0]==='api') console.log(JSON.stringify({head_sha:process.env.FIXTURE_COMMIT,path:'.github/workflows/release.yml',event:'push',conclusion:'success'}));
else if(args[1]==='download') { const src=args[0]==='run'?proof:assets, dest=args[args.indexOf('--dir')+1]; for(const name of fs.readdirSync(src)) fs.copyFileSync(path.join(src,name),path.join(dest,name)); }
else process.exit(3);
`;
    await writeFile(path.join(bin, "gh"), gh, { mode: 0o755 });
    const hook = path.join(root, "local-download.mjs");
    await writeFile(hook, `import {readFile} from 'node:fs/promises'; import path from 'node:path'; globalThis.fetch = async (url) => new Response(await readFile(path.join(process.env.FIXTURE_ASSETS, decodeURIComponent(new URL(url).pathname.split('/').pop()))));`);
    const transport = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FIXTURE_ASSETS: assets, FIXTURE_PROOF: proof, FIXTURE_COMMIT: commit, FIXTURE_DRAFT: "1", NODE_OPTIONS: `--import=${hook}` };
    const draft = run("verify-published-release.mjs", ["draft-download", "--draft"], transport);
    assert.equal(draft.status, 0, draft.stderr);
    transport.FIXTURE_DRAFT = "0";
    const published = run("verify-published-release.mjs", ["public-download"], transport);
    assert.equal(published.status, 0, published.stderr);
    await writeFile(path.join(assets, "npcink-device-inventory.zip"), "replaced plugin with updated checksums");
    checksums();
    const replaced = run("verify-published-release.mjs", ["replaced-download"], transport);
    assert.notEqual(replaced.status, 0);
    assert.match(replaced.stderr, /differs from the original candidate build proof/);
    candidate.commit = "0".repeat(40);
    await writeFile(path.join(assets, "candidate.json"), JSON.stringify(candidate));
    checksums();
    const wrongSource = run("verify-published-release.mjs", ["wrong-source", "--draft"], { ...transport, FIXTURE_DRAFT: "1" });
    assert.notEqual(wrongSource.status, 0);
    assert.match(wrongSource.stderr, /does not match release tag\/commit/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
