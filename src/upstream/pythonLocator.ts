import { access } from "node:fs/promises";
import path from "node:path";
import { UpstreamStartupError } from "./startupError.js";

export async function resolvePythonPath(pythonPath: string): Promise<string> {
  const resolvedPath = path.resolve(pythonPath);

  try {
    await access(resolvedPath);
    return resolvedPath;
  } catch (error) {
    throw new UpstreamStartupError("Managed upstream Python interpreter not found", {
      pythonPath: resolvedPath,
      cause: error
    });
  }
}
