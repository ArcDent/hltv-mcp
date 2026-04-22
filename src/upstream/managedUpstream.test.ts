import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startManagedUpstream } from "./managedUpstream.js";
import { assertPortAvailable, buildBaseUrl } from "./port.js";
import { UpstreamStartupError } from "./startupError.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures");

function nextPort(seed: number): number {
  return 19_000 + seed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listenServer(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("buildBaseUrl wraps IPv6 hosts with brackets", () => {
  const value = buildBaseUrl("::1", 19_160);
  assert.equal(value, "http://[::1]:19160/");
  assert.equal(new URL(value).toString(), "http://[::1]:19160/");
});

test("startManagedUpstream rejects a missing interpreter path", async () => {
  await assert.rejects(
    () =>
      startManagedUpstream({
        enabled: true,
        pythonPath: "/tmp/does-not-exist-python",
        workingDirectory: fixturesDir,
        appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
        host: "127.0.0.1",
        port: nextPort(1),
        startTimeoutMs: 1_000,
        healthPath: "/healthz",
        requestTimeoutMs: 250
      }),
    /python/i
  );
});

test("startManagedUpstream starts a managed child and stops it idempotently", async () => {
  const handle = await startManagedUpstream(
    {
      enabled: true,
      pythonPath: process.execPath,
      workingDirectory: fixturesDir,
      appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
      host: "127.0.0.1",
      port: nextPort(2),
      startTimeoutMs: 3_000,
      healthPath: "/healthz",
      requestTimeoutMs: 250
    },
    {
      ...process.env,
      FAKE_UPSTREAM_MODE: "serve"
    }
  );

  const response = await fetch(`${handle.baseUrl}healthz`);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status?: unknown }).status, "ok");

  await handle.stop();
  await handle.stop();
});

test("startManagedUpstream aborts delayed startup and does not leave a managed child running", async () => {
  const port = nextPort(7);
  const abortController = new AbortController();

  const startupPromise = startManagedUpstream(
    {
      enabled: true,
      pythonPath: process.execPath,
      workingDirectory: fixturesDir,
      appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
      host: "127.0.0.1",
      port,
      startTimeoutMs: 5_000,
      healthPath: "/healthz",
      requestTimeoutMs: 250
    },
    {
      ...process.env,
      FAKE_UPSTREAM_MODE: "serve",
      FAKE_UPSTREAM_DELAY_MS: "1500"
    },
    {
      signal: abortController.signal
    }
  );

  await delay(120);
  abortController.abort("test shutdown during startup");

  await assert.rejects(
    async () => {
      const handle = await startupPromise;
      await handle.stop();
    },
    /abort/i
  );

  await delay(1_700);
  await assert.doesNotReject(() => assertPortAvailable("127.0.0.1", port));
});

test("startManagedUpstream uses loopback dial URL for wildcard IPv4 bind host", async () => {
  const handle = await startManagedUpstream(
    {
      enabled: true,
      pythonPath: process.execPath,
      workingDirectory: fixturesDir,
      appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
      host: "0.0.0.0",
      port: nextPort(5),
      startTimeoutMs: 3_000,
      healthPath: "/healthz",
      requestTimeoutMs: 250
    },
    {
      ...process.env,
      FAKE_UPSTREAM_MODE: "serve"
    }
  );

  try {
    assert.equal(handle.baseUrl, `http://127.0.0.1:${nextPort(5)}/`);

    const response = await fetch(`${handle.baseUrl}healthz`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { status?: unknown }).status, "ok");
  } finally {
    await handle.stop();
  }
});

test("startManagedUpstream does not become ready from a foreign health responder", async () => {
  const port = nextPort(4);
  let foreignHealthHitCount = 0;

  const foreignServer = http.createServer((request, response) => {
    if (request.url === "/healthz") {
      foreignHealthHitCount += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "foreign" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  let resolvedHandle: Awaited<ReturnType<typeof startManagedUpstream>> | undefined;

  const delayedForeignStart = (async () => {
    await delay(350);
    await listenServer(foreignServer, port, "127.0.0.1");
  })();

  try {
    await assert.rejects(
      async () => {
        resolvedHandle = await startManagedUpstream(
          {
            enabled: true,
            pythonPath: process.execPath,
            workingDirectory: fixturesDir,
            appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
            host: "127.0.0.1",
            port,
            startTimeoutMs: 1_300,
            healthPath: "/healthz",
            requestTimeoutMs: 100
          },
          {
            ...process.env,
            FAKE_UPSTREAM_MODE: "idle"
          }
        );

        throw new Error("startManagedUpstream unexpectedly resolved");
      },
      (error: unknown): boolean => {
        if (!(error instanceof UpstreamStartupError)) {
          return false;
        }

        const lastFailureReason = error.details.lastFailureReason;
        const lastError = error.details.lastError;

        return (
          lastFailureReason === "instance_token_mismatch" &&
          lastError instanceof Error &&
          /instance token mismatch/i.test(lastError.message)
        );
      }
    );

    assert.ok(
      foreignHealthHitCount > 0,
      "expected to hit the foreign /healthz endpoint before failing startup"
    );
  } finally {
    await delayedForeignStart.catch(() => {});
    await resolvedHandle?.stop();
    await closeServer(foreignServer);
  }
});

test("startManagedUpstream surfaces early child exit", async () => {
  await assert.rejects(
    () =>
      startManagedUpstream(
        {
          enabled: true,
          pythonPath: process.execPath,
          workingDirectory: fixturesDir,
          appFile: path.join(fixturesDir, "fakeUpstreamServer.mjs"),
          host: "127.0.0.1",
          port: nextPort(3),
          startTimeoutMs: 2_000,
          healthPath: "/healthz",
          requestTimeoutMs: 250
        },
        {
          ...process.env,
          FAKE_UPSTREAM_MODE: "exit-immediately"
        }
      ),
    /exited/i
  );
});

test("assertPortAvailable reports bind host not available distinctly", async () => {
  await assert.rejects(
    () => assertPortAvailable("203.0.113.123", nextPort(6)),
    (error: unknown): boolean => {
      if (!(error instanceof UpstreamStartupError)) {
        return false;
      }

      if (!/bind host is not available/i.test(error.message)) {
        return false;
      }

      const cause = error.details.cause;
      return !!cause &&
        typeof cause === "object" &&
        "code" in cause &&
        (cause as { code?: unknown }).code === "EADDRNOTAVAIL";
    }
  );
});
