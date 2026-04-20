# News Pagination Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/news` default to 25 items with continuation-friendly pagination metadata, remove source from rendered output, and update slash-command docs to support Chinese-title presentation plus `继续` pagination.

**Architecture:** Keep backend responsibilities narrow: the MCP tool adds explicit `page` / `offset` support and returns pagination metadata after tag filtering. Leave Chinese-title generation to the slash-command template because the upstream API has no reliable Chinese title field. Update renderer and docs so direct MCP output and `/news` command behavior stay aligned.

**Tech Stack:** TypeScript, Node.js built-in test runner (`node:test` via `tsx`), Zod schemas, MCP SDK

---

## File Structure

- Modify: `src/types/common.ts`
  - Add a reusable pagination metadata shape to `ToolMeta`.
- Modify: `src/types/hltv.ts`
  - Extend `NewsDigestQuery` with `page` / `offset`.
- Modify: `src/mcp/schemas.ts`
  - Expand `newsSchema` to accept higher `limit` and explicit pagination params.
- Modify: `src/services/hltvFacade.ts`
  - Implement filtered pagination, compute continuation metadata, and keep news-specific default limit at 25.
- Modify: `src/renderers/chineseRenderer.ts`
  - Remove source line from news output, show empty state as `暂无匹配新闻`, and render pagination hints.
- Modify: `src/services/summaryService.ts`
  - Keep summaries aligned with paginated output.
- Modify: `src/commands/commandHandlers.ts`
  - Change `/news` default count from 5 to 25.
- Modify: `docs/templates/opencode.commands.news.md`
  - Update default call behavior, continuation instructions, and output requirements.
- Modify: `examples/opencode-project/.opencode/commands/news.md`
  - Keep example command behavior in sync with the canonical template.
- Modify: `README.md`
  - Document new `/news` defaults and pagination behavior.
- Create: `src/newsCommandFlow.test.ts`
  - Cover facade pagination, renderer rules, command defaults, and template text assertions.

---

### Task 1: Add news pagination contract and backend behavior

**Files:**
- Create: `src/newsCommandFlow.test.ts`
- Modify: `src/types/common.ts`
- Modify: `src/types/hltv.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `src/services/hltvFacade.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCache } from "./cache/memoryCache.js";
import { HltvFacade } from "./services/hltvFacade.js";
import type { AppConfig } from "./config/env.js";

function createConfig(): AppConfig {
  return {
    mcpServerName: "hltv-mcp-service",
    mcpServerVersion: "0.2.0",
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

test("news digest supports page and offset after tag filtering", async () => {
  const facade = new HltvFacade(
    createConfig(),
    { getNews: async () => createRawNews(80) } as never,
    new MemoryCache(),
    {} as never,
    {} as never
  );

  const byPage = await facade.getNewsDigest({ limit: 10, page: 2, tag: "Rio" });
  assert.equal(byPage.items?.[0]?.title, "Story 21");
  assert.equal(byPage.meta.pagination?.offset, 10);
  assert.equal(byPage.meta.pagination?.current_page, 2);

  const byOffset = await facade.getNewsDigest({ limit: 10, offset: 20, tag: "Rio" });
  assert.equal(byOffset.items?.[0]?.title, "Story 41");
  assert.equal(byOffset.meta.pagination?.offset, 20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/newsCommandFlow.test.ts`

Expected: FAIL because `NewsDigestQuery` / `ToolMeta` do not yet support `page`, `offset`, or `pagination`, and `getNewsDigest()` still defaults to 5 and slices only the first page.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/types/common.ts
export interface PaginationMeta {
  offset: number;
  limit: number;
  returned: number;
  total: number;
  has_more: boolean;
  current_page: number;
  next_offset?: number;
  next_page?: number;
}

export interface ToolMeta {
  source: string;
  fetched_at: string;
  cache_hit: boolean;
  ttl_sec: number;
  schema_version: string;
  partial: boolean;
  notes?: string[];
  stale?: boolean;
  pagination?: PaginationMeta;
}
```

```ts
// src/types/hltv.ts
export interface NewsDigestQuery {
  limit?: number;
  tag?: string;
  year?: number;
  month?: number | string;
  page?: number;
  offset?: number;
}
```

```ts
// src/mcp/schemas.ts
export const newsSchema = {
  limit: z.number().int().min(1).max(50).optional(),
  tag: z.string().min(1).optional(),
  year: z.number().int().min(2000).max(3000).optional(),
  month: z.union([z.number().int().min(1).max(12), z.string().min(1)]).optional(),
  page: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional()
};
```

```ts
// src/services/hltvFacade.ts (inside getNewsDigest)
const limit = query.limit ?? 25;
const derivedOffset = query.offset ?? (query.page && query.page > 1 ? (query.page - 1) * limit : 0);

const filteredItems = normalizedItems.filter((item) => {
  if (!normalizedQuery.tag) {
    return true;
  }

  return (
    includesIgnoreCase(item.title, normalizedQuery.tag) ||
    includesIgnoreCase(item.summary_hint, normalizedQuery.tag) ||
    includesIgnoreCase(item.tag, normalizedQuery.tag)
  );
});

const items = filteredItems.slice(derivedOffset, derivedOffset + limit);
const total = filteredItems.length;
const hasMore = derivedOffset + items.length < total;

meta: this.createMeta(this.config.newsCacheTtlSec, {
  partial: notes.length > 0,
  notes,
  pagination: {
    offset: derivedOffset,
    limit,
    returned: items.length,
    total,
    has_more: hasMore,
    current_page: Math.floor(derivedOffset / limit) + 1,
    next_offset: hasMore ? derivedOffset + limit : undefined,
    next_page: hasMore ? Math.floor(derivedOffset / limit) + 2 : undefined
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/newsCommandFlow.test.ts`

Expected: PASS for the two new pagination tests.

- [ ] **Step 5: Commit**

```bash
git add src/newsCommandFlow.test.ts src/types/common.ts src/types/hltv.ts src/mcp/schemas.ts src/services/hltvFacade.ts
git commit -m "feat: add paginated news digest responses"
```

---

### Task 2: Update renderer, summaries, command defaults, and slash-command docs

**Files:**
- Modify: `src/newsCommandFlow.test.ts`
- Modify: `src/renderers/chineseRenderer.ts`
- Modify: `src/services/summaryService.ts`
- Modify: `src/commands/commandHandlers.ts`
- Modify: `docs/templates/opencode.commands.news.md`
- Modify: `examples/opencode-project/.opencode/commands/news.md`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```ts
import { ChineseRenderer } from "./renderers/chineseRenderer.js";
import { SummaryService } from "./services/summaryService.js";
import type { ToolResponse } from "./types/common.js";
import type { NewsItem } from "./types/hltv.js";
import { COMMAND_REGISTRY, CommandHandlers } from "./commands/commandHandlers.js";
import { readFileSync } from "node:fs";

function readProjectText(pathFromProjectRoot: string): string {
  return readFileSync(new URL(`../${pathFromProjectRoot}`, import.meta.url), "utf8");
}

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

  assert.match(renderer.renderNews(response), /暂无匹配新闻/);
});

test("news command defaults to 25 and docs mention 继续 plus Chinese titles", async () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/newsCommandFlow.test.ts`

Expected: FAIL because `renderNews()` still prints `【来源】`, empty state still says `暂无新闻数据`, `/news` still defaults to 5, and docs still describe 5-item output with source retention.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/commandHandlers.ts
export const COMMAND_REGISTRY = {
  news: {
    aliases: ["news", "新闻", "n"],
    description: "查看新闻集合（默认 25 条，支持继续分页）",
    usage: "/News [tag] [page|offset]"
  }
} as const;

async news(count = 25, tag?: string): Promise<string> {
  const response = await this.facade.getNewsDigest({
    limit: count,
    tag
  });
  return this.renderer.renderNews(response);
}
```

```ts
// src/renderers/chineseRenderer.ts
const emptyText = "暂无匹配新闻";
const lines = response.items?.length
  ? response.items
      .map((item, index) => {
        const pieces = [`${index + 1}. ${item.title}`];
        if (item.published_at) {
          pieces.push(formatDateTime(item.published_at));
        }
        if (item.tag) {
          pieces.push(`标签：${item.tag}`);
        }
        return pieces.join(" — ");
      })
      .join("\n")
  : emptyText;

const pagination = response.meta.pagination;
const paginationLines = pagination
  ? [
      "",
      `【分页】当前 ${pagination.offset + 1}-${pagination.offset + pagination.returned} / 共 ${pagination.total}`,
      pagination.has_more
        ? `可继续下一页：page=${pagination.next_page} 或 offset=${pagination.next_offset}`
        : "已到最后一页"
    ]
  : [];

return [
  "【新闻集合】",
  "",
  lines,
  ...paginationLines,
  "",
  "【中文总结】",
  summary,
  "",
  ...this.renderReasonSection(response),
  `【更新时间】${formatDateTime(response.meta.fetched_at)}`
].join("\n");
```

```md
<!-- docs/templates/opencode.commands.news.md -->
1. 调用 `hltv_local_hltv_news_digest`。
2. 如果 `$ARGUMENTS` 为空，默认查询最新新闻，建议参数：
   - `limit`: `25`
3. 如果用户回复“继续”，优先沿用上一轮查询条件，并使用上一轮返回的 `next_offset` 或 `next_page` 继续取下一批 25 条。
4. 输出时保留：
   - 中文标题（根据英文原标题生成简洁中文标题）
   - 英文原标题
   - 发布时间
   - 主题/标签（可选）
   - 更新时间（Asia/Shanghai）
5. 不要输出来源。
6. 如果没有数据，明确说明是“暂无匹配新闻”。
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/newsCommandFlow.test.ts`

Expected: PASS for renderer, handler, and docs assertions.

- [ ] **Step 5: Commit**

```bash
git add src/newsCommandFlow.test.ts src/renderers/chineseRenderer.ts src/services/summaryService.ts src/commands/commandHandlers.ts docs/templates/opencode.commands.news.md examples/opencode-project/.opencode/commands/news.md README.md
git commit -m "docs: align news command output with paginated flow"
```

---

### Task 3: Run full verification and prepare branch for PR

**Files:**
- Modify: none if verification passes
- Test: `src/newsCommandFlow.test.ts`
- Test: `src/matchCommandFlow.test.ts`

- [ ] **Step 1: Run the focused news tests**

Run: `npx tsx --test src/newsCommandFlow.test.ts`

Expected: PASS with 0 failures.

- [ ] **Step 2: Run the existing regression tests**

Run: `npx tsx --test src/matchCommandFlow.test.ts`

Expected: PASS with 0 failures.

- [ ] **Step 3: Run type verification**

Run: `npm run check`

Expected: exit code 0 and no TypeScript errors.

- [ ] **Step 4: Review git diff before creating the PR**

Run: `git status && git diff -- src/types/common.ts src/types/hltv.ts src/mcp/schemas.ts src/services/hltvFacade.ts src/renderers/chineseRenderer.ts src/services/summaryService.ts src/commands/commandHandlers.ts src/newsCommandFlow.test.ts docs/templates/opencode.commands.news.md examples/opencode-project/.opencode/commands/news.md README.md`

Expected: only the intended news pagination/output/doc changes appear.

- [ ] **Step 5: Create the final feature commit and push**

```bash
git add src/types/common.ts src/types/hltv.ts src/mcp/schemas.ts src/services/hltvFacade.ts src/renderers/chineseRenderer.ts src/services/summaryService.ts src/commands/commandHandlers.ts src/newsCommandFlow.test.ts docs/templates/opencode.commands.news.md examples/opencode-project/.opencode/commands/news.md README.md docs/superpowers/specs/2026-04-19-news-pagination-output-design.md docs/superpowers/plans/2026-04-19-news-pagination-output.md
git commit -m "feat: paginate news command output"
git push -u origin feat/news-pagination-output
```

- [ ] **Step 6: Create the pull request**

Run:

```bash
gh pr create --title "feat: paginate news command output" --body "$(cat <<'EOF'
## Summary
- add explicit pagination metadata to the news digest tool and default news pages to 25 items
- remove source from rendered news output and add continuation hints for follow-up pages
- update `/news` slash-command docs so OpenCode can produce Chinese titles and support `继续`

## Verification
- npx tsx --test src/newsCommandFlow.test.ts
- npx tsx --test src/matchCommandFlow.test.ts
- npm run check
EOF
)"
```

Expected: GitHub returns a PR URL.

---

## Self-Review

- **Spec coverage:** The plan covers backend pagination, renderer changes, docs/template updates, and verification/PR steps from the approved design.
- **Placeholder scan:** No `TODO` / `TBD` placeholders remain; each task includes concrete files, commands, and code snippets.
- **Type consistency:** The plan consistently uses `page`, `offset`, and `meta.pagination` as the public contract for news continuation.
