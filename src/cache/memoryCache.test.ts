import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCache } from "./memoryCache.js";

test("cache evicts the oldest entry when maxEntries is exceeded", () => {
  const cache = new MemoryCache({ maxEntries: 2 });

  cache.set("a", 1, 60);
  cache.set("b", 2, 60);
  cache.set("c", 3, 60);

  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
});

test("stale entries expire after maxStaleSeconds and expose stale age", () => {
  let now = 1_000;
  const cache = new MemoryCache({ maxStaleSeconds: 30, now: () => now });

  cache.set("key", "value", 10);

  now += 15_000;
  const stale = cache.getStaleWithMeta<string>("key");
  assert.equal(stale?.value, "value");
  assert.equal(stale?.staleAgeSec, 5);

  now += 31_000;
  assert.equal(cache.getStale("key"), undefined);
});

test("runOnce deduplicates concurrent computations for the same key", async () => {
  const cache = new MemoryCache();
  let calls = 0;

  const compute = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "computed";
  };

  const [first, second] = await Promise.all([
    cache.runOnce("dedupe", compute),
    cache.runOnce("dedupe", compute)
  ]);

  assert.equal(first, "computed");
  assert.equal(second, "computed");
  assert.equal(calls, 1);
});
