import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { needsDesktopRelease } from "./release-scope.mjs";

const releaseRef = String(process.env.RELEASE_TAG || process.env.RELEASE_REF || "").trim();

if (!releaseRef) {
  console.error("RELEASE_TAG or RELEASE_REF is required.");
  process.exit(1);
}

const previousTag = process.env.PREVIOUS_RELEASE_TAG || previousReleaseTag(releaseRef);
const changedPaths = previousTag ? changedFiles(previousTag, releaseRef) : [];
const desktop = !previousTag || needsDesktopRelease(changedPaths);
const mode = desktop ? "desktop" : "plugin";
const reason = !previousTag
  ? "no_previous_release_tag"
  : desktop
    ? "desktop_release_path_changed"
    : "plugin_only_changes";

writeOutput("desktop", String(desktop));
writeOutput("mode", mode);
writeOutput("previous_tag", previousTag || "");
writeOutput("reason", reason);

console.log(
  JSON.stringify(
    {
      releaseRef,
      previousTag: previousTag || null,
      mode,
      reason,
      changedPaths,
    },
    null,
    2
  )
);

function previousReleaseTag(ref) {
  try {
    return runGit(["describe", "--tags", "--abbrev=0", "--match", "v*", `${ref}^`]);
  } catch {
    return "";
  }
}

function changedFiles(previous, current) {
  const output = runGit(["diff", "--name-only", `${previous}..${current}`]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}
