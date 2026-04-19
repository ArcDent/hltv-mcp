# /news 分页与输出改造设计

## 背景

当前仓库里的 `hltv_news_digest` 只有基础 `limit + tag + 年月` 过滤能力，`/news` 模板默认只拉取 5 条，并要求保留来源字段。用户希望把 `/news` 改成更适合连续阅读新闻流的体验：默认先给 25 条、支持“继续”读取下一批、输出中加入中文标题、允许省略 topic/tag、并统一使用 `Asia/Shanghai` 显示更新时间。

本仓库的一个关键约束是：**真实 `/news` 体验由 Markdown slash-command 模板控制，TypeScript 服务端只暴露 MCP tool。** 因此需要同时改后端数据契约与命令模板：后端负责稳定分页、返回 continuation 元信息；模板负责会话式“继续”和最终中文化输出指令。

## 目标

1. `hltv_news_digest` 默认支持 25 条新闻分页读取。
2. 同时支持显式分页参数：`page` 与 `offset`。
3. MCP 返回结果携带足够的分页元信息，便于 slash-command 在后续一轮中继续读取下一批。
4. `renderNews()` 移除来源字段，并在无数据时明确输出“暂无匹配新闻”。
5. `/news` 模板默认要求输出中文标题 + 英文原标题，并将更新时间固定为 `Asia/Shanghai`。
6. topic/tag 改为**可选输出**，有值可显示，无值可省略；不再强制保留来源。

## 非目标

1. 不在后端引入真实翻译服务或新的中文标题上游来源。
2. 不引入服务端会话存储；“继续”依然依赖客户端/代理保留上轮上下文。
3. 不修改其他工具（`/team`、`/player`、`/result`、`/match`）的默认 limit 策略。

## 设计决策

### 1. 后端分页契约

扩展 `NewsDigestQuery` 与 `newsSchema`：

- `limit?: number`，新闻默认值改为 `25`，并放宽上限以容纳用户要求。
- `page?: number`，用于页码式分页。
- `offset?: number`，用于偏移式分页。
- 保留 `tag/year/month/timezone`。

分页计算规则：

1. 如果显式传入 `offset`，优先使用 `offset`。
2. 否则如果传入 `page`，计算 `offset = (page - 1) * limit`。
3. 两者都未传入时，`offset = 0`。
4. 所有分页都在**新闻过滤之后**执行，避免 page/offset 与 tag 过滤产生歧义。

### 2. 分页元信息

扩展 `ToolMeta`，为新闻结果增加可复用的 `pagination` 字段，结构如下：

- `offset`: 当前查询起始偏移
- `limit`: 当前页 limit
- `returned`: 当前页实际返回条数
- `total`: 过滤后总条数
- `has_more`: 是否还有下一页
- `current_page`: 当前页码（按当前 limit 推导）
- `next_offset?`: 下一次推荐 offset
- `next_page?`: 下一次推荐 page

这样 slash-command 可以在收到一页结果后，直接基于 `next_offset` 或 `next_page` 发起下一轮工具调用；会话式“继续”则由模板说明驱动，而不是后端记忆状态。

### 3. 中文标题策略

后端没有可靠中文标题数据源，因此**不在 `NewsItem` 中新增伪造的 `title_zh` 字段**。中文标题由 `/news` 模板明确要求代理在最终面向用户输出时，根据英文原标题生成一条简洁中文标题，同时保留英文原标题原文。

这意味着：

- `structuredContent.items[].title` 仍然是英文原始标题；
- slash-command 最终输出中需要呈现“中文标题 + 英文原标题”；
- 直接调用 MCP tool 时，内置 renderer 仍然以英文标题为主，但会补充分页提示与更新时间规范化。

### 4. `renderNews()` 输出规则

服务端 `renderNews()` 做以下收敛：

1. 空结果统一显示 `暂无匹配新闻`。
2. 删除 `【来源】` 行。
3. 更新时间继续使用 `formatDateTime(..., timezone)`，但新闻默认时区固定回落为 `Asia/Shanghai`。
4. 若存在 `meta.pagination`，在正文后追加当前区间、总数和下一页提示。
5. tag 不再强制输出；只有在条目里存在 tag 且确有必要时才显示。

### 5. Slash-command 模板规则

`docs/templates/opencode.commands.news.md` 与示例命令模板同步改造为：

1. 默认调用 `hltv_local_hltv_news_digest`，参数为：
   - `limit: 25`
   - `timezone: "Asia/Shanghai"`
2. 若 `$ARGUMENTS` 中出现赛事词、标签词、主题词，提取为 `tag`。
3. 若用户只说“继续”，优先根据上一轮工具结果中的分页元信息继续下一页，默认沿用原来的 `tag/year/month/timezone/limit`。
4. 最终输出字段调整为：
   - 中文标题
   - 英文原标题
   - 发布时间
   - 主题/标签（可选，有则保留，无则省略）
   - 更新时间（Asia/Shanghai）
5. 不再要求输出来源。
6. 若工具报错，继续原样呈现错误码与事实上游信息。

### 6. README 同步

README 需要同步声明 `/news` 的推荐行为：

- 默认 25 条；
- 支持“继续”读取下一批；
- 显式分页也支持 `page` / `offset`；
- `/news` 模板输出默认不展示来源。

## 影响文件

### 代码

- `src/types/hltv.ts`
- `src/types/common.ts`
- `src/mcp/schemas.ts`
- `src/services/hltvFacade.ts`
- `src/renderers/chineseRenderer.ts`
- `src/services/summaryService.ts`
- `src/commands/commandHandlers.ts`
- `src/mcp/server.ts`（仅 schema 透传验证）

### 文档/模板

- `docs/templates/opencode.commands.news.md`
- `examples/opencode-project/.opencode/commands/news.md`
- `README.md`

### 测试

- 新增一个面向 news 的测试文件，覆盖：分页契约、renderer 文本、command/docs 行为。

## 测试策略

1. **Facade 分页测试**：验证默认 25 条、`page` 与 `offset` 逻辑、`meta.pagination` 字段，以及 tag 过滤后再分页。
2. **Renderer 测试**：验证无来源、空结果文本、更新时间时区、下一页提示。
3. **命令/文档测试**：验证 `CommandHandlers.news()` 默认 25 条，模板改为默认 25 条并描述“继续”语义。
4. **类型检查**：执行 `npm run check`。

## 风险与缓解

### 风险 1：slash-command 的“继续”依赖上下文而不是后端状态

缓解：后端返回明确 `next_offset` / `next_page`，模板说明优先复用上一轮分页元信息。

### 风险 2：中文标题并非来自上游真实字段

缓解：在设计上明确中文标题属于最终展示层行为；结构化数据只保留英文原始标题，避免伪造数据源。

### 风险 3：`DEFAULT_RESULT_LIMIT` 是全局配置，直接改成 25 会影响其他工具

缓解：只在 `getNewsDigest()` 与 `CommandHandlers.news()` 内部对新闻默认值单独设置为 25，不改全局默认配置。
