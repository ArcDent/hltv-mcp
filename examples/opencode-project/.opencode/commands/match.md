---
description: 查询 HLTV 未来比赛
agent: build
---
使用 HLTV MCP 查询未来比赛。

默认假设当前 OpenCode 中的 MCP 名称是 `hltv_local`，所以工具名前缀是 `hltv_local_`。
如果你的 MCP 名称不是 `hltv_local`，请先把下面工具名替换成你的真实前缀再执行。

执行规则：

1. 调用 `hltv_local_hltv_matches_upcoming`。
2. 如果 `$ARGUMENTS` 为空，默认查询全站未来比赛，建议参数：
   - `limit`: `5`
   - `days`: `7`
3. 如果 `$ARGUMENTS` 中包含队伍或赛事过滤条件，尽量提取：
   - 队伍 -> `team`
   - 赛事 -> `event`
4. 输出时保留：
   - 对阵双方
   - 预计开赛时间
   - 赛事
   - 更新时间
   - 来源
5. 如果没有数据，明确说明是“暂无匹配赛程”。
6. 如果工具返回错误，原样说明错误码和事实上游信息，不要脑补。

用户输入：
$ARGUMENTS
