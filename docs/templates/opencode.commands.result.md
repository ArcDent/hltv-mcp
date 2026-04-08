---
description: 查询 HLTV 近期结果
agent: build
---
使用 HLTV MCP 查询近期比赛结果。

默认假设当前 OpenCode 中的 MCP 名称是 `hltv_local`，所以工具名前缀是 `hltv_local_`。
如果你的 MCP 名称不是 `hltv_local`，请先把下面工具名替换成你的真实前缀再执行。

执行规则：

1. 调用 `hltv_local_hltv_results_recent`。
2. 如果 `$ARGUMENTS` 为空，默认查询全站最近结果，建议参数：
   - `limit`: `5`
   - `days`: `7`
3. 如果 `$ARGUMENTS` 中包含队伍或赛事过滤条件，尽量提取：
   - 队伍 -> `team`
   - 赛事 -> `event`
4. 输出时保留：
   - 对阵双方
   - 比分
   - 赛事
   - 时间
   - 更新时间
   - 来源
5. 如果没有数据，明确说明是“暂无匹配结果”。
6. 如果工具返回错误，原样说明错误码和事实上游信息，不要脑补。

用户输入：
$ARGUMENTS
