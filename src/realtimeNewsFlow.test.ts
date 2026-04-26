import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCache } from "./cache/memoryCache.js";
import { HltvApiClient } from "./clients/hltvApiClient.js";
import { COMMAND_REGISTRY, CommandHandlers } from "./commands/commandHandlers.js";
import type { AppConfig } from "./config/env.js";
import { createMcpServer } from "./mcp/server.js";
import { realtimeNewsSchema } from "./mcp/schemas.js";
import { ChineseRenderer } from "./renderers/chineseRenderer.js";
import { HltvFacade } from "./services/hltvFacade.js";
import { normalizeRealtimeNews } from "./services/hltvNormalizer.js";
import { SummaryService } from "./services/summaryService.js";
import type { ToolResponse } from "./types/common.js";
import type { RealtimeNewsItem } from "./types/hltv.js";

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

function createRawRealtimeNews(total: number): unknown[] {
  return Array.from({ length: total }, (_, index) => ({
    section: index < 3 ? "today" : index < 6 ? "yesterday" : "previous",
    category: index % 2 === 0 ? "Portugal" : "Game update",
    title: `Realtime story ${index + 1}`,
    relative_time: index === 0 ? "15 minutes ago" : `${index + 1} hours ago`,
    comments: `${index} comments`,
    link: `https://www.hltv.org/news/${43000 + index}/story-${index + 1}`,
    summary_hint: index === 0 ? "Feature summary" : undefined
  }));
}

test("realtime news schema supports pagination and has no tag field", () => {
  assert.equal(realtimeNewsSchema.limit.safeParse(25).success, true);
  assert.equal(realtimeNewsSchema.limit.safeParse(0).success, false);
  assert.equal(realtimeNewsSchema.limit.safeParse(51).success, false);
  assert.equal(realtimeNewsSchema.page.safeParse(1).success, true);
  assert.equal(realtimeNewsSchema.offset.safeParse(0).success, true);
  assert.equal("tag" in realtimeNewsSchema, false);
});

test("normalizeRealtimeNews maps live feed fields", () => {
  assert.deepEqual(
    normalizeRealtimeNews([
      {
        section: "today",
        category: "Portugal",
        title: "BCG Masters Championship 2 to be held in Vila Nova de Gaia",
        relative_time: "15 minutes ago",
        comments: "7 comments",
        link: "https://www.hltv.org/news/43001/example",
        summary_hint: "Announced in Portugal"
      }
    ]),
    [
      {
        section: "today",
        category: "Portugal",
        title: "BCG Masters Championship 2 to be held in Vila Nova de Gaia",
        relative_time: "15 minutes ago",
        comments: "7 comments",
        link: "https://www.hltv.org/news/43001/example",
        summary_hint: "Announced in Portugal"
      }
    ]
  );
});

test("api client calls realtime news endpoint", async () => {
  const seenUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seenUrls.push(String(input));
    return new Response(JSON.stringify(createRawRealtimeNews(1)), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const client = new HltvApiClient({
      baseUrl: "http://127.0.0.1:8020",
      timeoutMs: 1_000
    });
    const items = await client.getRealtimeNews();

    assert.equal(items.length, 1);
    assert.equal(seenUrls[0], "http://127.0.0.1:8020/api/v1/news/realtime");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("facade returns realtime news with pagination metadata", async () => {
  const facade = new HltvFacade(
    createConfig(),
    { getRealtimeNews: async () => createRawRealtimeNews(12) } as never,
    new MemoryCache(),
    {} as never,
    {} as never
  );

  const response = await facade.getRealtimeNews({ limit: 5, page: 2 });

  assert.equal(response.items?.length, 5);
  assert.equal(response.items?.[0]?.title, "Realtime story 6");
  assert.deepEqual(response.query, { limit: 5, offset: 5, page: 2 });
  assert.deepEqual(response.meta.pagination, {
    offset: 5,
    limit: 5,
    returned: 5,
    total: 12,
    has_more: true,
    current_page: 2,
    next_offset: 10,
    next_page: 3
  });
});

test("renderRealtimeNews shows live fields and omits source", () => {
  const renderer = new ChineseRenderer(new SummaryService("template"));
  const response: ToolResponse<never, RealtimeNewsItem> = {
    query: { limit: 25, offset: 0, page: 1 },
    items: [
      {
        section: "today",
        category: "Portugal",
        title: "BCG Masters Championship 2 to be held in Vila Nova de Gaia",
        relative_time: "15 minutes ago",
        comments: "7 comments",
        summary_hint: "Portuguese event announcement"
      }
    ],
    meta: {
      source: "hltv-scraper-api",
      fetched_at: "2026-04-26T04:32:00.000Z",
      timezone: "Asia/Shanghai",
      cache_hit: false,
      ttl_sec: 60,
      schema_version: "test",
      partial: false,
      pagination: {
        offset: 0,
        limit: 25,
        returned: 1,
        total: 30,
        has_more: true,
        current_page: 1,
        next_offset: 25,
        next_page: 2
      }
    },
    error: null
  };

  const text = renderer.renderRealtimeNews(response);
  assert.match(text, /实时新闻/);
  assert.match(text, /今日/);
  assert.match(text, /Portugal/);
  assert.match(text, /15 minutes ago/);
  assert.match(text, /7 comments/);
  assert.match(text, /下一页|继续|offset=25|page=2/);
  assert.doesNotMatch(text, /【来源】/);
});

test("mcp server registers and executes hltv_realtime_news", async () => {
  const realtimeResponse = {
    query: { limit: 25 },
    items: [],
    meta: {
      source: "test",
      fetched_at: new Date("2026-04-26T04:32:00.000Z").toISOString(),
      timezone: "Asia/Shanghai",
      cache_hit: false,
      ttl_sec: 60,
      schema_version: "test",
      partial: false
    },
    error: null
  };

  let facadeQuery: unknown;
  let rendererInput: unknown;

  const server = createMcpServer(
    createConfig(),
    {
      getRealtimeNews: async (input: { limit?: number; page?: number; offset?: number }) => {
        facadeQuery = input;
        return realtimeResponse;
      }
    } as never,
    {
      renderRealtimeNews: (response: unknown) => {
        rendererInput = response;
        return "实时新闻";
      }
    } as never
  );

  const tools = (
    server as unknown as {
      _registeredTools?: Record<
        string,
        {
          callback?: (input: unknown) => Promise<unknown>;
          handler?: (input: unknown) => Promise<unknown>;
        }
      >;
    }
  )._registeredTools;

  const realtimeTool = tools?.hltv_realtime_news;
  assert.ok(realtimeTool);

  const invoke = realtimeTool.callback ?? realtimeTool.handler;
  assert.ok(invoke);

  const result = (await invoke({ limit: 25 })) as {
    content?: Array<{ text?: string }>;
    structuredContent?: { query?: Record<string, unknown> };
    isError?: boolean;
  };

  assert.deepEqual(facadeQuery, { limit: 25 });
  assert.equal(rendererInput, realtimeResponse);
  assert.equal(result.isError, false);
  assert.equal(result.content?.[0]?.text, "实时新闻");
  assert.deepEqual(result.structuredContent?.query, { limit: 25 });
});

test("news command defaults to realtime news without tag", async () => {
  let receivedQuery: { limit?: number; page?: number; offset?: number; tag?: string } | undefined;
  const handlers = new CommandHandlers(
    {
      getRealtimeNews: async (query: { limit?: number; page?: number; offset?: number; tag?: string }) => {
        receivedQuery = query;
        return {
          query,
          items: [],
          meta: {
            source: "test",
            fetched_at: new Date("2026-04-26T04:32:00.000Z").toISOString(),
            timezone: "Asia/Shanghai",
            cache_hit: false,
            ttl_sec: 60,
            schema_version: "test",
            partial: false
          },
          error: null
        };
      }
    } as never,
    { renderRealtimeNews: () => "实时新闻" } as never
  );

  await handlers.news();

  assert.deepEqual(receivedQuery, { limit: 25 });
  assert.equal("tag" in (receivedQuery ?? {}), false);
  assert.match(COMMAND_REGISTRY.news.usage, /page|offset/i);
});
