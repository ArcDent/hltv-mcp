import http from "node:http";

const host = process.env.HLTV_UPSTREAM_HOST ?? "127.0.0.1";
const port = Number(process.env.HLTV_UPSTREAM_PORT ?? "18020");
const healthPath = process.env.HLTV_UPSTREAM_HEALTH_PATH ?? "/healthz";
const mode = process.env.FAKE_UPSTREAM_MODE ?? "serve";
const instanceToken = process.env.HLTV_UPSTREAM_INSTANCE_TOKEN ?? "";

if (mode === "exit-immediately") {
  process.stderr.write("exiting before ready\n");
  process.exit(1);
}

if (mode === "idle") {
  process.stderr.write("running idle without binding socket\n");
  const shutdown = () => {
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  setInterval(() => {
    // keep process alive
  }, 1_000);
} else {
  const startupDelayMs = Number(process.env.FAKE_UPSTREAM_DELAY_MS ?? "0");

  setTimeout(() => {
    const server = http.createServer((request, response) => {
      if (request.url === healthPath) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok", instance_token: instanceToken || undefined }));
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });

    server.listen(port, host, () => {
      process.stderr.write(`fake upstream listening on ${host}:${port}\n`);
    });

    const shutdown = () => {
      server.close(() => process.exit(0));
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }, startupDelayMs);
}
