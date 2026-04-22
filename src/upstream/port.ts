import net from "node:net";
import { UpstreamStartupError } from "./startupError.js";

export function resolveDialHost(host: string): string {
  const normalized = host.trim().toLowerCase();

  if (normalized === "0.0.0.0") {
    return "127.0.0.1";
  }

  if (normalized === "::") {
    return "::1";
  }

  return host;
}

export function buildBaseUrl(host: string, port: number): string {
  const normalizedHost = net.isIP(host) === 6 && !host.startsWith("[") && !host.endsWith("]") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}/`;
}

export async function assertPortAvailable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      server.close();

      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        reject(
          new UpstreamStartupError("Managed upstream port is already in use", {
            host,
            port,
            code: (error as NodeJS.ErrnoException).code,
            cause: error
          })
        );
        return;
      }

      if ((error as NodeJS.ErrnoException).code === "EADDRNOTAVAIL") {
        reject(
          new UpstreamStartupError("Managed upstream bind host is not available", {
            host,
            port,
            code: (error as NodeJS.ErrnoException).code,
            cause: error
          })
        );
        return;
      }

      reject(
        new UpstreamStartupError("Failed to probe managed upstream bind target", {
          host,
          port,
          code: (error as NodeJS.ErrnoException).code,
          cause: error
        })
      );
    });

    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(
            new UpstreamStartupError("Failed to release managed upstream port probe", {
              host,
              port,
              cause: closeError
            })
          );
          return;
        }

        resolve();
      });
    });

    server.listen(port, host);
  });
}
