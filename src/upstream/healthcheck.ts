import { UpstreamStartupError } from "./startupError.js";

export interface HealthcheckOptions {
  baseUrl: string;
  healthPath: string;
  timeoutMs: number;
  requestTimeoutMs: number;
  expectedInstanceToken?: string;
  isChildAlive: () => boolean;
}

type FailureReason = "instance_token_mismatch" | "invalid_health_payload" | "http_status" | "request_error";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForHealthyUpstream(options: HealthcheckOptions): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  let lastFailureReason: FailureReason | undefined;
  const healthUrl = new URL(options.healthPath.replace(/^\/+/, ""), options.baseUrl);

  while (Date.now() - startedAt < options.timeoutMs) {
    if (!options.isChildAlive()) {
      throw new UpstreamStartupError("Managed upstream exited before becoming healthy", {
        baseUrl: options.baseUrl,
        healthPath: options.healthPath,
        lastError
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);

    try {
      const response = await fetch(healthUrl, { signal: controller.signal });

      if (response.ok) {
        if (!options.expectedInstanceToken) {
          return;
        }

        try {
          const payload = await response.json() as { instance_token?: unknown };

          if (payload.instance_token === options.expectedInstanceToken) {
            return;
          }

          lastError = new Error("healthcheck instance token mismatch");
          lastFailureReason = "instance_token_mismatch";
        } catch (error) {
          lastError = error;
          lastFailureReason = "invalid_health_payload";
        }

        await delay(100);
        continue;
      }

      lastError = new Error(`healthcheck responded with ${response.status}`);
      lastFailureReason = "http_status";
    } catch (error) {
      lastError = error;
      lastFailureReason = "request_error";
    } finally {
      clearTimeout(timer);
    }

    await delay(100);
  }

  throw new UpstreamStartupError("Timed out waiting for managed upstream healthcheck", {
    baseUrl: options.baseUrl,
    healthPath: options.healthPath,
    timeoutMs: options.timeoutMs,
    expectedInstanceToken: options.expectedInstanceToken,
    lastFailureReason,
    lastError
  });
}
