import type { ResolvedTeamEntity } from "../types/hltv.js";
import type { HltvApiClient } from "../clients/hltvApiClient.js";
import { asRecord, pickNumber, pickString } from "../utils/object.js";
import { parseHltvEntityLink } from "../utils/strings.js";
import { buildCatalogTeamQueryVariants, expandCatalogTeamAliases } from "../utils/teamAliasCatalog.js";
import { EntityDirectory, normalizeLookupName, uniqueStrings } from "./entityIdentity.js";

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
    const queries = buildCatalogTeamQueryVariants(name);
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
        const normalized = this.normalizeTeam(item, name);
        if (normalized) {
          const remembered = this.remember(normalized, this.buildMatchedAliases(normalized, name, query));
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

  private normalizeTeam(raw: unknown, originalQuery: string): ResolvedTeamEntity | undefined {
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

    const entity: ResolvedTeamEntity = {
      type: "team",
      id,
      name,
      slug: parsedLink.slug ?? this.client.buildSlug(name, id),
      country,
      rank,
      aliases: uniqueStrings([name, parsedLink.slug])
    };

    return {
      ...entity,
      score: this.scoreMatch(entity, originalQuery)
    };
  }

  private lookupAliases(query: string): string[] {
    return expandCatalogTeamAliases(query);
  }

  private buildMatchedAliases(entity: ResolvedTeamEntity, originalQuery: string, query: string): string[] {
    const aliases = uniqueStrings([originalQuery, query, ...this.lookupAliases(originalQuery)]);
    return aliases.some((alias) => this.matchesEntityIdentity(entity, alias)) ? aliases : [];
  }

  private matchesEntityIdentity(entity: ResolvedTeamEntity, query: string): boolean {
    const target = normalizeLookupName(query);
    return uniqueStrings([entity.name, entity.slug]).some((value) => {
      const candidate = normalizeLookupName(value);
      return candidate.strict === target.strict || candidate.loose === target.loose || candidate.slug === target.slug;
    });
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
