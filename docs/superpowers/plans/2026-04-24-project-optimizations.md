# Project Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship low-conflict project optimizations that improve verification, OpenCode diagnostics, cache safety, and match ordering before opening a PR into `ArcDev`.

**Architecture:** Keep the public MCP tool contracts intact and avoid broad facade decomposition in this PR. Add tooling as isolated files, enrich `analyzeDoctorInput` with managed/external upstream semantics, upgrade `MemoryCache` behind its existing API, and add small facade sorting helpers at the final response boundary.

**Tech Stack:** TypeScript ESM on Node 18+, `node:test` with `tsx`, npm/package-lock, GitHub Actions, existing MCP/facade/cache modules.

---

## File Structure

- Create: `scripts/run-tests.mjs` — recursively discovers `src/**/*.test.ts` and runs them via `node --import tsx --test`.
- Modify: `package.json` — add `test` and `verify` scripts.
- Create: `.github/workflows/verify.yml` — CI runs `npm ci` and `npm run verify` on PRs/pushes.
- Create: `src/toolingScripts.test.ts` — guards package scripts and CI workflow.
- Modify: `src/doctor/opencodeDoctor.ts` — model managed/external upstream mode in recommendations and checks.
- Modify: `src/doctor/opencodeDoctorCli.ts` — pass managed-upstream config details into doctor analysis.
- Modify: `src/doctor/opencodeDoctor.test.ts` — prove managed failures do not recommend ignored `HLTV_API_BASE_URL` changes.
- Modify: `src/cache/memoryCache.ts` — add max entries, stale max age, stale age metadata, and in-flight dedupe.
- Create: `src/cache/memoryCache.test.ts` — cover expiry, stale, eviction, and dedupe behavior.
- Modify: `src/types/common.ts` — add optional `stale_age_sec` to `ToolMeta`.
- Modify: `src/services/hltvFacade.ts` — include stale age in cache fallback metadata and sort result/upcoming match outputs deterministically.
- Create: `src/services/hltvFacadeSorting.test.ts` — cover result descending and upcoming ascending ordering.

## Conflict Avoidance

- Work only in `/home/arcdent/.config/superpowers/worktrees/hltv-mcp/feat-project-optimizations`.
- Keep changes localized to tooling, doctor, cache, and tiny facade helper edits.
- Before final push, run `git fetch origin --prune`, verify `origin/ArcDev` has not diverged incompatibly, then rebase if needed.
- Do not touch root dirty worktree `/home/arcdent/github/hltv-mcp`.

---

### Task 1: Add Unified Verification And CI

**Files:**
- Create: `scripts/run-tests.mjs`
- Modify: `package.json`
- Create: `.github/workflows/verify.yml`
- Create: `src/toolingScripts.test.ts`

- [ ] **Step 1: Write the failing tooling contract test**

Create `src/toolingScripts.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --import tsx --test src/toolingScripts.test.ts`

Expected: FAIL because `package.json` has no `test`/`verify` scripts and the workflow file is missing.

- [ ] **Step 3: Add the test runner and scripts**

Create `scripts/run-tests.mjs`:

```js
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

function collectTestFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

const projectRoot = process.cwd();
const testFiles = collectTestFiles(path.join(projectRoot, "src")).sort();

if (testFiles.length === 0) {
  console.error("No TypeScript test files found under src/.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  cwd: projectRoot,
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
```

Update `package.json` scripts to include:

```json
"test": "node scripts/run-tests.mjs",
"verify": "npm run check && npm run build && npm test"
```

- [ ] **Step 4: Add CI workflow**

Create `.github/workflows/verify.yml`:

```yaml
name: Verify

on:
  pull_request:
  push:
    branches:
      - ArcDev
      - main

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npm run verify
```

- [ ] **Step 5: Run targeted and full verification**

Run: `node --import tsx --test src/toolingScripts.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all discovered TypeScript tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/run-tests.mjs .github/workflows/verify.yml src/toolingScripts.test.ts
git commit -m "ci: add unified verification workflow"
```

---

### Task 2: Fix Doctor Managed-Upstream Diagnostics

**Files:**
- Modify: `src/doctor/opencodeDoctor.ts`
- Modify: `src/doctor/opencodeDoctorCli.ts`
- Modify: `src/doctor/opencodeDoctor.test.ts`

- [ ] **Step 1: Write failing managed/external diagnostics tests**

Add tests to `src/doctor/opencodeDoctor.test.ts`:

```ts
test("managed-mode upstream failures recommend managed prerequisites, not ignored API base URL", () => {
  const report = analyzeDoctorInput(
    createInput({
      upstreamMode: "managed",
      managedUpstream: {
        pythonPath: "/repo/hltv-api-fixed/env/bin/python",
        workdir: "/repo/hltv-api-fixed",
        host: "127.0.0.1",
        port: 18020,
        healthPath: "/healthz"
      },
      upstreamBaseUrls: ["http://127.0.0.1:18020/"],
      upstreamProbeResults: [
        {
          url: "http://127.0.0.1:18020/api/v1/results/",
          ok: false,
          error: "connect ECONNREFUSED 127.0.0.1:18020"
        }
      ]
    })
  );

  const recommendations = report.recommendations.join("\n");
  assert.equal(statusFor(report, "upstream"), "fail");
  assert.match(recommendations, /HLTV_UPSTREAM_PYTHON_PATH|hltv-api-fixed\/env\/bin\/python/);
  assert.match(recommendations, /HLTV_UPSTREAM_MANAGED=false/);
  assert.doesNotMatch(recommendations, /检查 `HLTV_API_BASE_URL` 是否可达/);
});

test("external-mode upstream failures keep API base URL guidance", () => {
  const report = analyzeDoctorInput(
    createInput({
      upstreamMode: "external",
      upstreamProbeResults: [
        {
          url: "http://127.0.0.1:8020/api/v1/results/",
          ok: false,
          error: "connect ECONNREFUSED 127.0.0.1:8020"
        }
      ]
    })
  );

  assert.match(report.recommendations.join("\n"), /HLTV_API_BASE_URL/);
});
```

- [ ] **Step 2: Run the doctor test to verify it fails**

Run: `node --import tsx --test src/doctor/opencodeDoctor.test.ts`

Expected: FAIL because `DoctorAnalysisInput` has no `upstreamMode`/`managedUpstream` and recommendations are not mode-aware.

- [ ] **Step 3: Extend doctor input contracts and recommendations**

In `src/doctor/opencodeDoctor.ts`, add:

```ts
export type UpstreamMode = "managed" | "external";

export interface ManagedUpstreamDoctorConfig {
  pythonPath?: string;
  workdir?: string;
  host?: string;
  port?: number;
  healthPath?: string;
}
```

Add optional fields to `DoctorAnalysisInput`:

```ts
upstreamMode?: UpstreamMode;
managedUpstream?: ManagedUpstreamDoctorConfig;
```

Replace the upstream recommendation branch so managed mode says to verify the managed Python path/workdir/port/health path and to set `HLTV_UPSTREAM_MANAGED=false` only when intentionally using an externally managed upstream. External mode keeps the existing `HLTV_API_BASE_URL` and WSL fallback recommendation.

- [ ] **Step 4: Pass loaded config mode from CLI**

In `src/doctor/opencodeDoctorCli.ts`, pass these fields from `loadedConfig`:

```ts
upstreamMode: loadedConfig?.managedUpstreamEnabled === false ? "external" : "managed",
managedUpstream: loadedConfig
  ? {
      pythonPath: loadedConfig.managedUpstreamPythonPath,
      workdir: loadedConfig.managedUpstreamWorkdir,
      host: loadedConfig.managedUpstreamHost,
      port: loadedConfig.managedUpstreamPort,
      healthPath: loadedConfig.managedUpstreamHealthPath
    }
  : undefined,
```

- [ ] **Step 5: Run doctor tests**

Run: `node --import tsx --test src/doctor/opencodeDoctor.test.ts src/doctor/opencodeDoctorCli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/doctor/opencodeDoctor.ts src/doctor/opencodeDoctorCli.ts src/doctor/opencodeDoctor.test.ts
git commit -m "fix: clarify managed upstream doctor diagnostics"
```

---

### Task 3: Harden Memory Cache

**Files:**
- Modify: `src/cache/memoryCache.ts`
- Create: `src/cache/memoryCache.test.ts`
- Modify: `src/types/common.ts`
- Modify: `src/services/hltvFacade.ts`

- [ ] **Step 1: Write failing cache tests**

Create `src/cache/memoryCache.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCache } from "./memoryCache.js";

test("cache evicts the oldest entry when maxEntries is exceeded", () => {
  const cache = new MemoryCache({ maxEntries: 2 });

  cache.set("a", 1, 60);
  cache.set("b", 2, 60);
  cache.set("c", 3, 60);

  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
});

test("stale entries expire after maxStaleSeconds and expose stale age", async () => {
  const cache = new MemoryCache({ maxStaleSeconds: 0.02 });

  cache.set("key", "value", 0.01);
  await new Promise((resolve) => setTimeout(resolve, 15));

  const stale = cache.getStaleWithMeta<string>("key");
  assert.equal(stale?.value, "value");
  assert.equal(typeof stale?.staleAgeSec, "number");

  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(cache.getStale("key"), undefined);
});

test("runOnce deduplicates concurrent computations for the same key", async () => {
  const cache = new MemoryCache();
  let calls = 0;

  const compute = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "computed";
  };

  const [first, second] = await Promise.all([
    cache.runOnce("dedupe", compute),
    cache.runOnce("dedupe", compute)
  ]);

  assert.equal(first, "computed");
  assert.equal(second, "computed");
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run the cache test to verify it fails**

Run: `node --import tsx --test src/cache/memoryCache.test.ts`

Expected: FAIL because constructor options, `getStaleWithMeta`, and `runOnce` do not exist.

- [ ] **Step 3: Implement cache options and dedupe**

Update `MemoryCache` to accept `{ maxEntries = 500, maxStaleSeconds = 3600 }`, track `createdAt`, `expiresAt`, and in-flight promises, provide `getStaleWithMeta`, keep `getStale` as a compatibility wrapper, evict oldest entries when capacity is exceeded, and delete in-flight promises in `finally`.

- [ ] **Step 4: Surface stale age in facade fallback**

Add `stale_age_sec?: number` to `ToolMeta`. In `HltvFacade.withCache`, use `getStaleWithMeta` and include `stale_age_sec` when returning stale data.

- [ ] **Step 5: Run cache and flow tests**

Run: `node --import tsx --test src/cache/memoryCache.test.ts src/newsCommandFlow.test.ts src/matchCommandFlow.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cache/memoryCache.ts src/cache/memoryCache.test.ts src/types/common.ts src/services/hltvFacade.ts
git commit -m "perf: harden in-memory cache behavior"
```

---

### Task 4: Sort Match Outputs Deterministically

**Files:**
- Modify: `src/services/hltvFacade.ts`
- Create: `src/services/hltvFacadeSorting.test.ts`

- [ ] **Step 1: Write failing facade sorting tests**

Create `src/services/hltvFacadeSorting.test.ts` with lightweight fake client/resolver objects and two tests: results are returned by `played_at` descending with missing dates last; upcoming matches are returned by `scheduled_at` ascending with missing dates last.

- [ ] **Step 2: Run the sorting test to verify it fails**

Run: `node --import tsx --test src/services/hltvFacadeSorting.test.ts`

Expected: FAIL because current facade preserves upstream order.

- [ ] **Step 3: Add sorting helpers**

In `src/services/hltvFacade.ts`, add private helpers based on existing `dateTimeToTimestamp`:

```ts
private sortResultsByPlayedAtDesc(matches: NormalizedMatch[]): NormalizedMatch[] {
  return [...matches].sort((left, right) => this.compareMatchTime(left.played_at, right.played_at, false));
}

private sortUpcomingByScheduledAtAsc(matches: NormalizedMatch[]): NormalizedMatch[] {
  return [...matches].sort((left, right) => this.compareMatchTime(left.scheduled_at, right.scheduled_at, true));
}

private compareMatchTime(leftValue: string | undefined, rightValue: string | undefined, ascending: boolean): number {
  const left = dateTimeToTimestamp(leftValue);
  const right = dateTimeToTimestamp(rightValue);
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return ascending ? left - right : right - left;
}
```

Apply them before slicing `recent_results`, `upcoming_matches`, `getResultsRecent` items, and `getUpcomingMatches` items.

- [ ] **Step 4: Run sorting and flow tests**

Run: `node --import tsx --test src/services/hltvFacadeSorting.test.ts src/matchCommandFlow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/hltvFacade.ts src/services/hltvFacadeSorting.test.ts
git commit -m "fix: sort match outputs deterministically"
```

---

### Task 5: Final Verification, Rebase Check, Push, PR


- [ ] **Step 1: Run full verification**

Run: `npm run verify`

Expected: `check`, `build`, and all TypeScript tests pass.

- [ ] **Step 2: Check branch freshness against ArcDev**

Run: `git fetch origin --prune && git status --short --branch && git log --oneline origin/ArcDev..HEAD`

Expected: worktree clean except committed branch ahead of `origin/ArcDev`.

If `origin/ArcDev` changed after branch creation, run `git rebase origin/ArcDev`, resolve conflicts if any, then rerun `npm run verify`.

- [ ] **Step 3: Push feature branch**

Run: `git push -u origin feat/project-optimizations`

Expected: branch pushed without force.

- [ ] **Step 4: Create PR targeting ArcDev**

Run:

```bash
gh pr create --base ArcDev --head feat/project-optimizations --title "Improve verification, diagnostics, cache, and match ordering" --body "$(cat <<'EOF'
## Summary
- Add unified npm verification scripts and GitHub Actions CI.
- Clarify doctor diagnostics for managed vs external upstream modes.
- Harden in-memory cache behavior and add deterministic match ordering.

## Verification
- npm run verify
EOF
)"
```

Expected: GitHub returns a PR URL.

## Self-Review

- Spec coverage: covers the highest-value low-conflict optimizations selected for this PR: verification/CI, doctor managed diagnostics, cache hardening, sorting, push/PR to `ArcDev`.
- Placeholder scan: no `TBD`, empty test instructions, or “implement later” placeholders remain.
- Type consistency: new `stale_age_sec` lives on `ToolMeta`; doctor mode fields are optional so existing tests can be updated incrementally; cache keeps existing `get`, `getStale`, `set`, and `clear` methods.
- Conflict check: excludes large facade decomposition and resolver rewrites to minimize conflicts with `ArcDev`.
