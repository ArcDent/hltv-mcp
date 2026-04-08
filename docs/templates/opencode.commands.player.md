---
description: 查询 HLTV 选手近况
agent: build
---
使用 HLTV MCP 查询选手近况。

默认假设当前 OpenCode 中的 MCP 名称是 `hltv_local`，所以工具名前缀是 `hltv_local_`。
如果你的 MCP 名称不是 `hltv_local`，请先把下面工具名替换成你的真实前缀再执行。

执行规则：

1. 如果 `$ARGUMENTS` 为空，先询问用户要查哪位选手。
2. 先调用 `hltv_local_resolve_player`，参数建议：
   - `name`: `$ARGUMENTS`
   - `exact`: `false`
   - `limit`: `5`
3. 如果没有候选，直接说明未找到，不要猜。
4. 如果存在多个高相似候选且不能确定，列出候选并让用户选择。
5. 如果可以确定候选，调用 `hltv_local_hltv_player_recent`，参数建议：
   - `player_id`: 解析出的 `id`
   - `player_name`: 解析出的 `name`
   - `limit`: `5`
   - `detail`: `"standard"`
6. 输出中文结果时保留：
   - 选手名
   - 所属队伍
   - 国家/地区
   - 近期概览统计
   - 近期亮点
   - 更新时间
   - 来源
7. 如果工具返回错误，原样说明错误码和事实上游信息，不要脑补。

用户输入：
$ARGUMENTS
