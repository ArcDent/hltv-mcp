import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const upstreamRoot = path.join(projectRoot, "hltv-api-fixed");

test("vendored upstream source is present in the root repository", () => {
  for (const relativePath of ["app.py", "Makefile", "requirements.txt", "tests/test_routes.py"]) {
    assert.equal(
      existsSync(path.join(upstreamRoot, relativePath)),
      true,
      `missing vendored upstream file: ${relativePath}`
    );
  }
});
