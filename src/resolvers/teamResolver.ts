import type { ResolvedTeamEntity } from "../types/hltv.js";
import type { HltvApiClient } from "../clients/hltvApiClient.js";
import { asRecord, pickNumber, pickString } from "../utils/object.js";
import { equalsIgnoreCase, includesIgnoreCase, parseHltvEntityLink } from "../utils/strings.js";

const TEAM_ALIAS_DICTIONARY: Record<string, string[]> = {
  navi: ["Natus Vincere", "NaVi"],
  vp: ["Virtus.pro"],
  spirit: ["Team Spirit"],
  faze: ["FaZe"],
  g2: ["G2"],
  mouz: ["MOUZ"]
};

export class TeamResolver {
  constructor(private readonly client: HltvApiClient) {}

  async resolve(name: string, exact = false, limit = 5): Promise<ResolvedTeamEntity[]> {
    const queries = [name, ...(TEAM_ALIAS_DICTIONARY[name.toLowerCase()] ?? [])];
    const results = new Map<number, ResolvedTeamEntity>();

    for (const query of queries) {
      const items = await this.client.searchTeams(query);
      for (const item of items) {
        const normalized = this.normalizeTeam(item, name);
        if (normalized) {
          results.set(normalized.id, normalized);
        }
      }
    }

    const sorted = [...results.values()].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
    return exact ? sorted.filter((item) => equalsIgnoreCase(item.name, name)).slice(0, limit) : sorted.slice(0, limit);
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
    const score = this.scoreMatch(name, originalQuery);

    return {
      type: "team",
      id,
      name,
      slug: parsedLink.slug ?? this.client.buildSlug(name, id),
      country,
      rank,
      score,
      aliases: TEAM_ALIAS_DICTIONARY[originalQuery.toLowerCase()] ?? []
    };
  }

  private scoreMatch(candidate: string, query: string): number {
    if (equalsIgnoreCase(candidate, query)) {
      return 1;
    }

    if (includesIgnoreCase(candidate, query)) {
      return 0.85;
    }

    return 0.5;
  }
}
