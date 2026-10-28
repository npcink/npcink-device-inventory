import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// No shell or argument logging: upload credentials arrive through stdin only.
export async function runCommand(request) {
  const { file, args, stdout, stderr, timeout_ms: timeout } = request;
  if (typeof file !== "string" || !file || file.includes("\0") || !Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
      typeof stdout !== "string" || typeof stderr !== "string" || stdout === stderr ||
      !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3_600_000) {
    throw new Error("Invalid command request");
  }
  const started = performance.now();
  const out = createWriteStream(stdout);
  const err = createWriteStream(stderr);
  const streams = Promise.allSettled([finished(out), finished(err)]);
  const child = spawn(file, args, { shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let reason = "";
  let killTimer;
  let drainTimer;
  let outputBytes = 0;

  function stop(failure) {
    if (reason) return;
    reason = failure;
    if (process.platform === "win32" && child.pid) {
      // Wait for taskkill to enumerate the tree before killing its root.
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const fallback = () => { child.kill("SIGKILL"); };
      killer.once("error", fallback);
      killer.once("close", fallback);
      killTimer = setTimeout(() => { killer.kill(); fallback(); }, 5000);
    } else if (child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
    // Broken providers can leave inherited pipe handles open. Bound cleanup too.
    drainTimer = setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
      child.kill("SIGKILL");
    }, 8000);
  }

  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 64 * 1024 * 1024) {
        stop("output_limit");
        child.stdout.unpipe(out);
        child.stderr.unpipe(err);
      }
    });
    stream.on("error", () => stop("pipe_error"));
  }
  out.on("error", () => stop("log_write_error"));
  err.on("error", () => stop("log_write_error"));
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  const timer = setTimeout(() => stop("timeout"), timeout);
  const exit = await new Promise((resolve) => {
    child.once("error", () => { reason ||= "start_error"; });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  clearTimeout(killTimer);
  clearTimeout(drainTimer);
  out.end();
  err.end();
  const logs = await streams;
  if (logs.some((result) => result.status === "rejected")) reason ||= "log_write_error";
  return {
    exit_code: reason ? (exit.code || 1) : (exit.code ?? 1),
    timed_out: reason === "timeout",
    failure: reason || (exit.signal ? "terminated" : ""),
    wall_elapsed_ms: Math.round(performance.now() - started),
    output_bytes: outputBytes,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 131072) throw new Error("Command request too large");
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString("utf8");
    const result = await runCommand(JSON.parse(input.replace(/^\uFEFF/, "")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    // Do not echo the request or exception (either can contain credentials).
    process.stdout.write(`${JSON.stringify({ exit_code: 1, failure: "runner_error", timed_out: false })}\n`);
    process.exitCode = 1;
  }
}
