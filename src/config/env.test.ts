import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./env.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("managed upstream defaults to vendored local service", () => {
  const config = loadConfig({});
  const expectedWorkdir = path.join(repoRoot, "hltv-api-fixed");

  assert.equal(config.managedUpstreamEnabled, true);
  assert.equal(config.hltvApiBaseUrl, "http://127.0.0.1:18020/");
  assert.deepEqual(config.hltvApiBaseUrls, ["http://127.0.0.1:18020/"]);
  assert.equal(config.managedUpstreamHost, "127.0.0.1");
  assert.equal(config.managedUpstreamPort, 18_020);
  assert.equal(config.managedUpstreamWorkdir, expectedWorkdir);
  assert.equal(config.managedUpstreamPythonPath, path.join(expectedWorkdir, "env", "bin", "python"));
  assert.equal(config.managedUpstreamHealthPath, "/healthz");
  assert.equal(config.managedUpstreamStartTimeoutMs, 15_000);
});

test("managed upstream env overrides are respected", () => {
  const config = loadConfig({
    HLTV_UPSTREAM_MANAGED: "true",
    HLTV_UPSTREAM_HOST: "0.0.0.0",
    HLTV_UPSTREAM_PORT: "19090",
    HLTV_UPSTREAM_WORKDIR: "/tmp/hltv-upstream",
    HLTV_UPSTREAM_PYTHON_PATH: "/opt/python/bin/python3",
    HLTV_UPSTREAM_HEALTH_PATH: "/ready",
    HLTV_UPSTREAM_START_TIMEOUT_MS: "32000",
    HLTV_API_BASE_URL: "http://ignored.example:9999",
    HLTV_API_FALLBACK_BASE_URL: "http://ignored-fallback.example:9998"
  });

  assert.equal(config.managedUpstreamEnabled, true);
  assert.equal(config.hltvApiBaseUrl, "http://127.0.0.1:19090/");
  assert.deepEqual(config.hltvApiBaseUrls, ["http://127.0.0.1:19090/"]);
  assert.equal(config.managedUpstreamHost, "0.0.0.0");
  assert.equal(config.managedUpstreamPort, 19_090);
  assert.equal(config.managedUpstreamWorkdir, "/tmp/hltv-upstream");
  assert.equal(config.managedUpstreamPythonPath, "/opt/python/bin/python3");
  assert.equal(config.managedUpstreamHealthPath, "/ready");
  assert.equal(config.managedUpstreamStartTimeoutMs, 32_000);
});

test("managed upstream maps wildcard IPv6 bind host to loopback dial URL", () => {
  const config = loadConfig({
    HLTV_UPSTREAM_MANAGED: "true",
    HLTV_UPSTREAM_HOST: "::"
  });

  assert.equal(config.managedUpstreamHost, "::");
  assert.equal(config.hltvApiBaseUrl, "http://[::1]:18020/");
  assert.deepEqual(config.hltvApiBaseUrls, ["http://[::1]:18020/"]);
});

test("managed upstream formats IPv6 host with brackets", () => {
  const config = loadConfig({
    HLTV_UPSTREAM_MANAGED: "true",
    HLTV_UPSTREAM_HOST: "::1"
  });

  assert.equal(config.hltvApiBaseUrl, "http://[::1]:18020/");
  assert.deepEqual(config.hltvApiBaseUrls, ["http://[::1]:18020/"]);
});

test("external mode preserves configured upstream URLs", () => {
  const config = loadConfig({
    HLTV_UPSTREAM_MANAGED: "false",
    HLTV_API_BASE_URL: "http://upstream.local:8021/api",
    HLTV_API_FALLBACK_BASE_URL: "http://backup.local:8022"
  });

  assert.equal(config.managedUpstreamEnabled, false);
  assert.equal(config.hltvApiBaseUrl, "http://upstream.local:8021/api/");
  assert.deepEqual(config.hltvApiBaseUrls, ["http://upstream.local:8021/api/", "http://backup.local:8022/"]);
});
