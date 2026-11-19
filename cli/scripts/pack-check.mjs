// Packs the npm package for real and fails if required files are missing.
// Reads the tarball itself, so it doesn't depend on npm's --json output format (which changed in npm 12).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED = ["dist/cli.js", "dist/index.js", "knowledge/sdks/sentry-cocoa.yaml", "README.md", "LICENSE", "NOTICE", "package.json"];

const dir = mkdtempSync(join(tmpdir(), "shelfready-pack-"));
try {
  execFileSync("npm", ["pack", "--pack-destination", dir], { stdio: ["ignore", "ignore", "inherit"] });
  const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack produced no tarball");
  const files = execFileSync("tar", ["-tzf", join(dir, tarball)], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/^package\//, ""));
  const missing = REQUIRED.filter((f) => !files.includes(f));
  if (missing.length) {
    console.error(`npm package ${tarball} is missing: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`npm package contents ok: ${tarball}, ${files.length} files`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
