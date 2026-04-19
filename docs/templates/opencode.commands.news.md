---
description: 查询 HLTV 新闻集合
agent: build
---
使用 HLTV MCP 查询新闻集合。

默认假设当前 OpenCode 中的 MCP 名称是 `hltv_local`，所以工具名前缀是 `hltv_local_`。
如果你的 MCP 名称不是 `hltv_local`，请先把下面工具名替换成你的真实前缀再执行。

执行规则：

1. 调用 `hltv_local_hltv_news_digest`。
2. 如果 `$ARGUMENTS` 为空，默认查询最新新闻，建议参数：
   - `limit`: `25`
   - `timezone`: `Asia/Shanghai`
3. 如果 `$ARGUMENTS` 中明显包含标签、赛事词或主题词，尽量提取为 `tag`。
4. 如果用户回复“继续”，优先沿用上一轮查询条件，并优先使用上一轮工具返回的 `next_offset` 或 `next_page` 继续取下一批 25 条。
5. 输出时保留：
   - 中文标题（由命令执行时的助手基于英文原标题生成简洁中文标题；工具原始结果仍以英文标题为准）
   - 英文原标题
   - 发布时间
   - 主题/标签（可选，有则保留，无则省略）
   - 更新时间（统一按 `Asia/Shanghai` 展示）
6. 不要输出数据源字段。
7. 如果没有数据，明确说明是“暂无匹配新闻”。
8. 如果工具返回错误，原样说明错误码和事实上游信息，不要脑补。

用户输入：
$ARGUMENTS
