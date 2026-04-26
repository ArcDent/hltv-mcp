# OpenCode 示例目录

这是一个**不会自动生效**的 OpenCode 示例目录。

这个示例默认按**外部上游模式**提供配置，也就是：

- 显式设置 `HLTV_UPSTREAM_MANAGED=false`
- 由你自己准备并启动 `HLTV_API_BASE_URL` 指向的上游 API

如果你想使用当前分支新增的 **managed upstream** 默认模式，请不要直接照抄这里的 `opencode.jsonc`；那种模式要求你先准备好仓库里的 Python 解释器（默认是 `hltv-api-fixed/env/bin/python`），否则 MCP 进程会在启动时 fail fast，OpenCode 也就无法连上这个 MCP。

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

- `examples/opencode-project/opencode.jsonc` -> `你的项目/opencode.jsonc`（或 `你的项目/.opencode/opencode.jsonc`）
- `examples/opencode-project/.opencode/commands/*.md` -> `你的项目/.opencode/commands/`

复制完以后，请确认 `opencode.jsonc` 里的运行模式与你的实际部署一致：

- **外部上游模式（推荐给 OpenCode 示例使用）**：保留 `"HLTV_UPSTREAM_MANAGED": "false"`，并确保 `HLTV_API_BASE_URL` 指向一个已经在运行的 upstream API
- **managed upstream 模式**：删除或改写示例里的外部模式配置，并先准备 `hltv-api-fixed/env/bin/python`，或者显式设置 `HLTV_UPSTREAM_PYTHON_PATH`

如果你是在 **WSL** 中运行 OpenCode / MCP，请把示例里的 MCP 启动路径改成 **WSL/Linux 可访问路径**，例如 `/home/you/.../dist/index.js` 或 `/mnt/c/.../dist/index.js`，不要直接照抄 `C:/...`。

如果你复制完以后仍然连不上，先检查这三件事：

1. 当前项目级配置到底放在哪个路径下，并用 `opencode debug config` / `opencode mcp list --print-logs` 确认 OpenCode 实际加载的是哪份配置
2. `hltv_local.enabled` 是否为 `true`
3. `HLTV_API_BASE_URL` 指向的上游是否真的可达

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
- `hltv_local_hltv_realtime_news`
- `hltv_local_hltv_news_digest`

补充：示例里的 `/match` 模板现在只支持无参数，并且只会调用 `hltv_local_hltv_matches_today({})`；如果你要按队伍或赛事筛未来比赛，请直接调用 `hltv_local_hltv_matches_upcoming`。

如果你自己的 MCP 名称不是 `hltv_local`，请把这些前缀一起替换掉。
