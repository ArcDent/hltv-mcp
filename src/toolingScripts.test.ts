import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readProjectFile(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("package exposes test and verify scripts", () => {
  const pkg = JSON.parse(readProjectFile("package.json")) as { scripts?: Record<string, string> };

  assert.equal(pkg.scripts?.test, "node scripts/run-tests.mjs");
  assert.equal(pkg.scripts?.verify, "npm run check && npm run build && npm test");
});

test("GitHub Actions verifies pull requests with npm ci", () => {
  const workflow = readProjectFile(".github/workflows/verify.yml");

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run verify/);
});
