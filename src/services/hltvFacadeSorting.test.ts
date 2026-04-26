import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCache } from "../cache/memoryCache.js";
import type { AppConfig } from "../config/env.js";
import { HltvFacade } from "./hltvFacade.js";

function createConfig(): AppConfig {
  return {
    mcpServerName: "hltv-mcp-service",
    mcpServerVersion: "0.3.0",
    hltvApiBaseUrl: "http://127.0.0.1:8020",
    hltvApiBaseUrls: ["http://127.0.0.1:8020"],
    hltvApiTimeoutMs: 1_000,
    defaultResultLimit: 10,
    summaryMode: "template",
    entityCacheTtlSec: 60,
    teamRecentCacheTtlSec: 60,
    playerRecentCacheTtlSec: 60,
    resultsCacheTtlSec: 60,
    matchesCacheTtlSec: 60,
    newsCacheTtlSec: 60,
    realtimeNewsCacheTtlSec: 60
  };
}

test("recent results are sorted by played_at descending with missing dates last", async () => {
  const facade = new HltvFacade(
    createConfig(),
    {
      getRecentResults: async () => [
        { id: 1, team1: "Early", team2: "Opponent", score: "13:10", played_at: "2026-04-18T10:00:00.000Z" },
        { id: 2, team1: "Missing", team2: "Opponent", score: "13:7" },
        { id: 3, team1: "Latest", team2: "Opponent", score: "13:11", played_at: "2026-04-20T10:00:00.000Z" },
        { id: 4, team1: "Middle", team2: "Opponent", score: "13:9", played_at: "2026-04-19T10:00:00.000Z" }
      ]
    } as never,
    new MemoryCache(),
    {} as never,
    {} as never
  );

  const response = await facade.getResultsRecent({ days: 365, limit: 10 });

  assert.deepEqual(
    response.items?.map((item) => item.team1),
    ["Latest", "Middle", "Early", "Missing"]
  );
});

test("upcoming matches are sorted by scheduled_at ascending with missing dates last", async () => {
  const facade = new HltvFacade(
    createConfig(),
    {
      getUpcomingMatches: async () => [
        { id: 1, team1: "Late", team2: "Opponent", scheduled_at: "2999-04-20T10:00:00.000Z" },
        { id: 2, team1: "Missing", team2: "Opponent" },
        { id: 3, team1: "Early", team2: "Opponent", scheduled_at: "2999-04-18T10:00:00.000Z" },
        { id: 4, team1: "Middle", team2: "Opponent", scheduled_at: "2999-04-19T10:00:00.000Z" }
      ]
    } as never,
    new MemoryCache(),
    {} as never,
    {} as never
  );

  const response = await facade.getUpcomingMatches({ days: 365_000, limit: 10 });

  assert.deepEqual(
    response.items?.map((item) => item.team1),
    ["Early", "Middle", "Late", "Missing"]
  );
});
