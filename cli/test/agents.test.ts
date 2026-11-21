import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAgentsNote } from "../src/index.js";

const repo = () => mkdtempSync(join(tmpdir(), "shelf-agents-"));

test("agents note: creates AGENTS.md when there's no agent file", () => {
  const root = repo();
  const r = addAgentsNote(root);
  assert.equal(r.action, "created");
  assert.equal(r.file, join(root, "AGENTS.md"));
  assert.match(readFileSync(r.file, "utf8"), /npx -y shelfready check/);
  rmSync(root, { recursive: true });
});

test("agents note: appends to CLAUDE.md when that's what the repo uses, once", () => {
  const root = repo();
  writeFileSync(join(root, "CLAUDE.md"), "# Notes\n\nUse tabs.\n");
  const r = addAgentsNote(root);
  assert.equal(r.action, "appended");
  assert.equal(r.file, join(root, "CLAUDE.md"));
  assert.ok(!existsSync(join(root, "AGENTS.md")));
  const text = readFileSync(r.file, "utf8");
  assert.ok(text.startsWith("# Notes\n\nUse tabs.\n\n<!-- shelfready -->"), text);
  assert.equal(addAgentsNote(root).action, "present");
  assert.equal(readFileSync(r.file, "utf8"), text, "idempotent");
  rmSync(root, { recursive: true });
});

test("agents note: prefers AGENTS.md when both exist", () => {
  const root = repo();
  writeFileSync(join(root, "CLAUDE.md"), "x\n");
  writeFileSync(join(root, "AGENTS.md"), "y\n");
  assert.equal(addAgentsNote(root).file, join(root, "AGENTS.md"));
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "x\n");
  rmSync(root, { recursive: true });
});
