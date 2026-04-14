---
description: 查询 HLTV 未来比赛
agent: build
---
使用 HLTV MCP 查询未来比赛。

默认假设当前 OpenCode 中的 MCP 名称是 `hltv_local`，所以工具名前缀是 `hltv_local_`。
如果你的 MCP 名称不是 `hltv_local`，请先把下面工具名替换成你的真实前缀再执行。

执行规则：

1. 先把“本次 `/match` 命令在当前消息里实际收到的原始参数字符串”记为 `rawArgs`。**所有 tool 参数都只能来自 `rawArgs` 本身**。
   - **不要**参考历史对话
   - **不要**参考之前提到过的队伍/赛事
   - **不要**参考之前的 tool 调用结果
   - **不要**参考示例文字、默认想象值、占位值或 tool schema 里可能出现的默认形式
2. **先调用** `hltv_local_match_command_parse`，传入：
   - `raw_args`: `rawArgs`
3. 再调用 `hltv_local_hltv_matches_upcoming`。
4. 只允许把 `hltv_local_match_command_parse` 返回结果中的 `payload` 原样传给 `hltv_local_hltv_matches_upcoming`：
   - **不要**自行再补 `team` / `event` / `team_id`
   - **不要**绕过解析工具自己拼 payload
   - 如果解析结果 `payload` 为 `{}`，就必须调用 `hltv_local_hltv_matches_upcoming({})`
5. 对解析结果做最后自检：
   - 若 `trim(rawArgs)` 为空，解析结果 `payload` 必须是 `{}`
   - 若解析结果里有 `dropped_fields`，说明一些无效/泛化/幻觉参数已被丢弃，不要把它们补回去
   - 最终传给 `hltv_local_hltv_matches_upcoming` 的对象必须严格等于 parser 返回的 `payload`
6. 输出时保留：
   - 对阵双方（尽量按 `英文原名/<中文译名官称>/<民间翻译（如果有）>` 格式展示队伍名）
   - 预计开赛时间
   - 赛事（尽量按 `英文原名/<中文译名官称>/<民间翻译（如果有）>` 格式展示赛事名）
   - 更新时间
   - 来源
7. 如果没有数据，明确说明是“暂无匹配赛程”。
8. 如果 parser 返回的 `dropped_fields` 非空，可在最终回复里补一句“已忽略无效过滤参数：...”。
9. 如果工具返回错误，原样说明错误码和事实上游信息，不要脑补。

关键示例：

- `/match` -> 先 `hltv_local_match_command_parse({ raw_args: "" })`，再 `hltv_local_hltv_matches_upcoming({})`
- `/match    ` -> 先 `hltv_local_match_command_parse({ raw_args: "    " })`，再 `hltv_local_hltv_matches_upcoming({})`
- 即使上文刚讨论过某支队伍、某个赛事或上一条 tool 调用，也**仍然只能**按当前 `rawArgs` 决定；空参数时依然必须调用 `{}`

用户输入：
$ARGUMENTS
