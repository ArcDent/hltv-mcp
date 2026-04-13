export type SummaryMode = "template" | "raw";

export interface AppConfig {
  mcpServerName: string;
  mcpServerVersion: string;
  hltvApiBaseUrl: string;
  hltvApiTimeoutMs: number;
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

function readString(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readSummaryMode(value: string | undefined): SummaryMode {
  return value === "raw" ? "raw" : "template";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    mcpServerName: readString(env.MCP_SERVER_NAME, "hltv-mcp-service"),
    mcpServerVersion: readString(env.MCP_SERVER_VERSION, "0.2.0"),
    hltvApiBaseUrl: readString(env.HLTV_API_BASE_URL, "http://127.0.0.1:8020"),
    hltvApiTimeoutMs: readNumber(env.HLTV_API_TIMEOUT_MS, 8_000),
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
