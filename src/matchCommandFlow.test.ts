import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMMAND_REGISTRY, CommandHandlers } from "./commands/commandHandlers.js";
import { HltvFacade } from "./services/hltvFacade.js";
import { createMcpServer } from "./mcp/server.js";
import type { AppConfig } from "./config/env.js";
import type { ToolResponse } from "./types/common.js";
import type { NormalizedMatch } from "./types/hltv.js";
import { parseMatchCommandArgs } from "./services/matchCommandParser.js";
import { isLikelyAutofilledUpcomingQuery } from "./services/upcomingMatchesQuery.js";

function createConfig(): AppConfig {
  return {
    mcpServerName: "hltv-mcp-service",
    mcpServerVersion: "0.2.0",
    hltvApiBaseUrl: "http://127.0.0.1:8020",
    hltvApiBaseUrls: ["http://127.0.0.1:8020"],
    hltvApiTimeoutMs: 1_000,
    defaultTimezone: "Asia/Shanghai",
    defaultResultLimit: 5,
    summaryMode: "template",
    entityCacheTtlSec: 60,
    teamRecentCacheTtlSec: 60,
    playerRecentCacheTtlSec: 60,
    resultsCacheTtlSec: 60,
    matchesCacheTtlSec: 60,
    newsCacheTtlSec: 60
  };
}

function createMatchResponse(query: Record<string, unknown>): ToolResponse<never, NormalizedMatch> {
  return {
    query,
    items: [],
    meta: {
      source: "test",
      fetched_at: new Date("2026-04-14T00:00:00.000Z").toISOString(),
      timezone: (query.timezone as string | undefined) ?? "Asia/Shanghai",
      cache_hit: false,
      ttl_sec: 0,
      schema_version: "test",
      partial: false
    },
    error: null
  };
}

function readProjectText(pathFromProjectRoot: string): string {
  return readFileSync(new URL(`../${pathFromProjectRoot}`, import.meta.url), "utf8");
}

function assertTodayOnlyMatchTemplate(content: string): void {
  assert.match(content, /hltv_local_hltv_matches_today\(\{\}\)/);
  assert.doesNotMatch(content, /hltv_local_match_command_parse/);
  assert.doesNotMatch(content, /hltv_local_hltv_matches_upcoming/);
  assert.doesNotMatch(content, /\/match\s+Spirit/);
  assert.doesNotMatch(content, /\/match\s+IEM\s+Melbourne/);
}

test("blank parser input stays empty and explicit filters survive parsing", () => {
  assert.deepEqual(parseMatchCommandArgs({ raw_args: "   " }), {
    raw_args: undefined,
    payload: {},
    dropped_fields: []
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "Spirit 3", timezone: "Asia/Shanghai" }), {
    raw_args: "Spirit 3",
    payload: {
      team: "Spirit",
      limit: 3,
      timezone: "Asia/Shanghai"
    },
    dropped_fields: []
  });
});

test("generic fabricated today payloads are treated as suspicious autofill", () => {
  assert.equal(
    isLikelyAutofilledUpcomingQuery({
      team: "today matches",
      event: "today",
      limit: 1,
      days: 1,
      timezone: "UTC"
    }),
    true
  );

  assert.equal(
    isLikelyAutofilledUpcomingQuery({
      team: "Spirit",
      event: "IEM Rio",
      limit: 1,
      days: 1,
      timezone: "UTC"
    }),
    false
  );
});

test("bare command handler routes to today matches", async () => {
  let getTodayMatchesCalls = 0;
  let getUpcomingMatchesCalls = 0;

  const handlers = new CommandHandlers(
    {
      getTodayMatches: async () => {
        getTodayMatchesCalls += 1;
        return createMatchResponse({ timezone: "Asia/Shanghai", today_only: true });
      },
      getUpcomingMatches: async () => {
        getUpcomingMatchesCalls += 1;
        return createMatchResponse({ timezone: "Asia/Shanghai", today_only: false });
      }
    } as unknown as HltvFacade,
    {
      renderMatches: (response: ToolResponse<never, NormalizedMatch>) => JSON.stringify(response.query)
    } as never
  );

  const rendered = await handlers.match();

  assert.equal(getTodayMatchesCalls, 1);
  assert.equal(getUpcomingMatchesCalls, 0);
  assert.equal(rendered, JSON.stringify({ timezone: "Asia/Shanghai", today_only: true }));
});

test("match registry advertises today-only usage", () => {
  assert.match(COMMAND_REGISTRY.match.description, /今日赛程|仅支持无参数/);
  assert.equal(COMMAND_REGISTRY.match.usage, "/Match");
});

test("match command ignores arguments and still routes to today matches", async () => {
  let getTodayMatchesCalls = 0;
  let getUpcomingMatchesCalls = 0;

  const handlers = new CommandHandlers(
    {
      getTodayMatches: async () => {
        getTodayMatchesCalls += 1;
        return createMatchResponse({ timezone: "Asia/Shanghai", today_only: true });
      },
      getUpcomingMatches: async () => {
        getUpcomingMatchesCalls += 1;
        return createMatchResponse({ timezone: "Asia/Shanghai", today_only: false });
      }
    } as unknown as HltvFacade,
    {
      renderMatches: (response: ToolResponse<never, NormalizedMatch>) => JSON.stringify(response.query)
    } as never
  );

  const rendered = await handlers.match("Spirit", "IEM Melbourne", 3);

  assert.equal(getTodayMatchesCalls, 1);
  assert.equal(getUpcomingMatchesCalls, 0);
  assert.equal(rendered, JSON.stringify({ timezone: "Asia/Shanghai", today_only: true }));
});

test("docs match template is today-only", () => {
  assertTodayOnlyMatchTemplate(readProjectText("docs/templates/opencode.commands.match.md"));
});

test("example match template is today-only", () => {
  assertTodayOnlyMatchTemplate(readProjectText("examples/opencode-project/.opencode/commands/match.md"));
});

test("today facade helper delegates with an empty upcoming query", async () => {
  const facade = new HltvFacade(
    createConfig(),
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  let capturedQuery: unknown;
  facade.getUpcomingMatches = async (query) => {
    capturedQuery = query as Record<string, unknown>;
    return createMatchResponse({ timezone: "Asia/Shanghai", today_only: true });
  };

  const response = await facade.getTodayMatches();

  assert.deepEqual(capturedQuery, {});
  assert.equal(response.query.today_only, true);
});

test("mcp server registers and executes the bare match tool", async () => {
  let getTodayMatchesCalls = 0;

  const server = createMcpServer(
    createConfig(),
    {
      resolveTeam: async () => ({ query: {}, items: [], meta: createMatchResponse({}).meta, error: null }),
      resolvePlayer: async () => ({ query: {}, items: [], meta: createMatchResponse({}).meta, error: null }),
      getTeamRecent: async () => ({ query: {}, data: undefined, meta: createMatchResponse({}).meta, error: null }),
      getPlayerRecent: async () => ({ query: {}, data: undefined, meta: createMatchResponse({}).meta, error: null }),
      getResultsRecent: async () => createMatchResponse({ timezone: "Asia/Shanghai" }),
      getTodayMatches: async () => {
        getTodayMatchesCalls += 1;
        return createMatchResponse({ timezone: "Asia/Shanghai", today_only: true });
      },
      getUpcomingMatches: async () => createMatchResponse({ timezone: "Asia/Shanghai", today_only: false }),
      getNewsDigest: async () => ({ query: {}, items: [], meta: createMatchResponse({}).meta, error: null })
    } as unknown as HltvFacade,
    {
      renderResolveResult: () => "resolve",
      renderTeamRecent: () => "team",
      renderPlayerRecent: () => "player",
      renderResults: () => "results",
      renderMatches: () => "matches",
      renderNews: () => "news"
    } as never
  );

  const tools = (
    server as unknown as {
      _registeredTools: Record<string, { description?: string; handler: (input: unknown) => Promise<unknown> }>;
    }
  )._registeredTools;

  assert.ok(tools.hltv_matches_today);
  assert.match(tools.match_command_parse.description ?? "", /Skip this tool for bare \/match/i);

  const result = (await tools.hltv_matches_today.handler({})) as {
    structuredContent?: { query?: Record<string, unknown> };
    isError?: boolean;
  };

  assert.equal(getTodayMatchesCalls, 1);
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent?.query, {
    timezone: "Asia/Shanghai",
    today_only: true
  });
});
