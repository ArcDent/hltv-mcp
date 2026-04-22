import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { loadConfig } from "../config/env.js";
import {
  analyzeDoctorInput,
  type DoctorAnalysisInput,
  type DoctorCheckStatus,
  type DoctorReport,
  type EffectiveMcpConfig,
  type UpstreamProbeResult
} from "./opencodeDoctor.js";

const execFileAsync = promisify(execFile);

interface CliOptions {
  json: boolean;
  mcpName: string;
}

interface ResolvedOpenCodeConfig {
  mcp?: Record<string, EffectiveMcpConfig>;
}

export function parseArgs(argv: string[]): CliOptions {
  let json = false;
  let mcpName = "hltv_local";

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--json") {
      json = true;
      continue;
    }

    if (value === "--mcp-name") {
      const nextValue = argv[index + 1];
      if (nextValue && !nextValue.startsWith("--")) {
        mcpName = nextValue;
        index += 1;
      }
    }
  }

  return {
    json,
    mcpName
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getProjectConfigPaths(projectRoot: string): Promise<string[]> {
  const candidates = [
    path.join(projectRoot, "opencode.json"),
    path.join(projectRoot, "opencode.jsonc"),
    path.join(projectRoot, ".opencode", "opencode.json"),
    path.join(projectRoot, ".opencode", "opencode.jsonc")
  ];

  const existingPaths: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      existingPaths.push(candidate);
    }
  }

  return existingPaths;
}

async function readResolvedOpenCodeConfig(projectRoot: string): Promise<ResolvedOpenCodeConfig> {
  const { stdout } = await execFileAsync("opencode", ["debug", "config"], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024
  });

  return parseResolvedOpenCodeConfig(stdout);
}

export function parseResolvedOpenCodeConfig(stdout: string): ResolvedOpenCodeConfig {
  return JSON.parse(stdout) as ResolvedOpenCodeConfig;
}

function normalizeEnvironment(environment: EffectiveMcpConfig["environment"]): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment ?? {}).map(([key, value]) => [key, value])) as NodeJS.ProcessEnv;
}

async function probeUpstream(baseUrl: string, timeoutMs: number): Promise<UpstreamProbeResult> {
  const probeUrl = new URL("api/v1/results/", baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    return {
      url: probeUrl,
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url: probeUrl,
      ok: false,
      error: message
    };
  } finally {
    clearTimeout(timer);
  }
}

async function buildDoctorInput(projectRoot: string, mcpName: string): Promise<DoctorAnalysisInput> {
  const expectedDistEntry = path.join(projectRoot, "dist", "index.js");
  const projectConfigPaths = await getProjectConfigPaths(projectRoot);
  const distEntryExists = await pathExists(expectedDistEntry);
  const resolvedConfig = await readResolvedOpenCodeConfig(projectRoot);
  const effectiveMcpConfig = resolvedConfig.mcp?.[mcpName];
  const effectiveEnvironment = normalizeEnvironment(effectiveMcpConfig?.environment);
  const loadedConfig = effectiveMcpConfig ? loadConfig(effectiveEnvironment) : undefined;
  const upstreamBaseUrls = loadedConfig?.hltvApiBaseUrls ?? [];
  const timeoutMs = Math.min(loadedConfig?.hltvApiTimeoutMs ?? 8_000, 3_000);
  const upstreamProbeResults: UpstreamProbeResult[] = [];

  for (const baseUrl of upstreamBaseUrls) {
    upstreamProbeResults.push(await probeUpstream(baseUrl, timeoutMs));
  }

  return {
    projectRoot,
    projectConfigPaths,
    distEntryExists,
    platform: process.platform,
    expectedDistEntry,
    effectiveMcpName: mcpName,
    effectiveMcpConfig,
    upstreamBaseUrls,
    upstreamProbeResults
  };
}

function statusIcon(status: DoctorCheckStatus): string {
  if (status === "pass") {
    return "PASS";
  }

  if (status === "warn") {
    return "WARN";
  }

  return "FAIL";
}

function summarizeOverallStatus(report: DoctorReport): string {
  if (report.ok) {
    return "通过";
  }

  if (report.checks.some((check) => check.status === "fail")) {
    return "发现阻塞问题";
  }

  return "发现风险项";
}

export function formatDoctorReport(report: DoctorReport, mcpName: string): string {
  const lines = [`HLTV MCP OpenCode Doctor (${mcpName})`, `结论：${summarizeOverallStatus(report)}`, ""];

  for (const check of report.checks) {
    lines.push(`[${statusIcon(check.status)}] ${check.label}`);
    lines.push(`  ${check.summary}`);
  }

  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("建议动作：");
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  return lines.join("\n");
}

export function renderDoctorOutput(
  report: DoctorReport,
  context: {
    json: boolean;
    mcpName: string;
    projectRoot: string;
  }
): string {
  if (context.json) {
    return JSON.stringify(
      {
        mcp_name: context.mcpName,
        project_root: context.projectRoot,
        report
      },
      null,
      2
    );
  }

  return formatDoctorReport(report, context.mcpName);
}

export function exitCodeForReport(report: DoctorReport): number {
  return report.checks.some((check) => check.status === "fail") ? 1 : 0;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const input = await buildDoctorInput(projectRoot, options.mcpName);
  const report = analyzeDoctorInput(input);

  console.log(renderDoctorOutput(report, { json: options.json, mcpName: options.mcpName, projectRoot }));
  process.exitCode = exitCodeForReport(report);
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`HLTV MCP OpenCode Doctor failed: ${message}`);
    process.exitCode = 1;
  });
}
