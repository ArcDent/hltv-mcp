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
      team: query.team,
      event: query.event,
      limit: query.limit ?? this.config.defaultResultLimit,
      days: query.days ?? 7,
      timezone: query.timezone ?? this.config.defaultTimezone
    };
    const cacheKey = `results_recent:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.resultsCacheTtlSec, normalizedQuery, async () => {
      const rawResults = await this.client.getRecentResults();
      const items = normalizeResults(rawResults)
        .filter((item) => this.matchesQuery(item, normalizedQuery.team, normalizedQuery.event))
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
      team: query.team,
      event: query.event,
      limit: query.limit ?? this.config.defaultResultLimit,
      days: query.days ?? 7,
      timezone: query.timezone ?? this.config.defaultTimezone
    };
    const cacheKey = `matches_upcoming:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.matchesCacheTtlSec, normalizedQuery, async () => {
      const rawMatches = await this.client.getUpcomingMatches();
      const items = normalizeUpcomingMatches(rawMatches)
        .filter((item) => this.matchesQuery(item, normalizedQuery.team, normalizedQuery.event))
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
    if (!teamName) {
      throw new AppError("INVALID_ARGUMENT", "team_name is required to resolve canonical team slug", {
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

    if (teamId) {
      const matchedCandidate = candidates.find((candidate) => candidate.id === teamId);
      if (matchedCandidate) {
        return matchedCandidate;
      }

      throw new AppError(
        "ENTITY_NOT_FOUND",
        `Unable to resolve canonical team slug for '${teamName}' with team_id=${teamId}`,
        {
          retryable: false,
          details: {
            team_id: teamId,
            team_name: teamName,
            candidates: candidates.slice(0, 3).map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
              slug: candidate.slug
            }))
          }
        }
      );
    }

    return candidates[0];
  }

  private async requirePlayer(
    playerId: number | undefined,
    playerName: string | undefined,
    exact = false
  ): Promise<ResolvedPlayerEntity> {
    if (!playerName) {
      throw new AppError("INVALID_ARGUMENT", "player_name is required to resolve canonical player slug", {
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

    if (playerId) {
      const matchedCandidate = candidates.find((candidate) => candidate.id === playerId);
      if (matchedCandidate) {
        return matchedCandidate;
      }

      throw new AppError(
        "ENTITY_NOT_FOUND",
        `Unable to resolve canonical player slug for '${playerName}' with player_id=${playerId}`,
        {
          retryable: false,
          details: {
            player_id: playerId,
            player_name: playerName,
            candidates: candidates.slice(0, 3).map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
              slug: candidate.slug
            }))
          }
        }
      );
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

  private matchesQuery(item: NormalizedMatch, team?: string, event?: string): boolean {
    const teamMatches =
      !team || includesIgnoreCase(item.team1, team) || includesIgnoreCase(item.team2, team) || includesIgnoreCase(item.opponent, team);
    const eventMatches = !event || includesIgnoreCase(item.event, event);
    return teamMatches && eventMatches;
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
