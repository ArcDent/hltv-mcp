import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDoctorInput, type DoctorAnalysisInput } from "./opencodeDoctor.js";

function createInput(overrides: Partial<DoctorAnalysisInput> = {}): DoctorAnalysisInput {
  return {
    projectRoot: "/repo",
    projectConfigPaths: [],
    distEntryExists: true,
    platform: "linux",
    expectedDistEntry: "/repo/dist/index.js",
    effectiveMcpName: "hltv_local",
    effectiveMcpConfig: {
      enabled: true,
      command: ["node", "/repo/dist/index.js"],
      environment: {
        HLTV_API_BASE_URL: "http://127.0.0.1:8020",
        HLTV_API_TIMEOUT_MS: "8000"
      }
    },
    upstreamBaseUrls: ["http://127.0.0.1:8020/"],
    upstreamProbeResults: [
      {
        url: "http://127.0.0.1:8020/",
        ok: true,
        status: 200
      }
    ],
    ...overrides
  };
}

function statusFor(report: ReturnType<typeof analyzeDoctorInput>, id: string): string | undefined {
  return report.checks.find((check) => check.id === id)?.status;
}

test("doctor flags missing project config, disabled MCP, and unreachable upstream", () => {
  const report = analyzeDoctorInput(
    createInput({
      projectConfigPaths: [],
      effectiveMcpConfig: {
        enabled: false,
        command: ["node", "/repo/dist/index.js"],
        environment: {
          HLTV_API_BASE_URL: "http://127.0.0.1:8020",
          HLTV_API_TIMEOUT_MS: "8000"
        }
      },
      upstreamProbeResults: [
        {
          url: "http://127.0.0.1:8020/",
          ok: false,
          error: "connect ECONNREFUSED 127.0.0.1:8020"
        }
      ]
    })
  );

  assert.equal(report.ok, false);
  assert.equal(statusFor(report, "project_config"), "warn");
  assert.equal(statusFor(report, "mcp_enabled"), "fail");
  assert.equal(statusFor(report, "upstream"), "fail");
  assert.match(report.recommendations.join("\n"), /项目级 OpenCode 配置/);
  assert.match(report.recommendations.join("\n"), /enabled.*true/i);
  assert.match(report.recommendations.join("\n"), /HLTV_API_BASE_URL|HLTV_API_FALLBACK_BASE_URL/);
});

test("doctor flags Windows command paths on Linux", () => {
  const report = analyzeDoctorInput(
    createInput({
      projectConfigPaths: ["/repo/opencode.jsonc"],
      effectiveMcpConfig: {
        enabled: true,
        command: ["node", "C:/Users/arcdent/hltv-mcp/dist/index.js"],
        environment: {
          HLTV_API_BASE_URL: "http://127.0.0.1:8020"
        }
      }
    })
  );

  assert.equal(report.ok, false);
  assert.equal(statusFor(report, "command_target"), "fail");
  assert.match(report.recommendations.join("\n"), /WSL\/Linux 可访问路径/);
});

test("doctor passes healthy project-local configuration", () => {
  const report = analyzeDoctorInput(
    createInput({
      projectConfigPaths: ["/repo/opencode.jsonc"],
      effectiveMcpConfig: {
        enabled: true,
        command: ["node", "/repo/dist/index.js"],
        environment: {
          HLTV_API_BASE_URL: "http://127.0.0.1:8020",
          HLTV_API_TIMEOUT_MS: "8000"
        }
      },
      upstreamProbeResults: [
        {
          url: "http://127.0.0.1:8020/",
          ok: true,
          status: 200
        }
      ]
    })
  );

  assert.equal(report.ok, true);
  assert.equal(statusFor(report, "project_config"), "pass");
  assert.equal(statusFor(report, "mcp_enabled"), "pass");
  assert.equal(statusFor(report, "command_target"), "pass");
  assert.equal(statusFor(report, "upstream"), "pass");
  assert.equal(report.recommendations.length, 0);
});

test("doctor accepts a dist entry that appears after node flags", () => {
  const report = analyzeDoctorInput(
    createInput({
      projectConfigPaths: ["/repo/opencode.jsonc"],
      effectiveMcpConfig: {
        enabled: true,
        command: ["node", "--enable-source-maps", "/repo/dist/index.js"],
        environment: {
          HLTV_API_BASE_URL: "http://127.0.0.1:8020",
          HLTV_API_TIMEOUT_MS: "8000"
        }
      },
      upstreamProbeResults: [
        {
          url: "http://127.0.0.1:8020/",
          ok: true,
          status: 200
        }
      ]
    })
  );

  assert.equal(statusFor(report, "command_target"), "pass");
  assert.equal(report.ok, true);
});

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
