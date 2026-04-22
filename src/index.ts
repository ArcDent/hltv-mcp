import path from "node:path";
import { MemoryCache } from "./cache/memoryCache.js";
import { HltvApiClient } from "./clients/hltvApiClient.js";
import { loadConfig } from "./config/env.js";
import { createMcpServer, startMcpServer } from "./mcp/server.js";
import { ChineseRenderer } from "./renderers/chineseRenderer.js";
import { PlayerResolver } from "./resolvers/playerResolver.js";
import { TeamResolver } from "./resolvers/teamResolver.js";
import { HltvFacade } from "./services/hltvFacade.js";
import { SummaryService } from "./services/summaryService.js";
import { startManagedUpstream } from "./upstream/managedUpstream.js";

function registerManagedShutdown(stopManagedUpstreamOnce: () => Promise<void>): void {
  const stopOnSignal = (signal: NodeJS.Signals) => {
    void stopManagedUpstreamOnce().finally(() => {
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exitCode = 1;
      }
    });
  };

  process.once("beforeExit", () => {
    void stopManagedUpstreamOnce();
  });

  process.once("SIGINT", () => {
    stopOnSignal("SIGINT");
  });

  process.once("SIGTERM", () => {
    stopOnSignal("SIGTERM");
  });

  process.stdin.once("end", () => {
    void stopManagedUpstreamOnce();
  });

  process.stdin.once("close", () => {
    void stopManagedUpstreamOnce();
  });
}

async function main(): Promise<void> {
  const config = loadConfig();

  let managedUpstreamStop: (() => Promise<void>) | undefined;
  let managedUpstreamStartPromise: Promise<{ stop: () => Promise<void> }> | undefined;
  let managedStartupAbortController: AbortController | undefined;
  let managedUpstreamStopPromise: Promise<void> | undefined;

  const stopManagedUpstreamOnce = (): Promise<void> => {
    if (!managedUpstreamStopPromise) {
      managedUpstreamStopPromise = (async () => {
        managedStartupAbortController?.abort("managed upstream shutdown requested");

        if (managedUpstreamStop) {
          await managedUpstreamStop();
          return;
        }

        if (managedUpstreamStartPromise) {
          await managedUpstreamStartPromise
            .then(async (handle) => {
              await handle.stop();
            })
            .catch(() => {});
        }
      })().catch((error) => {
        console.error("Failed to stop managed upstream", error);
      });
    }

    return managedUpstreamStopPromise;
  };

  if (config.managedUpstreamEnabled) {
    managedStartupAbortController = new AbortController();
    registerManagedShutdown(stopManagedUpstreamOnce);

    const managedUpstreamWorkdir = config.managedUpstreamWorkdir ?? path.join(process.cwd(), "hltv-api-fixed");
    managedUpstreamStartPromise = startManagedUpstream(
      {
        enabled: true,
        pythonPath: config.managedUpstreamPythonPath ?? path.join(managedUpstreamWorkdir, "env", "bin", "python"),
        workingDirectory: managedUpstreamWorkdir,
        appFile: path.join(managedUpstreamWorkdir, "app.py"),
        host: config.managedUpstreamHost ?? "127.0.0.1",
        port: config.managedUpstreamPort ?? 18_020,
        startTimeoutMs: config.managedUpstreamStartTimeoutMs ?? 15_000,
        healthPath: config.managedUpstreamHealthPath ?? "/healthz",
        requestTimeoutMs: config.hltvApiTimeoutMs
      },
      process.env,
      {
        signal: managedStartupAbortController.signal
      }
    );

    const managedUpstreamHandle = await managedUpstreamStartPromise;

    managedUpstreamStop = managedUpstreamHandle.stop;
  }

  const cache = new MemoryCache();

  try {
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
  } catch (error) {
    await stopManagedUpstreamOnce();
    throw error;
  }
}

main().catch((error) => {
  console.error("Failed to start HLTV MCP server", error);
  process.exitCode = 1;
});
