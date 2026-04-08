import type {
  NewsItem,
  NormalizedMatch,
  PlayerProfile,
  ResolvedPlayerEntity,
  ResolvedTeamEntity,
  TeamProfile
} from "../types/hltv.js";
import { asRecord, compact, pickArray, pickNumber, pickString, pickValue } from "../utils/object.js";
import { normalizeDateTime } from "../utils/time.js";

function parseLooseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().match(/-?\d+(?:\.\d+)?/);
    if (!normalized) {
      return undefined;
    }

    const parsed = Number(normalized[0]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function pickLooseNumber(record: Record<string, unknown>, paths: string[]): number | undefined {
  for (const path of paths) {
    const parsed = parseLooseNumber(pickValue(record, [path]));
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function firstString(items: unknown[] | undefined): string | undefined {
  for (const item of items ?? []) {
    if (typeof item === "string" && item.trim().length > 0) {
      return item.trim();
    }
  }

  return undefined;
}

function listToText(value: unknown, separator = ", "): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (typeof item === "number" && Number.isFinite(item)) {
        return String(item);
      }

      return undefined;
    })
    .filter((item): item is string => Boolean(item));

  return values.length ? values.join(separator) : undefined;
}

function pickText(record: Record<string, unknown>, paths: string[], separator = ", "): string | undefined {
  const direct = pickString(record, paths);
  if (direct) {
    return direct;
  }

  for (const path of paths) {
    const value = pickValue(record, [path]);
    const listText = listToText(value, separator);
    if (listText) {
      return listText;
    }
  }

  return undefined;
}

function parseScore(record: Record<string, unknown>): string | undefined {
  const direct = pickString(record, ["score", "result", "scoreline"]);
  if (direct) {
    return direct;
  }

  const scoreList = listToText(pickValue(record, ["score", "result", "scoreline"]), ":");
  if (scoreList) {
    return scoreList;
  }

  const left = pickLooseNumber(record, ["team1_score", "team1Score", "left_score", "leftScore"]);
  const right = pickLooseNumber(record, ["team2_score", "team2Score", "right_score", "rightScore"]);

  if (left !== undefined && right !== undefined) {
    return `${left}:${right}`;
  }

  return undefined;
}

function parseOutcome(record: Record<string, unknown>, perspective?: string): NormalizedMatch["result"] {
  const direct = pickString(record, ["outcome", "result_status", "match_result"]);
  if (direct) {
    const normalized = direct.toLowerCase();
    if (normalized.includes("win")) {
      return "win";
    }
    if (normalized.includes("loss") || normalized.includes("lose")) {
      return "loss";
    }
    if (normalized.includes("draw")) {
      return "draw";
    }
  }

  const team1 = pickString(record, ["team1", "team1_name", "team1.name", "team1Name"]);
  const team2 = pickString(record, ["team2", "team2_name", "team2.name", "team2Name"]);
  const team1Score = pickLooseNumber(record, ["team1_score", "team1Score"]);
  const team2Score = pickLooseNumber(record, ["team2_score", "team2Score"]);

  if (!perspective || team1Score === undefined || team2Score === undefined) {
    return undefined;
  }

  if (team1Score === team2Score) {
    return "draw";
  }

  if (team1 === perspective) {
    return team1Score > team2Score ? "win" : "loss";
  }

  if (team2 === perspective) {
    return team2Score > team1Score ? "win" : "loss";
  }

  return undefined;
}

export function normalizeTeamProfile(
  raw: unknown,
  fallback: ResolvedTeamEntity
): TeamProfile {
  const record = asRecord(raw);
  if (!record) {
    return {
      id: fallback.id,
      name: fallback.name,
      slug: fallback.slug,
      country: fallback.country,
      rank: fallback.rank
    };
  }

  return {
    id: pickNumber(record, ["id", "team_id", "teamId"]) ?? fallback.id,
    name: pickString(record, ["name", "team_name", "teamName", "team"]) ?? fallback.name,
    slug: fallback.slug,
    country:
      pickString(record, ["country", "country_code", "countryCode", "country.name", "country.code"]) ??
      fallback.country,
    rank: pickLooseNumber(record, ["rank", "world_rank", "worldRank", "ranking"]) ?? fallback.rank,
    raw_summary: pickString(record, ["summary", "description"])
  };
}

export function normalizePlayerProfile(
  raw: unknown,
  fallback: ResolvedPlayerEntity
): PlayerProfile {
  const record = asRecord(raw);
  if (!record) {
    return {
      id: fallback.id,
      name: fallback.name,
      slug: fallback.slug,
      team: fallback.team,
      country: fallback.country
    };
  }

  return {
    id: pickNumber(record, ["id", "player_id", "playerId"]) ?? fallback.id,
    name: pickString(record, ["name", "player_name", "playerName", "player", "nick"]) ?? fallback.name,
    slug: fallback.slug,
    team:
      pickString(record, ["team", "team_name", "teamName", "current_team", "team.name"]) ??
      firstString(pickArray(record, ["team"])) ??
      fallback.team,
    country:
      pickString(record, ["country", "country_code", "countryCode", "country.name", "flag"]) ??
      fallback.country,
    raw_summary: pickString(record, ["summary", "description", "bio"])
  };
}

export function normalizeOverview(raw: unknown): Record<string, string | number> {
  const record = asRecord(raw);
  if (!record) {
    return {};
  }

  const containers = compact([
    record,
    asRecord(record.summary),
    asRecord(record.player_statistics),
    asRecord(record.role_stats),
    asRecord(record.stats)
  ]);

  const keyMap: Record<string, string[]> = {
    rating: ["rating", "rating_2.0", "rating2"],
    maps: ["maps", "maps_played"],
    kills: ["kills", "total_kills"],
    deaths: ["deaths", "total_deaths"],
    kd_diff: ["kd_diff", "kill_death_difference"],
    headshots: ["headshots", "headshot_percentage", "hs"],
    adr: ["adr"],
    kast: ["kast"],
    impact: ["impact"]
  };

  const entries = compact(
    Object.entries(keyMap).map(([normalizedKey, paths]) => {
      for (const container of containers) {
        const rawValue = pickValue(container, paths);
        if (typeof rawValue === "number" || typeof rawValue === "string") {
          return [normalizedKey, typeof rawValue === "string" ? rawValue.trim() : rawValue] as const;
        }
      }

      return undefined;
    })
  );

  return Object.fromEntries(entries);
}

export function normalizeMatches(rawItems: unknown[], perspective?: string): NormalizedMatch[] {
  return compact(
    rawItems.map((item) => {
      const record = asRecord(item);
      if (!record) {
        return undefined;
      }

      const team1 = pickString(record, ["team1", "team1_name", "team1.name", "team1Name"]);
      const team2 = pickString(record, ["team2", "team2_name", "team2.name", "team2Name"]);
      const opponent =
        pickString(record, ["opponent", "opponent_name", "opponentName"]) ??
        (perspective && team1 === perspective ? team2 : perspective && team2 === perspective ? team1 : undefined);
      const scheduled = normalizeDateTime(
        pickString(record, ["scheduled_at", "date", "datetime", "time", "timestamp", "match_time"])
      );
      const playedAt = normalizeDateTime(
        pickString(record, ["played_at", "playedAt", "finished_at", "date", "datetime", "time", "timestamp"])
      );
      const result = parseOutcome(record, perspective);
      const score = parseScore(record);

      return {
        match_id: pickNumber(record, ["id", "match_id", "matchId"]),
        team1,
        team2,
        opponent,
        event: pickString(record, ["event", "event_name", "eventName", "event.name", "event_title"]),
        result: score || playedAt ? result ?? "unknown" : "scheduled",
        score,
        winner: pickString(record, ["winner", "winner_name", "winnerName", "winner.name"]),
        best_of: pickString(record, ["best_of", "bestOf", "format"]),
        played_at: score || playedAt ? playedAt : undefined,
        scheduled_at: score || playedAt ? undefined : scheduled,
        map_text: pickText(record, ["map", "maps", "map_text", "mapText"])
      };
    })
  );
}

export function splitTeamMatches(matches: NormalizedMatch[]): {
  recent_results: NormalizedMatch[];
  upcoming_matches: NormalizedMatch[];
} {
  const recent_results = matches.filter((item) => item.score || item.played_at);
  const upcoming_matches = matches.filter((item) => !item.score && item.scheduled_at);

  return {
    recent_results,
    upcoming_matches
  };
}

export function normalizeResults(rawItems: unknown[]): NormalizedMatch[] {
  return normalizeMatches(rawItems);
}

export function normalizeUpcomingMatches(rawItems: unknown[]): NormalizedMatch[] {
  return normalizeMatches(rawItems).map((item) => ({
    ...item,
    result: "scheduled"
  }));
}

export function normalizeNews(rawItems: unknown[]): NewsItem[] {
  return compact(
    rawItems.map((item) => {
      const record = asRecord(item);
      if (!record) {
        return undefined;
      }

      const title = pickString(record, ["title", "headline", "name"]);
      if (!title) {
        return undefined;
      }

      return {
        title,
        link: pickString(record, ["link", "url"]),
        published_at: normalizeDateTime(
          pickString(record, ["published_at", "publishedAt", "date", "datetime", "timestamp"])
        ),
        summary_hint: pickString(record, ["summary", "description", "teaser"]),
        tag: pickString(record, ["tag", "topic", "category"])
      };
    })
  );
}

export function collectRecentHighlights(rawPlayer: unknown, rawOverview: unknown): string[] {
  const playerRecord = asRecord(rawPlayer);
  const normalizedOverview = normalizeOverview(rawOverview);
  const notes = new Set<string>();

  const achievements = playerRecord ? pickArray(playerRecord, ["achievements", "highlights", "trophies"]) : undefined;
  for (const item of achievements ?? []) {
    if (typeof item === "string") {
      notes.add(item);
    } else {
      const record = asRecord(item);
      const value = record ? pickString(record, ["title", "name", "text"]) : undefined;
      if (value) {
        notes.add(value);
      }
    }
  }

  const rating = normalizedOverview.rating;
  if (rating !== undefined) {
    notes.add(`近期 rating: ${rating}`);
  }

  return [...notes].slice(0, 5);
}
