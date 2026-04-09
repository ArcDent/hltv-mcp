import type { AppConfig } from "../config/env.js";
import { MemoryCache } from "../cache/memoryCache.js";
import { AppError, isAppError } from "../errors/appError.js";
import type { ToolError, ToolMeta, ToolResponse } from "../types/common.js";
import type {
  NewsDigestQuery,
  NewsItem,
  NormalizedMatch,
  PlayerRecentData,
  PlayerRecentQuery,
  ResolveEntityQuery,
  ResolvedPlayerEntity,
  ResolvedTeamEntity,
  ResultsRecentQuery,
  TeamRecentData,
  TeamRecentQuery,
  UpcomingMatchesQuery
} from "../types/hltv.js";
import { nowIso } from "../utils/time.js";
import { includesIgnoreCase } from "../utils/strings.js";
import { HltvApiClient } from "../clients/hltvApiClient.js";
import { PlayerResolver } from "../resolvers/playerResolver.js";
import { TeamResolver } from "../resolvers/teamResolver.js";
import { buildSlugCandidates, entityAliases, normalizeLookupName, uniqueStrings } from "../resolvers/entityIdentity.js";
import {
  collectRecentHighlights,
  normalizeMatches,
  normalizeNews,
  normalizeOverview,
  normalizePlayerProfile,
  normalizeResults,
  normalizeTeamProfile,
  normalizeUpcomingMatches,
  splitTeamMatches
} from "./hltvNormalizer.js";

export class HltvFacade {
  constructor(
    private readonly config: AppConfig,
    private readonly client: HltvApiClient,
    private readonly cache: MemoryCache,
    private readonly teamResolver: TeamResolver,
    private readonly playerResolver: PlayerResolver
  ) {}

  async resolveTeam(query: ResolveEntityQuery): Promise<ToolResponse<never, ResolvedTeamEntity>> {
    const normalizedQuery = {
      name: query.name,
      exact: query.exact ?? false,
      limit: query.limit ?? this.config.defaultResultLimit
    };
    const cacheKey = `resolve_team:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.entityCacheTtlSec, normalizedQuery, async () => {
      const items = await this.teamResolver.resolve(
        normalizedQuery.name,
        normalizedQuery.exact,
        normalizedQuery.limit
      );

      if (!items.length) {
        throw new AppError("ENTITY_NOT_FOUND", `No team matched '${normalizedQuery.name}'`, {
          retryable: false,
          details: normalizedQuery
        });
      }

      return {
        query: normalizedQuery,
        items,
        meta: this.createMeta(this.config.entityCacheTtlSec),
        error: null
      };
    });
  }

  async resolvePlayer(query: ResolveEntityQuery): Promise<ToolResponse<never, ResolvedPlayerEntity>> {
    const normalizedQuery = {
      name: query.name,
      exact: query.exact ?? false,
      limit: query.limit ?? this.config.defaultResultLimit
    };
    const cacheKey = `resolve_player:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.entityCacheTtlSec, normalizedQuery, async () => {
      const items = await this.playerResolver.resolve(
        normalizedQuery.name,
        normalizedQuery.exact,
        normalizedQuery.limit
      );

      if (!items.length) {
        throw new AppError("ENTITY_NOT_FOUND", `No player matched '${normalizedQuery.name}'`, {
          retryable: false,
          details: normalizedQuery
        });
      }

      return {
        query: normalizedQuery,
        items,
        meta: this.createMeta(this.config.entityCacheTtlSec),
        error: null
      };
    });
  }

  async getTeamRecent(
    query: TeamRecentQuery
  ): Promise<ToolResponse<TeamRecentData, never, ResolvedTeamEntity>> {
    const normalizedQuery = {
      team_id: query.team_id,
      team_name: query.team_name,
      limit: query.limit ?? this.config.defaultResultLimit,
      include_upcoming: query.include_upcoming ?? true,
      include_recent_results: query.include_recent_results ?? true,
      detail: query.detail ?? "standard",
      timezone: query.timezone ?? this.config.defaultTimezone,
      exact: query.exact ?? false
    };
    const cacheKey = `team_recent:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.teamRecentCacheTtlSec, normalizedQuery, async () => {
      const resolved = await this.requireTeam(normalizedQuery.team_id, normalizedQuery.team_name, normalizedQuery.exact);
      const [teamDetail, teamMatches] = await Promise.all([
        this.client.getTeam(resolved.id, resolved.slug),
        this.client.getTeamMatches(resolved.id)
      ]);

      const profile = normalizeTeamProfile(teamDetail, resolved);
      const normalizedMatches = normalizeMatches(teamMatches, profile.name);
      const split = splitTeamMatches(normalizedMatches);

      const recent_results = normalizedQuery.include_recent_results
        ? split.recent_results.slice(0, normalizedQuery.limit)
        : [];
      const upcoming_matches = normalizedQuery.include_upcoming
        ? split.upcoming_matches.slice(0, normalizedQuery.limit)
        : [];

      const summary_stats = this.buildRecordStats(recent_results);

      return {
        query: normalizedQuery,
        resolved_entity: resolved,
        data: {
          profile,
          recent_results,
          upcoming_matches,
          summary_stats
        },
        meta: this.createMeta(this.config.teamRecentCacheTtlSec),
        error: null
      };
    });
  }

  async getPlayerRecent(
    query: PlayerRecentQuery
  ): Promise<ToolResponse<PlayerRecentData, never, ResolvedPlayerEntity>> {
    const normalizedQuery = {
      player_id: query.player_id,
      player_name: query.player_name,
      limit: query.limit ?? this.config.defaultResultLimit,
      detail: query.detail ?? "standard",
      timezone: query.timezone ?? this.config.defaultTimezone,
      exact: query.exact ?? false
    };
    const cacheKey = `player_recent:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.playerRecentCacheTtlSec, normalizedQuery, async () => {
      const resolved = await this.requirePlayer(
        normalizedQuery.player_id,
        normalizedQuery.player_name,
        normalizedQuery.exact
      );
      const [playerDetail, playerOverview] = await Promise.all([
        this.client.getPlayer(resolved.id, resolved.slug),
        this.client.getPlayerOverview(resolved.id, resolved.slug)
      ]);

      const profile = normalizePlayerProfile(playerDetail, resolved);
      const overview = normalizeOverview(playerOverview);
      const recent_matches = normalizeMatches([playerDetail], profile.name).slice(0, normalizedQuery.limit);
      const recent_highlights = collectRecentHighlights(playerDetail, playerOverview);

      return {
        query: normalizedQuery,
        resolved_entity: resolved,
        data: {
          profile,
          overview,
          recent_matches,
          recent_highlights
        },
        meta: this.createMeta(this.config.playerRecentCacheTtlSec),
        error: null
      };
    });
  }

  async getResultsRecent(query: ResultsRecentQuery): Promise<ToolResponse<never, NormalizedMatch>> {
    const normalizedQuery = {
      team_id: query.team_id,
      team: query.team,
      event: query.event,
      limit: query.limit ?? this.config.defaultResultLimit,
      days: query.days ?? 7,
      timezone: query.timezone ?? this.config.defaultTimezone
    };
    const cacheKey = `results_recent:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.resultsCacheTtlSec, normalizedQuery, async () => {
      const teamFilter = await this.resolveOptionalTeamFilter(normalizedQuery.team_id, normalizedQuery.team);
      const rawResults = await this.client.getRecentResults();
      const items = normalizeResults(rawResults)
        .filter((item) => this.matchesQuery(item, teamFilter, normalizedQuery.event))
        .slice(0, normalizedQuery.limit);

      return {
        query: normalizedQuery,
        items,
        meta: this.createMeta(this.config.resultsCacheTtlSec),
        error: null
      };
    });
  }

  async getUpcomingMatches(
    query: UpcomingMatchesQuery
  ): Promise<ToolResponse<never, NormalizedMatch>> {
    const normalizedQuery = {
      team_id: query.team_id,
      team: query.team,
      event: query.event,
      limit: query.limit ?? this.config.defaultResultLimit,
      days: query.days ?? 7,
      timezone: query.timezone ?? this.config.defaultTimezone
    };
    const cacheKey = `matches_upcoming:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.matchesCacheTtlSec, normalizedQuery, async () => {
      const teamFilter = await this.resolveOptionalTeamFilter(normalizedQuery.team_id, normalizedQuery.team);
      const rawMatches = await this.client.getUpcomingMatches();
      const items = normalizeUpcomingMatches(rawMatches)
        .filter((item) => this.matchesQuery(item, teamFilter, normalizedQuery.event))
        .slice(0, normalizedQuery.limit);

      return {
        query: normalizedQuery,
        items,
        meta: this.createMeta(this.config.matchesCacheTtlSec),
        error: null
      };
    });
  }

  async getNewsDigest(query: NewsDigestQuery): Promise<ToolResponse<never, NewsItem>> {
    const normalizedQuery = {
      limit: query.limit ?? this.config.defaultResultLimit,
      tag: query.tag,
      year: query.year,
      month: query.month,
      timezone: query.timezone ?? this.config.defaultTimezone
    };
    const cacheKey = `news_digest:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.newsCacheTtlSec, normalizedQuery, async () => {
      const rawNews = await this.client.getNews(normalizedQuery.year, normalizedQuery.month);
      const items = normalizeNews(rawNews)
        .filter((item) => {
          if (!normalizedQuery.tag) {
            return true;
          }

          return (
            includesIgnoreCase(item.title, normalizedQuery.tag) ||
            includesIgnoreCase(item.summary_hint, normalizedQuery.tag) ||
            includesIgnoreCase(item.tag, normalizedQuery.tag)
          );
        })
        .slice(0, normalizedQuery.limit);

      return {
        query: normalizedQuery,
        items,
        meta: this.createMeta(this.config.newsCacheTtlSec),
        error: null
      };
    });
  }

  private async requireTeam(
    teamId: number | undefined,
    teamName: string | undefined,
    exact = false
  ): Promise<ResolvedTeamEntity> {
    if (teamId) {
      const resolvedById = await this.resolveTeamById(teamId, teamName, exact);
      if (resolvedById) {
        return resolvedById;
      }

      throw new AppError(
        "ENTITY_NOT_FOUND",
        teamName
          ? `Unable to resolve canonical team slug for '${teamName}' with team_id=${teamId}`
          : `Unable to resolve canonical team slug for team_id=${teamId}`,
        {
          retryable: false,
          details: {
            team_id: teamId,
            team_name: teamName,
            exact
          }
        }
      );
    }

    if (!teamName) {
      throw new AppError("INVALID_ARGUMENT", "team_id or team_name is required", {
        retryable: false,
        details: {
          team_id: teamId,
          team_name: teamName
        }
      });
    }

    const candidates = await this.teamResolver.resolve(teamName, exact, 10);
    if (!candidates.length) {
      throw new AppError("ENTITY_NOT_FOUND", `No team matched '${teamName}'`, {
        retryable: false,
        details: {
          team_id: teamId,
          team_name: teamName,
          exact
        }
      });
    }

    return candidates[0];
  }

  private async requirePlayer(
    playerId: number | undefined,
    playerName: string | undefined,
    exact = false
  ): Promise<ResolvedPlayerEntity> {
    if (playerId) {
      const resolvedById = await this.resolvePlayerById(playerId, playerName, exact);
      if (resolvedById) {
        return resolvedById;
      }

      throw new AppError(
        "ENTITY_NOT_FOUND",
        playerName
          ? `Unable to resolve canonical player slug for '${playerName}' with player_id=${playerId}`
          : `Unable to resolve canonical player slug for player_id=${playerId}`,
        {
          retryable: false,
          details: {
            player_id: playerId,
            player_name: playerName,
            exact
          }
        }
      );
    }

    if (!playerName) {
      throw new AppError("INVALID_ARGUMENT", "player_id or player_name is required", {
        retryable: false,
        details: {
          player_id: playerId,
          player_name: playerName
        }
      });
    }

    const candidates = await this.playerResolver.resolve(playerName, exact, 10);
    if (!candidates.length) {
      throw new AppError("ENTITY_NOT_FOUND", `No player matched '${playerName}'`, {
        retryable: false,
        details: {
          player_id: playerId,
          player_name: playerName,
          exact
        }
      });
    }

    return candidates[0];
  }

  private buildRecordStats(matches: NormalizedMatch[]): TeamRecentData["summary_stats"] {
    let wins = 0;
    let losses = 0;
    let draws = 0;

    for (const match of matches) {
      if (match.result === "win") {
        wins += 1;
      } else if (match.result === "loss") {
        losses += 1;
      } else if (match.result === "draw") {
        draws += 1;
      }
    }

    return {
      wins,
      losses,
      draws,
      recent_record: `${wins}W-${losses}L${draws > 0 ? `-${draws}D` : ""}`
    };
  }

  private matchesQuery(
    item: NormalizedMatch,
    teamFilter?: { id?: number; names: string[] },
    event?: string
  ): boolean {
    const teamMatches = !teamFilter || this.matchTeamFilter(item, teamFilter);
    const eventMatches = !event || includesIgnoreCase(item.event, event);
    return teamMatches && eventMatches;
  }

  private async resolveTeamById(
    teamId: number,
    teamName?: string,
    exact = false
  ): Promise<ResolvedTeamEntity | undefined> {
    const cached = this.teamResolver.getById(teamId);
    if (cached) {
      return cached;
    }

    if (teamName) {
      const candidates = await this.teamResolver.resolve(teamName, exact, 10);
      const matched = candidates.find((candidate) => candidate.id === teamId);
      if (matched) {
        return matched;
      }
    }

    const slugHints = buildSlugCandidates("team", teamId, undefined, [teamName]);
    for (const slug of slugHints) {
      try {
        const detail = await this.client.getTeam(teamId, slug);
        const fallback: ResolvedTeamEntity = {
          type: "team",
          id: teamId,
          name: teamName ?? slug,
          slug,
          aliases: uniqueStrings([teamName, slug])
        };
        const profile = normalizeTeamProfile(detail, fallback);
        return this.teamResolver.remember(
          {
            type: "team",
            id: profile.id,
            name: profile.name,
            slug: profile.slug,
            country: profile.country,
            rank: profile.rank,
            aliases: uniqueStrings([teamName, slug, profile.name, profile.slug])
          },
          uniqueStrings([teamName, slug])
        );
      } catch (error) {
        if (isAppError(error) && error.code === "UPSTREAM_NOT_FOUND") {
          continue;
        }

        throw error;
      }
    }

    return undefined;
  }

  private async resolvePlayerById(
    playerId: number,
    playerName?: string,
    exact = false
  ): Promise<ResolvedPlayerEntity | undefined> {
    const cached = this.playerResolver.getById(playerId);
    if (cached) {
      return cached;
    }

    if (playerName) {
      const candidates = await this.playerResolver.resolve(playerName, exact, 10);
      const matched = candidates.find((candidate) => candidate.id === playerId);
      if (matched) {
        return matched;
      }
    }

    const slugHints = buildSlugCandidates("player", playerId, undefined, [playerName]);
    for (const slug of slugHints) {
      try {
        const detail = await this.client.getPlayer(playerId, slug);
        const fallback: ResolvedPlayerEntity = {
          type: "player",
          id: playerId,
          name: playerName ?? slug,
          slug,
          aliases: uniqueStrings([playerName, slug])
        };
        const profile = normalizePlayerProfile(detail, fallback);
        return this.playerResolver.remember(
          {
            type: "player",
            id: profile.id,
            name: profile.name,
            slug: profile.slug,
            team: profile.team,
            country: profile.country,
            aliases: uniqueStrings([playerName, slug, profile.name, profile.slug])
          },
          uniqueStrings([playerName, slug])
        );
      } catch (error) {
        if (isAppError(error) && error.code === "UPSTREAM_NOT_FOUND") {
          continue;
        }

        throw error;
      }
    }

    return undefined;
  }

  private async resolveOptionalTeamFilter(
    teamId?: number,
    teamName?: string
  ): Promise<{ id?: number; names: string[] } | undefined> {
    if (!teamId && !teamName) {
      return undefined;
    }

    if (teamId) {
      const resolved = await this.resolveTeamById(teamId, teamName, false);
      if (resolved) {
        return {
          id: resolved.id,
          names: entityAliases(resolved)
        };
      }

      return {
        id: teamId,
        names: uniqueStrings([teamName])
      };
    }

    const candidates = await this.teamResolver.resolve(teamName!, false, 10);
    if (!candidates.length) {
      throw new AppError("ENTITY_NOT_FOUND", `No team matched '${teamName}'`, {
        retryable: false,
        details: {
          team_id: teamId,
          team_name: teamName
        }
      });
    }

    return {
      id: candidates[0].id,
      names: entityAliases(candidates[0])
    };
  }

  private matchTeamFilter(item: NormalizedMatch, teamFilter: { id?: number; names: string[] }): boolean {
    if (
      teamFilter.id !== undefined &&
      [item.team1_id, item.team2_id, item.opponent_id].some((candidateId) => candidateId === teamFilter.id)
    ) {
      return true;
    }

    if (!teamFilter.names.length) {
      return false;
    }

    const itemNames = uniqueStrings([item.team1, item.team2, item.opponent]);
    return teamFilter.names.some((name) => {
      const target = normalizeLookupName(name);
      return itemNames.some((candidate) => {
        const normalized = normalizeLookupName(candidate);
        return (
          normalized.strict === target.strict ||
          normalized.loose === target.loose ||
          normalized.slug === target.slug ||
          normalized.loose.includes(target.loose) ||
          target.loose.includes(normalized.loose)
        );
      });
    });
  }

  private createMeta(ttlSec: number, overrides: Partial<ToolMeta> = {}): ToolMeta {
    return {
      source: "hltv-scraper-api",
      fetched_at: nowIso(),
      timezone: this.config.defaultTimezone,
      cache_hit: false,
      ttl_sec: ttlSec,
      schema_version: "1.0",
      partial: false,
      ...overrides
    };
  }

  private async withCache<TData, TItem, TResolved>(
    cacheKey: string,
    ttlSec: number,
    query: Record<string, unknown>,
    compute: () => Promise<ToolResponse<TData, TItem, TResolved>>
  ): Promise<ToolResponse<TData, TItem, TResolved>> {
    const cached = this.cache.get<ToolResponse<TData, TItem, TResolved>>(cacheKey);
    if (cached) {
      return this.cloneWithMeta(cached, {
        cache_hit: true,
        ttl_sec: ttlSec
      });
    }

    try {
      const response = await compute();
      this.cache.set(cacheKey, response, ttlSec);
      return response;
    } catch (error) {
      const stale = this.cache.getStale<ToolResponse<TData, TItem, TResolved>>(cacheKey);
      if (stale) {
        return this.cloneWithMeta(stale, {
          cache_hit: true,
          stale: true,
          ttl_sec: ttlSec
        });
      }

      return {
        query,
        meta: this.createMeta(ttlSec, {
          partial: false
        }),
        error: this.toToolError(error)
      };
    }
  }

  private cloneWithMeta<TData, TItem, TResolved>(
    response: ToolResponse<TData, TItem, TResolved>,
    meta: Partial<ToolMeta>
  ): ToolResponse<TData, TItem, TResolved> {
    const cloned = structuredClone(response) as ToolResponse<TData, TItem, TResolved>;
    cloned.meta = {
      ...cloned.meta,
      ...meta
    };
    return cloned;
  }

  private toToolError(error: unknown): ToolError {
    if (isAppError(error)) {
      return {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details
      };
    }

    return {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown internal error",
      retryable: false
    };
  }
}
