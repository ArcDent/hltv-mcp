import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMMAND_REGISTRY, CommandHandlers } from "./commands/commandHandlers.js";
import { HltvFacade } from "./services/hltvFacade.js";
import { createMcpServer } from "./mcp/server.js";
import { loadConfig } from "./config/env.js";
import { ChineseRenderer } from "./renderers/chineseRenderer.js";
import type { AppConfig } from "./config/env.js";
import type { ToolResponse } from "./types/common.js";
import type { NormalizedMatch } from "./types/hltv.js";
import { parseMatchCommandArgs } from "./services/matchCommandParser.js";
import { isLikelyAutofilledUpcomingQuery } from "./services/upcomingMatchesQuery.js";
import {
  matchCommandParseSchema,
  matchesSchema,
  newsSchema,
  playerRecentSchema,
  resultsSchema,
  teamRecentSchema
} from "./mcp/schemas.js";
import { FIXED_TIMEZONE } from "./utils/time.js";

function createConfig(): AppConfig {
  return {
    mcpServerName: "hltv-mcp-service",
    mcpServerVersion: "0.3.0",
    hltvApiBaseUrl: "http://127.0.0.1:8020",
    hltvApiBaseUrls: ["http://127.0.0.1:8020"],
    hltvApiTimeoutMs: 1_000,
    defaultResultLimit: 5,
    summaryMode: "template",
    entityCacheTtlSec: 60,
    teamRecentCacheTtlSec: 60,
    playerRecentCacheTtlSec: 60,
    resultsCacheTtlSec: 60,
    matchesCacheTtlSec: 60,
    newsCacheTtlSec: 60,
    realtimeNewsCacheTtlSec: 60
  };
}

function createMatchResponse(query: Record<string, unknown>): ToolResponse<never, NormalizedMatch> {
  return {
    query,
    items: [],
    meta: {
      source: "test",
      fetched_at: new Date("2026-04-14T00:00:00.000Z").toISOString(),
      timezone: FIXED_TIMEZONE,
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

function createRenderer(): ChineseRenderer {
  return new ChineseRenderer({
    summarizeMatches: () => "summary",
    summarizeResults: () => "summary",
    summarizeRealtimeNews: () => "summary",
    summarizeNews: () => "summary",
    summarizeTeam: () => "summary",
    summarizePlayer: () => "summary"
  } as never);
}

test("blank parser input stays empty and parser strips timezone fragments", () => {
  assert.deepEqual(parseMatchCommandArgs({ raw_args: "   " }), {
    raw_args: undefined,
    payload: {},
    dropped_fields: []
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "Spirit 3" }), {
    raw_args: "Spirit 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: []
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "team: Spirit, timezone: UTC, limit: 3" }), {
    raw_args: "team: Spirit, timezone: UTC, limit: 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "Spirit timezone: UTC 3" }), {
    raw_args: "Spirit timezone: UTC 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "Spirit timezone: UTC+08:00 3" }), {
    raw_args: "Spirit timezone: UTC+08:00 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "team: Spirit timezone: UTC+08:00 limit: 3" }), {
    raw_args: "team: Spirit timezone: UTC+08:00 limit: 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "team: Spirit timezone: UTC 3" }), {
    raw_args: "team: Spirit timezone: UTC 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "event: IEM Rio timezone: UTC+08:00 3" }), {
    raw_args: "event: IEM Rio timezone: UTC+08:00 3",
    payload: {
      event: "IEM Rio",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "Spirit UTC+08:00 3" }), {
    raw_args: "Spirit UTC+08:00 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "IEM Rio UTC+08:00 3" }), {
    raw_args: "IEM Rio UTC+08:00 3",
    payload: {
      event: "IEM Rio",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "Spirit Asia/Shanghai 3" }), {
    raw_args: "Spirit Asia/Shanghai 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "IEM Rio Asia/Shanghai 3" }), {
    raw_args: "IEM Rio Asia/Shanghai 3",
    payload: {
      event: "IEM Rio",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "team: Spirit Asia/Shanghai 3" }), {
    raw_args: "team: Spirit Asia/Shanghai 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "team: Spirit UTC+08:00 3" }), {
    raw_args: "team: Spirit UTC+08:00 3",
    payload: {
      team: "Spirit",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });

  assert.deepEqual(parseMatchCommandArgs({ raw_args: "event: IEM Rio UTC 3" }), {
    raw_args: "event: IEM Rio UTC 3",
    payload: {
      event: "IEM Rio",
      limit: 3
    },
    dropped_fields: ["timezone"]
  });
});

test("generic fabricated today payloads are treated as suspicious autofill", () => {
  assert.equal(
    isLikelyAutofilledUpcomingQuery({
      team: "today matches",
      event: "today",
      limit: 1,
      days: 1
    }),
    true
  );

  assert.equal(
    isLikelyAutofilledUpcomingQuery({
      team: "Spirit",
      event: "IEM Rio",
      limit: 1,
      days: 1
    }),
    false
  );
});

test("fixed Shanghai contract is reflected by config and mcp schemas", () => {
  const config = loadConfig({} as NodeJS.ProcessEnv);

  assert.equal(FIXED_TIMEZONE, "Asia/Shanghai");
  assert.equal(config.mcpServerVersion, "0.3.0");
  assert.equal(Object.prototype.hasOwnProperty.call(config, "defaultTimezone"), false);

  assert.equal(Object.prototype.hasOwnProperty.call(teamRecentSchema, "timezone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(playerRecentSchema, "timezone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(resultsSchema, "timezone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(matchesSchema, "timezone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(matchCommandParseSchema, "timezone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(newsSchema, "timezone"), false);
});

test("naive upstream timestamps are normalized as Asia/Shanghai local time even on UTC hosts", () => {
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      `import('./dist/utils/time.js').then(({ normalizeDateTime, formatDateTime, dateKeyInFixedTimezone, todayDateKey }) => {
        const normalized = normalizeDateTime('2026-04-19 19:00');
        const lateNight = normalizeDateTime('2026-04-19 23:30');
        process.stdout.write(JSON.stringify({
          normalized,
          rendered: formatDateTime(normalized),
          lateNightDateKey: dateKeyInFixedTimezone(lateNight),
          referenceDateKey: todayDateKey(new Date('2026-04-19T15:00:00.000Z'))
        }));
      });`
    ],
    {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        TZ: "UTC"
      },
      encoding: "utf8"
    }
  );

  const parsed = JSON.parse(output) as {
    normalized: string;
    rendered: string;
    lateNightDateKey: string;
    referenceDateKey: string;
  };

  assert.equal(parsed.normalized, "2026-04-19T11:00:00.000Z");
  assert.equal(parsed.rendered, "2026/04/19 19:00");
  assert.equal(parsed.lateNightDateKey, parsed.referenceDateKey);
});

test("renderer always formats match times in fixed Shanghai time", () => {
  const response = createMatchResponse({ today_only: true, timezone: "UTC" });
  response.items = [
    {
      team1: "Spirit",
      team2: "Vitality",
      event: "IEM Rio 2026",
      scheduled_at: "2026-04-19T11:00:00.000Z"
    }
  ];

  const rendered = createRenderer().renderMatches(response);

  assert.match(rendered, /2026\/04\/19 19:00/);
  assert.doesNotMatch(rendered, /2026\/04\/19 11:00/);
});

test("bare command handler routes to today matches", async () => {
  let getTodayMatchesCalls = 0;
  let getUpcomingMatchesCalls = 0;

  const handlers = new CommandHandlers(
    {
      getTodayMatches: async () => {
        getTodayMatchesCalls += 1;
        return createMatchResponse({ today_only: true });
      },
      getUpcomingMatches: async () => {
        getUpcomingMatchesCalls += 1;
        return createMatchResponse({ today_only: false });
      }
    } as unknown as HltvFacade,
    {
      renderMatches: (response: ToolResponse<never, NormalizedMatch>) => JSON.stringify(response.query)
    } as never
  );

  const rendered = await handlers.match();

  assert.equal(getTodayMatchesCalls, 1);
  assert.equal(getUpcomingMatchesCalls, 0);
  assert.equal(rendered, JSON.stringify({ today_only: true }));
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
        return createMatchResponse({ today_only: true });
      },
      getUpcomingMatches: async () => {
        getUpcomingMatchesCalls += 1;
        return createMatchResponse({ today_only: false });
      }
    } as unknown as HltvFacade,
    {
      renderMatches: (response: ToolResponse<never, NormalizedMatch>) => JSON.stringify(response.query)
    } as never
  );

  const rendered = await handlers.match("Spirit", "IEM Melbourne", 3);

  assert.equal(getTodayMatchesCalls, 1);
  assert.equal(getUpcomingMatchesCalls, 0);
  assert.equal(rendered, JSON.stringify({ today_only: true }));
});

test("docs match template is today-only", () => {
  assertTodayOnlyMatchTemplate(readProjectText("docs/templates/opencode.commands.match.md"));
});

test("example match template is today-only", () => {
  assertTodayOnlyMatchTemplate(readProjectText("examples/opencode-project/.opencode/commands/match.md"));
});

test("docs and release metadata reflect the fixed Shanghai contract", () => {
  assert.doesNotMatch(readProjectText(".env.example"), /DEFAULT_TIMEZONE/);
  assert.doesNotMatch(readProjectText("README.md"), /DEFAULT_TIMEZONE/);
  assert.doesNotMatch(readProjectText("docs/templates/opencode.jsonc"), /DEFAULT_TIMEZONE/);
  assert.doesNotMatch(readProjectText("examples/opencode-project/opencode.jsonc"), /DEFAULT_TIMEZONE/);
  assert.match(readProjectText("README.md"), /固定.*Asia\/Shanghai|Asia\/Shanghai.*固定/);
  assert.match(readProjectText(".env.example"), /MCP_SERVER_VERSION=0\.3\.0/);
  assert.match(readProjectText("package.json"), /"version":\s*"0\.3\.0"/);
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
    return createMatchResponse({ today_only: true });
  };

  const response = await facade.getTodayMatches();

  assert.deepEqual(capturedQuery, {});
  assert.deepEqual(response.query, { today_only: true });
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
      getResultsRecent: async () => createMatchResponse({}),
      getTodayMatches: async () => {
        getTodayMatchesCalls += 1;
        return createMatchResponse({ today_only: true });
      },
      getUpcomingMatches: async () => createMatchResponse({ today_only: false }),
      getRealtimeNews: async () => ({ query: {}, items: [], meta: createMatchResponse({}).meta, error: null }),
      getNewsDigest: async () => ({ query: {}, items: [], meta: createMatchResponse({}).meta, error: null })
    } as unknown as HltvFacade,
    {
      renderResolveResult: () => "resolve",
      renderTeamRecent: () => "team",
      renderPlayerRecent: () => "player",
      renderResults: () => "results",
      renderMatches: () => "matches",
      renderRealtimeNews: () => "realtime",
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
  assert.doesNotMatch(tools.hltv_matches_today.description ?? "", /active timezone/i);
  assert.doesNotMatch(tools.hltv_matches_upcoming.description ?? "", /only timezone/i);

  const result = (await tools.hltv_matches_today.handler({})) as {
    structuredContent?: { query?: Record<string, unknown> };
    isError?: boolean;
  };

  assert.equal(getTodayMatchesCalls, 1);
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent?.query, {
    today_only: true
  });
});
