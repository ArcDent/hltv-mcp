import type { ResolvedPlayerEntity } from "../types/hltv.js";
import type { HltvApiClient } from "../clients/hltvApiClient.js";
import { asRecord, pickArray, pickNumber, pickString } from "../utils/object.js";
import { parseHltvEntityLink } from "../utils/strings.js";
import { buildQueryVariants, EntityDirectory, normalizeLookupName, uniqueStrings } from "./entityIdentity.js";

const PLAYER_ALIAS_DICTIONARY: Record<string, string[]> = {
  monesy: ["m0NESY", "Ilya Osipov"],
  "m0nesy": ["m0NESY", "Ilya Osipov"],
  zywoo: ["ZywOo", "Mathieu Herbaut", "Mathieu 'ZywOo' Herbaut", "载物"],
  zywooo: ["ZywOo", "Mathieu Herbaut", "Mathieu 'ZywOo' Herbaut", "载物"],
  "mathieu herbaut": ["ZywOo", "Mathieu 'ZywOo' Herbaut", "载物"],
  "mathieu 'zywoo' herbaut": ["ZywOo", "Mathieu Herbaut", "载物"],
  载物: ["ZywOo", "Mathieu Herbaut", "Mathieu 'ZywOo' Herbaut"],
  simple: ["s1mple", "Oleksandr Kostyliev"],
  "s1mple": ["s1mple", "Oleksandr Kostyliev"]
};

export class PlayerResolver {
  private readonly directory = new EntityDirectory<ResolvedPlayerEntity>();

  constructor(private readonly client: HltvApiClient) {}

  getById(id: number): ResolvedPlayerEntity | undefined {
    return this.directory.getById(id);
  }

  remember(entity: ResolvedPlayerEntity, extraAliases: string[] = []): ResolvedPlayerEntity {
    return this.directory.remember(entity, extraAliases);
  }

  async resolve(name: string, exact = false, limit = 5): Promise<ResolvedPlayerEntity[]> {
    const queries = buildQueryVariants(name, PLAYER_ALIAS_DICTIONARY);
    const results = new Map<number, ResolvedPlayerEntity>();

    for (const cached of this.directory.findByAlias(name)) {
      results.set(cached.id, {
        ...cached,
        score: this.scoreMatch(cached, name)
      });
    }

    for (const query of queries) {
      const items = await this.client.searchPlayers(query);
      for (const item of items) {
        const normalized = this.normalizePlayer(item, name, [query]);
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

  private normalizePlayer(raw: unknown, originalQuery: string, extraAliases: string[] = []): ResolvedPlayerEntity | undefined {
    const record = asRecord(raw);
    if (!record) {
      return undefined;
    }

    const link = pickString(record, ["profile_link", "link", "href", "url"]);
    const parsedLink = parseHltvEntityLink(link, "player");
    const id = pickNumber(record, ["id", "player_id", "playerId"]) ?? parsedLink.id;
    const name = pickString(record, ["name", "player_name", "playerName", "player", "nick"]);
    if (!id || !name) {
      return undefined;
    }

    const teamArray = pickArray(record, ["team"]);
    const team =
      pickString(record, ["team", "team_name", "teamName", "current_team"]) ??
      teamArray?.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    const country = pickString(record, ["country", "country_code", "countryCode"]);
    const dictionaryAliases = this.lookupAliases(originalQuery);

    const entity: ResolvedPlayerEntity = {
      type: "player",
      id,
      name,
      slug: parsedLink.slug ?? this.client.buildSlug(name, id),
      team,
      country,
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
      ...(PLAYER_ALIAS_DICTIONARY[normalized.strict] ?? []),
      ...(PLAYER_ALIAS_DICTIONARY[normalized.loose] ?? []),
      ...(PLAYER_ALIAS_DICTIONARY[normalized.slug] ?? [])
    ]);
  }

  private isExactMatch(entity: ResolvedPlayerEntity, query: string): boolean {
    const target = normalizeLookupName(query);
    return uniqueStrings([entity.name, entity.slug, ...(entity.aliases ?? [])]).some((value) => {
      const candidate = normalizeLookupName(value);
      return candidate.strict === target.strict || candidate.loose === target.loose || candidate.slug === target.slug;
    });
  }

  private scoreMatch(entity: ResolvedPlayerEntity, query: string): number {
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
