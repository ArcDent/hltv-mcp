# Managed Upstream Autostart Design

**Date:** 2026-04-22  
**Status:** Approved by user instruction to proceed without another approval gate  
**Primary goal:** Make the TypeScript MCP server start and manage the bundled Python HLTV upstream automatically so users no longer need to launch the upstream manually.

---

## 1. Problem Statement

The current TypeScript MCP server assumes an already-running HTTP upstream at `HLTV_API_BASE_URL`, defaulting to `http://127.0.0.1:8020/`. That creates a fragile local setup:

- users must manually start the Python scraper service before starting the MCP server;
- failure modes are delayed until the first tool call reaches the missing upstream;
- the main repository does not currently track `hltv-api-fixed/`, so isolated worktrees do not contain the Python upstream source at all.

The user requested a larger architectural shift: the MCP process itself must launch the upstream. The chosen implementation shape is:

- keep the existing TypeScript `HltvApiClient -> HltvFacade -> MCP tools` architecture;
- keep the HTTP boundary between TypeScript and Python;
- have MCP startup spawn the Python upstream automatically;
- require an existing repository-local virtualenv at `hltv-api-fixed/env/bin/python`;
- fail fast with actionable errors if the upstream cannot be started.

---

## 2. Current-State Findings That Constrain The Design

### 2.1 Root TypeScript server

- `src/index.ts` is the only runtime entrypoint.
- `src/mcp/server.ts` only starts stdio transport; there is no HTTP/SSE server entrypoint in the root project.
- `src/config/env.ts` currently only models external upstream URLs and WSL fallback behavior.
- `src/clients/hltvApiClient.ts` already supports one primary URL plus retry/failover URLs.

### 2.2 Python upstream

- `hltv-api-fixed/app.py` exposes `create_app()` and currently runs Flask directly in `__main__` with `debug=True`, `host='0.0.0.0'`, `port=8020`.
- `hltv-api-fixed/tests/conftest.py` already builds a Flask app through `create_app()` and provides `client` and `app` fixtures.
- `hltv-api-fixed/Makefile` assumes a venv at `hltv-api-fixed/env/` and already has test targets like `make test-unit`.
- `hltv-api-fixed/.gitignore` already excludes `env/`, caches, JSON artifacts, and `.worktrees/`.

### 2.3 Repository-layout constraint discovered during worktree setup

- The root repository working tree contains `hltv-api-fixed/` as an untracked nested Git repository.
- The new isolated worktree created from the root branch does **not** include `hltv-api-fixed/` because the directory is not tracked by the root repo.

This means the implementation must first make `hltv-api-fixed/` a tracked part of the root repository, or the managed-upstream feature cannot be developed, tested, or shipped from a clean branch.

---

## 3. Goals And Non-Goals

## Goals

1. Starting the MCP server must automatically start the bundled Python upstream when managed mode is enabled.
2. MCP startup must wait for upstream readiness before exposing tools.
3. The default Python interpreter must be `hltv-api-fixed/env/bin/python`.
4. The Python upstream source must be tracked by the root repository so worktrees and clean clones have the code.
5. The system must still support an external-upstream compatibility mode for debugging or special deployments.
6. Existing MCP behavior unrelated to startup, especially `/match` today-only behavior, must not regress.

## Non-Goals

1. Do not rewrite the Python scraper into TypeScript.
2. Do not remove the HTTP boundary between the MCP server and the scraper.
3. Do not auto-create the Python virtualenv.
4. Do not auto-install Python requirements.
5. Do not redesign existing façade, resolver, renderer, or command semantics beyond what startup orchestration requires.

---

## 4. Chosen Architecture

The implementation will add a managed-upstream lifecycle layer in the TypeScript runtime and track the Python upstream inside the root repository.

### 4.1 Runtime startup flow

When `HLTV_UPSTREAM_MANAGED=true`:

1. `src/index.ts` loads config.
2. MCP startup resolves the Python executable path.
3. MCP startup verifies the vendored upstream working directory and `app.py` entrypoint exist.
4. MCP startup checks the configured host/port for conflicts.
5. MCP spawns the Python process.
6. MCP polls a lightweight health endpoint until the upstream is ready or startup times out.
7. MCP constructs `HltvApiClient` using the managed upstream base URL.
8. MCP connects stdio transport.
9. On `SIGINT`, `SIGTERM`, and normal process shutdown, MCP stops the Python child process **only if MCP created it**.

When `HLTV_UPSTREAM_MANAGED=false`:

1. The existing external-upstream flow stays in place.
2. `HLTV_API_BASE_URL` and optional WSL fallback handling remain available.
3. No child process is spawned or cleaned up.

### 4.2 Repository layout after the change

The root repository will track `hltv-api-fixed/` directly as vendored source. The nested `.git/` directory and local-only OpenCode artifacts must not be carried into the tracked copy.

Expected tracked layout:

```text
hltv-api-fixed/
  .dockerignore
  .gitignore
  Dockerfile
  Makefile
  README.md
  app.py
  config.py
  docs/
  hltv_scraper/
  pytest.ini
  requirements.txt
  routes/
  swagger_specs/
  tests/
```

Explicitly not tracked in the root repo:

- `hltv-api-fixed/.git/`
- `hltv-api-fixed/.opencode/`
- `hltv-api-fixed/env/`
- `hltv-api-fixed/__pycache__/`
- other cache or generated output already covered by `.gitignore`

---

## 5. TypeScript Module Design

Add a focused upstream lifecycle layer under `src/upstream/`.

### 5.1 New files

#### `src/upstream/types.ts`

Defines the runtime contract used by the lifecycle manager.

Required exported types:

- `ManagedUpstreamConfig`
- `ManagedUpstreamHandle`
- `ManagedUpstreamStatus`

Required shape:

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

#### `src/upstream/pythonLocator.ts`

Responsibilities:

- resolve `HLTV_UPSTREAM_PYTHON` if provided;
- otherwise resolve `<repo-root>/hltv-api-fixed/env/bin/python`;
- verify the file exists;
- return a normalized absolute path;
- throw a startup error with a clear, actionable message on failure.

#### `src/upstream/port.ts`

Responsibilities:

- build a normalized base URL from host/port;
- probe whether the TCP port is already in use;
- distinguish `available`, `occupied by healthy managed-target`, and `occupied by something else`;
- keep the initial implementation strict: if the port is already serving anything, fail instead of silently attaching.

#### `src/upstream/healthcheck.ts`

Responsibilities:

- poll `http://<host>:<port><healthPath>` until HTTP 200 is returned;
- honor `startTimeoutMs`;
- capture the last failure reason for diagnostics;
- abort early if the child process exits before becoming healthy.

#### `src/upstream/processManager.ts`

Responsibilities:

- spawn the Python child process using the resolved interpreter;
- run in `hltv-api-fixed/` as the working directory;
- inject startup environment variables for host, port, and debug mode;
- forward prefixed stdout/stderr to the MCP process stderr for observability;
- support idempotent shutdown.

#### `src/upstream/managedUpstream.ts`

High-level orchestrator that combines locator, port check, spawn, healthcheck, and shutdown.

Required exported API:

```ts
export async function startManagedUpstream(
  config: ManagedUpstreamConfig,
  env?: NodeJS.ProcessEnv
): Promise<ManagedUpstreamHandle>
```

This is the only upstream lifecycle entrypoint used by `src/index.ts`.

### 5.2 Existing file changes

#### `src/config/env.ts`

Expand `AppConfig` with managed-upstream settings:

```ts
managedUpstreamEnabled: boolean;
managedUpstreamPythonPath?: string;
managedUpstreamWorkdir: string;
managedUpstreamHost: string;
managedUpstreamPort: number;
managedUpstreamHealthPath: string;
managedUpstreamStartTimeoutMs: number;
```

Behavior rules:

- default `managedUpstreamEnabled` to `true`;
- default host to `127.0.0.1`;
- default port to `18020`;
- default health path to `/healthz`;
- default workdir to `hltv-api-fixed` relative to repo root;
- when managed mode is enabled, `hltvApiBaseUrl` and `hltvApiBaseUrls` must resolve to the managed upstream URL and should not include WSL host fallbacks;
- when managed mode is disabled, keep existing URL + WSL fallback behavior unchanged.

#### `src/index.ts`

Refactor startup into:

1. `loadConfig()`
2. optionally `startManagedUpstream(...)`
3. create `HltvApiClient`
4. create resolvers/facade/renderer/server
5. `startMcpServer(server)`
6. register shutdown hooks that call `handle.stop()`

The shutdown hooks must be safe to call multiple times.

#### `src/clients/hltvApiClient.ts`

No architectural redesign is required. Only minimal changes are allowed, such as improved error detail if startup-managed URLs are used. Existing retry/failover behavior remains intact.

---

## 6. Python Upstream Changes

The Python service needs two changes.

### 6.1 Add a health endpoint

Add a lightweight Flask route in `hltv-api-fixed/app.py`:

- path: `/healthz`
- method: `GET`
- response: `{"status": "ok"}`
- status code: `200`

This endpoint must not touch scraper dependencies or trigger background work.

### 6.2 Make runtime host and port configurable

Replace the hardcoded `debug=True`, `host='0.0.0.0'`, `port=8020` launch block with environment-driven startup:

- `HLTV_UPSTREAM_HOST`, default `127.0.0.1`
- `HLTV_UPSTREAM_PORT`, default `18020`
- `HLTV_UPSTREAM_DEBUG`, default false-ish

This keeps direct manual startup possible while aligning the defaults with managed mode.

---

## 7. Error Handling Requirements

Managed startup must fail **before** MCP stdio transport is exposed when any of the following happen:

1. Python interpreter path is missing.
2. `hltv-api-fixed/app.py` is missing.
3. Working directory is missing.
4. Target port is already occupied.
5. Child process fails to spawn.
6. Child process exits before becoming healthy.
7. Healthcheck times out.

Error messages must include enough context to debug quickly:

- resolved Python path
- resolved workdir
- attempted base URL
- startup timeout
- last healthcheck error if available

Startup failures do **not** need to be turned into `AppError` instances because they happen before any MCP tool executes. A dedicated lifecycle error type under `src/upstream/` is acceptable.

---

## 8. Observability Requirements

The managed Python process stdout and stderr must be surfaced to the MCP process stderr with a stable prefix:

```text
[hltv-upstream] ...
```

This is required so users can distinguish TypeScript MCP logs from Python upstream logs during local debugging.

---

## 9. Testing Strategy

Testing must cover both runtimes.

### 9.1 TypeScript tests

Add focused Node test files under `src/upstream/` and `src/config/` for:

- config defaults in managed mode;
- config fallback behavior when managed mode is disabled;
- Python path resolution failures;
- child-process startup success using a fake HTTP server script;
- healthcheck timeout / early-exit failures;
- idempotent shutdown.

Regression verification must continue to run:

```bash
npm run check
npm run build
node --import tsx --test src/matchCommandFlow.test.ts
```

### 9.2 Python tests

Add or extend route tests in `hltv-api-fixed/tests/test_routes.py` for:

- `/healthz` returning `200` with `{"status": "ok"}`;
- runtime config defaults or environment-driven startup helper behavior, if extracted into a helper function.

Verification commands:

```bash
make test-unit
./env/bin/python -m pytest tests/test_routes.py::TestRoutesEndpoints::test_healthz_endpoint -v
```

### 9.3 Scope guard

Do not add a full end-to-end test that launches the real scraper stack during the TypeScript test run. Keep the TypeScript lifecycle tests deterministic by using a lightweight fake upstream process.

---

## 10. Documentation Changes

Update:

- `README.md`
- `.env.example`
- `AGENTS.md`

Required documentation changes:

1. Managed upstream is now the default mode.
2. Users must have `hltv-api-fixed/env/bin/python` prepared.
3. `HLTV_UPSTREAM_MANAGED=false` switches back to external mode.
4. The old manual-start instructions become compatibility/debug notes rather than the primary path.

---

## 11. Rollout Sequence

Implementation should land in this order:

1. Make `hltv-api-fixed/` tracked in the root repository.
2. Add `/healthz` and env-driven Python launch configuration.
3. Add TypeScript upstream lifecycle modules and tests.
4. Wire managed startup into `src/index.ts` and config parsing.
5. Update docs.
6. Run TypeScript and Python verification.

This order keeps the repository buildable and gives the lifecycle code a real upstream directory to manage.

---

## 12. Acceptance Criteria

The feature is complete when all of the following are true:

1. A clean branch or worktree contains tracked `hltv-api-fixed/` source.
2. Running `npm run dev` or `npm run start` no longer requires manually starting the Python upstream first.
3. If `hltv-api-fixed/env/bin/python` is missing, MCP startup fails immediately with a clear error.
4. If the configured port is occupied, MCP startup fails immediately with a clear error.
5. MCP waits for `/healthz` before exposing tools.
6. Existing `/match` behavior and existing TypeScript tests still pass.
7. Python route tests still pass, including the new health endpoint test.
8. Setting `HLTV_UPSTREAM_MANAGED=false` preserves the old external-upstream flow.
