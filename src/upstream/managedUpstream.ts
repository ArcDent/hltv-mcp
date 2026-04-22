import { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { waitForHealthyUpstream } from "./healthcheck.js";
import { buildBaseUrl, assertPortAvailable, resolveDialHost } from "./port.js";
import { spawnManagedUpstream } from "./processManager.js";
import { resolvePythonPath } from "./pythonLocator.js";
import { UpstreamStartupError } from "./startupError.js";
import type { ManagedUpstreamConfig, ManagedUpstreamHandle } from "./types.js";

interface StartManagedUpstreamOptions {
  signal?: AbortSignal;
}

function withCause(
  message: string,
  details: Record<string, unknown>,
  cause: unknown
): UpstreamStartupError {
  if (cause instanceof UpstreamStartupError) {
    return cause;
  }

  return new UpstreamStartupError(message, {
    ...details,
    cause
  });
}

function createAbortError(signal: AbortSignal): UpstreamStartupError {
  return new UpstreamStartupError("Managed upstream startup aborted", {
    reason: signal.reason
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

function createAbortWatcher(signal: AbortSignal | undefined): { promise: Promise<never>; dispose: () => void } {
  if (!signal) {
    return {
      promise: new Promise<never>(() => {}),
      dispose: () => {}
    };
  }

  let onAbort: (() => void) | undefined;

  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(createAbortError(signal));
      return;
    }

    onAbort = () => {
      reject(createAbortError(signal));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });

  return {
    promise,
    dispose: () => {
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  };
}

export async function startManagedUpstream(
  config: ManagedUpstreamConfig,
  env: NodeJS.ProcessEnv = process.env,
  options: StartManagedUpstreamOptions = {}
): Promise<ManagedUpstreamHandle> {
  const startupSignal = options.signal;
  const dialHost = resolveDialHost(config.host);

  if (!config.enabled) {
    return {
      baseUrl: buildBaseUrl(dialHost, config.port),
      managed: false,
      stop: async () => {}
    };
  }

  throwIfAborted(startupSignal);

  const pythonPath = await resolvePythonPath(config.pythonPath);
  throwIfAborted(startupSignal);

  await assertPortAvailable(config.host, config.port);
  throwIfAborted(startupSignal);

  const instanceToken = randomUUID();

  const child = await spawnManagedUpstream({
    pythonPath,
    workingDirectory: config.workingDirectory,
    appFile: config.appFile,
    host: config.host,
    port: config.port,
    env: {
      ...env,
      HLTV_UPSTREAM_HEALTH_PATH: config.healthPath,
      HLTV_UPSTREAM_INSTANCE_TOKEN: instanceToken
    }
  });

  const abortWatcher = createAbortWatcher(startupSignal);

  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;

  const exitState = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      resolve();
    });
  });

  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      reject(
        new UpstreamStartupError("Failed to spawn managed upstream", {
          pythonPath,
          workingDirectory: config.workingDirectory,
          appFile: config.appFile,
          cause: error
        })
      );
    });
  });

  const baseUrl = buildBaseUrl(dialHost, config.port);

  try {
    await Promise.race([
      waitForHealthyUpstream({
        baseUrl,
        healthPath: config.healthPath,
        timeoutMs: config.startTimeoutMs,
        requestTimeoutMs: config.requestTimeoutMs,
        expectedInstanceToken: instanceToken,
        isChildAlive: () => !exited
      }),
      spawnError,
      exitState.then(() => {
        throw new UpstreamStartupError("Managed upstream exited before becoming healthy", {
          baseUrl,
          healthPath: config.healthPath,
          exitCode,
          exitSignal
        });
      })
      ,
      abortWatcher.promise
    ]);
  } catch (error) {
    await stopChild(child);
    throw withCause(
      "Managed upstream failed during startup",
      {
        baseUrl,
        healthPath: config.healthPath,
        timeoutMs: config.startTimeoutMs,
        expectedInstanceToken: instanceToken,
        exitCode,
        exitSignal
      },
      error
    );
  } finally {
    abortWatcher.dispose();
  }

  let stopping: Promise<void> | undefined;

  return {
    baseUrl,
    managed: true,
    pid: child.pid,
    stop() {
      if (!stopping) {
        stopping = stopChild(child);
      }

      return stopping;
    }
  };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let killTimer: NodeJS.Timeout | undefined;

    const finish = () => {
      if (killTimer) {
        clearTimeout(killTimer);
      }

      resolve();
    };

    child.once("exit", finish);

    child.kill("SIGTERM");

    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 1_000);
  });
}
