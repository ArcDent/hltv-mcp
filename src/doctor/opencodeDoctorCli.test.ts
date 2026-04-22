import assert from "node:assert/strict";
import test from "node:test";
import type { DoctorReport } from "./opencodeDoctor.js";
import {
  exitCodeForReport,
  formatDoctorReport,
  parseArgs,
  parseResolvedOpenCodeConfig,
  renderDoctorOutput
} from "./opencodeDoctorCli.js";

function createReport(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    ok: true,
    checks: [
      {
        id: "project_config",
        label: "项目级 OpenCode 配置",
        status: "pass",
        summary: "检测到项目级配置文件。"
      }
    ],
    recommendations: [],
    ...overrides
  };
}

test("parseArgs reads --json and --mcp-name", () => {
  const options = parseArgs(["--json", "--mcp-name", "custom_hltv"]);

  assert.deepEqual(options, {
    json: true,
    mcpName: "custom_hltv"
  });
});

test("parseResolvedOpenCodeConfig parses opencode debug config output", () => {
  const resolved = parseResolvedOpenCodeConfig(`{"mcp":{"hltv_local":{"enabled":true,"command":["node","/repo/dist/index.js"]}}}`);

  assert.equal(resolved.mcp?.hltv_local?.enabled, true);
  assert.deepEqual(resolved.mcp?.hltv_local?.command, ["node", "/repo/dist/index.js"]);
});

test("renderDoctorOutput returns json when requested", () => {
  const output = renderDoctorOutput(createReport(), {
    json: true,
    mcpName: "hltv_local",
    projectRoot: "/repo"
  });

  const parsed = JSON.parse(output) as { mcp_name: string; project_root: string; report: DoctorReport };
  assert.equal(parsed.mcp_name, "hltv_local");
  assert.equal(parsed.project_root, "/repo");
  assert.equal(parsed.report.ok, true);
});

test("formatDoctorReport and exitCodeForReport surface blocking failures", () => {
  const report = createReport({
    ok: false,
    checks: [
      {
        id: "upstream",
        label: "HLTV 上游连通性",
        status: "fail",
        summary: "所有上游探测都失败了。"
      }
    ],
    recommendations: ["检查 HLTV_API_BASE_URL"]
  });

  const text = formatDoctorReport(report, "hltv_local");

  assert.match(text, /HLTV MCP OpenCode Doctor/);
  assert.match(text, /\[FAIL\] HLTV 上游连通性/);
  assert.equal(exitCodeForReport(report), 1);
});
