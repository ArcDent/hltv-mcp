import { ChildProcess, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { UpstreamStartupError } from "./startupError.js";

export interface SpawnManagedUpstreamOptions {
  pythonPath: string;
  workingDirectory: string;
  appFile: string;
  host: string;
  port: number;
  env?: NodeJS.ProcessEnv;
}

export async function spawnManagedUpstream(options: SpawnManagedUpstreamOptions): Promise<ChildProcess> {
  const resolvedWorkdir = path.resolve(options.workingDirectory);
  const resolvedAppFile = path.resolve(options.appFile);

  try {
    await access(resolvedWorkdir);
  } catch (error) {
    throw new UpstreamStartupError("Managed upstream working directory is missing", {
      workingDirectory: resolvedWorkdir,
      cause: error
    });
  }

  try {
    await access(resolvedAppFile);
  } catch (error) {
    throw new UpstreamStartupError("Managed upstream entrypoint is missing", {
      appFile: resolvedAppFile,
      cause: error
    });
  }

  let child: ChildProcess;

  try {
    child = spawn(options.pythonPath, [resolvedAppFile], {
      cwd: resolvedWorkdir,
      env: {
        ...process.env,
        ...options.env,
        HLTV_UPSTREAM_HOST: options.host,
        HLTV_UPSTREAM_PORT: String(options.port),
        HLTV_UPSTREAM_DEBUG: "false"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    throw new UpstreamStartupError("Failed to spawn managed upstream", {
      pythonPath: options.pythonPath,
      workingDirectory: resolvedWorkdir,
      appFile: resolvedAppFile,
      cause: error
    });
  }

  child.stdout?.on("data", (chunk: Buffer | string) => {
    process.stderr.write(`[hltv-upstream] ${chunk}`);
  });

  child.stderr?.on("data", (chunk: Buffer | string) => {
    process.stderr.write(`[hltv-upstream] ${chunk}`);
  });

  return child;
}
