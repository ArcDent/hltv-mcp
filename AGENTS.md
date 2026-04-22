# AGENTS.md

## What this repo actually is
- The root project is a TypeScript MCP server. `src/index.ts` is the only runtime entrypoint; it loads config, starts the managed upstream by default, then wires `MemoryCache`, `HltvApiClient`, resolvers, `HltvFacade`, `SummaryService`, and `ChineseRenderer`, and starts the MCP server over stdio.
- `src/mcp/server.ts` is the MCP wiring layer: tool registration lives here, and the only implemented transport is stdio. README examples for Streamable HTTP / SSE are client templates, not implemented server entrypoints.
- `hltv-api-fixed/` is a separate bundled Python upstream scraper API with its own Makefile/tests. Do not mix its commands or assumptions with the root TypeScript package.

## Root commands (verified)
- Node requirement: `>=18.17`.
- Install deps first: `npm install`
- Typecheck: `npm run check`
- Build: `npm run build`
- Start built stdio server: `npm run start`
- There is **no** root `npm test` script.
- Verified focused TS test entrypoint: `node --import tsx --test src/matchCommandFlow.test.ts`
  - Use this instead of plain `node --test ...`; the repo uses TypeScript source with ESM `.js` import specifiers, so direct `node --test` against the `.ts` file fails.

## High-value code boundaries
- `src/mcp/*`: MCP schemas + tool registration.
- `src/services/hltvFacade.ts`: orchestration, cache usage, query normalization, and tool-level behavior.
- `src/clients/hltvApiClient.ts`: upstream HTTP calls, retry/failover across `baseUrls`, timeout handling.
- `src/resolvers/*`: team/player identity resolution and canonical slug handling.
- `src/renderers/chineseRenderer.ts`: final user-facing Chinese rendering.

## Upstream/API assumptions
- Managed upstream is the default: `loadConfig()` enables it unless `HLTV_UPSTREAM_MANAGED=false`.
- `src/index.ts` starts managed upstream (`hltv-api-fixed/app.py`) before constructing `HltvApiClient` when managed mode is enabled.
- Default managed Python path is `hltv-api-fixed/env/bin/python`; if it is missing, startup must fail fast.
- To restore external upstream mode, set `HLTV_UPSTREAM_MANAGED=false` and configure `HLTV_API_BASE_URL` (plus optional `HLTV_API_FALLBACK_BASE_URL`).
- In WSL external mode, `src/config/env.ts` automatically adds a fallback base URL by reading `/etc/resolv.conf` **when** the configured base URL is loopback-like (`127.0.0.1`, `localhost`, `0.0.0.0`, `::1`).
- If the upstream runs on the Windows host and auto-detect still does not work, set `HLTV_API_FALLBACK_BASE_URL` explicitly.
- MCP registration examples point to the built file at `dist/index.js` and default the MCP name to `hltv_local`; if you rename the MCP, update the tool prefix everywhere.

## Behavior that must not regress
- `/match` is intentionally **today-only** in the shipped slash-command templates.
  - Bare `/match` -> call `hltv_*_hltv_matches_today({})`
  - Any non-empty `/match` args -> reject and tell the user to remove arguments
  - Do **not** run `match_command_parse` for bare `/match`
  - For filtered future matches, call `hltv_*_hltv_matches_upcoming` directly
- `HltvFacade.getTodayMatches()` intentionally delegates as `getUpcomingMatches({})`; the empty query is what triggers today-only behavior.
- `src/services/upcomingMatchesQuery.ts` deliberately strips generic/autofilled placeholders like “today matches”. Do not add guessed `team` / `event` / `limit` / `days` fields when the intent is just “today schedule”.
- If you touch `/match` behavior, also run `node --import tsx --test src/matchCommandFlow.test.ts`; that test covers the command handler, MCP tool registration, and both match template files.

## OpenCode templates/examples
- `docs/templates/` and `examples/opencode-project/` are reference material only; they are intentionally not live config for this repo.
- If you copy them into a real OpenCode project, replace the hard-coded `hltv_local_` prefix if the actual MCP name differs.

## If you intentionally work inside `hltv-api-fixed/`
- Use its own commands from that subdirectory:
  - `make test-unit`
  - `make test-integration`
  - `make test-fast`
  - `make test-slow`
  - `make test-cov`
  - one test: `make test-one TEST=test_player_search_success`
- Those Make targets assume a Python virtualenv at `hltv-api-fixed/env/` because they invoke `./env/bin/python`.
