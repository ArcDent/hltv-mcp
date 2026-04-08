---
description: 查询 HLTV 队伍近况
agent: build
---
使用 HLTV MCP 查询队伍近况。

默认假设当前 OpenCode 中的 MCP 名称是 `hltv_local`，所以工具名前缀是 `hltv_local_`。
如果你的 MCP 名称不是 `hltv_local`，请先把下面工具名替换成你的真实前缀再执行。

执行规则：

1. 如果 `$ARGUMENTS` 为空，先询问用户要查哪支队伍。
2. 先调用 `hltv_local_resolve_team`，参数建议：
   - `name`: `$ARGUMENTS`
   - `exact`: `false`
   - `limit`: `5`
3. 如果没有候选，明确告诉用户没有找到匹配队伍，不要臆测。
4. 如果有多个高相似候选且无法确定，不要盲猜，列出候选并让用户选择。
5. 如果可以确定候选，调用 `hltv_local_hltv_team_recent`，参数建议：
   - `team_id`: 解析出的 `id`
   - `team_name`: 解析出的 `name`
   - `limit`: `5`
   - `include_upcoming`: `true`
   - `include_recent_results`: `true`
   - `detail`: `"standard"`
6. 输出中文结果时，保留这些事实：
   - 队伍名
   - 排名
   - 最近几场结果
   - 未来赛程
   - 更新时间
   - 来源
7. 如果工具返回错误，原样说明错误码和事实上游信息，不要脑补。

用户输入：
$ARGUMENTS
