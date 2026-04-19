import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryCache } from "./cache/memoryCache.js";
import { COMMAND_REGISTRY, CommandHandlers } from "./commands/commandHandlers.js";
import type { AppConfig } from "./config/env.js";
import { newsSchema } from "./mcp/schemas.js";
import { ChineseRenderer } from "./renderers/chineseRenderer.js";
import { HltvFacade } from "./services/hltvFacade.js";
import { SummaryService } from "./services/summaryService.js";
import type { ToolResponse } from "./types/common.js";
import type { NewsItem } from "./types/hltv.js";

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
    newsCacheTtlSec: 60
  };
}

function createRawNews(total: number): unknown[] {
  return Array.from({ length: total }, (_, index) => ({
    title: `Story ${index + 1}`,
    date: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    tag: index % 2 === 0 ? "Rio" : "Major"
  }));
}

function readProjectText(pathFromProjectRoot: string): string {
  return readFileSync(new URL(`../${pathFromProjectRoot}`, import.meta.url), "utf8");
}

test("news schema enforces pagination validators", () => {
  assert.equal(newsSchema.limit.safeParse(25).success, true);
  assert.equal(newsSchema.limit.safeParse(0).success, false);
  assert.equal(newsSchema.limit.safeParse(51).success, false);

  assert.equal(newsSchema.page.safeParse(1).success, true);
  assert.equal(newsSchema.page.safeParse(0).success, false);

  assert.equal(newsSchema.offset.safeParse(0).success, true);
  assert.equal(newsSchema.offset.safeParse(-1).success, false);
});

test("news digest defaults to 25 items and exposes continuation metadata", async () => {
  const facade = new HltvFacade(
    createConfig(),
    { getNews: async () => createRawNews(60) } as never,
    new MemoryCache(),
    {} as never,
    {} as never
  );

  const response = await facade.getNewsDigest({});

  assert.equal(response.items?.length, 25);
  assert.equal(response.items?.[0]?.title, "Story 1");
  assert.equal(response.query.limit, 25);
  assert.deepEqual(response.meta.pagination, {
    offset: 0,
    limit: 25,
    returned: 25,
    total: 60,
    has_more: true,
    current_page: 1,
    next_offset: 25,
    next_page: 2
  });
});

test("news digest supports page/offset after tag filtering", async () => {
  const facade = new HltvFacade(
    createConfig(),
    { getNews: async () => createRawNews(80) } as never,
    new MemoryCache(),
    {} as never,
    {} as never
  );

  const byPage = await facade.getNewsDigest({
    limit: 10,
    page: 2,
    tag: "Rio"
  });
  assert.equal(byPage.items?.[0]?.title, "Story 21");
  assert.equal(byPage.query.offset, 10);
  assert.equal(byPage.query.page, 2);
  assert.equal(byPage.meta.pagination?.offset, 10);
  assert.equal(byPage.meta.pagination?.current_page, 2);
  assert.equal(byPage.query.page, byPage.meta.pagination?.current_page);

  const byOffset = await facade.getNewsDigest({
    limit: 10,
    offset: 20,
    page: 2,
    tag: "Rio"
  });
  assert.equal(byOffset.items?.[0]?.title, "Story 41");
  assert.equal(byOffset.query.offset, 20);
  assert.equal(byOffset.query.page, 3);
  assert.equal(byOffset.meta.pagination?.offset, 20);
  assert.equal(byOffset.meta.pagination?.current_page, 3);
  assert.equal(byOffset.query.page, byOffset.meta.pagination?.current_page);
});

test("news digest cache key uses effective pagination when offset is provided", async () => {
  let callCount = 0;
  const facade = new HltvFacade(
    createConfig(),
    {
      getNews: async () => {
        callCount += 1;
        return createRawNews(80);
      }
    } as never,
    new MemoryCache(),
    {} as never,
    {} as never
  );

  const first = await facade.getNewsDigest({
    limit: 10,
    offset: 20,
    page: 99,
    tag: "Rio"
  });
  assert.equal(first.meta.cache_hit, false);
  assert.equal(first.query.page, first.meta.pagination?.current_page);

  const second = await facade.getNewsDigest({
    limit: 10,
    offset: 20,
    page: 1,
    tag: "Rio"
  });
  assert.equal(second.meta.cache_hit, true);
  assert.equal(second.query.page, second.meta.pagination?.current_page);
  assert.equal(callCount, 1);
});

test("renderNews omits source, uses shanghai fallback, and shows continuation hint", () => {
  const renderer = new ChineseRenderer(new SummaryService("raw"));
  const response: ToolResponse<never, NewsItem> = {
    query: {},
    items: [{ title: "Spirit reach Rio final", published_at: "2026-04-17T16:00:00.000Z", tag: "IEM Rio" }],
    meta: {
      source: "hltv-scraper-api",
      fetched_at: "2026-04-19T04:32:00.000Z",
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

  const text = renderer.renderNews(response);
  assert.match(text, /Spirit reach Rio final/);
  assert.match(text, /IEM Rio/);
  assert.match(text, /下一页|继续|offset=25|page=2/);
  assert.doesNotMatch(text, /【来源】/);
  assert.equal(text.match(/【更新时间】/g)?.length ?? 0, 1);
});

test("renderNews uses 暂无匹配新闻 for empty pages", () => {
  const renderer = new ChineseRenderer(new SummaryService("raw"));
  const response: ToolResponse<never, NewsItem> = {
    query: {},
    items: [],
    meta: {
      source: "hltv-scraper-api",
      fetched_at: "2026-04-19T04:32:00.000Z",
      timezone: "Asia/Shanghai",
      cache_hit: false,
      ttl_sec: 60,
      schema_version: "test",
      partial: false,
      pagination: {
        offset: 25,
        limit: 25,
        returned: 0,
        total: 25,
        has_more: false,
        current_page: 2
      }
    },
    error: null
  };

  const text = renderer.renderNews(response);
  assert.match(text, /暂无匹配新闻/);
  assert.match(text, /【分页】当前 25-25 \/ 共 25|【分页】当前 0 条 \/ 共 25/);
});

test("news command defaults to 25 and docs mention continuation plus chinese titles", async () => {
  let receivedLimit: number | undefined;
  const handlers = new CommandHandlers(
    {
      getNewsDigest: async (query: { limit?: number }) => {
        receivedLimit = query.limit;
        return {
          query,
          items: [],
          meta: {
            source: "test",
            fetched_at: new Date("2026-04-19T04:32:00.000Z").toISOString(),
            timezone: "Asia/Shanghai",
            cache_hit: false,
            ttl_sec: 0,
            schema_version: "test",
            partial: false
          },
          error: null
        };
      }
    } as never,
    {
      renderNews: () => "news"
    } as never
  );

  await handlers.news();

  assert.equal(receivedLimit, 25);
  assert.match(COMMAND_REGISTRY.news.usage, /25|page|offset/i);
  assert.match(readProjectText("docs/templates/opencode.commands.news.md"), /继续/);
  assert.match(readProjectText("docs/templates/opencode.commands.news.md"), /中文标题/);
  assert.doesNotMatch(readProjectText("docs/templates/opencode.commands.news.md"), /来源/);
});

test("news command forwards explicit page and offset", async () => {
  let receivedQuery:
    | {
        limit?: number;
        tag?: string;
        page?: number;
        offset?: number;
      }
    | undefined;

  const handlers = new CommandHandlers(
    {
      getNewsDigest: async (query: {
        limit?: number;
        tag?: string;
        page?: number;
        offset?: number;
      }) => {
        receivedQuery = query;
        return {
          query,
          items: [],
          meta: {
            source: "test",
            fetched_at: new Date("2026-04-19T04:32:00.000Z").toISOString(),
            timezone: "Asia/Shanghai",
            cache_hit: false,
            ttl_sec: 0,
            schema_version: "test",
            partial: false
          },
          error: null
        };
      }
    } as never,
    {
      renderNews: () => "news"
    } as never
  );

  await handlers.news(25, "iem-rio", 2, 25);

  assert.deepEqual(receivedQuery, {
    limit: 25,
    tag: "iem-rio",
    page: 2,
    offset: 25
  });
});
