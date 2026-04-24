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
import {
  FIXED_TIMEZONE,
  dateKeyInFixedTimezone,
  dateTimeToTimestamp,
  nowIso,
  todayDateKey
} from "../utils/time.js";
import { includesIgnoreCase, parseHltvEntityLink, sanitizeHltvText } from "../utils/strings.js";
import { HltvApiClient } from "../clients/hltvApiClient.js";
import { PlayerResolver } from "../resolvers/playerResolver.js";
import { TeamResolver } from "../resolvers/teamResolver.js";
import { buildSlugCandidates, entityAliases, normalizeLookupName, uniqueStrings } from "../resolvers/entityIdentity.js";
import { asRecord, pickArray, pickNumber, pickString } from "../utils/object.js";
import { expandTeamAliases, matchEventName, matchTeamNames } from "../utils/localizedNames.js";
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
import {
  isLikelyAutofilledUpcomingQuery,
  normalizeUpcomingFilterText
} from "./upcomingMatchesQuery.js";

interface TeamInferenceCandidate {
  id?: number;
  name?: string;
  slug?: string;
  appearances: number;
  aliases?: string[];
}

const PRIORITY_TEAM_QUERIES: TeamInferenceCandidate[] = [
  { id: 9565, name: "Vitality", slug: "vitality", appearances: 0 },
  { id: 7020, name: "Spirit", slug: "spirit", aliases: ["Team Spirit"], appearances: 0 },
  { id: 4608, name: "Natus Vincere", slug: "natus-vincere", aliases: ["NaVi", "NAVI"], appearances: 0 },
  { id: 4494, name: "MOUZ", slug: "mouz", appearances: 0 },
  { id: 6667, name: "FaZe", slug: "faze", aliases: ["FaZe Clan"], appearances: 0 },
  { id: 5995, name: "G2", slug: "g2", aliases: ["G2 Esports"], appearances: 0 },
  { id: 11283, name: "Falcons", slug: "falcons", appearances: 0 },
  { id: 6665, name: "Astralis", slug: "astralis", appearances: 0 },
  { id: 5378, name: "Virtus.pro", slug: "virtuspro", aliases: ["VP"], appearances: 0 },
  { id: 5973, name: "Liquid", slug: "liquid", aliases: ["Team Liquid"], appearances: 0 },
  { id: 8297, name: "FURIA", slug: "furia", appearances: 0 },
  { id: 11861, name: "Aurora", slug: "aurora", appearances: 0 },
  { id: 7175, name: "HEROIC", slug: "heroic", appearances: 0 },
  { id: 12467, name: "PARIVISION", slug: "parivision", appearances: 0 },
  { id: 4914, name: "3DMAX", slug: "3dmax", appearances: 0 },
  { id: 4773, name: "paiN", slug: "pain", appearances: 0 },
  { id: 9928, name: "GamerLegion", slug: "gamerlegion", appearances: 0 },
  { id: 5005, name: "Complexity", slug: "complexity", appearances: 0 },
  { id: 4411, name: "Ninjas in Pyjamas", slug: "ninjas-in-pyjamas", aliases: ["NIP"], appearances: 0 }
];

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
        ? this.sortResultsByPlayedAtDesc(split.recent_results).slice(0, normalizedQuery.limit)
        : [];
      const upcoming_matches = normalizedQuery.include_upcoming
        ? this.sortUpcomingByScheduledAtAsc(split.upcoming_matches).slice(0, normalizedQuery.limit)
        : [];
      const notes = this.collectTeamRecentNotes(profile, normalizedMatches, recent_results, upcoming_matches);

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
        meta: this.createMeta(this.config.teamRecentCacheTtlSec, {
          partial: notes.length > 0,
          notes
        }),
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

      const inferredTeam = await this.inferPlayerTeam(resolved, playerDetail);
      const resolvedEntity = inferredTeam
        ? this.playerResolver.remember({
            ...resolved,
            team: inferredTeam.name
          })
        : resolved;
      const profile = inferredTeam
        ? normalizePlayerProfile(playerDetail, {
            ...resolvedEntity,
            team: inferredTeam.name
          })
        : normalizePlayerProfile(playerDetail, resolvedEntity);
      const overview = normalizeOverview(playerOverview, playerDetail);
      const recent_matches = this.sortResultsByPlayedAtDesc(
        normalizeMatches([playerDetail], profile.name).filter((item) => item.score || item.played_at)
      ).slice(0, normalizedQuery.limit);
      const recent_highlights = collectRecentHighlights(playerDetail, playerOverview).slice(0, normalizedQuery.limit);
      const notes = this.collectPlayerRecentNotes(profile, overview, recent_highlights, recent_matches, inferredTeam?.name);

      return {
        query: normalizedQuery,
        resolved_entity: resolvedEntity,
        data: {
          profile,
          overview,
          recent_matches,
          recent_highlights
        },
        meta: this.createMeta(this.config.playerRecentCacheTtlSec, {
          partial: notes.length > 0,
          notes
        }),
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
      days: query.days ?? 7
    };
    const cacheKey = `results_recent:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.resultsCacheTtlSec, normalizedQuery, async () => {
      const teamFilter = await this.resolveOptionalTeamFilter(normalizedQuery.team_id, normalizedQuery.team);
      const rawResults = await this.client.getRecentResults();
      const parsedItems = normalizeResults(rawResults);
      const windowedItems = this.applyTimeWindow(parsedItems, normalizedQuery.days, false);
      const filteredItems = windowedItems.filter((item) => this.matchesQuery(item, teamFilter, normalizedQuery.event));
      const items = this.sortResultsByPlayedAtDesc(filteredItems).slice(0, normalizedQuery.limit);
      const notes = this.collectMatchQueryNotes({
        parsedItems,
        windowedItems,
        filteredItems: items,
        teamFilter,
        event: normalizedQuery.event,
        days: normalizedQuery.days,
        scheduled: false,
        todayOnly: false
      });

      return {
        query: normalizedQuery,
        items,
        meta: this.createMeta(this.config.resultsCacheTtlSec, {
          partial: notes.length > 0,
          notes
        }),
        error: null
      };
    });
  }

  async getUpcomingMatches(
    query: UpcomingMatchesQuery
  ): Promise<ToolResponse<never, NormalizedMatch>> {
    const effectiveQuery = isLikelyAutofilledUpcomingQuery(query) ? {} : query;
    const normalizedTeam = normalizeUpcomingFilterText(effectiveQuery.team);
    const normalizedEvent = normalizeUpcomingFilterText(effectiveQuery.event);
    const todayOnly =
      effectiveQuery.team_id === undefined &&
      !normalizedTeam &&
      !normalizedEvent &&
      effectiveQuery.limit === undefined &&
      effectiveQuery.days === undefined;
    const normalizedQuery = {
      team_id: effectiveQuery.team_id,
      team: normalizedTeam,
      event: normalizedEvent,
      limit: todayOnly ? undefined : effectiveQuery.limit ?? this.config.defaultResultLimit,
      days: todayOnly ? undefined : effectiveQuery.days ?? 7,
      today_only: todayOnly
    };
    const cacheKey = `matches_upcoming:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.matchesCacheTtlSec, normalizedQuery, async () => {
      const teamFilter = await this.resolveOptionalTeamFilter(normalizedQuery.team_id, normalizedQuery.team);
      const rawMatches = await this.client.getUpcomingMatches();
      const parsedItems = normalizeUpcomingMatches(rawMatches);
      const windowedItems = normalizedQuery.today_only
        ? this.filterMatchesToToday(parsedItems)
        : this.applyTimeWindow(parsedItems, normalizedQuery.days ?? 7, true);
      const filteredItems = windowedItems.filter((item) => this.matchesQuery(item, teamFilter, normalizedQuery.event));
      const sortedItems = this.sortUpcomingByScheduledAtAsc(filteredItems);
      const items =
        normalizedQuery.limit !== undefined ? sortedItems.slice(0, normalizedQuery.limit) : sortedItems;
      const notes = this.collectMatchQueryNotes({
        parsedItems,
        windowedItems,
        filteredItems: items,
        teamFilter,
        event: normalizedQuery.event,
        days: normalizedQuery.days,
        scheduled: true,
        todayOnly: normalizedQuery.today_only
      });

      return {
        query: normalizedQuery,
        items,
        meta: this.createMeta(this.config.matchesCacheTtlSec, {
          partial: notes.length > 0,
          notes
        }),
        error: null
      };
    });
  }

  async getTodayMatches(): Promise<ToolResponse<never, NormalizedMatch>> {
    return this.getUpcomingMatches({});
  }

  async getNewsDigest(query: NewsDigestQuery): Promise<ToolResponse<never, NewsItem>> {
    const limit = query.limit ?? 25;
    const normalizedOffset = query.offset ?? (query.page && query.page > 1 ? (query.page - 1) * limit : 0);
    const normalizedPage = Math.floor(normalizedOffset / limit) + 1;

    const normalizedQuery = {
      limit,
      offset: normalizedOffset,
      page: normalizedPage,
      tag: query.tag,
      year: query.year,
      month: query.month
    };
    const cacheKey = `news_digest:${JSON.stringify(normalizedQuery)}`;

    return this.withCache(cacheKey, this.config.newsCacheTtlSec, normalizedQuery, async () => {
      const rawNews = await this.client.getNews(normalizedQuery.year, normalizedQuery.month);
      const normalizedItems = normalizeNews(rawNews);

      const filteredItems = normalizedItems.filter((item) => {
        if (!normalizedQuery.tag) {
          return true;
        }

        return (
          includesIgnoreCase(item.title, normalizedQuery.tag) ||
          includesIgnoreCase(item.summary_hint, normalizedQuery.tag) ||
          includesIgnoreCase(item.tag, normalizedQuery.tag)
        );
      });

      const items = filteredItems.slice(normalizedQuery.offset, normalizedQuery.offset + normalizedQuery.limit);
      const total = filteredItems.length;
      const hasMore = normalizedQuery.offset + items.length < total;
      const currentPage = normalizedQuery.page;

      const notes = this.collectNewsNotes({
        rawNews,
        normalizedItems,
        filteredItems,
        tag: normalizedQuery.tag,
        year: normalizedQuery.year,
        month: normalizedQuery.month
      });

      return {
        query: normalizedQuery,
        items,
        meta: this.createMeta(this.config.newsCacheTtlSec, {
          partial: notes.length > 0,
          notes,
          pagination: {
            offset: normalizedQuery.offset,
            limit: normalizedQuery.limit,
            returned: items.length,
            total,
            has_more: hasMore,
            current_page: currentPage,
            next_offset: hasMore ? normalizedQuery.offset + normalizedQuery.limit : undefined,
            next_page: hasMore ? currentPage + 1 : undefined
          }
        }),
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
    const eventMatches = !event || matchEventName(item.event, event);
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
    const normalizedTeamName = teamName?.trim();

    if (!teamId && !normalizedTeamName) {
      return undefined;
    }

    if (teamId) {
      const resolved = await this.resolveTeamById(teamId, normalizedTeamName, false);
      if (resolved) {
        return {
          id: resolved.id,
          names: uniqueStrings([...entityAliases(resolved), ...expandTeamAliases(normalizedTeamName)])
        };
      }

      return {
        id: teamId,
        names: uniqueStrings([normalizedTeamName, ...expandTeamAliases(normalizedTeamName)])
      };
    }

    const localizedAliases = expandTeamAliases(normalizedTeamName);
    const resolveCandidates = uniqueStrings([normalizedTeamName, ...localizedAliases]);

    for (const candidateName of resolveCandidates) {
      const candidates = await this.teamResolver.resolve(candidateName, false, 10);
      if (!candidates.length) {
        continue;
      }

      return {
        id: candidates[0].id,
        names: uniqueStrings([...entityAliases(candidates[0]), ...localizedAliases])
      };
    }

    if (!localizedAliases.length) {
      throw new AppError("ENTITY_NOT_FOUND", `No team matched '${normalizedTeamName}'`, {
        retryable: false,
        details: {
          team_id: teamId,
          team_name: normalizedTeamName
        }
      });
    }

    return {
      names: localizedAliases
    };
  }

  private async inferPlayerTeam(
    player: ResolvedPlayerEntity,
    rawPlayerDetail: unknown
  ): Promise<ResolvedTeamEntity | undefined> {
    const existingTeam = normalizePlayerProfile(rawPlayerDetail, player).team;
    if (existingTeam) {
      return undefined;
    }

    const cacheKey = `player_team_inference:${player.id}`;
    const cached = this.cache.get<ResolvedTeamEntity | null>(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    try {
      const priorityCandidates = this.buildPriorityTeamCandidates();
      const priorityMatch = await this.findPlayerTeamFromCandidates(player, priorityCandidates, 3);
      if (priorityMatch) {
        this.cache.set(cacheKey, priorityMatch, this.config.playerRecentCacheTtlSec);
        return priorityMatch;
      }

      const [recentResults, upcomingMatches] = await Promise.all([
        this.client.getRecentResults(),
        this.client.getUpcomingMatches()
      ]);
      const activeCandidates = this.buildFallbackTeamCandidates(
        this.collectActiveTeamCandidates([
          ...normalizeResults(recentResults),
          ...normalizeUpcomingMatches(upcomingMatches)
        ]),
        16
      );

      const inferred = await this.findPlayerTeamFromCandidates(player, activeCandidates, 6);
      this.cache.set(cacheKey, inferred ?? null, this.config.playerRecentCacheTtlSec);
      return inferred;
    } catch (error) {
      if (isAppError(error)) {
        this.cache.set(cacheKey, null, Math.min(this.config.playerRecentCacheTtlSec, 60));
        return undefined;
      }

      throw error;
    }
  }

  private async findPlayerTeamFromCandidates(
    player: ResolvedPlayerEntity,
    candidates: TeamInferenceCandidate[],
    concurrency = 6
  ): Promise<ResolvedTeamEntity | undefined> {
    if (!candidates.length) {
      return undefined;
    }

    let cursor = 0;
    let found: ResolvedTeamEntity | undefined;
    const workerCount = Math.min(Math.max(concurrency, 1), candidates.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (found === undefined) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= candidates.length) {
          return;
        }

        const candidate = candidates[currentIndex];
        const resolvedTeam = await this.resolveActiveTeamCandidate(candidate);
        if (!resolvedTeam) {
          continue;
        }

        const detail = await this.getTeamDetailCached(resolvedTeam);
        if (!detail || !this.teamRosterContainsPlayer(detail, player)) {
          continue;
        }

        const profile = normalizeTeamProfile(detail, resolvedTeam);
        found = this.teamResolver.remember(
          {
            type: "team",
            id: profile.id,
            name: profile.name,
            slug: profile.slug,
            country: profile.country,
            rank: profile.rank,
            aliases: uniqueStrings([candidate.name, resolvedTeam.name, resolvedTeam.slug, profile.name, profile.slug])
          },
          uniqueStrings([candidate.name])
        );
        return;
      }
    });

    await Promise.all(workers);
    return found;
  }

  private buildPriorityTeamCandidates(): TeamInferenceCandidate[] {
    return PRIORITY_TEAM_QUERIES.map((team, index) => ({
      ...team,
      appearances: 10_000 - index
    }));
  }

  private buildFallbackTeamCandidates(
    activeCandidates: TeamInferenceCandidate[],
    maxCandidates = 36
  ): TeamInferenceCandidate[] {
    const seenNames = new Set(
      PRIORITY_TEAM_QUERIES.flatMap((team) =>
        uniqueStrings([team.name, team.slug, ...(team.aliases ?? [])]).map((value) => normalizeLookupName(value).slug)
      )
    );
    const seenIds = new Set(PRIORITY_TEAM_QUERIES.map((team) => team.id));

    return activeCandidates
      .filter((candidate) => {
        if (candidate.id !== undefined && seenIds.has(candidate.id)) {
          return false;
        }

        const normalizedName = sanitizeHltvText(candidate.name);
        if (!normalizedName) {
          return true;
        }

        return !seenNames.has(normalizeLookupName(normalizedName).slug);
      })
      .slice(0, maxCandidates);
  }

  private async resolveActiveTeamCandidate(candidate: TeamInferenceCandidate): Promise<ResolvedTeamEntity | undefined> {
    if (candidate.id !== undefined && candidate.slug) {
      const cached = this.teamResolver.getById(candidate.id);
      if (cached) {
        return cached;
      }

      return this.teamResolver.remember(
        {
          type: "team",
          id: candidate.id,
          name: candidate.name ?? candidate.slug,
          slug: candidate.slug,
          aliases: uniqueStrings([candidate.name, candidate.slug, ...(candidate.aliases ?? [])])
        },
        uniqueStrings(candidate.aliases ?? [])
      );
    }

    if (candidate.id !== undefined) {
      try {
        return await this.resolveTeamById(candidate.id, candidate.name, false);
      } catch (error) {
        if (isAppError(error) && ["UPSTREAM_NOT_FOUND", "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE"].includes(error.code)) {
          return undefined;
        }

        throw error;
      }
    }

    const rawName = sanitizeHltvText(candidate.name);
    if (!rawName) {
      return undefined;
    }

    const cacheKey = `active_team_candidate:${normalizeLookupName(rawName).slug}`;
    const cached = this.cache.get<ResolvedTeamEntity | null>(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    try {
      const searchResults = await this.client.searchTeams(rawName);
      const normalizedCandidates = searchResults
        .map((item) => this.normalizeTeamSearchCandidate(item, rawName))
        .filter((item): item is ResolvedTeamEntity => Boolean(item))
        .sort((left, right) => this.scoreNameMatch(right.name, rawName) - this.scoreNameMatch(left.name, rawName));

      const best = normalizedCandidates[0];
      if (!best) {
        this.cache.set(cacheKey, null, Math.min(this.config.entityCacheTtlSec, 120));
        return undefined;
      }

      const remembered = this.teamResolver.remember(best, [rawName]);
      this.cache.set(cacheKey, remembered, this.config.entityCacheTtlSec);
      return remembered;
    } catch (error) {
      if (isAppError(error) && ["UPSTREAM_NOT_FOUND", "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE"].includes(error.code)) {
        this.cache.set(cacheKey, null, Math.min(this.config.entityCacheTtlSec, 120));
        return undefined;
      }

      throw error;
    }
  }

  private normalizeTeamSearchCandidate(raw: unknown, fallbackName: string): ResolvedTeamEntity | undefined {
    const record = asRecord(raw);
    if (!record) {
      return undefined;
    }

    const link = pickString(record, ["link", "profile_link", "href", "url"]);
    const parsedLink = parseHltvEntityLink(link, "team");
    const id = pickNumber(record, ["id", "team_id", "teamId"]) ?? parsedLink.id;
    const name = sanitizeHltvText(pickString(record, ["name", "team_name", "teamName", "team"])) ?? fallbackName;
    if (!id || !name) {
      return undefined;
    }

    return {
      type: "team",
      id,
      name,
      slug: sanitizeHltvText(parsedLink.slug) ?? this.client.buildSlug(name, id),
      country: sanitizeHltvText(pickString(record, ["country", "country_code", "countryCode"])),
      rank: pickNumber(record, ["rank", "world_rank", "worldRank"]),
      aliases: uniqueStrings([name, parsedLink.slug, fallbackName])
    };
  }

  private scoreNameMatch(candidateName: string, targetName: string): number {
    const candidate = normalizeLookupName(candidateName);
    const target = normalizeLookupName(targetName);

    if (candidate.strict === target.strict || candidate.loose === target.loose || candidate.slug === target.slug) {
      return 1;
    }

    if (
      candidate.loose.includes(target.loose) ||
      target.loose.includes(candidate.loose) ||
      candidate.strict.includes(target.strict) ||
      target.strict.includes(candidate.strict)
    ) {
      return 0.8;
    }

    return 0.4;
  }

  private async getTeamDetailCached(team: ResolvedTeamEntity): Promise<unknown | undefined> {
    const cacheKey = `team_detail:${team.id}`;
    const cached = this.cache.get<unknown | null>(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    try {
      const detail = await this.client.getTeam(team.id, team.slug);
      this.cache.set(cacheKey, detail, this.config.entityCacheTtlSec);
      return detail;
    } catch (error) {
      if (isAppError(error) && ["UPSTREAM_NOT_FOUND", "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE"].includes(error.code)) {
        this.cache.set(cacheKey, null, Math.min(this.config.entityCacheTtlSec, 120));
        return undefined;
      }

      throw error;
    }
  }

  private collectActiveTeamCandidates(matches: NormalizedMatch[]): TeamInferenceCandidate[] {
    const candidates = new Map<string, TeamInferenceCandidate>();

    const pushCandidate = (id?: number, name?: string) => {
      const normalizedName = sanitizeHltvText(name);
      if (id === undefined && !normalizedName) {
        return;
      }

      const key = id !== undefined ? `id:${id}` : `name:${normalizeLookupName(normalizedName!).slug || normalizedName!.toLowerCase()}`;
      const existing = candidates.get(key);
      if (existing) {
        existing.appearances += 1;
        if (!existing.name && normalizedName) {
          existing.name = normalizedName;
        }
        return;
      }

      candidates.set(key, {
        id,
        name: normalizedName,
        appearances: 1
      });
    };

    for (const match of matches) {
      pushCandidate(match.team1_id, match.team1);
      pushCandidate(match.team2_id, match.team2);
    }

    return [...candidates.values()]
      .sort((left, right) => {
        if (right.appearances !== left.appearances) {
          return right.appearances - left.appearances;
        }

        return String(left.name ?? "").localeCompare(String(right.name ?? ""), "en-US");
      })
      .slice(0, 36);
  }

  private teamRosterContainsPlayer(rawTeam: unknown, player: ResolvedPlayerEntity): boolean {
    const roster = this.extractRosterMembers(rawTeam);
    if (!roster.length) {
      return false;
    }

    const aliases = uniqueStrings(entityAliases(player));
    const normalizedAliases = aliases
      .map((alias) => normalizeLookupName(alias))
      .filter((alias) => alias.loose.length > 0 || alias.slug.length > 0);

    return roster.some((member) => {
      if (member.id !== undefined && member.id === player.id) {
        return true;
      }

      return member.names.some((name) => {
        const candidate = normalizeLookupName(name);

        return normalizedAliases.some((alias) => {
          if (candidate.strict === alias.strict || candidate.loose === alias.loose || candidate.slug === alias.slug) {
            return true;
          }

          const candidateLoose = candidate.loose;
          const aliasLoose = alias.loose;
          if (!candidateLoose || !aliasLoose) {
            return false;
          }

          const candidateSingleToken = candidate.tokens.length === 1 ? candidate.tokens[0] : undefined;
          const aliasSingleToken = alias.tokens.length === 1 ? alias.tokens[0] : undefined;

          return Boolean(
            (candidateSingleToken && candidateSingleToken.length >= 3 && alias.tokens.includes(candidateSingleToken)) ||
              (aliasSingleToken && aliasSingleToken.length >= 3 && candidate.tokens.includes(aliasSingleToken)) ||
              (candidateLoose.length >= 4 && aliasLoose.includes(candidateLoose)) ||
              (aliasLoose.length >= 4 && candidateLoose.includes(aliasLoose))
          );
        });
      });
    });
  }

  private extractRosterMembers(rawTeam: unknown): Array<{ id?: number; names: string[] }> {
    const record = this.unwrapPrimaryRecord(rawTeam);
    if (!record) {
      return [];
    }

    const roster = pickArray(record, ["squad", "players", "lineup", "roster"]);
    if (!roster?.length) {
      return [];
    }

    const members: Array<{ id?: number; names: string[] }> = [];

    for (const item of roster) {
        const member = asRecord(item);
        if (!member) {
          continue;
        }

        const link = pickString(member, ["link", "profile_link", "href", "url"]);
        const parsedLink = parseHltvEntityLink(link, "player");
        const names = uniqueStrings([
          sanitizeHltvText(pickString(member, ["nick"])),
          sanitizeHltvText(pickString(member, ["name", "player_name", "playerName"])),
          sanitizeHltvText(pickString(member, ["full_name", "fullName", "real_name", "realName"])),
          sanitizeHltvText(parsedLink.slug)
        ]);
        const id = pickNumber(member, ["id", "player_id", "playerId"]) ?? parsedLink.id;

        if (id === undefined && !names.length) {
          continue;
        }

        members.push({
          id,
          names
        });
    }

    return members;
  }

  private unwrapPrimaryRecord(raw: unknown): Record<string, unknown> | undefined {
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const record = asRecord(item);
        if (record) {
          return record;
        }
      }

      return undefined;
    }

    return asRecord(raw);
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

    return matchTeamNames([item.team1, item.team2, item.opponent], teamFilter.names);
  }

  private filterMatchesToToday(matches: NormalizedMatch[]): NormalizedMatch[] {
    const currentDay = todayDateKey();
    return matches.filter((item) => dateKeyInFixedTimezone(item.scheduled_at) === currentDay);
  }

  private createMeta(ttlSec: number, overrides: Partial<ToolMeta> = {}): ToolMeta {
    return {
      source: "hltv-scraper-api",
      fetched_at: nowIso(),
      timezone: FIXED_TIMEZONE,
      cache_hit: false,
      ttl_sec: ttlSec,
      schema_version: "1.0",
      partial: false,
      ...overrides
    };
  }

  private applyTimeWindow(matches: NormalizedMatch[], days: number, scheduled: boolean): NormalizedMatch[] {
    const limitMs = days * 24 * 60 * 60 * 1_000;
    const now = Date.now();

    return matches.filter((item) => {
      const timeValue = scheduled ? item.scheduled_at : item.played_at;
      const timestamp = dateTimeToTimestamp(timeValue);
      if (timestamp === undefined) {
        return true;
      }

      if (scheduled) {
        return timestamp >= now && timestamp <= now + limitMs;
      }

      return timestamp <= now && timestamp >= now - limitMs;
    });
  }

  private sortResultsByPlayedAtDesc(matches: NormalizedMatch[]): NormalizedMatch[] {
    return [...matches].sort((left, right) => this.compareMatchTime(left.played_at, right.played_at, false));
  }

  private sortUpcomingByScheduledAtAsc(matches: NormalizedMatch[]): NormalizedMatch[] {
    return [...matches].sort((left, right) => this.compareMatchTime(left.scheduled_at, right.scheduled_at, true));
  }

  private compareMatchTime(leftValue: string | undefined, rightValue: string | undefined, ascending: boolean): number {
    const left = dateTimeToTimestamp(leftValue);
    const right = dateTimeToTimestamp(rightValue);

    if (left === undefined && right === undefined) {
      return 0;
    }

    if (left === undefined) {
      return 1;
    }

    if (right === undefined) {
      return -1;
    }

    return ascending ? left - right : right - left;
  }

  private collectPlayerRecentNotes(
    profile: PlayerRecentData["profile"],
    overview: PlayerRecentData["overview"],
    recentHighlights: string[],
    recentMatches: NormalizedMatch[],
    inferredTeamName?: string
  ): string[] {
    const notes: string[] = [];

    if (inferredTeamName) {
      notes.push(`所属队伍由近期活跃队伍 roster 扫描推断为 ${inferredTeamName}；上游选手详情原本缺失该字段。`);
    } else if (!profile.team) {
      notes.push("上游选手详情暂未提供可识别的所属队伍字段，且基于近期活跃队伍的自动推断也未命中；已先返回其余可确认信息。");
    }

    if (!profile.country) {
      notes.push("上游选手详情未提供可识别的国家/地区字段。");
    }

    if (!Object.keys(overview).length) {
      notes.push("上游统计接口返回为空或字段结构不包含已识别的统计键。");
    }

    if (!recentHighlights.length) {
      notes.push("上游详情/统计中没有可提取的 trophies、highlights 或 rating 信息。");
    }

    if (!recentMatches.length) {
      notes.push("当前选手详情响应中未包含可解析的近期比赛记录。");
    }

    return notes;
  }

  private collectNewsNotes({
    rawNews,
    normalizedItems,
    filteredItems,
    tag,
    year,
    month
  }: {
    rawNews: unknown[];
    normalizedItems: NewsItem[];
    filteredItems: NewsItem[];
    tag?: string;
    year?: number;
    month?: number | string;
  }): string[] {
    const notes: string[] = [];

    if (!rawNews.length) {
      notes.push("上游新闻接口当前返回空结果；这不是本地渲染造成的。");
    }

    if (rawNews.length > 0 && !normalizedItems.length) {
      notes.push("上游新闻接口返回了数据，但字段结构不包含已识别的标题字段。");
    }

    if (normalizedItems.length > 0 && !filteredItems.length && tag) {
      notes.push(`新闻数据存在，但没有条目匹配 tag='${tag}'。`);
    }

    if (year && month) {
      notes.push(`参数化新闻请求已按上游要求使用月份文本传递（year=${year}, month=${String(month)}）。`);
    }

    return notes;
  }

  private collectTeamRecentNotes(
    profile: TeamRecentData["profile"],
    normalizedMatches: NormalizedMatch[],
    recentResults: NormalizedMatch[],
    upcomingMatches: NormalizedMatch[]
  ): string[] {
    const notes: string[] = [];

    if (!profile.country) {
      notes.push("上游队伍详情未提供可识别的国家/地区字段。");
    }

    if (!profile.rank) {
      notes.push("上游队伍详情未提供可识别的排名字段。");
    }

    if (!normalizedMatches.length) {
      notes.push("上游队伍比赛接口未返回可解析的比赛记录。");
      return notes;
    }

    if (!recentResults.length) {
      notes.push("当前队伍比赛数据中没有被识别为已结束的赛果记录。");
    }

    if (!upcomingMatches.length) {
      notes.push("当前队伍比赛数据中没有被识别为未来赛程的记录。");
    }

    return notes;
  }

  private collectMatchQueryNotes({
    parsedItems,
    windowedItems,
    filteredItems,
    teamFilter,
    event,
    days,
    scheduled,
    todayOnly
  }: {
    parsedItems: NormalizedMatch[];
    windowedItems: NormalizedMatch[];
    filteredItems: NormalizedMatch[];
    teamFilter?: { id?: number; names: string[] };
    event?: string;
    days?: number;
    scheduled: boolean;
    todayOnly?: boolean;
  }): string[] {
    const notes: string[] = [];
    if (filteredItems.length) {
      return notes;
    }

    if (!parsedItems.length) {
      notes.push(scheduled ? "上游未来比赛接口未返回可解析的比赛记录。" : "上游近期结果接口未返回可解析的比赛记录。");
      return notes;
    }

    if (!windowedItems.length) {
      if (todayOnly) {
        notes.push(`当前为无参数默认模式：仅展示 ${FIXED_TIMEZONE} 时区的今日比赛；今天暂无可展示赛程。`);
      } else {
        notes.push(`时间窗口过滤为最近 ${days} 天，但当前没有记录落在该时间范围内。`);
      }
      const missingTimeCount = parsedItems.filter((item) => !(scheduled ? item.scheduled_at : item.played_at)).length;
      if (missingTimeCount > 0) {
        notes.push(`${missingTimeCount} 条记录缺少可解析时间，无法参与精确时间过滤。`);
      }
      return notes;
    }

    if (teamFilter) {
      notes.push(`队伍过滤条件未命中任何记录：${teamFilter.names[0] ?? `team_id=${teamFilter.id}`}`);
    }

    if (event?.trim()) {
      notes.push(`赛事过滤条件未命中任何记录：${event.trim()}`);
    }

    if (todayOnly) {
      notes.push(`当前为无参数默认模式：仅展示 ${FIXED_TIMEZONE} 时区的今日比赛。`);
    } else {
      notes.push(`时间窗口过滤为最近 ${days} 天，超出窗口的记录已被排除。`);
    }

    const missingTimeCount = windowedItems.filter((item) => !(scheduled ? item.scheduled_at : item.played_at)).length;
    if (missingTimeCount > 0) {
      notes.push(`${missingTimeCount} 条记录缺少可解析时间，已保留但可能无法按时间精确筛选。`);
    }

    return notes;
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
      const stale = this.cache.getStaleWithMeta<ToolResponse<TData, TItem, TResolved>>(cacheKey);
      if (stale) {
        return this.cloneWithMeta(stale.value, {
          cache_hit: true,
          stale: true,
          stale_age_sec: stale.staleAgeSec,
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
