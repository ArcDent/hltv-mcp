import { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SummaryMode = "template" | "raw";

export interface AppConfig {
  mcpServerName: string;
  mcpServerVersion: string;
  hltvApiBaseUrl: string;
  hltvApiBaseUrls: string[];
  managedUpstreamEnabled?: boolean;
  managedUpstreamPythonPath?: string;
  managedUpstreamWorkdir?: string;
  managedUpstreamHost?: string;
  managedUpstreamPort?: number;
  managedUpstreamHealthPath?: string;
  managedUpstreamStartTimeoutMs?: number;
  hltvApiTimeoutMs: number;
  defaultResultLimit: number;
  summaryMode: SummaryMode;
  entityCacheTtlSec: number;
  teamRecentCacheTtlSec: number;
  playerRecentCacheTtlSec: number;
  resultsCacheTtlSec: number;
  matchesCacheTtlSec: number;
  newsCacheTtlSec: number;
  realtimeNewsCacheTtlSec: number;
}

function readString(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function readOptionalString(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readSummaryMode(value: string | undefined): SummaryMode {
  return value === "raw" ? "raw" : "template";
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);

    if (!url.pathname || url.pathname === "") {
      url.pathname = "/";
    } else if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function normalizeHealthPath(value: string): string {
  if (value.startsWith("/")) {
    return value;
  }

  return `/${value}`;
}

function isLoopbackLikeHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "0.0.0.0";
}

function isRunningInWsl(env: NodeJS.ProcessEnv): boolean {
  if (process.platform !== "linux") {
    return false;
  }

  if (readOptionalString(env.WSL_DISTRO_NAME) || readOptionalString(env.WSL_INTEROP)) {
    return true;
  }

  if (os.release().toLowerCase().includes("microsoft")) {
    return true;
  }

  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

function detectWslHostIp(): string | undefined {
  try {
    const resolvConf = readFileSync("/etc/resolv.conf", "utf8");
    const match = resolvConf.match(/^nameserver\s+(?<ip>[^\s#]+)$/m);
    return match?.groups?.ip;
  } catch {
    return undefined;
  }
}

function buildHltvApiBaseUrls(env: NodeJS.ProcessEnv): string[] {
  const primaryBaseUrl = normalizeBaseUrl(readString(env.HLTV_API_BASE_URL, "http://127.0.0.1:8020"));
  const configuredFallbackBaseUrl = readOptionalString(env.HLTV_API_FALLBACK_BASE_URL);
  const candidates = [primaryBaseUrl];

  if (configuredFallbackBaseUrl) {
    candidates.push(normalizeBaseUrl(configuredFallbackBaseUrl));
  }

  if (!isRunningInWsl(env)) {
    return uniqueStrings(candidates);
  }

  try {
    const primaryUrl = new URL(primaryBaseUrl);

    if (!isLoopbackLikeHost(primaryUrl.hostname)) {
      return uniqueStrings(candidates);
    }

    const detectedHostIp = detectWslHostIp();

    if (!detectedHostIp) {
      return uniqueStrings(candidates);
    }

    const wslReachableUrl = new URL(primaryUrl.toString());
    wslReachableUrl.hostname = detectedHostIp;
    candidates.push(normalizeBaseUrl(wslReachableUrl.toString()));
  } catch {
    return uniqueStrings(candidates);
  }

  return uniqueStrings(candidates);
}

function buildManagedHltvApiBaseUrl(host: string, port: number): string {
  const dialHost = resolveManagedDialHost(host);
  const normalizedHost = net.isIP(dialHost) === 6 ? `[${dialHost}]` : dialHost;
  return normalizeBaseUrl(`http://${normalizedHost}:${port}`);
}

function resolveManagedDialHost(host: string): string {
  const normalized = host.trim().toLowerCase();

  if (normalized === "0.0.0.0") {
    return "127.0.0.1";
  }

  if (normalized === "::") {
    return "::1";
  }

  return host;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const managedUpstreamEnabled = readBoolean(env.HLTV_UPSTREAM_MANAGED, true);
  const managedUpstreamHost = readString(env.HLTV_UPSTREAM_HOST, "127.0.0.1");
  const managedUpstreamPort = readNumber(env.HLTV_UPSTREAM_PORT, 18_020);
  const managedUpstreamWorkdir = readString(env.HLTV_UPSTREAM_WORKDIR, path.join(repositoryRoot, "hltv-api-fixed"));
  const managedUpstreamPythonPath = readString(
    env.HLTV_UPSTREAM_PYTHON_PATH,
    path.join(managedUpstreamWorkdir, "env", "bin", "python")
  );
  const managedUpstreamHealthPath = normalizeHealthPath(readString(env.HLTV_UPSTREAM_HEALTH_PATH, "/healthz"));
  const managedUpstreamStartTimeoutMs = readNumber(env.HLTV_UPSTREAM_START_TIMEOUT_MS, 15_000);

  const hltvApiBaseUrls = managedUpstreamEnabled
    ? [buildManagedHltvApiBaseUrl(managedUpstreamHost, managedUpstreamPort)]
    : buildHltvApiBaseUrls(env);

  return {
    mcpServerName: readString(env.MCP_SERVER_NAME, "hltv-mcp-service"),
    mcpServerVersion: readString(env.MCP_SERVER_VERSION, "0.3.0"),
    hltvApiBaseUrl: hltvApiBaseUrls[0] ?? normalizeBaseUrl("http://127.0.0.1:8020"),
    hltvApiBaseUrls,
    managedUpstreamEnabled,
    managedUpstreamPythonPath,
    managedUpstreamWorkdir,
    managedUpstreamHost,
    managedUpstreamPort,
    managedUpstreamHealthPath,
    managedUpstreamStartTimeoutMs,
    hltvApiTimeoutMs: readNumber(env.HLTV_API_TIMEOUT_MS, 8_000),
    defaultResultLimit: readNumber(env.DEFAULT_RESULT_LIMIT, 5),
    summaryMode: readSummaryMode(env.SUMMARY_MODE),
    entityCacheTtlSec: readNumber(env.ENTITY_CACHE_TTL_SEC, 3_600),
    teamRecentCacheTtlSec: readNumber(env.TEAM_RECENT_CACHE_TTL_SEC, 300),
    playerRecentCacheTtlSec: readNumber(env.PLAYER_RECENT_CACHE_TTL_SEC, 300),
    resultsCacheTtlSec: readNumber(env.RESULTS_CACHE_TTL_SEC, 120),
    matchesCacheTtlSec: readNumber(env.MATCHES_CACHE_TTL_SEC, 60),
    newsCacheTtlSec: readNumber(env.NEWS_CACHE_TTL_SEC, 180),
    realtimeNewsCacheTtlSec: readNumber(env.REALTIME_NEWS_CACHE_TTL_SEC, 60)
  };
}
