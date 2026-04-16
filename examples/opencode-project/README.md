# OpenCode 示例目录

这是一个**不会自动生效**的 OpenCode 示例目录。

之所以放在 `examples/opencode-project/` 下，而不是仓库根目录，是为了避免 OpenCode 在打开本仓库时误把这些示例当成 live 配置直接加载。

## 目录内容

```text
examples/opencode-project/
├─ opencode.jsonc
└─ .opencode/
   └─ commands/
      ├─ team.md
      ├─ player.md
      ├─ result.md
      ├─ match.md
      └─ news.md
```

## 如何使用

把下面这些文件复制到你自己的 OpenCode 项目：

- `examples/opencode-project/opencode.jsonc` -> `你的项目/opencode.jsonc`
- `examples/opencode-project/.opencode/commands/*.md` -> `你的项目/.opencode/commands/`

如果你是在 **WSL** 中运行 OpenCode / MCP，请把示例里的 MCP 启动路径改成 **WSL/Linux 可访问路径**，例如 `/home/you/.../dist/index.js` 或 `/mnt/c/.../dist/index.js`，不要直接照抄 `C:/...`。

## 默认前缀说明

这个示例默认你的 MCP 名称叫：

```text
hltv_local
```

所以命令模板里引用的是：

- `hltv_local_resolve_team`
- `hltv_local_resolve_player`
- `hltv_local_match_command_parse`
- `hltv_local_hltv_matches_today`
- `hltv_local_hltv_team_recent`
- `hltv_local_hltv_player_recent`
- `hltv_local_hltv_results_recent`
- `hltv_local_hltv_matches_upcoming`
- `hltv_local_hltv_news_digest`

补充：示例里的 `/match` 模板现在只支持无参数，并且只会调用 `hltv_local_hltv_matches_today({})`；如果你要按队伍或赛事筛未来比赛，请直接调用 `hltv_local_hltv_matches_upcoming`。

如果你自己的 MCP 名称不是 `hltv_local`，请把这些前缀一起替换掉。
