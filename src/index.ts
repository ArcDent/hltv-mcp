import { MemoryCache } from "./cache/memoryCache.js";
import { HltvApiClient } from "./clients/hltvApiClient.js";
import { loadConfig } from "./config/env.js";
import { createMcpServer, startMcpServer } from "./mcp/server.js";
import { ChineseRenderer } from "./renderers/chineseRenderer.js";
import { PlayerResolver } from "./resolvers/playerResolver.js";
import { TeamResolver } from "./resolvers/teamResolver.js";
import { HltvFacade } from "./services/hltvFacade.js";
import { SummaryService } from "./services/summaryService.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const cache = new MemoryCache();
  const client = new HltvApiClient({
    baseUrl: config.hltvApiBaseUrl,
    baseUrls: config.hltvApiBaseUrls,
    timeoutMs: config.hltvApiTimeoutMs
  });
  const teamResolver = new TeamResolver(client);
  const playerResolver = new PlayerResolver(client);
  const facade = new HltvFacade(config, client, cache, teamResolver, playerResolver);
  const summaryService = new SummaryService(config.summaryMode);
  const renderer = new ChineseRenderer(summaryService);
  const server = createMcpServer(config, facade, renderer);

  await startMcpServer(server);
}

main().catch((error) => {
  console.error("Failed to start HLTV MCP server", error);
  process.exitCode = 1;
});
