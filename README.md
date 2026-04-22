# HLTV MCP Service

一个基于 `hltv-scraper-api` 的 HLTV MCP 服务骨架，当前主要面向 **OpenCode + local stdio MCP** 场景。

当前暴露的 tools：

- `resolve_team`
- `resolve_player`
- `match_command_parse`
- `hltv_matches_today`
- `hltv_team_recent`
- `hltv_player_recent`
- `hltv_results_recent`
- `hltv_matches_upcoming`
- `hltv_news_digest`

上游默认由 MCP 在启动时**自动拉起（managed upstream）**：

- `src/index.ts` 会在 stdio MCP 启动前先启动 `hltv-api-fixed/app.py`
- 默认 Python 解释器路径是 `hltv-api-fixed/env/bin/python`
- 如果 `hltv-api-fixed/env/bin/python` 不存在，服务会在启动阶段直接失败（fail fast）
- 运行 `npm run start` 前，请先准备好 `hltv-api-fixed/env/bin/python`（或通过 `HLTV_UPSTREAM_PYTHON_PATH` override 覆盖解释器路径）
- 当前实现不会自动创建 Python venv（do not auto-create）

如果你要改回外部上游模式（自己部署 `hltv-scraper-api`），设置：

```env
HLTV_UPSTREAM_MANAGED=false
HLTV_API_BASE_URL=http://127.0.0.1:8020
```

在外部上游模式下，如果 MCP 跑在 **WSL**、而 `hltv-scraper-api` 跑在 **Windows 宿主机**：

- 现在代码会在 WSL 下对 `127.0.0.1` / `localhost` / `0.0.0.0` 自动额外尝试一个从 `/etc/resolv.conf` 推断出的 Windows host 地址；
- 如果你的环境没有成功自动探测，可以显式设置：

```env
HLTV_UPSTREAM_MANAGED=false
HLTV_API_FALLBACK_BASE_URL=http://WINDOWS_HOST_IP:8020
```

---

## 1. 当前支持情况

### 已实现

- `stdio`

### 还没实现，但后续可扩展

- `Streamable HTTP`
- `SSE`

也就是说：

> 现在这份代码可以直接作为 **本地 stdio MCP server** 接给 OpenCode。  
> 如果你要对接 HTTP / SSE 客户端，需要你后续自己补 transport 启动入口。

---

## 2. 快速开始

```bash
npm install
npm run build
```

如果你使用默认 managed upstream，请先手动准备解释器（仓库不会自动创建 venv）：

- 目标路径：`hltv-api-fixed/env/bin/python`
- 或设置 `HLTV_UPSTREAM_PYTHON_PATH` 覆盖（override）到你已准备好的解释器路径

未准备好解释器时，`npm run start` 会 fail fast。

可选手动启动：

```bash
npm run start
```

> 这是一个 MCP stdio server，通常由 MCP 客户端拉起；手动运行时它不会像普通 HTTP 服务那样输出页面。

---

## 3. 常用环境变量

参考 `.env.example`，最常用的是：

```env
# 默认 managed upstream（自动启动）
HLTV_UPSTREAM_MANAGED=true
HLTV_UPSTREAM_PORT=18020
HLTV_UPSTREAM_HEALTH_PATH=/healthz
HLTV_UPSTREAM_PYTHON_PATH=

# 外部上游模式（手动部署 hltv-scraper-api）
HLTV_UPSTREAM_MANAGED=false
HLTV_API_BASE_URL=http://127.0.0.1:8020
HLTV_API_FALLBACK_BASE_URL=
HLTV_API_TIMEOUT_MS=8000
DEFAULT_RESULT_LIMIT=5
SUMMARY_MODE=template
```

- 服务当前所有时间输出固定使用 `Asia/Shanghai`。
- 不再支持通过 tool 参数或环境变量传入 `timezone`。
- `/match` 的“今日赛程”语义按 `Asia/Shanghai` 日界线解释。

---

## 3.1 查询建议与已验证行为

以下行为已在当前实现中验证：

- **推荐先走 `resolve_*`**：先把输入 name 解析成实体（id + canonical slug），再调用近况/赛果工具。
- **别名归一化示例**（已验证样例）：
  - 选手：`ZywOo` / `zywoo` / `载物`
  - 队伍：`Spirit` / `Team Spirit`
- **`hltv_team_recent` / `hltv_player_recent` 为 ID-first**：
  - 传了 `team_id` / `player_id` 时，会优先按 ID 路径解析与拉取详情；
  - 不会仅因为原始 `team_name` / `player_name` 无法再次精确解析而直接失败（前提是该 ID 在上游可访问）。
- **`hltv_results_recent` / `hltv_matches_upcoming` 支持 `team_id` 过滤**：
  - 可只传 `team_id`，也可与 `team` 同时传；
  - 过滤时会优先匹配队伍 ID，并结合名称别名做补充匹配。
- **`hltv_matches_upcoming` 无参数时默认返回 `Asia/Shanghai` 时区下的今日全部比赛**：
  - 不再默认只取 `5` 条未来比赛；
  - 输出中的队伍名与赛事名会尽量按 `英文原名/<中文译名官称>/<民间翻译（如果有）>` 展示；
  - 赛事与队伍过滤也会一并兼容这些中英别名。
- **`/match` 路由约定**：
  - **`/match`（无参数）**：直接调用 `hltv_local_hltv_matches_today({})`，不要调用 parser。
  - **`/match`（带参数）**：不要调用任何 tool，直接提示“`/match` 现在只支持无参数，只用于查询今日赛程；请删除参数后重试”。
  - 如果还要按队伍 / 赛事筛未来比赛，请直接调用 `hltv_local_hltv_matches_upcoming`，不要再通过 `/match` 间接路由。

---

## 4. 与 OpenCode 对接

### 重要说明

本仓库：

- **不会自动帮你连接 OpenCode**
- **不会自动帮你写 `opencode.jsonc`**
- **不会自动帮你创建 `.opencode/commands/*.md`**
- **不会自动帮你注册 `/team` `/player` `/result` `/match` `/news`**

这些都需要你手动完成。

---

### 4.1 先构建项目

```bash
npm install
npm run build
```

确保存在：

```text
dist/index.js
```

---

### 4.2 在 OpenCode 中手动注册 local MCP

推荐手工编辑项目级 OpenCode 配置：

- `opencode.json` / `opencode.jsonc`
- 或 `.opencode/opencode.json` / `.opencode/opencode.jsonc`

- 单文件模板：`docs/templates/opencode.jsonc`
- 完整可复制示例：`examples/opencode-project/`

> 实际以你本机 `opencode debug config` / `opencode mcp list --print-logs` 看到的加载路径为准。当前版本如果项目里没有 live 配置，往往仍会回退到全局配置。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "hltv_local": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/hltv-mcp-service/dist/index.js"
      ],
      "enabled": true,
      "timeout": 10000,
      "environment": {
        "HLTV_UPSTREAM_MANAGED": "false",
        "HLTV_API_BASE_URL": "http://127.0.0.1:8020",
        // Optional for WSL when upstream runs on the Windows host:
        // "HLTV_API_FALLBACK_BASE_URL": "http://WINDOWS_HOST_IP:8020",
        "HLTV_API_TIMEOUT_MS": "8000",
        "DEFAULT_RESULT_LIMIT": "5",
        "SUMMARY_MODE": "template"
      }
    }
  }
}
```

如果你用的是别的 MCP 名称，而不是 `hltv_local`，后面所有工具名前缀都要一起改。

例如：

- MCP 名称是 `hltv_local`
- 那么 OpenCode 里看到的实际工具名就是：
  - `hltv_local_resolve_team`
  - `hltv_local_resolve_player`
  - `hltv_local_match_command_parse`
  - `hltv_local_hltv_matches_today`
  - `hltv_local_hltv_team_recent`
  - `hltv_local_hltv_player_recent`
  - `hltv_local_hltv_results_recent`
  - `hltv_local_hltv_matches_upcoming`
  - `hltv_local_hltv_news_digest`

---

### 4.3 验证 MCP 是否接入成功

```bash
opencode mcp list
```

或：

```bash
opencode mcp ls
```

如果配置正确，你应该能看到：

- `hltv_local`
- 状态是 `connected` 或至少不是 `disabled`

如果你想一键做本地排查，可以运行：

```bash
npm run doctor:opencode
```

或输出 JSON：

```bash
npm run doctor:opencode -- --json
```

这个 doctor 会重点检查：

- 当前项目里有没有项目级 OpenCode 配置文件
- `dist/index.js` 是否存在
- 有效配置里的 `hltv_local.enabled` 是否为 `true`
- MCP 启动路径是不是当前项目的 `dist/index.js`
- `HLTV_API_BASE_URL` / `HLTV_API_FALLBACK_BASE_URL` 指向的上游是否可达

它不会单独替代 `opencode debug config` / `opencode mcp list --print-logs`：如果你要确认“到底是哪一份配置真正生效”，仍然应该结合这两个 OpenCode 命令一起看。

---

### 4.4 在 OpenCode 中直接调用工具

可以先测试实体解析：

```text
调用 hltv_local_resolve_team，搜索 Team Spirit
```

再测试近况查询：

```text
调用 hltv_local_hltv_team_recent，查询 Team Spirit 最近 5 场比赛，并用中文总结
```

如果你已经拿到实体 ID，推荐直接按 ID 查询（ID-first）：

```text
先调用 hltv_local_resolve_player，搜索 zywoo
再调用 hltv_local_hltv_player_recent，传 player_id=<上一步结果里的 id>
```

```text
调用 hltv_local_hltv_results_recent，传 team_id=<Team Spirit 的 id>
调用 hltv_local_hltv_matches_upcoming，传 team_id=<Team Spirit 的 id>
```

> 注意：本项目现在会优先通过 `resolve_team` / `resolve_player` 拿 canonical slug，避免像 `Team Spirit -> team-spirit` 这种本地伪造 slug 导致的 404。

---

### 4.5 也可以用 OpenCode CLI 向导手动添加

```bash
opencode mcp add
```

建议填写：

- 类型：`local`
- 名称：`hltv_local`
- command：`node`
- args：`/absolute/path/to/hltv-mcp-service/dist/index.js`
- timeout：`10000`
- environment：与上面示例一致

如果你是在 **WSL** 里跑 OpenCode / MCP：

- `args` 请填写 **WSL/Linux 可访问路径**，例如 `/home/you/.../dist/index.js` 或 `/mnt/c/.../dist/index.js`；
- 不要直接照抄 `C:/...` 这种 Windows 路径，否则本地 stdio MCP 很可能根本拉不起来。

---

## 5. 手动注册 OpenCode slash commands

### 重要说明

OpenCode 的 slash commands 不是 MCP 自动生成的。

也就是说：

- 你把 MCP 接进去以后，**tools 会出现**
- 但 `/team` `/player` `/result` `/match` `/news` **不会自动出现**

如果你要这些命令，需要你自己手动复制模板到：

```text
.opencode/commands/
```

如果你想直接参考一套完整目录结构，而不只是单个模板文件，可以看：

```text
examples/opencode-project/
```

这里面已经包含：

- `opencode.jsonc`
- `.opencode/commands/team.md`
- `.opencode/commands/player.md`
- `.opencode/commands/result.md`
- `.opencode/commands/match.md`
- `.opencode/commands/news.md`

> 这个目录只是示例，不会被 OpenCode 自动加载。  
> 你需要手动复制到你自己的项目里。

本仓库已经提供了模板：

- `docs/templates/opencode.commands.team.md`
- `docs/templates/opencode.commands.player.md`
- `docs/templates/opencode.commands.result.md`
- `docs/templates/opencode.commands.match.md`
- `docs/templates/opencode.commands.news.md`
- `docs/templates/opencode.jsonc`

推荐复制方式：

- `docs/templates/opencode.commands.team.md` -> `.opencode/commands/team.md`
- `docs/templates/opencode.commands.player.md` -> `.opencode/commands/player.md`
- `docs/templates/opencode.commands.result.md` -> `.opencode/commands/result.md`
- `docs/templates/opencode.commands.match.md` -> `.opencode/commands/match.md`
- `docs/templates/opencode.commands.news.md` -> `.opencode/commands/news.md`

复制完成后，你就可以在 OpenCode 里使用：

- `/team Team Spirit`
- `/player ZywOo`
- `/result`
- `/match`（只支持无参数，用于查询今日赛程）
- `/news`（默认 25 条，支持“继续”读取下一批，最终展示可带中文标题）

> 模板默认写死使用 `hltv_local_` 前缀。  
> 如果你的 MCP 名称不是 `hltv_local`，请先把模板里的工具名前缀改掉再使用。

当前 `/news` 模板约定：

- 默认调用 `hltv_local_hltv_news_digest({ limit: 25 })`
- 支持根据上一轮返回的分页元信息继续读取下一批（如 `next_page` / `next_offset`）
- 最终 slash-command 输出默认不展示数据源字段，可由助手基于英文原标题补充中文标题；MCP 工具原始结果仍以英文标题为准

---

## 6. 其他客户端对接模板

下面这些是**客户端配置模板**，不是当前仓库已经实现的服务端入口。

---

### 6.1 stdio 模板

#### 适用场景

- 本地 CLI / IDE / 桌面 MCP 客户端
- 客户端自己拉起 `node dist/index.js`

#### 当前支持情况

- **已实现，可直接使用**

#### 通用模板

```json
{
  "transport": "stdio",
  "command": "node",
  "args": [
    "/absolute/path/to/hltv-mcp-service/dist/index.js"
  ],
  "env": {
    "HLTV_UPSTREAM_MANAGED": "false",
    "HLTV_API_BASE_URL": "http://127.0.0.1:8020",
    "HLTV_API_FALLBACK_BASE_URL": "http://WINDOWS_HOST_IP:8020",
    "HLTV_API_TIMEOUT_MS": "8000",
    "DEFAULT_RESULT_LIMIT": "5",
    "SUMMARY_MODE": "template"
  }
}
```

WSL 场景下请注意：

- 如果上游也跑在 WSL 里，`127.0.0.1` 通常没问题；
- 如果上游跑在 Windows 宿主机里，优先依赖当前版本内置的自动回退，必要时显式设置 `HLTV_API_FALLBACK_BASE_URL`；
- `args` 必须是 WSL 内可访问的 Linux 路径，而不是 `C:/...`。

---

### 6.2 Streamable HTTP 模板

#### 当前支持情况

- **SDK 支持，但本仓库未实现服务端入口**

#### 客户端模板

```json
{
  "transport": "streamable-http",
  "url": "https://your-domain.example.com/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

#### 说明

- 这是客户端模板
- 当前仓库默认**没有**这个 HTTP endpoint
- 如果要支持，需要你后续自行接入 `StreamableHTTPServerTransport`

---

### 6.3 SSE 模板

#### 当前支持情况

- **SDK 可支持，但本仓库未实现服务端入口**
- **新项目更推荐 Streamable HTTP，而不是 SSE**

#### 客户端模板

```json
{
  "transport": "sse",
  "url": "https://your-domain.example.com/sse"
}
```

#### 说明

- 这是兼容性模板
- 当前仓库默认**没有**这个 SSE endpoint
- 如果要支持，需要你后续自行接入 `SSEServerTransport`

---

## 7. 故障排查

### 7.1 `HLTV API responded with 404`

通常表示：

- 上游 `hltv-scraper-api` 没有这条实体
- 或者详情路由里的 slug 不对

现在本项目会优先从搜索结果里的真实 `link/profile_link` 提取 slug，而不是只靠本地 `slugify()` 硬拼。

如果还报错，先做这两步：

1. 先调用 `hltv_local_resolve_team` / `hltv_local_resolve_player` 看解析结果
2. 再检查错误输出里的 `上游路径` 和 `上游状态码`

---

### 7.2 为什么我已经接了 MCP，但没有 `/team` 命令？

因为 OpenCode 的 command 和 MCP tool 是两套东西：

- MCP 注册后你得到的是 tool
- slash command 需要你自己在 `.opencode/commands/` 或 `opencode.jsonc` 里再注册

---

### 7.3 WSL 下为什么 `hltv-mcp` 拉不起来，或者一直连不上上游？

最常见的就是这三个原因：

1. **当前项目根本没有项目级配置文件，实际仍在吃全局配置**
   - 这时你虽然是在项目目录里运行 OpenCode，但真正生效的可能还是 `~/.config/opencode/opencode.jsonc`
   - 可以用 `opencode mcp list --print-logs` 看它到底加载了哪些配置文件
   - 也可以直接跑 `npm run doctor:opencode`

2. **本地 MCP 启动路径写成了 Windows 路径**
   - 例如在 WSL 里仍然写 `C:/.../dist/index.js`
   - 这会导致 OpenCode 无法正确拉起 `node dist/index.js`
3. **上游 base URL 仍然指向 `127.0.0.1`，但 API 实际跑在 Windows 宿主机**
   - 这时 WSL 里的 `127.0.0.1` 指向的是 WSL 自己，不一定是 Windows 上的服务
   - 当前版本会自动尝试 `/etc/resolv.conf` 里的 Windows host 地址
   - 如果仍失败，请手动设置 `HLTV_API_FALLBACK_BASE_URL`

还有一个高频但很容易漏掉的问题：

- `hltv_local.enabled` 仍然是 `false`
- 这会让 OpenCode 列表里显示 `disabled`，即使 command path 已经改对了也不会真的连上
- `npm run doctor:opencode` 也会直接把这个问题报出来

另外，当前实现对 `HLTV_API_BASE_URL` 的 path prefix 也更友好了：

- 例如把上游挂在 `http://host:8020/some-prefix/` 时，请求会保留这个 prefix，而不是强制打到站点根路径

---

## 8. 最后总结

当前仓库最稳妥的接法是：

1. `npm install`
2. `npm run build`
3. 你手动把 `node dist/index.js` 注册到 OpenCode 的 `local MCP`
4. 用 `opencode mcp list` 检查 `hltv_local` 是否出现
5. 按需把 `docs/templates/` 里的命令模板复制到 `.opencode/commands/`
6. 在 OpenCode 中调用 `/team` `/player` `/result` `/match` `/news` 或直接调用 prefixed tools

当前结论：

- **stdio：现在就能用**
- **OpenCode 命令模板：现在仓库已提供，可手动复制**
- **Streamable HTTP：可扩展，但当前未实现**
- **SSE：可扩展，但当前未实现**
