# Managed Upstream Autostart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TypeScript MCP server automatically start and stop the bundled Python HLTV upstream so users no longer have to launch the upstream manually.

**Architecture:** Track `hltv-api-fixed/` inside the root repository, add a small Python `/healthz` and env-driven launch configuration, then add a TypeScript upstream lifecycle layer that starts the child process before MCP stdio transport is exposed. Keep the existing HTTP boundary and tool/facade/renderer stack intact, with `HLTV_UPSTREAM_MANAGED=false` preserving the old external-upstream mode.

**Tech Stack:** TypeScript (Node 18+, `node:test`, `tsx`), Flask, existing `hltv-api-fixed` pytest/Makefile workflow, MCP SDK stdio transport.

---

## File Structure

- Create: `src/upstream/vendoredUpstreamLayout.test.ts` — guards that `hltv-api-fixed/` is tracked in the root repo.
- Create/Track: `hltv-api-fixed/**` — vendored Python upstream source copied into the root repo, excluding nested `.git`, `.opencode`, and local env/cache artifacts.
- Modify: `hltv-api-fixed/app.py` — add `/healthz` and environment-driven runtime options.
- Create: `hltv-api-fixed/tests/test_app_runtime.py` — tests runtime host/port/debug option parsing.
- Modify: `hltv-api-fixed/tests/test_routes.py` — adds `/healthz` route test.
- Modify: `src/config/env.ts` — parse managed-upstream settings and derive managed base URL defaults.
- Create: `src/config/env.test.ts` — config contract tests for managed and external modes.
- Create: `src/upstream/types.ts` — managed-upstream runtime contracts.
- Create: `src/upstream/startupError.ts` — startup-specific error class.
- Create: `src/upstream/pythonLocator.ts` — resolves and validates the interpreter path.
- Create: `src/upstream/port.ts` — port-availability and health-probe helpers.
- Create: `src/upstream/healthcheck.ts` — readiness polling.
- Create: `src/upstream/processManager.ts` — child-process spawn and cleanup.
- Create: `src/upstream/managedUpstream.ts` — orchestration entrypoint used by `src/index.ts`.
- Create: `src/upstream/managedUpstream.test.ts` — lifecycle tests using a fake child process.
- Create: `src/upstream/test-fixtures/fakeUpstreamServer.mjs` — lightweight fake upstream used by TypeScript tests.
- Modify: `src/index.ts` — start/stop managed upstream during MCP startup/shutdown.
- Create: `src/upstream/managedUpstreamDocs.test.ts` — verifies `.env.example`, `README.md`, and `AGENTS.md` document the new default.
- Modify: `.env.example` — document managed-upstream env vars and defaults.
- Modify: `README.md` — document autostart as the default path.
- Modify: `AGENTS.md` — update repo instructions for managed upstream.

## Pre-flight For Python Verification

If `hltv-api-fixed/env/bin/python` does not exist inside the worktree, create it before running any Python verification command:

```bash
python3 -m venv "hltv-api-fixed/env" && "hltv-api-fixed/env/bin/pip" install -r "hltv-api-fixed/requirements.txt"
```

This is a local development prerequisite only. The shipped feature must still fail fast when the venv is missing at runtime.

---

### Task 1: Vendor `hltv-api-fixed/` Into The Root Repository

**Files:**
- Create: `src/upstream/vendoredUpstreamLayout.test.ts`
- Create/Track: `hltv-api-fixed/app.py`
- Create/Track: `hltv-api-fixed/Makefile`
- Create/Track: `hltv-api-fixed/requirements.txt`
- Create/Track: `hltv-api-fixed/routes/**`
- Create/Track: `hltv-api-fixed/tests/**`
- Create/Track: `hltv-api-fixed/hltv_scraper/**`

- [ ] **Step 1: Write the failing repository-layout guard test**

```ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const upstreamRoot = path.join(projectRoot, "hltv-api-fixed");

test("vendored upstream source is present in the root repository", () => {
  for (const relativePath of [
    "app.py",
    "Makefile",
    "requirements.txt",
    "tests/test_routes.py"
  ]) {
    assert.equal(
      existsSync(path.join(upstreamRoot, relativePath)),
      true,
      `missing vendored upstream file: ${relativePath}`
    );
  }
});
```

- [ ] **Step 2: Run the guard test to verify it fails in the clean worktree**

Run: `node --import tsx --test src/upstream/vendoredUpstreamLayout.test.ts`

Expected: FAIL with an assertion that `hltv-api-fixed/app.py` or another required file is missing.

- [ ] **Step 3: Copy the upstream source into the worktree and strip nested-repo metadata**

```bash
mkdir -p "hltv-api-fixed" && rsync -a \
  --exclude '.git/' \
  --exclude '.opencode/' \
  --exclude 'env/' \
  --exclude '__pycache__/' \
  "/home/arcdent/github/hltv-mcp/hltv-api-fixed/" \
  "hltv-api-fixed/"
```

Then verify the nested repo metadata is gone:

```bash
test ! -e "hltv-api-fixed/.git" && test ! -e "hltv-api-fixed/.opencode"
```

- [ ] **Step 4: Run the guard test again to verify it passes**

Run: `node --import tsx --test src/upstream/vendoredUpstreamLayout.test.ts`

Expected: PASS with 1/1 test passing.

- [ ] **Step 5: Commit the vendored source baseline**

```bash
git add src/upstream/vendoredUpstreamLayout.test.ts hltv-api-fixed
git commit -m "chore: vendor hltv upstream source"
```

---

### Task 2: Add Python Healthcheck And Runtime Launch Options

**Files:**
- Modify: `hltv-api-fixed/app.py`
- Create: `hltv-api-fixed/tests/test_app_runtime.py`
- Modify: `hltv-api-fixed/tests/test_routes.py`

- [ ] **Step 1: Write the failing runtime-option and health route tests**

Create `hltv-api-fixed/tests/test_app_runtime.py` with:

```py
import app as app_module


def test_read_runtime_options_defaults(monkeypatch):
    monkeypatch.delenv("HLTV_UPSTREAM_HOST", raising=False)
    monkeypatch.delenv("HLTV_UPSTREAM_PORT", raising=False)
    monkeypatch.delenv("HLTV_UPSTREAM_DEBUG", raising=False)

    assert app_module.read_runtime_options() == {
        "host": "127.0.0.1",
        "port": 18020,
        "debug": False,
    }


def test_read_runtime_options_from_env(monkeypatch):
    monkeypatch.setenv("HLTV_UPSTREAM_HOST", "0.0.0.0")
    monkeypatch.setenv("HLTV_UPSTREAM_PORT", "19001")
    monkeypatch.setenv("HLTV_UPSTREAM_DEBUG", "true")

    assert app_module.read_runtime_options() == {
        "host": "0.0.0.0",
        "port": 19001,
        "debug": True,
    }
```

Add this test method to `hltv-api-fixed/tests/test_routes.py` inside `TestRoutesEndpoints`:

```py
    def test_healthz_endpoint(self, client):
        response = client.get("/healthz")

        assert response.status_code == 200
        assert json.loads(response.data) == {"status": "ok"}
```

- [ ] **Step 2: Run the targeted Python tests to verify they fail**

Run: `./env/bin/python -m pytest tests/test_app_runtime.py tests/test_routes.py::TestRoutesEndpoints::test_healthz_endpoint -v`

Workdir: `hltv-api-fixed`

Expected: FAIL because `read_runtime_options` does not exist and `/healthz` is not registered.

- [ ] **Step 3: Implement runtime option parsing and `/healthz` in `hltv-api-fixed/app.py`**

Replace `hltv-api-fixed/app.py` with this structure:

```py
import os

from flask import Flask, jsonify
from flasgger import Swagger


def read_runtime_options():
    raw_port = os.getenv("HLTV_UPSTREAM_PORT", "18020")

    try:
        port = int(raw_port)
    except ValueError:
        port = 18020

    return {
        "host": os.getenv("HLTV_UPSTREAM_HOST", "127.0.0.1"),
        "port": port,
        "debug": os.getenv("HLTV_UPSTREAM_DEBUG", "").lower() in {"1", "true", "yes", "on"},
    }


def create_app():
    app = Flask(__name__)
    app.json.sort_keys = False  # type: ignore
    Swagger(app)

    @app.get("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    from routes.teams import teams_bp
    from routes.players import players_bp
    from routes.matches import matches_bp
    from routes.news import news_bp
    from routes.results import results_bp

    app.register_blueprint(teams_bp)
    app.register_blueprint(players_bp)
    app.register_blueprint(matches_bp)
    app.register_blueprint(news_bp)
    app.register_blueprint(results_bp)

    return app


flask_app = create_app()


if __name__ == "__main__":
    runtime = read_runtime_options()
    flask_app.run(
        debug=runtime["debug"],
        host=runtime["host"],
        port=runtime["port"],
    )
```

- [ ] **Step 4: Run the targeted tests, then the Python unit suite**

Run: `./env/bin/python -m pytest tests/test_app_runtime.py tests/test_routes.py::TestRoutesEndpoints::test_healthz_endpoint -v && make test-unit`

Workdir: `hltv-api-fixed`

Expected: PASS for the two new tests and PASS for the existing route unit suite.

- [ ] **Step 5: Commit the Python runtime changes**

```bash
git add hltv-api-fixed/app.py hltv-api-fixed/tests/test_app_runtime.py hltv-api-fixed/tests/test_routes.py
git commit -m "feat: add managed upstream health endpoint"
```

---

### Task 3: Parse Managed-Upstream Config In TypeScript

**Files:**
- Modify: `src/config/env.ts`
- Create: `src/config/env.test.ts`

- [ ] **Step 1: Write the failing config-contract tests**

Create `src/config/env.test.ts` with:

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./env.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("managed upstream defaults to the vendored local service", () => {
  const config = loadConfig({});

  assert.equal(config.managedUpstreamEnabled, true);
  assert.equal(config.hltvApiBaseUrl, "http://127.0.0.1:18020/");
  assert.deepEqual(config.hltvApiBaseUrls, ["http://127.0.0.1:18020/"]);
  assert.equal(config.managedUpstreamHost, "127.0.0.1");
  assert.equal(config.managedUpstreamPort, 18020);
  assert.equal(config.managedUpstreamHealthPath, "/healthz");
  assert.equal(
    config.managedUpstreamWorkdir,
    path.join(projectRoot, "hltv-api-fixed")
  );
  assert.equal(
    config.managedUpstreamPythonPath,
    path.join(projectRoot, "hltv-api-fixed", "env", "bin", "python")
  );
});

test("external mode preserves configured upstream URLs", () => {
  const config = loadConfig({
    HLTV_UPSTREAM_MANAGED: "false",
    HLTV_API_BASE_URL: "http://127.0.0.1:8020",
    HLTV_API_FALLBACK_BASE_URL: "http://172.22.224.1:8020"
  });

  assert.equal(config.managedUpstreamEnabled, false);
  assert.deepEqual(config.hltvApiBaseUrls, [
    "http://127.0.0.1:8020/",
    "http://172.22.224.1:8020/"
  ]);
});
```

- [ ] **Step 2: Run the config tests to verify they fail**

Run: `node --import tsx --test src/config/env.test.ts`

Expected: FAIL because the new config fields do not exist and the base URL still defaults to port 8020.

- [ ] **Step 3: Implement managed-upstream parsing in `src/config/env.ts`**

Add the new `AppConfig` fields and helpers using this structure:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function readManagedBaseUrl(host: string, port: number): string {
  return normalizeBaseUrl(`http://${host}:${port}`);
}

export interface AppConfig {
  mcpServerName: string;
  mcpServerVersion: string;
  hltvApiBaseUrl: string;
  hltvApiBaseUrls: string[];
  hltvApiTimeoutMs: number;
  managedUpstreamEnabled: boolean;
  managedUpstreamPythonPath: string;
  managedUpstreamWorkdir: string;
  managedUpstreamHost: string;
  managedUpstreamPort: number;
  managedUpstreamHealthPath: string;
  managedUpstreamStartTimeoutMs: number;
  defaultTimezone: string;
  defaultResultLimit: number;
  summaryMode: SummaryMode;
  entityCacheTtlSec: number;
  teamRecentCacheTtlSec: number;
  playerRecentCacheTtlSec: number;
  resultsCacheTtlSec: number;
  matchesCacheTtlSec: number;
  newsCacheTtlSec: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const managedUpstreamEnabled = readBoolean(env.HLTV_UPSTREAM_MANAGED, true);
  const managedUpstreamHost = readString(env.HLTV_UPSTREAM_HOST, "127.0.0.1");
  const managedUpstreamPort = readNumber(env.HLTV_UPSTREAM_PORT, 18020);
  const managedUpstreamHealthPath = readString(env.HLTV_UPSTREAM_HEALTH_PATH, "/healthz");
  const managedUpstreamStartTimeoutMs = readNumber(env.HLTV_UPSTREAM_START_TIMEOUT_MS, 15_000);
  const managedUpstreamWorkdir = path.resolve(
    readString(env.HLTV_UPSTREAM_WORKDIR, path.join(REPO_ROOT, "hltv-api-fixed"))
  );
  const managedUpstreamPythonPath = path.resolve(
    readString(
      env.HLTV_UPSTREAM_PYTHON,
      path.join(managedUpstreamWorkdir, "env", "bin", "python")
    )
  );

  const hltvApiBaseUrls = managedUpstreamEnabled
    ? [readManagedBaseUrl(managedUpstreamHost, managedUpstreamPort)]
    : buildHltvApiBaseUrls(env);

  return {
    mcpServerName: readString(env.MCP_SERVER_NAME, "hltv-mcp-service"),
    mcpServerVersion: readString(env.MCP_SERVER_VERSION, "0.2.0"),
    hltvApiBaseUrl: hltvApiBaseUrls[0] ?? normalizeBaseUrl("http://127.0.0.1:18020"),
    hltvApiBaseUrls,
    hltvApiTimeoutMs: readNumber(env.HLTV_API_TIMEOUT_MS, 8_000),
    managedUpstreamEnabled,
    managedUpstreamPythonPath,
    managedUpstreamWorkdir,
    managedUpstreamHost,
    managedUpstreamPort,
    managedUpstreamHealthPath,
    managedUpstreamStartTimeoutMs,
    defaultTimezone: readString(env.DEFAULT_TIMEZONE, "Asia/Shanghai"),
    defaultResultLimit: readNumber(env.DEFAULT_RESULT_LIMIT, 5),
    summaryMode: readSummaryMode(env.SUMMARY_MODE),
    entityCacheTtlSec: readNumber(env.ENTITY_CACHE_TTL_SEC, 3_600),
    teamRecentCacheTtlSec: readNumber(env.TEAM_RECENT_CACHE_TTL_SEC, 300),
    playerRecentCacheTtlSec: readNumber(env.PLAYER_RECENT_CACHE_TTL_SEC, 300),
    resultsCacheTtlSec: readNumber(env.RESULTS_CACHE_TTL_SEC, 120),
    matchesCacheTtlSec: readNumber(env.MATCHES_CACHE_TTL_SEC, 60),
    newsCacheTtlSec: readNumber(env.NEWS_CACHE_TTL_SEC, 180)
  };
}
```

- [ ] **Step 4: Run the config test and the existing `/match` regression test**

Run: `node --import tsx --test src/config/env.test.ts src/matchCommandFlow.test.ts`

Expected: PASS for both files.

- [ ] **Step 5: Commit the config changes**

```bash
git add src/config/env.ts src/config/env.test.ts
git commit -m "feat: add managed upstream config"
```

---

### Task 4: Implement The Managed-Upstream Lifecycle Layer

**Files:**
- Create: `src/upstream/types.ts`
- Create: `src/upstream/startupError.ts`
- Create: `src/upstream/pythonLocator.ts`
- Create: `src/upstream/port.ts`
- Create: `src/upstream/healthcheck.ts`
- Create: `src/upstream/processManager.ts`
- Create: `src/upstream/managedUpstream.ts`
- Create: `src/upstream/managedUpstream.test.ts`
- Create: `src/upstream/test-fixtures/fakeUpstreamServer.mjs`

- [ ] **Step 1: Write the failing lifecycle tests and fake child fixture**

Create `src/upstream/test-fixtures/fakeUpstreamServer.mjs` with:

```js
import http from "node:http";

const host = process.env.HLTV_UPSTREAM_HOST ?? "127.0.0.1";
const port = Number(process.env.HLTV_UPSTREAM_PORT ?? "18020");
const healthPath = process.env.HLTV_UPSTREAM_HEALTH_PATH ?? "/healthz";
const mode = process.env.FAKE_UPSTREAM_MODE ?? "serve";

if (mode === "exit-immediately") {
  process.stderr.write("exiting before ready\n");
  process.exit(1);
}

const startupDelayMs = Number(process.env.FAKE_UPSTREAM_DELAY_MS ?? "0");

setTimeout(() => {
  const server = http.createServer((request, response) => {
    if (request.url === healthPath) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  server.listen(port, host, () => {
    process.stderr.write(`fake upstream listening on ${host}:${port}\n`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}, startupDelayMs);
```

Create `src/upstream/managedUpstream.test.ts` with:

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startManagedUpstream } from "./managedUpstream.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures");

function nextPort(seed: number): number {
  return 19000 + seed;
}

test("startManagedUpstream rejects a missing interpreter path", async () => {
  await assert.rejects(
    () =>
      startManagedUpstream({
        enabled: true,
        pythonPath: "/tmp/does-not-exist-python",
        workingDirectory: fixturesDir,
        appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
        host: "127.0.0.1",
        port: nextPort(1),
        startTimeoutMs: 1_000,
        healthPath: "/healthz",
        requestTimeoutMs: 250
      }),
    /python/i
  );
});

test("startManagedUpstream starts a managed child and stops it idempotently", async () => {
  const handle = await startManagedUpstream(
    {
      enabled: true,
      pythonPath: process.execPath,
      workingDirectory: fixturesDir,
      appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
      host: "127.0.0.1",
      port: nextPort(2),
      startTimeoutMs: 3_000,
      healthPath: "/healthz",
      requestTimeoutMs: 250
    },
    {
      ...process.env,
      FAKE_UPSTREAM_MODE: "serve"
    }
  );

  const response = await fetch(`${handle.baseUrl}healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });

  await handle.stop();
  await handle.stop();
});

test("startManagedUpstream surfaces early child exit", async () => {
  await assert.rejects(
    () =>
      startManagedUpstream(
        {
          enabled: true,
          pythonPath: process.execPath,
          workingDirectory: fixturesDir,
          appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
          host: "127.0.0.1",
          port: nextPort(3),
          startTimeoutMs: 2_000,
          healthPath: "/healthz",
          requestTimeoutMs: 250
        },
        {
          ...process.env,
          FAKE_UPSTREAM_MODE: "exit-immediately"
        }
      ),
    /exited/i
  );
});
```

- [ ] **Step 2: Run the lifecycle tests to verify they fail**

Run: `node --import tsx --test src/upstream/managedUpstream.test.ts`

Expected: FAIL because none of the lifecycle modules exist yet.

- [ ] **Step 3: Implement the shared types and startup error**

Create `src/upstream/types.ts`:

```ts
export interface ManagedUpstreamConfig {
  enabled: boolean;
  pythonPath: string;
  workingDirectory: string;
  appFile: string;
  host: string;
  port: number;
  startTimeoutMs: number;
  healthPath: string;
  requestTimeoutMs: number;
}

export interface ManagedUpstreamHandle {
  baseUrl: string;
  managed: boolean;
  pid?: number;
  stop(): Promise<void>;
}
```

Create `src/upstream/startupError.ts`:

```ts
export class UpstreamStartupError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "UpstreamStartupError";
  }
}
```

- [ ] **Step 4: Implement path resolution and port probing**

Create `src/upstream/pythonLocator.ts`:

```ts
import { access } from "node:fs/promises";
import path from "node:path";
import { UpstreamStartupError } from "./startupError.js";

export async function resolvePythonPath(pythonPath: string): Promise<string> {
  const resolvedPath = path.resolve(pythonPath);

  try {
    await access(resolvedPath);
    return resolvedPath;
  } catch (error) {
    throw new UpstreamStartupError("Managed upstream Python interpreter not found", {
      pythonPath: resolvedPath,
      cause: error
    });
  }
}
```

Create `src/upstream/port.ts`:

```ts
import net from "node:net";
import { UpstreamStartupError } from "./startupError.js";

export function buildBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}/`;
}

export async function assertPortAvailable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      reject(
        new UpstreamStartupError("Managed upstream port is already in use", {
          host,
          port,
          cause: error
        })
      );
    });

    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve();
      });
    });

    server.listen(port, host);
  });
}
```

- [ ] **Step 5: Implement health polling, process management, and orchestration**

Create `src/upstream/healthcheck.ts`:

```ts
import { UpstreamStartupError } from "./startupError.js";

export async function waitForHealthyUpstream(options: {
  baseUrl: string;
  healthPath: string;
  timeoutMs: number;
  requestTimeoutMs: number;
  isChildAlive: () => boolean;
}): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < options.timeoutMs) {
    if (!options.isChildAlive()) {
      throw new UpstreamStartupError("Managed upstream exited before becoming healthy", {
        baseUrl: options.baseUrl,
        healthPath: options.healthPath,
        lastError
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);

    try {
      const response = await fetch(new URL(options.healthPath.replace(/^\/+/, ""), options.baseUrl), {
        signal: controller.signal
      });

      if (response.ok) {
        clearTimeout(timer);
        return;
      }

      lastError = new Error(`healthcheck responded with ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new UpstreamStartupError("Timed out waiting for managed upstream healthcheck", {
    baseUrl: options.baseUrl,
    healthPath: options.healthPath,
    timeoutMs: options.timeoutMs,
    lastError
  });
}
```

Create `src/upstream/processManager.ts`:

```ts
import { access } from "node:fs/promises";
import { ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { UpstreamStartupError } from "./startupError.js";

export async function spawnManagedUpstream(options: {
  pythonPath: string;
  workingDirectory: string;
  appFile: string;
  host: string;
  port: number;
  env?: NodeJS.ProcessEnv;
}): Promise<ChildProcess> {
  const resolvedWorkdir = path.resolve(options.workingDirectory);
  const resolvedAppFile = path.resolve(options.appFile);

  try {
    await access(resolvedWorkdir);
    await access(resolvedAppFile);
  } catch (error) {
    throw new UpstreamStartupError("Managed upstream entrypoint is missing", {
      workingDirectory: resolvedWorkdir,
      appFile: resolvedAppFile,
      cause: error
    });
  }

  const child = spawn(options.pythonPath, [resolvedAppFile], {
    cwd: resolvedWorkdir,
    env: {
      ...process.env,
      ...options.env,
      HLTV_UPSTREAM_HOST: options.host,
      HLTV_UPSTREAM_PORT: String(options.port),
      HLTV_UPSTREAM_DEBUG: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.on("data", (chunk) => {
    process.stderr.write(`[hltv-upstream] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[hltv-upstream] ${chunk}`);
  });

  child.once("error", (error) => {
    throw new UpstreamStartupError("Failed to spawn managed upstream", {
      pythonPath: options.pythonPath,
      workingDirectory: resolvedWorkdir,
      appFile: resolvedAppFile,
      cause: error
    });
  });

  return child;
}
```

Create `src/upstream/managedUpstream.ts`:

```ts
import { ChildProcess } from "node:child_process";
import { waitForHealthyUpstream } from "./healthcheck.js";
import { buildBaseUrl, assertPortAvailable } from "./port.js";
import { spawnManagedUpstream } from "./processManager.js";
import { resolvePythonPath } from "./pythonLocator.js";
import { UpstreamStartupError } from "./startupError.js";
import type { ManagedUpstreamConfig, ManagedUpstreamHandle } from "./types.js";

export async function startManagedUpstream(
  config: ManagedUpstreamConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<ManagedUpstreamHandle> {
  const pythonPath = await resolvePythonPath(config.pythonPath);
  await assertPortAvailable(config.host, config.port);

  const child = await spawnManagedUpstream({
    pythonPath,
    workingDirectory: config.workingDirectory,
    appFile: config.appFile,
    host: config.host,
    port: config.port,
    env: {
      ...env,
      HLTV_UPSTREAM_HEALTH_PATH: config.healthPath
    }
  });

  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;

  child.once("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  const baseUrl = buildBaseUrl(config.host, config.port);

  try {
    await waitForHealthyUpstream({
      baseUrl,
      healthPath: config.healthPath,
      timeoutMs: config.startTimeoutMs,
      requestTimeoutMs: config.requestTimeoutMs,
      isChildAlive: () => !exited
    });
  } catch (error) {
    if (!exited) {
      child.kill("SIGTERM");
    }

    throw error instanceof UpstreamStartupError
      ? error
      : new UpstreamStartupError("Managed upstream failed during startup", {
          baseUrl,
          exitCode,
          exitSignal,
          cause: error
        });
  }

  let stopping: Promise<void> | undefined;

  return {
    baseUrl,
    managed: true,
    pid: child.pid,
    stop() {
      if (!stopping) {
        stopping = stopChild(child);
      }

      return stopping;
    }
  };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 1_000);
  });
}
```

- [ ] **Step 6: Run the lifecycle tests and config regression together**

Run: `node --import tsx --test src/upstream/managedUpstream.test.ts src/config/env.test.ts`

Expected: PASS for all lifecycle and config tests.

- [ ] **Step 7: Commit the lifecycle layer**

```bash
git add src/upstream src/config/env.ts src/config/env.test.ts
git commit -m "feat: add managed upstream lifecycle"
```

---

### Task 5: Wire Startup Into `src/index.ts` And Update Docs

**Files:**
- Modify: `src/index.ts`
- Create: `src/upstream/managedUpstreamDocs.test.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the failing documentation contract test**

Create `src/upstream/managedUpstreamDocs.test.ts` with:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readProjectText(pathFromRoot: string): string {
  return readFileSync(new URL(`../../${pathFromRoot}`, import.meta.url), "utf8");
}

test(".env.example documents managed upstream defaults", () => {
  const content = readProjectText(".env.example");

  assert.match(content, /HLTV_UPSTREAM_MANAGED=true/);
  assert.match(content, /HLTV_UPSTREAM_PORT=18020/);
  assert.match(content, /HLTV_UPSTREAM_HEALTH_PATH=\/healthz/);
});

test("README documents automatic upstream startup", () => {
  const content = readProjectText("README.md");

  assert.match(content, /automatically start/i);
  assert.match(content, /hltv-api-fixed\/env\/bin\/python/);
});

test("AGENTS.md documents managed upstream as the default", () => {
  const content = readProjectText("AGENTS.md");

  assert.match(content, /managed upstream/i);
  assert.match(content, /HLTV_UPSTREAM_MANAGED=false/);
});
```

- [ ] **Step 2: Run the docs contract test to verify it fails**

Run: `node --import tsx --test src/upstream/managedUpstreamDocs.test.ts`

Expected: FAIL because the docs still describe manual upstream startup and the new env vars do not exist.

- [ ] **Step 3: Wire managed startup into `src/index.ts`**

Update `src/index.ts` to this structure:

```ts
import path from "node:path";
import { MemoryCache } from "./cache/memoryCache.js";
import { HltvApiClient } from "./clients/hltvApiClient.js";
import { loadConfig } from "./config/env.js";
import { createMcpServer, startMcpServer } from "./mcp/server.js";
import { ChineseRenderer } from "./renderers/chineseRenderer.js";
import { PlayerResolver } from "./resolvers/playerResolver.js";
import { TeamResolver } from "./resolvers/teamResolver.js";
import { HltvFacade } from "./services/hltvFacade.js";
import { SummaryService } from "./services/summaryService.js";
import { startManagedUpstream } from "./upstream/managedUpstream.js";
import type { ManagedUpstreamHandle } from "./upstream/types.js";

function registerShutdown(stop: () => Promise<void>): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stop().finally(() => process.exit(0));
    });
  }

  process.once("beforeExit", () => {
    void stop();
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  let managedUpstream: ManagedUpstreamHandle | undefined;

  if (config.managedUpstreamEnabled) {
    managedUpstream = await startManagedUpstream({
      enabled: true,
      pythonPath: config.managedUpstreamPythonPath,
      workingDirectory: config.managedUpstreamWorkdir,
      appFile: path.join(config.managedUpstreamWorkdir, "app.py"),
      host: config.managedUpstreamHost,
      port: config.managedUpstreamPort,
      startTimeoutMs: config.managedUpstreamStartTimeoutMs,
      healthPath: config.managedUpstreamHealthPath,
      requestTimeoutMs: Math.min(config.hltvApiTimeoutMs, 1_000)
    });

    registerShutdown(() => managedUpstream?.stop() ?? Promise.resolve());
  }

  const cache = new MemoryCache();
  const client = new HltvApiClient({
    baseUrl: config.hltvApiBaseUrl,
    baseUrls: config.hltvApiBaseUrls,
    timeoutMs: config.hltvApiTimeoutMs
  });
  const teamResolver = new TeamResolver(client);
  const playerResolver = new PlayerResolver(client);
  const facade = new HltvFacade(config, client, cache, teamResolver, playerResolver);
  const summaryService = new SummaryService(config.summaryMode);
  const renderer = new ChineseRenderer(summaryService);
  const server = createMcpServer(config, facade, renderer);

  await startMcpServer(server);
}

main().catch((error) => {
  console.error("Failed to start HLTV MCP server", error);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Update `.env.example`, `README.md`, and `AGENTS.md`**

Update `.env.example` so it contains at least:

```dotenv
HLTV_UPSTREAM_MANAGED=true
HLTV_UPSTREAM_PYTHON=
HLTV_UPSTREAM_WORKDIR=
HLTV_UPSTREAM_HOST=127.0.0.1
HLTV_UPSTREAM_PORT=18020
HLTV_UPSTREAM_HEALTH_PATH=/healthz
HLTV_UPSTREAM_START_TIMEOUT_MS=15000

HLTV_API_BASE_URL=http://127.0.0.1:8020
HLTV_API_FALLBACK_BASE_URL=
```

Update `README.md` to move the startup story to:

```md
## Upstream runtime

By default the MCP server starts the bundled `hltv-api-fixed` Flask upstream automatically. You no longer need to launch the upstream manually first, but you do need a ready virtualenv at `hltv-api-fixed/env/bin/python`.

Set `HLTV_UPSTREAM_MANAGED=false` if you want to keep using an already-running external upstream via `HLTV_API_BASE_URL`.
```

Update `AGENTS.md` to replace manual-start assumptions with:

```md
## Upstream/API assumptions
- Default mode is a managed upstream: `src/index.ts` starts `hltv-api-fixed/app.py` through `hltv-api-fixed/env/bin/python` and waits for `/healthz`.
- `HLTV_UPSTREAM_MANAGED=false` restores the old external-upstream flow using `HLTV_API_BASE_URL` and optional `HLTV_API_FALLBACK_BASE_URL`.
- If `hltv-api-fixed/env/bin/python` is missing, startup is expected to fail fast with a clear error.
```

- [ ] **Step 5: Run the full project verification**

Run in repo root:

```bash
npm run check && npm run build && node --import tsx --test \
  src/config/env.test.ts \
  src/matchCommandFlow.test.ts \
  src/upstream/vendoredUpstreamLayout.test.ts \
  src/upstream/managedUpstream.test.ts \
  src/upstream/managedUpstreamDocs.test.ts
```

Run in `hltv-api-fixed`:

```bash
make test-unit && ./env/bin/python -m pytest tests/test_app_runtime.py tests/test_routes.py::TestRoutesEndpoints::test_healthz_endpoint -v
```

Expected: PASS for TypeScript checks/build/tests and PASS for Python route/runtime tests.

- [ ] **Step 6: Commit the integration and documentation changes**

```bash
git add src/index.ts .env.example README.md AGENTS.md src/upstream/managedUpstreamDocs.test.ts
git commit -m "feat: autostart the managed hltv upstream"
```

---

## Self-Review Checklist For The Engineer Executing This Plan

- Verify Task 1 makes `hltv-api-fixed/` visible inside the isolated worktree before any later task assumes it exists.
- Verify Task 2 does not change scraper route behavior other than adding `/healthz` and env-driven launch options.
- Verify Task 3 keeps existing WSL fallback logic untouched when `HLTV_UPSTREAM_MANAGED=false`.
- Verify Task 4 uses a fake child process in TypeScript tests rather than trying to run the real Python stack.
- Verify Task 5 does not regress `/match` behavior and updates all three docs (`README.md`, `.env.example`, `AGENTS.md`).

## Execution Mode For This Session

The user already chose **Subagent-Driven** execution and explicitly instructed us not to stop for another approval gate. Execute Task 1 first with a fresh implementation subagent, then run spec review, then code-quality review before moving to Task 2.
