import assert from "node:assert/strict";
import test from "node:test";
import {
  expandEventAliases,
  expandTeamAliases,
  formatEventDisplayName,
  formatTeamDisplayName,
  matchEventName,
  matchTeamNames
} from "./localizedNames.js";
import { lookupCatalogTeamEntry } from "./teamAliasCatalog.js";

test("localizedNames uses curated team aliases for display formatting", () => {
  assert.equal(formatTeamDisplayName("Spirit"), "Spirit/Spirit战队/绿龙");
  assert.equal(formatTeamDisplayName("Team Spirit"), "Spirit/Spirit战队/绿龙");
  assert.equal(formatTeamDisplayName("绿龙"), "Spirit/Spirit战队/绿龙");
  assert.equal(formatTeamDisplayName("FURIA"), "FURIA/FURIA战队/黑豹");
  assert.equal(formatTeamDisplayName("Aurora"), "Aurora/Aurora战队/欧若拉");
  assert.equal(formatTeamDisplayName("paiN"), "paiN/paiN Gaming战队");
});

test("localizedNames expands curated team aliases for matching", () => {
  const naviAliases = expandTeamAliases("天生赢家");
  assert.ok(naviAliases.includes("Natus Vincere"));
  assert.ok(naviAliases.includes("NaVi"));
  assert.ok(naviAliases.includes("天生赢家"));

  const pariAliases = expandTeamAliases("PV");
  assert.ok(pariAliases.includes("PARIVISION"));
  assert.ok(pariAliases.includes("PV"));
  assert.ok(pariAliases.includes("PARI"));

  assert.equal(matchTeamNames(["FURIA"], ["黑豹"]), true);
  assert.equal(matchTeamNames(["Spirit"], ["绿龙"]), true);
});

test("localizedNames keeps explicit coverage for legacy-only team fallback behavior", () => {
  assert.equal(lookupCatalogTeamEntry("Alliance"), undefined);
  assert.equal(lookupCatalogTeamEntry("SINNERS"), undefined);

  assert.equal(formatTeamDisplayName("联盟"), "联盟/Alliance战队");
  assert.equal(formatTeamDisplayName("罪人"), "罪人/SINNERS战队");

  const allianceAliases = expandTeamAliases("联盟");
  assert.ok(allianceAliases.includes("Alliance"));

  const sinnersAliases = expandTeamAliases("罪人");
  assert.ok(sinnersAliases.includes("SINNERS"));

  assert.equal(matchTeamNames(["Alliance"], ["联盟"]), true);
  assert.equal(matchTeamNames(["SINNERS"], ["罪人"]), true);
});

test("localizedNames keeps safe fallback behavior for uncataloged teams", () => {
  assert.equal(formatTeamDisplayName("  Unknown   Team  "), "Unknown Team/Unknown Team战队");
  assert.deepEqual(expandTeamAliases("  Unknown   Team  "), ["Unknown Team", "Unknown Team战队"]);
  assert.equal(matchTeamNames(["Unknown Team"], ["Unknown Team战队"]), true);
});

test("localizedNames keeps event localization behavior separate", () => {
  assert.equal(formatEventDisplayName("IEM Rio"), "IEM Rio/IEM 里约站/里约IEM");

  const eventAliases = expandEventAliases("IEM Rio");
  assert.ok(eventAliases.includes("IEM Rio"));
  assert.ok(eventAliases.includes("里约IEM"));

  assert.equal(matchEventName("IEM Rio", "里约IEM"), true);
});
