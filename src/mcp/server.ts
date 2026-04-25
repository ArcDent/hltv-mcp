import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppConfig } from "../config/env.js";
import { HltvFacade } from "../services/hltvFacade.js";
import { parseMatchCommandArgs } from "../services/matchCommandParser.js";
import { ChineseRenderer } from "../renderers/chineseRenderer.js";
import {
  matchCommandParseSchema,
  matchesSchema,
  matchesTodaySchema,
  newsSchema,
  playerRecentSchema,
  resolveEntitySchema,
  resultsSchema,
  teamRecentSchema
} from "./schemas.js";

function asStructuredContent(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function toolResult(text: string, structuredContent: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: asStructuredContent(structuredContent),
    isError
  };
}

export function createMcpServer(
  config: AppConfig,
  facade: HltvFacade,
  renderer: ChineseRenderer
): McpServer {
  const server = new McpServer({
    name: config.mcpServerName,
    version: config.mcpServerVersion
  });

  server.tool(
    "resolve_team",
    "Resolve a team name to stable HLTV identity candidates.",
    resolveEntitySchema,
    async (input) => {
      const response = await facade.resolveTeam(input);
      return toolResult(renderer.renderResolveResult("队伍候选", response), response, Boolean(response.error));
    }
  );

  server.tool(
    "resolve_player",
    "Resolve a player name to stable HLTV identity candidates.",
    resolveEntitySchema,
    async (input) => {
      const response = await facade.resolvePlayer(input);
      return toolResult(renderer.renderResolveResult("选手候选", response), response, Boolean(response.error));
    }
  );

  server.tool(
    "hltv_team_recent",
    "Get recent state, recent results, and upcoming matches for one team.",
    teamRecentSchema,
    async (input) => {
      const response = await facade.getTeamRecent(input);
      return toolResult(renderer.renderTeamRecent(response), response, Boolean(response.error));
    }
  );

  server.tool(
    "hltv_player_recent",
    "Get recent state and overview statistics for one player.",
    playerRecentSchema,
    async (input) => {
      const response = await facade.getPlayerRecent(input);
      return toolResult(renderer.renderPlayerRecent(response), response, Boolean(response.error));
    }
  );

  server.tool(
    "hltv_results_recent",
    "Get recent HLTV results with optional team or event filters.",
    resultsSchema,
    async (input) => {
      const response = await facade.getResultsRecent(input);
      return toolResult(renderer.renderResults(response), response, Boolean(response.error));
    }
  );

  server.tool(
    "match_command_parse",
    "Parse explicit non-empty /match filter text into a safe payload. Skip this tool for bare /match and call hltv_matches_today directly. Drops invalid, generic, placeholder, or hallucinated fields so slash commands can call hltv_matches_upcoming safely.",
    matchCommandParseSchema,
    async (input) => {
      const parsed = parseMatchCommandArgs(input);
      return toolResult(JSON.stringify(parsed, null, 2), parsed);
    }
  );

  server.tool(
    "hltv_matches_today",
    "Get today's HLTV matches in fixed Asia/Shanghai time. Use this for bare /match with no arguments so the tool call stays parameter-free.",
    matchesTodaySchema,
    async () => {
      const response = await facade.getTodayMatches();
      return toolResult(renderer.renderMatches(response), response, Boolean(response.error));
    }
  );

  server.tool(
    "hltv_matches_upcoming",
    "Get upcoming HLTV matches for explicit filters. For bare /match, prefer hltv_matches_today instead of this tool. For generic requests like 'today matches', '今日赛程', or '今天有什么比赛', omit team/event/limit/days and call with {}.",
    matchesSchema,
    async (input) => {
      const response = await facade.getUpcomingMatches(input);
      return toolResult(renderer.renderMatches(response), response, Boolean(response.error));
    }
  );

  server.tool(
    "hltv_news_digest",
    "Get HLTV monthly archive news. Omit tag for the archive list; tag is only an explicit title/topic filter. Use hltv_realtime_news for latest/today/current news.",
    newsSchema,
    async (input) => {
      const response = await facade.getNewsDigest(input);
      return toolResult(renderer.renderNews(response), response, Boolean(response.error));
    }
  );

  return server;
}

export async function startMcpServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
