import { normalizeLookupName, uniqueStrings } from "../resolvers/entityIdentity.js";
import { sanitizeHltvText } from "./strings.js";

export interface TeamAliasEntry {
  canonicalName: string;
  displayName: string;
  officialName: string;
  displayAlias: string;
  parseAliases: string[];
}

const TEAM_ALIAS_CATALOG: TeamAliasEntry[] = [
  {
    canonicalName: "Team Spirit",
    displayName: "Spirit",
    officialName: "Spirit战队",
    displayAlias: "绿龙",
    parseAliases: ["Spirit", "Team Spirit", "绿龙"]
  },
  {
    canonicalName: "Vitality",
    displayName: "Vitality",
    officialName: "Vitality战队",
    displayAlias: "小蜜蜂",
    parseAliases: ["Vitality", "Team Vitality", "小蜜蜂", "蜜蜂"]
  },
  {
    canonicalName: "Natus Vincere",
    displayName: "Natus Vincere",
    officialName: "Natus Vincere战队",
    displayAlias: "NaVi",
    parseAliases: ["Natus Vincere", "NaVi", "NAVI", "天生赢家"]
  },
  {
    canonicalName: "G2",
    displayName: "G2",
    officialName: "G2战队",
    displayAlias: "武士",
    parseAliases: ["G2", "G2 Esports", "武士"]
  },
  {
    canonicalName: "MOUZ",
    displayName: "MOUZ",
    officialName: "MOUZ战队",
    displayAlias: "老鼠",
    parseAliases: ["MOUZ", "mouz", "老鼠"]
  },
  {
    canonicalName: "FaZe",
    displayName: "FaZe",
    officialName: "FaZe战队",
    displayAlias: "FaZe",
    parseAliases: ["FaZe", "FaZe Clan"]
  },
  {
    canonicalName: "Falcons",
    displayName: "Falcons",
    officialName: "Falcons战队",
    displayAlias: "猎鹰",
    parseAliases: ["Falcons", "Team Falcons", "猎鹰"]
  },
  {
    canonicalName: "Astralis",
    displayName: "Astralis",
    officialName: "Astralis战队",
    displayAlias: "A队",
    parseAliases: ["Astralis", "A队"]
  },
  {
    canonicalName: "Virtus.pro",
    displayName: "Virtus.pro",
    officialName: "Virtus.pro战队",
    displayAlias: "VP",
    parseAliases: ["Virtus.pro", "Virtus Pro", "VP"]
  },
  {
    canonicalName: "Team Liquid",
    displayName: "Liquid",
    officialName: "Liquid战队",
    displayAlias: "液体",
    parseAliases: ["Team Liquid", "Liquid", "液体"]
  },
  {
    canonicalName: "FURIA",
    displayName: "FURIA",
    officialName: "FURIA战队",
    displayAlias: "黑豹",
    parseAliases: ["FURIA", "黑豹"]
  },
  {
    canonicalName: "Aurora",
    displayName: "Aurora",
    officialName: "Aurora战队",
    displayAlias: "欧若拉",
    parseAliases: ["Aurora", "欧若拉"]
  },
  {
    canonicalName: "HEROIC",
    displayName: "HEROIC",
    officialName: "HEROIC战队",
    displayAlias: "HEROIC",
    parseAliases: ["HEROIC"]
  },
  {
    canonicalName: "PARIVISION",
    displayName: "PARIVISION",
    officialName: "PARIVISION战队",
    displayAlias: "PV",
    parseAliases: ["PARIVISION", "PARI", "PV"]
  },
  {
    canonicalName: "paiN",
    displayName: "paiN",
    officialName: "paiN Gaming战队",
    displayAlias: "paiN",
    parseAliases: ["paiN", "paiN Gaming"]
  },
  {
    canonicalName: "Complexity",
    displayName: "Complexity",
    officialName: "Complexity战队",
    displayAlias: "coL",
    parseAliases: ["Complexity", "Complexity Gaming", "coL"]
  },
  {
    canonicalName: "Ninjas in Pyjamas",
    displayName: "Ninjas in Pyjamas",
    officialName: "Ninjas in Pyjamas战队",
    displayAlias: "NIP",
    parseAliases: ["Ninjas in Pyjamas", "NiP", "NIP"]
  },
  {
    canonicalName: "GamerLegion",
    displayName: "GamerLegion",
    officialName: "GamerLegion战队",
    displayAlias: "GL",
    parseAliases: ["GamerLegion", "GL"]
  },
  {
    canonicalName: "The MongolZ",
    displayName: "The MongolZ",
    officialName: "The MongolZ战队",
    displayAlias: "蒙古队",
    parseAliases: ["The MongolZ", "MongolZ", "蒙古队"]
  },
  {
    canonicalName: "TYLOO",
    displayName: "TYLOO",
    officialName: "TYLOO战队",
    displayAlias: "天禄",
    parseAliases: ["TYLOO", "天禄"]
  },
  {
    canonicalName: "Rare Atom",
    displayName: "Rare Atom",
    officialName: "Rare Atom战队",
    displayAlias: "RA",
    parseAliases: ["Rare Atom", "RA"]
  },
  {
    canonicalName: "Lynn Vision",
    displayName: "Lynn Vision",
    officialName: "Lynn Vision战队",
    displayAlias: "LVG",
    parseAliases: ["Lynn Vision", "LVG"]
  },
  {
    canonicalName: "fnatic",
    displayName: "fnatic",
    officialName: "fnatic战队",
    displayAlias: "橙黑",
    parseAliases: ["fnatic", "Fnatic", "橙黑"]
  },
  {
    canonicalName: "Eternal Fire",
    displayName: "Eternal Fire",
    officialName: "Eternal Fire战队",
    displayAlias: "永火",
    parseAliases: ["Eternal Fire", "永火"]
  },
  {
    canonicalName: "RED Canids",
    displayName: "RED Canids",
    officialName: "RED Canids战队",
    displayAlias: "红犬",
    parseAliases: ["RED Canids", "红犬"]
  }
];

const TEAM_ALIAS_LOOKUP = new Map<string, TeamAliasEntry>();

for (const entry of TEAM_ALIAS_CATALOG) {
  const values = uniqueStrings([entry.canonicalName, entry.officialName, entry.displayAlias, ...entry.parseAliases]);
  for (const value of values) {
    const normalized = normalizeLookupName(value);
    for (const key of uniqueStrings([normalized.strict, normalized.loose, normalized.slug])) {
      if (!TEAM_ALIAS_LOOKUP.has(key)) {
        TEAM_ALIAS_LOOKUP.set(key, entry);
      }
    }
  }
}

function getNormalizedLookupKeys(name: string): string[] {
  const normalized = normalizeLookupName(name);
  return uniqueStrings([normalized.strict, normalized.loose, normalized.slug]);
}

function buildVariantForms(value: string): string[] {
  const normalized = normalizeLookupName(value);
  return uniqueStrings([
    value,
    normalized.strict,
    normalized.loose,
    normalized.slug,
    normalized.tokens.join(" "),
    normalized.tokens.join("-"),
    normalized.tokens.join("_"),
    normalized.tokens.join("")
  ]);
}

export function lookupCatalogTeamEntry(name: string | undefined): TeamAliasEntry | undefined {
  const sanitized = sanitizeHltvText(name);
  if (!sanitized) {
    return undefined;
  }

  for (const key of getNormalizedLookupKeys(sanitized)) {
    const entry = TEAM_ALIAS_LOOKUP.get(key);
    if (entry) {
      return entry;
    }
  }

  return undefined;
}

export function expandCatalogTeamAliases(name: string | undefined): string[] {
  const entry = lookupCatalogTeamEntry(name);
  if (!entry) {
    return [];
  }

  return uniqueStrings([entry.canonicalName, entry.officialName, entry.displayAlias, ...entry.parseAliases]);
}

export function formatCatalogTeamDisplayName(name: string | undefined): string | undefined {
  const sanitized = sanitizeHltvText(name);
  if (!sanitized) {
    return undefined;
  }

  const entry = lookupCatalogTeamEntry(sanitized);
  if (!entry) {
    return sanitized;
  }

  return uniqueStrings([entry.displayName, entry.officialName, entry.displayAlias]).join("/");
}

export function buildCatalogTeamQueryVariants(name: string | undefined): string[] {
  const sanitized = sanitizeHltvText(name);
  if (!sanitized) {
    return [];
  }

  const entry = lookupCatalogTeamEntry(sanitized);
  const seeds = entry
    ? uniqueStrings([sanitized, entry.canonicalName, entry.officialName, entry.displayAlias, ...entry.parseAliases])
    : [sanitized];

  return uniqueStrings(seeds.flatMap((seed) => buildVariantForms(seed)));
}
