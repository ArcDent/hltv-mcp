# HLTV 实时新闻 Selenium 抓取与 MCP/OCR 验证设计

## 背景

当前根项目通过 `hltv_local_hltv_realtime_news` 暴露 HLTV 实时新闻工具。TypeScript MCP 层会请求 bundled Python upstream 的 `/api/v1/news/realtime`，再由 `hltv-api-fixed` 内的 Scrapy/Selenium 抓取 `https://www.hltv.org/news`。

现有失败链路已经定位清楚：MCP schema、工具注册和 managed upstream 启动不是问题；Python upstream 能响应健康检查，但实时新闻端点会先超过 TypeScript client 的 8 秒超时，延长等待后返回 `502 challenge_detected`。直接访问 HLTV 新闻页时可见 Cloudflare challenge 页面，而不是正常新闻 DOM。

用户要求本次修复保持运行时路线为 **A：Python upstream 自己启动 Selenium/headless Chrome**。MCP 浏览器只作为独立验证手段，不作为生产/运行时依赖。

## 目标

1. 让 `/api/v1/news/realtime` 能通过 Python upstream 自己的 Selenium/browser fetch 获取 HLTV 实时新闻页面的正常 DOM。
2. 让 `hltv_local_hltv_realtime_news({ limit: 25 })` 能返回非空、实时的 HLTV 新闻数据。
3. 用 MCP 浏览器独立验证 `https://www.hltv.org/news` 当前页面确实包含新闻节点。
4. 用 MCP 截图 + OCR 识别页面文字，并与 upstream 抓取结果做一致性校验。
5. 确保验收数据是实时抓取结果，不接受旧缓存伪装成功。
6. 保持失败语义清晰：如果仍只能拿到 Cloudflare/challenge 页面，继续返回明确的 `challenge_detected`，而不是空列表或误判成功。

## 非目标

1. 不改变根 MCP 工具入参；`hltv_realtime_news` 仍只支持 `limit`、`page`、`offset`，不新增 `tag`。
2. 不把运行时改为连接当前 MCP Chrome 或 DevTools Chrome。
3. 不改变 `/news` slash-command 默认调用实时新闻的行为。
4. 不引入第三方新闻源替代 HLTV 实时新闻页。
5. 不用旧 `data/news/realtime_news.json` 缓存作为最终验收依据。

## 当前链路

```text
TS MCP hltv_realtime_news
→ src/clients/hltvApiClient.ts /api/v1/news/realtime
→ hltv-api-fixed/routes/news.py
→ HLTVScraper.get_realtime_news()
→ SpiderManager spider hltv_realtime_news
→ challenge_fetcher.fetch_hltv_page("https://www.hltv.org/news")
→ HTTP fetch / Selenium browser fetch / retry
→ realtime news parser
→ data/news/realtime_news.json
→ Python route JSON response
→ TS facade pagination/rendering
```

本次设计只在必要范围内修改 `hltv-api-fixed` 抓取链路；根 TypeScript MCP 层除非需要调整超时或测试辅助，否则不改工具契约。

## 方案选择

用户选择方案 A：继续使用 Python upstream 自己启动的 Selenium/headless Chrome。

在该约束下，推荐实现方向是增强现有 Selenium/browser fetch 能力，并用 MCP 浏览器作为独立事实来源来验证 selector、页面内容和抓取结果。

不采用以下方案：

- 运行时复用 MCP Chrome / DevTools Chrome：违背用户选择的 A 路线。
- 单纯修改 parser selector：如果 upstream Selenium 仍拿到 challenge HTML，parser 再正确也不会返回实时数据。
- 只返回最近缓存：不能证明“实时”，不满足用户验收标准。

## 设计细节

### 1. MCP 浏览器作为页面事实来源

实施前先用已连接的 `chrome-devtools_*` MCP 浏览器访问：

```text
https://www.hltv.org/news
```

采集两类证据：

1. `chrome-devtools_take_snapshot`：确认可访问页面中有新闻标题、链接、时间或评论等节点。
2. `chrome-devtools_take_screenshot` + OCR：保存页面截图并识别文字，得到页面上肉眼可见的新闻标题。

这些证据用于校准 parser 和最终一致性对比，但不会成为 Python upstream 的运行时依赖。

### 2. Selenium/browser fetch 增强

在 `hltv-api-fixed/hltv_scraper/browser_fetcher.py` 和/或 `challenge_fetcher.py` 中增强浏览器抓取策略：

1. 浏览器启动后先打开 HLTV 首页或新闻页，保留当前流程中已有的预热意图。
2. 等待真实新闻内容条件，而不是只等待 document load：
   - 新闻列表链接，例如 `a.newsline.article`；
   - 实时新闻卡片/行的当前 selector；
   - JSON-LD 或页面中能稳定代表新闻列表的结构。
3. 如果页面包含 challenge 特征：
   - 不立即把 challenge HTML 交给 parser；
   - 在限定时间内继续等待并重新检测；
   - 重新检查真实新闻 selector 是否出现。
4. 浏览器 fetch 返回前必须做内容判定：
   - 有新闻节点 → 返回最终 HTML；
   - 仍是 challenge 且无新闻节点 → 抛出 `NewsScrapeFetchError(reason="challenge_detected")`。
5. 保持总等待时间可控，避免 MCP TypeScript client 总是先报 `UPSTREAM_TIMEOUT` 而看不到真实 upstream 失败原因。

若实现需要新增环境变量，应保持可选并有安全默认值，例如：

- `HLTV_BROWSER_TIMEOUT_SECONDS`
- `HLTV_BROWSER_CHALLENGE_WAIT_SECONDS`
- `HLTV_BROWSER_POLL_INTERVAL_SECONDS`

### 3. Realtime parser 校准

如果 MCP 浏览器显示的真实 DOM 与当前 parser fixture 不一致，则更新：

- `hltv-api-fixed/hltv_scraper/realtime_news_content.py`
- `hltv-api-fixed/hltv_scraper/hltv_scraper/spiders/parsers/realtime_news.py`
- `hltv-api-fixed/tests/test_realtime_news_parser.py`

parser 应提取至少以下字段中可用的部分：

- 英文标题；
- HLTV 链接；
- 相对时间或发布时间文本；
- 分类/标签；
- 评论数。

字段缺失时应保留合理降级，但不能把 challenge 页面文本解析成新闻。

### 4. Fresh fetch 约束

最终验收前必须证明结果不是旧缓存：

1. 删除或绕过 `hltv-api-fixed/hltv_scraper/data/news/realtime_news.json`。
2. 记录 API 请求开始时间。
3. 请求 `/api/v1/news/realtime`。
4. 验证输出文件存在且 mtime 不早于请求开始前的合理窗口。
5. 验证响应中含非空新闻数组。

如果现有 `SpiderManager` 缓存策略阻碍 fresh fetch，可以在测试/验证命令中临时删除缓存文件，而不是改变产品默认的 1 分钟短缓存策略。

### 5. 一致性验收规则

用户选择一致性规则 B：**前 5 条中至少 3 条标题一致**。

具体验收过程：

1. 用 MCP 浏览器 snapshot 提取页面前若干条新闻标题。
2. 用 MCP 截图 OCR 提取可见新闻标题文本。
3. fresh 调用 Python upstream `/api/v1/news/realtime`。
4. 对比 API 返回前 5 条标题与浏览器/OCR 标题：
   - 至少 3 条标题能在浏览器 snapshot 或 OCR 文本中匹配；
   - 允许大小写、标点和空白差异；
   - 允许 HLTV 页面在验证期间插入新内容导致轻微顺序变化。

若 snapshot 与 OCR 内容本身不一致，先以 MCP 浏览器 snapshot 为结构化事实来源，OCR 作为可视证据；但最终报告要说明 OCR 识别偏差。

## 影响文件

预计修改范围：

- `hltv-api-fixed/hltv_scraper/browser_fetcher.py`
- `hltv-api-fixed/hltv_scraper/challenge_fetcher.py`
- `hltv-api-fixed/hltv_scraper/news_page_detection.py`
- `hltv-api-fixed/hltv_scraper/realtime_news_content.py`
- `hltv-api-fixed/hltv_scraper/hltv_scraper/spiders/hltv_realtime_news.py`
- `hltv-api-fixed/hltv_scraper/hltv_scraper/spiders/parsers/realtime_news.py`
- `hltv-api-fixed/tests/test_browser_fetcher.py`
- `hltv-api-fixed/tests/test_realtime_news_parser.py`
- `hltv-api-fixed/tests/test_news_pipeline.py`

根 TypeScript 层预计不改；如果为了观察真实 upstream 错误调整超时配置或测试，需要同步运行根项目验证。

## 测试与验证计划

### 自动化测试

Python upstream：

```bash
cd hltv-api-fixed
make test-one TEST=test_realtime_news
make test-one TEST=test_browser_fetcher
make test-one TEST=test_news_pipeline
```

如果 Make 目标不适合精确筛选，则使用项目既有 pytest 入口运行对应测试文件。

根 TypeScript：

```bash
npm run check
node --import tsx --test src/realtimeNewsFlow.test.ts
```

若触碰 `/match` 行为或附近模板：

```bash
node --import tsx --test src/matchCommandFlow.test.ts
```

### 端到端人工/工具验证

1. MCP 浏览器打开 `https://www.hltv.org/news`。
2. `chrome-devtools_take_snapshot` 保存页面新闻节点证据。
3. `chrome-devtools_take_screenshot` 保存截图。
4. 使用 OCR 工具识别截图。
5. 删除或绕过 realtime news 缓存。
6. 直接请求：

   ```bash
   curl http://127.0.0.1:18020/api/v1/news/realtime
   ```

7. 验证 HTTP 200、非空数据、无 `challenge_detected`、fresh 文件 mtime。
8. 对比 API 前 5 条标题与 MCP snapshot/OCR 标题，至少 3 条匹配。
9. 最后通过 MCP tool 调用 `hltv_local_hltv_realtime_news({ limit: 25 })`，确认最终中文输出可用。

## 风险与缓解

### 风险 1：Cloudflare 持续识别 headless Selenium

即使 MCP 浏览器能看到新闻，Python upstream 自己启动的 headless Selenium 仍可能只能看到 challenge 页。

缓解：增强等待、预热和内容检测；失败时保持 `challenge_detected`，不误报成功。若该风险无法通过 Selenium 参数和等待策略解决，需要重新讨论是否允许 B/C 路线，但本设计不擅自切换运行时依赖。

### 风险 2：实时页面更新导致标题对比不稳定

缓解：采用用户批准的规则 B：前 5 条中至少 3 条匹配，允许轻微顺序变化、标点差异和验证期间新增新闻。

### 风险 3：OCR 识别误差

缓解：OCR 作为可视证据，不单独作为结构化 truth；最终一致性同时参考 MCP snapshot 文本。报告中明确 OCR 原文和匹配逻辑。

### 风险 4：缓存误判为实时成功

缓解：验收前删除或绕过 `data/news/realtime_news.json`，并检查输出文件 mtime 与请求时间。

## 自检清单

- 无待定占位符：本文没有 `TBD` 或未决设计项。
- 范围一致：运行时保持 Python upstream Selenium；MCP 浏览器只用于验证。
- 验收明确：必须满足 MCP snapshot、截图 OCR、fresh API、MCP tool 四类证据。
- 一致性规则明确：前 5 条 API 标题中至少 3 条匹配浏览器/OCR 标题。
- 非目标明确：不新增 MCP 入参、不切换到 DevTools Chrome 运行时、不用旧缓存冒充实时结果。
