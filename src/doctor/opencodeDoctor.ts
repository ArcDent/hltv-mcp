export type DoctorCheckStatus = "pass" | "warn" | "fail";

export interface EffectiveMcpConfig {
  enabled?: boolean;
  command?: string[];
  environment?: Record<string, string | undefined>;
}

export interface UpstreamProbeResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export type UpstreamMode = "managed" | "external";

export interface ManagedUpstreamDoctorConfig {
  pythonPath?: string;
  workdir?: string;
  host?: string;
  port?: number;
  healthPath?: string;
}

export interface DoctorAnalysisInput {
  projectRoot: string;
  projectConfigPaths: string[];
  distEntryExists: boolean;
  platform: NodeJS.Platform;
  expectedDistEntry: string;
  effectiveMcpName: string;
  effectiveMcpConfig?: EffectiveMcpConfig;
  upstreamMode?: UpstreamMode;
  managedUpstream?: ManagedUpstreamDoctorConfig;
  upstreamBaseUrls: string[];
  upstreamProbeResults: UpstreamProbeResult[];
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  summary: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  recommendations: string[];
}

function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function normalizePath(value: string): string {
  return value.replace(/\\+/g, "/");
}

function readCommandTarget(command: string[] | undefined): string | undefined {
  if (!command || command.length === 0) {
    return undefined;
  }

  for (let index = command.length - 1; index >= 0; index -= 1) {
    const part = command[index];
    if (part && !part.startsWith("-")) {
      return part;
    }
  }

  return command[command.length - 1] ?? command[0];
}

function hasPassingUpstreamProbe(results: UpstreamProbeResult[]): boolean {
  return results.some((result) => result.ok);
}

function describeManagedUpstream(config: ManagedUpstreamDoctorConfig | undefined): string {
  const parts = [
    config?.pythonPath ? `Python=${config.pythonPath}` : undefined,
    config?.workdir ? `workdir=${config.workdir}` : undefined,
    config?.host && config?.port ? `listen=${config.host}:${config.port}` : undefined,
    config?.healthPath ? `health=${config.healthPath}` : undefined
  ].filter((part): part is string => Boolean(part));

  return parts.length ? `（当前 managed 配置：${parts.join("，")}）` : "";
}

export function analyzeDoctorInput(input: DoctorAnalysisInput): DoctorReport {
  const checks: DoctorCheck[] = [];
  const recommendations: string[] = [];
  const effectiveMcpConfig = input.effectiveMcpConfig;
  const commandTarget = readCommandTarget(effectiveMcpConfig?.command);
  const normalizedCommandTarget = commandTarget ? normalizePath(commandTarget) : undefined;
  const normalizedExpectedDistEntry = normalizePath(input.expectedDistEntry);

  if (input.projectConfigPaths.length > 0) {
    checks.push({
      id: "project_config",
      label: "项目级 OpenCode 配置",
      status: "pass",
      summary: `检测到项目级配置文件：${input.projectConfigPaths.join(", ")}；仍建议结合 opencode debug config / opencode mcp list --print-logs 确认实际生效来源。`
    });
  } else {
    checks.push({
      id: "project_config",
      label: "项目级 OpenCode 配置",
      status: "warn",
      summary: "未检测到项目级 OpenCode 配置，当前目录可能仍依赖全局配置。"
    });
    recommendations.push("补一个项目级 OpenCode 配置（例如 `opencode.jsonc` 或 `.opencode/opencode.jsonc`），避免只依赖全局配置。");
  }

  if (input.distEntryExists) {
    checks.push({
      id: "dist_entry",
      label: "MCP 构建产物",
      status: "pass",
      summary: `检测到运行入口：${input.expectedDistEntry}`
    });
  } else {
    checks.push({
      id: "dist_entry",
      label: "MCP 构建产物",
      status: "fail",
      summary: `未找到运行入口：${input.expectedDistEntry}`
    });
    recommendations.push("先运行 `npm run build`，确保 `dist/index.js` 存在后再接入 OpenCode。");
  }

  if (!effectiveMcpConfig) {
    checks.push({
      id: "mcp_enabled",
      label: "MCP 启用状态",
      status: "fail",
      summary: `在有效配置中没有找到 MCP 项 \`${input.effectiveMcpName}\`。`
    });
    recommendations.push(`确认 OpenCode 有名为 \`${input.effectiveMcpName}\` 的 MCP 配置项。`);
  } else if (effectiveMcpConfig.enabled === false) {
    checks.push({
      id: "mcp_enabled",
      label: "MCP 启用状态",
      status: "fail",
      summary: `有效配置中的 \`${input.effectiveMcpName}.enabled\` 当前为 false。`
    });
    recommendations.push(`把有效配置中的 \`${input.effectiveMcpName}.enabled\` 改成 true。`);
  } else {
    checks.push({
      id: "mcp_enabled",
      label: "MCP 启用状态",
      status: "pass",
      summary: `有效配置中的 \`${input.effectiveMcpName}\` 已启用。`
    });
  }

  if (!commandTarget) {
    checks.push({
      id: "command_target",
      label: "MCP 启动路径",
      status: "fail",
      summary: "未检测到 MCP command target。"
    });
    recommendations.push("确认 MCP `command` 至少包含启动命令和 `dist/index.js` 路径。");
  } else if (input.platform === "linux" && isWindowsStylePath(commandTarget)) {
    checks.push({
      id: "command_target",
      label: "MCP 启动路径",
      status: "fail",
      summary: `当前在 Linux/WSL 环境下仍使用 Windows 路径：${commandTarget}`
    });
    recommendations.push("如果你在 WSL/Linux 中运行 OpenCode，请把 MCP 启动路径改成 WSL/Linux 可访问路径，而不是 `C:/...` 这种 Windows 路径。");
  } else if (!normalizedCommandTarget || !normalizedCommandTarget.endsWith("/dist/index.js")) {
    checks.push({
      id: "command_target",
      label: "MCP 启动路径",
      status: "warn",
      summary: `当前 command target 不是常见的 dist 入口：${commandTarget}`
    });
    recommendations.push(`确认 MCP command target 指向当前仓库构建产物（通常是 \`${input.expectedDistEntry}\`）。`);
  } else if (normalizedCommandTarget !== normalizedExpectedDistEntry) {
    checks.push({
      id: "command_target",
      label: "MCP 启动路径",
      status: "warn",
      summary: `当前 command target 为 ${commandTarget}，与当前项目构建产物 ${input.expectedDistEntry} 不一致。`
    });
    recommendations.push(`如果你现在调试的是当前仓库，请把 MCP command target 对齐到 \`${input.expectedDistEntry}\`。`);
  } else {
    checks.push({
      id: "command_target",
      label: "MCP 启动路径",
      status: "pass",
      summary: `当前 command target 已指向当前项目产物：${commandTarget}`
    });
  }

  const upstreamMode = input.upstreamMode ?? "external";

  if (input.upstreamBaseUrls.length === 0) {
    checks.push({
      id: "upstream",
      label: "HLTV 上游连通性",
      status: "warn",
      summary: "没有可用的上游 base URL 可探测。"
    });
    if (upstreamMode === "managed") {
      recommendations.push(
        `当前为 managed upstream 模式；确认 \`HLTV_UPSTREAM_PYTHON_PATH\` 指向可执行解释器，\`HLTV_UPSTREAM_WORKDIR\` 指向 hltv-api-fixed 目录，并检查端口/健康检查配置${describeManagedUpstream(input.managedUpstream)}。`
      );
    } else {
      recommendations.push("确认 `HLTV_API_BASE_URL`（以及必要时的 `HLTV_API_FALLBACK_BASE_URL`）已经在 MCP environment 中配置。");
    }
  } else if (!hasPassingUpstreamProbe(input.upstreamProbeResults)) {
    const sampleFailure = input.upstreamProbeResults[0];
    checks.push({
      id: "upstream",
      label: "HLTV 上游连通性",
      status: "fail",
      summary: sampleFailure
        ? `所有上游探测都失败了；首个失败：${sampleFailure.url}${sampleFailure.error ? ` (${sampleFailure.error})` : ""}`
        : "所有上游探测都失败了。"
    });
    if (upstreamMode === "managed") {
      recommendations.push(
        `当前为 managed upstream 模式，\`HLTV_API_BASE_URL\` 会被忽略；请确认 \`HLTV_UPSTREAM_PYTHON_PATH\`（默认 hltv-api-fixed/env/bin/python）存在且可执行、\`HLTV_UPSTREAM_WORKDIR\` 指向 hltv-api-fixed、端口未被占用，并检查健康路径${describeManagedUpstream(input.managedUpstream)}。如果你想连接外部已运行的上游，请显式设置 \`HLTV_UPSTREAM_MANAGED=false\` 后再配置 \`HLTV_API_BASE_URL\`。`
      );
    } else {
      recommendations.push("检查 `HLTV_API_BASE_URL` 是否可达；如果你在 WSL 中而上游跑在 Windows 宿主机，请再确认 `HLTV_API_FALLBACK_BASE_URL` 或 WSL 自动 fallback 是否生效。");
    }
  } else {
    const successfulResult = input.upstreamProbeResults.find((result) => result.ok)!;
    checks.push({
      id: "upstream",
      label: "HLTV 上游连通性",
      status: "pass",
      summary: `至少一个上游探测成功：${successfulResult.url}${successfulResult.status ? ` (HTTP ${successfulResult.status})` : ""}`
    });
  }

  return {
    ok: checks.every((check) => check.status === "pass"),
    checks,
    recommendations
  };
}
