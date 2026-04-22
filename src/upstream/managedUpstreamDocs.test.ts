import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readProjectFile(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function extractMarkdownCodeBlocks(markdown: string): string[] {
  return Array.from(markdown.matchAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g), (match) => match[1] ?? "");
}

function hasRequiredStdinCleanupHandlers(indexTs: string): boolean {
  const hasStdinEndCleanup = /process\.stdin\.once\("end",[\s\S]*?stopManagedUpstreamOnce\(\)/.test(indexTs);
  const hasStdinCloseCleanup = /process\.stdin\.once\("close",[\s\S]*?stopManagedUpstreamOnce\(\)/.test(indexTs);

  return hasStdinEndCleanup && hasStdinCloseCleanup;
}

test(".env.example documents managed upstream defaults", () => {
  const envExample = readProjectFile(".env.example");

  assert.match(envExample, /^HLTV_UPSTREAM_MANAGED=true$/m);
  assert.match(envExample, /^HLTV_UPSTREAM_PORT=18020$/m);
  assert.match(envExample, /^HLTV_UPSTREAM_HEALTH_PATH=\/healthz$/m);
  assert.match(envExample, /^HLTV_UPSTREAM_WORKDIR=$/m);
  assert.match(envExample, /^HLTV_UPSTREAM_PYTHON_PATH=$/m);
  assert.doesNotMatch(envExample, /^HLTV_UPSTREAM_WORKDIR=hltv-api-fixed$/m);
  assert.doesNotMatch(envExample, /^HLTV_UPSTREAM_PYTHON_PATH=hltv-api-fixed\/env\/bin\/python$/m);
});

test("README documents managed upstream prerequisites and explicit external-mode fallback", () => {
  const readme = readProjectFile("README.md");
  const codeBlocksWithApiBaseUrl = extractMarkdownCodeBlocks(readme).filter((block) => block.includes("HLTV_API_BASE_URL"));

  assert.match(readme, /自动启动|自动拉起|auto\s*-?\s*start/i);
  assert.match(readme, /HLTV_UPSTREAM_MANAGED=false/);
  assert.match(readme, /hltv-api-fixed\/env\/bin\/python/);
  assert.match(readme, /运行\s*`npm run start`\s*前[\s\S]*hltv-api-fixed\/env\/bin\/python/);
  assert.match(readme, /不会自动创建|do\s+not\s+auto-?create/i);
  assert.match(readme, /HLTV_UPSTREAM_PYTHON_PATH[\s\S]*(覆盖|override)/i);
  assert.match(readme, /(不存在|missing)[\s\S]*(失败|fail\s*fast)/i);

  assert.ok(codeBlocksWithApiBaseUrl.length > 0, "expected README code snippets that include HLTV_API_BASE_URL");

  for (const codeBlock of codeBlocksWithApiBaseUrl) {
    const hasManagedDisabled =
      codeBlock.includes("HLTV_UPSTREAM_MANAGED=false") ||
      codeBlock.includes('"HLTV_UPSTREAM_MANAGED": "false"');

    assert.equal(
      hasManagedDisabled,
      true,
      `HLTV_API_BASE_URL snippet must explicitly disable managed mode:\n${codeBlock}`
    );
  }
});

test("index.ts includes explicit stdin shutdown cleanup for managed upstream", () => {
  const indexTs = readProjectFile("src/index.ts");

  assert.equal(
    hasRequiredStdinCleanupHandlers(indexTs),
    true,
    "expected managed-upstream cleanup to include both process.stdin end and close handlers"
  );

  const indexWithoutCloseCleanup = indexTs.replace(
    /process\.stdin\.once\("close", \(\) => \{\n\s*void stopManagedUpstreamOnce\(\);\n\s*\}\);\n?/m,
    ""
  );
  assert.notEqual(indexWithoutCloseCleanup, indexTs, "expected fixture to remove stdin close cleanup handler");
  assert.equal(
    hasRequiredStdinCleanupHandlers(indexWithoutCloseCleanup),
    false,
    "removing process.stdin close cleanup must fail the contract"
  );

  const indexWithoutEndCleanup = indexTs.replace(
    /process\.stdin\.once\("end", \(\) => \{\n\s*void stopManagedUpstreamOnce\(\);\n\s*\}\);\n?/m,
    ""
  );
  assert.notEqual(indexWithoutEndCleanup, indexTs, "expected fixture to remove stdin end cleanup handler");
  assert.equal(
    hasRequiredStdinCleanupHandlers(indexWithoutEndCleanup),
    false,
    "removing process.stdin end cleanup must fail the contract"
  );
});

test("index.ts wires abortable managed startup and registers shutdown hooks before startup begins", () => {
  const indexTs = readProjectFile("src/index.ts");

  assert.match(indexTs, /new AbortController\(\)/, "expected AbortController for in-flight managed startup");
  assert.match(indexTs, /managedStartupAbortController\.signal/, "expected managed startup signal to be passed");
  assert.match(indexTs, /managedStartupAbortController\?\.abort\(/, "expected shutdown to abort in-flight startup");

  const registerShutdownIndex = indexTs.indexOf("registerManagedShutdown(stopManagedUpstreamOnce);");
  const startManagedUpstreamIndex = indexTs.indexOf("startManagedUpstream(");

  assert.ok(registerShutdownIndex >= 0, "expected registerManagedShutdown call in index.ts");
  assert.ok(startManagedUpstreamIndex >= 0, "expected startManagedUpstream call in index.ts");
  assert.ok(
    registerShutdownIndex < startManagedUpstreamIndex,
    "expected shutdown hooks to register before startManagedUpstream() starts"
  );
});

test("AGENTS.md documents managed upstream default and external mode switch", () => {
  const agents = readProjectFile("AGENTS.md");

  assert.match(agents, /(default\s+managed\s+upstream|managed\s+upstream\s+is\s+the\s+default)/i);
  assert.match(agents, /HLTV_UPSTREAM_MANAGED=false/);
});

test("OpenCode templates and examples explicitly disable managed mode when using HLTV_API_BASE_URL", () => {
  const templateConfig = readProjectFile("docs/templates/opencode.jsonc");
  const exampleConfig = readProjectFile("examples/opencode-project/opencode.jsonc");
  const exampleReadme = readProjectFile("examples/opencode-project/README.md");

  assert.match(templateConfig, /"HLTV_UPSTREAM_MANAGED"\s*:\s*"false"/);
  assert.match(templateConfig, /"HLTV_API_BASE_URL"\s*:\s*"http:\/\/127\.0\.0\.1:8020"/);

  assert.match(exampleConfig, /"HLTV_UPSTREAM_MANAGED"\s*:\s*"false"/);
  assert.match(exampleConfig, /"HLTV_API_BASE_URL"\s*:\s*"http:\/\/127\.0\.0\.1:8020"/);

  assert.match(exampleReadme, /HLTV_UPSTREAM_MANAGED=false/);
  assert.match(exampleReadme, /HLTV_API_BASE_URL/);
  assert.match(exampleReadme, /hltv-api-fixed\/env\/bin\/python/);
  assert.match(exampleReadme, /(fail\s*fast|无法连上|无法连接)/i);
});
