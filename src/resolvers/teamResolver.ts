import type { ResolvedTeamEntity } from "../types/hltv.js";
import type { HltvApiClient } from "../clients/hltvApiClient.js";
import { asRecord, pickNumber, pickString } from "../utils/object.js";
import { parseHltvEntityLink } from "../utils/strings.js";
import { buildQueryVariants, EntityDirectory, normalizeLookupName, uniqueStrings } from "./entityIdentity.js";

const TEAM_ALIAS_DICTIONARY: Record<string, string[]> = {
  navi: ["Natus Vincere", "NaVi"],
  "natus vincere": ["NaVi", "Natus Vincere", "NAVI"],
  vp: ["Virtus.pro"],
  "virtus pro": ["Virtus.pro", "VP"],
  spirit: ["Team Spirit", "Spirit"],
  "team spirit": ["Team Spirit", "Spirit"],
  faze: ["FaZe", "FaZe Clan"],
  "faze clan": ["FaZe", "FaZe Clan"],
  g2: ["G2", "G2 Esports"],
  mouz: ["MOUZ"]
};

export class TeamResolver {
  private readonly directory = new EntityDirectory<ResolvedTeamEntity>();

  constructor(private readonly client: HltvApiClient) {}

  getById(id: number): ResolvedTeamEntity | undefined {
    return this.directory.getById(id);
  }

  remember(entity: ResolvedTeamEntity, extraAliases: string[] = []): ResolvedTeamEntity {
    return this.directory.remember(entity, extraAliases);
  }

  async resolve(name: string, exact = false, limit = 5): Promise<ResolvedTeamEntity[]> {
    const queries = buildQueryVariants(name, TEAM_ALIAS_DICTIONARY);
    const results = new Map<number, ResolvedTeamEntity>();

    for (const cached of this.directory.findByAlias(name)) {
      results.set(cached.id, {
        ...cached,
        score: this.scoreMatch(cached, name)
      });
    }

    for (const query of queries) {
      const items = await this.client.searchTeams(query);
      for (const item of items) {
        const normalized = this.normalizeTeam(item, name, [query]);
        if (normalized) {
          const remembered = this.remember(normalized, [name, query]);
          results.set(remembered.id, {
            ...remembered,
            score: this.scoreMatch(remembered, name)
          });
        }
      }
    }

    const sorted = [...results.values()].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
    return exact ? sorted.filter((item) => this.isExactMatch(item, name)).slice(0, limit) : sorted.slice(0, limit);
  }

  private normalizeTeam(raw: unknown, originalQuery: string, extraAliases: string[] = []): ResolvedTeamEntity | undefined {
    const record = asRecord(raw);
    if (!record) {
      return undefined;
    }

    const link = pickString(record, ["link", "profile_link", "href", "url"]);
    const parsedLink = parseHltvEntityLink(link, "team");
    const id = pickNumber(record, ["id", "team_id", "teamId"]) ?? parsedLink.id;
    const name = pickString(record, ["name", "team_name", "teamName", "team"]);
    if (!id || !name) {
      return undefined;
    }

    const country = pickString(record, ["country", "country_code", "countryCode"]);
    const rank = pickNumber(record, ["rank", "world_rank", "worldRank"]);
    const dictionaryAliases = this.lookupAliases(originalQuery);

    const entity: ResolvedTeamEntity = {
      type: "team",
      id,
      name,
      slug: parsedLink.slug ?? this.client.buildSlug(name, id),
      country,
      rank,
      aliases: uniqueStrings([name, parsedLink.slug, ...dictionaryAliases, ...extraAliases])
    };

    return {
      ...entity,
      score: this.scoreMatch(entity, originalQuery)
    };
  }

  private lookupAliases(query: string): string[] {
    const normalized = normalizeLookupName(query);
    return uniqueStrings([
      ...(TEAM_ALIAS_DICTIONARY[normalized.strict] ?? []),
      ...(TEAM_ALIAS_DICTIONARY[normalized.loose] ?? []),
      ...(TEAM_ALIAS_DICTIONARY[normalized.slug] ?? [])
    ]);
  }

  private isExactMatch(entity: ResolvedTeamEntity, query: string): boolean {
    const target = normalizeLookupName(query);
    return uniqueStrings([entity.name, entity.slug, ...(entity.aliases ?? [])]).some((value) => {
      const candidate = normalizeLookupName(value);
      return candidate.strict === target.strict || candidate.loose === target.loose || candidate.slug === target.slug;
    });
  }

  private scoreMatch(entity: ResolvedTeamEntity, query: string): number {
    const target = normalizeLookupName(query);
    let best = 0.45;

    for (const value of uniqueStrings([entity.name, entity.slug, ...(entity.aliases ?? [])])) {
      const candidate = normalizeLookupName(value);

      if (candidate.strict === target.strict || candidate.loose === target.loose || candidate.slug === target.slug) {
        best = Math.max(best, 1);
        continue;
      }

      if (candidate.tokens.join("") && candidate.tokens.join("") === target.tokens.join("")) {
        best = Math.max(best, 0.96);
        continue;
      }

      if (
        candidate.loose.includes(target.loose) ||
        target.loose.includes(candidate.loose) ||
        candidate.strict.includes(target.strict) ||
        target.strict.includes(candidate.strict)
      ) {
        best = Math.max(best, 0.82);
      }
    }

    return best;
  }
}
