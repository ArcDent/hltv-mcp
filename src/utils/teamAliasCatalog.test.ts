import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogTeamQueryVariants,
  expandCatalogTeamAliases,
  formatCatalogTeamDisplayName,
  lookupCatalogTeamEntry
} from "./teamAliasCatalog.js";

test("Spirit display alias is 绿龙", () => {
  const entry = lookupCatalogTeamEntry("Spirit");
  assert.ok(entry);
  assert.equal(entry?.displayAlias, "绿龙");
});

test("Spirit display string is normalized to approved catalog output", () => {
  assert.equal(formatCatalogTeamDisplayName("Spirit"), "Spirit/Spirit战队/绿龙");
});

test("Spirit aliases share the same curated display string", () => {
  assert.equal(formatCatalogTeamDisplayName("Spirit"), "Spirit/Spirit战队/绿龙");
  assert.equal(formatCatalogTeamDisplayName("Team Spirit"), "Spirit/Spirit战队/绿龙");
  assert.equal(formatCatalogTeamDisplayName("绿龙"), "Spirit/Spirit战队/绿龙");
});

test("FURIA display string includes 黑豹", () => {
  assert.equal(formatCatalogTeamDisplayName("FURIA"), "FURIA/FURIA战队/黑豹");
});

test("Aurora display string includes 欧若拉", () => {
  assert.equal(formatCatalogTeamDisplayName("Aurora"), "Aurora/Aurora战队/欧若拉");
});

test("paiN display suppresses duplicate alias segments", () => {
  assert.equal(formatCatalogTeamDisplayName("paiN"), "paiN/paiN Gaming战队");
});

test("Team Liquid aliases share the same curated display string", () => {
  assert.equal(formatCatalogTeamDisplayName("Liquid"), "Liquid/Liquid战队/液体");
  assert.equal(formatCatalogTeamDisplayName("Team Liquid"), "Liquid/Liquid战队/液体");
});

test("Natus Vincere alias expansion includes NaVi and 天生赢家", () => {
  const aliases = expandCatalogTeamAliases("Natus Vincere");
  assert.ok(aliases.includes("NaVi"));
  assert.ok(aliases.includes("天生赢家"));
});

test("PARIVISION alias expansion includes PV and PARI", () => {
  const aliases = expandCatalogTeamAliases("PARIVISION");
  assert.ok(aliases.includes("PV"));
  assert.ok(aliases.includes("PARI"));
});

test("lookup by Chinese alias 绿龙 resolves to Team Spirit", () => {
  const entry = lookupCatalogTeamEntry("绿龙");
  assert.ok(entry);
  assert.equal(entry?.canonicalName, "Team Spirit");
});

test("resolver query variants for 天生赢家 include NaVi and Natus Vincere", () => {
  const variants = buildCatalogTeamQueryVariants("天生赢家");
  assert.ok(variants.includes("NaVi"));
  assert.ok(variants.includes("Natus Vincere"));
});

test("unknown teams have no catalog entry and no alias expansion", () => {
  assert.equal(lookupCatalogTeamEntry("Unknown Team"), undefined);
  assert.deepEqual(expandCatalogTeamAliases("Unknown Team"), []);
});

test("unknown team display formatting falls back to sanitized input", () => {
  assert.equal(formatCatalogTeamDisplayName("  Unknown   Team  "), "Unknown Team");
});

test("unknown team query variants stay safely scoped to normalized input", () => {
  assert.deepEqual(buildCatalogTeamQueryVariants("  Unknown   Team  "), [
    "Unknown Team",
    "unknown-team",
    "unknown_team",
    "unknownteam"
  ]);
});
