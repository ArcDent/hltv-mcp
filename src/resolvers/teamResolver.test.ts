import assert from "node:assert/strict";
import test from "node:test";
import type { HltvApiClient } from "../clients/hltvApiClient.js";
import { TeamResolver } from "./teamResolver.js";

function createResolver(searchResults: Record<string, unknown[]>) {
  const searchCalls: string[] = [];
  const resolver = new TeamResolver({
    searchTeams: async (name: string) => {
      searchCalls.push(name);
      return searchResults[name] ?? [];
    },
    buildSlug: (name: string, id: number) => `${name}-${id}`
  } as HltvApiClient);

  return { resolver, searchCalls };
}

test("resolver expands catalog query variants for curated team aliases", async () => {
  const { resolver, searchCalls } = createResolver({
    "Team Spirit": [{ id: 7020, name: "Spirit", link: "/team/7020/spirit" }],
    Spirit: [{ id: 7020, name: "Spirit", link: "/team/7020/spirit" }],
    NaVi: [{ id: 4608, name: "Natus Vincere", link: "/team/4608/natus-vincere" }],
    PARI: [{ id: 12426, name: "PARIVISION", link: "/team/12426/parivision" }]
  });

  const spiritFromAlias = await resolver.resolve("绿龙", true, 1);
  const spiritFromShortName = await resolver.resolve("Spirit", true, 1);
  const spiritFromCanonicalName = await resolver.resolve("Team Spirit", true, 1);
  const navi = await resolver.resolve("天生赢家", true, 1);
  const pari = await resolver.resolve("PV", true, 1);

  assert.equal(spiritFromAlias[0]?.name, "Spirit");
  assert.equal(spiritFromShortName[0]?.name, "Spirit");
  assert.equal(spiritFromCanonicalName[0]?.name, "Spirit");
  assert.equal(navi[0]?.name, "Natus Vincere");
  assert.equal(pari[0]?.name, "PARIVISION");
  assert.ok(searchCalls.includes("Team Spirit"));
  assert.ok(searchCalls.includes("Spirit"));
  assert.ok(searchCalls.includes("NaVi"));
  assert.ok(searchCalls.includes("Natus Vincere"));
  assert.ok(searchCalls.includes("PARI"));
  assert.ok(searchCalls.includes("PARIVISION"));
});

test("resolver keeps unknown team query fallback sensible and non-empty", async () => {
  const { resolver, searchCalls } = createResolver({
    "unknown-team": [{ id: 9999, name: "Unknown Team", link: "/team/9999/unknown-team" }]
  });

  const results = await resolver.resolve("  Unknown   Team  ", false, 1);

  assert.equal(results[0]?.name, "Unknown Team");
  assert.ok(searchCalls.length > 0);
  assert.ok(searchCalls.every((query) => query.trim().length > 0));
  assert.ok(searchCalls.includes("unknown-team"));
});

test("resolver can normalize cached aliases after a catalog-backed lookup", async () => {
  let returnSearchResults = true;
  const searchCalls: string[] = [];
  const resolver = new TeamResolver({
    searchTeams: async (name: string) => {
      searchCalls.push(name);
      if (returnSearchResults && name === "Natus Vincere") {
        return [{ id: 4608, name: "Natus Vincere", link: "/team/4608/natus-vincere" }];
      }

      return [];
    },
    buildSlug: (name: string, id: number) => `${name}-${id}`
  } as HltvApiClient);

  const fromChineseAlias = await resolver.resolve("天生赢家", true, 1);
  returnSearchResults = false;
  const fromCachedAlias = await resolver.resolve("NaVi", true, 1);

  assert.equal(fromChineseAlias[0]?.name, "Natus Vincere");
  assert.equal(fromCachedAlias[0]?.name, "Natus Vincere");
  assert.ok(searchCalls.includes("Natus Vincere"));
});

test("resolver exact catalog lookup excludes sibling mixed results from cache", async () => {
  let returnMixedResults = true;
  const resolver = new TeamResolver({
    searchTeams: async (name: string) => {
      if (returnMixedResults && name === "Spirit") {
        return [
          { id: 7020, name: "Spirit", link: "/team/7020/spirit" },
          { id: 9991, name: "Spirit Academy", link: "/team/9991/spirit-academy" }
        ];
      }

      return [];
    },
    buildSlug: (name: string, id: number) => `${name}-${id}`
  } as HltvApiClient);

  const firstPass = await resolver.resolve("绿龙", true, 5);
  returnMixedResults = false;
  const cachedPass = await resolver.resolve("绿龙", true, 5);

  assert.deepEqual(
    firstPass.map((team) => team.name),
    ["Spirit"]
  );
  assert.deepEqual(
    cachedPass.map((team) => team.name),
    ["Spirit"]
  );
});
