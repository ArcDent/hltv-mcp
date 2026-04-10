import type {
  NewsItem,
  NormalizedMatch,
  PlayerProfile,
  ResolvedPlayerEntity,
  ResolvedTeamEntity,
  TeamProfile
} from "../types/hltv.js";
import { asRecord, compact, pickArray, pickNumber, pickString, pickValue } from "../utils/object.js";
import { parseHltvEntityLink, sanitizeHltvText } from "../utils/strings.js";
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

function unwrapPrimaryRecord(raw: unknown): Record<string, unknown> | undefined {
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

function firstString(items: unknown[] | undefined): string | undefined {
  for (const item of items ?? []) {
    if (typeof item === "string" && item.trim().length > 0) {
      return sanitizeHltvText(item);
    }
  }

  return undefined;
}

function firstNamedValue(items: unknown[] | undefined): string | undefined {
  for (const item of items ?? []) {
    if (typeof item === "string" && item.trim().length > 0) {
      return sanitizeHltvText(item);
    }

    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const value = pickString(record, [
      "name",
      "team_name",
      "teamName",
      "player_name",
      "playerName",
      "nick",
      "title",
      "text"
    ]);

    if (value) {
      return sanitizeHltvText(value);
    }
  }

  return undefined;
}

function unwrapEntityName(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = sanitizeHltvText(value);
    return trimmed || undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return sanitizeHltvText(
    pickString(record, ["name", "team_name", "teamName", "player_name", "playerName"])
  );
}

function normalizeCountryText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = sanitizeHltvText(value);
  if (!trimmed) {
    return undefined;
  }

  const flagMatch =
    trimmed.match(/\/flags\/[^/]+\/([a-z]{2})\.(?:gif|png|svg|webp)/i) ??
    trimmed.match(/\b([A-Z]{2})\.(?:gif|png|svg|webp)\b/);

  if (flagMatch?.[1]) {
    return flagMatch[1].toUpperCase();
  }

  return trimmed;
}

function pickCountry(record: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const rawValue = pickValue(record, [path]);
    if (typeof rawValue === "string") {
      const normalized = normalizeCountryText(rawValue);
      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function flattenMetricArray(value: unknown): Record<string, string | number> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries: Array<[string, string | number]> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    for (const [key, rawValue] of Object.entries(record)) {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        entries.push([key, rawValue]);
        continue;
      }

        if (typeof rawValue === "string" && rawValue.trim().length > 0) {
          const sanitized = sanitizeHltvText(rawValue);
          if (sanitized) {
            entries.push([key, sanitized]);
          }
        }
    }
  }

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function buildDateTimeCandidate(
  record: Record<string, unknown>,
  datePaths: string[],
  timePaths: string[],
  fallbackPaths: string[]
): string | undefined {
  const direct = pickString(record, fallbackPaths);
  if (direct) {
    return normalizeDateTime(direct);
  }

  const datePart = pickString(record, datePaths);
  const timePart = pickString(record, timePaths);
  if (datePart && timePart) {
    return normalizeDateTime(`${datePart} ${timePart}`);
  }

  return normalizeDateTime(datePart ?? timePart);
}

function parseMatchIdFromLink(link: string | undefined): number | undefined {
  if (!link) {
    return undefined;
  }

  const matched = link.match(/\/matches\/(\d+)\//i);
  if (!matched) {
    return undefined;
  }

  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function looksLikeMatchRecord(record: Record<string, unknown>): boolean {
  return Boolean(
    pickValue(record, [
      "team1",
      "team1_name",
      "team1.name",
      "team2",
      "team2_name",
      "team2.name",
      "opponent",
      "opponent_name",
      "opponentName",
      "score",
      "result",
      "scoreline",
      "event",
      "event_name",
      "event.name",
      "event_title",
      "date",
      "datetime",
      "time",
      "timestamp",
      "hour",
      "match_time",
      "played_at",
      "scheduled_at"
    ]) ?? pickString(record, ["link", "url"])
  );
}

function expandMatchItems(rawItems: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const record = asRecord(value);
    if (!record) {
      return;
    }

    const nested = pickArray(record, [
      "matches",
      "recent_matches",
      "recentResults",
      "results",
      "upcoming_matches",
      "upcomingMatches"
    ]);

    if (nested?.length) {
      for (const item of nested) {
        visit(item);
      }
      return;
    }

    if (looksLikeMatchRecord(record)) {
      out.push(record);
    }
  };

  for (const item of rawItems) {
    visit(item);
  }

  return out;
}

function buildPlayerName(record: Record<string, unknown>, fallbackName: string): string {
  const explicit = sanitizeHltvText(pickString(record, ["player_name", "playerName", "player"]));
  if (explicit) {
    return explicit;
  }

  const nick = sanitizeHltvText(pickString(record, ["nick"]));
  if (nick && fallbackName.toLowerCase().includes(nick.toLowerCase())) {
    return sanitizeHltvText(fallbackName) ?? fallbackName;
  }

  return nick ?? sanitizeHltvText(pickString(record, ["name"])) ?? sanitizeHltvText(fallbackName) ?? fallbackName;
}

function listToText(value: unknown, separator = ", "): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map((item) => {
      if (typeof item === "string") {
        return sanitizeHltvText(item);
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
  const direct = sanitizeHltvText(pickString(record, paths));
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
  const direct = sanitizeHltvText(pickString(record, ["score", "result", "scoreline"]));
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
  const record = unwrapPrimaryRecord(raw);
  if (!record) {
    return {
      id: fallback.id,
      name: fallback.name,
      slug: fallback.slug,
      country: fallback.country,
      rank: fallback.rank
    };
  }

  const link = pickString(record, ["link", "profile_link", "href", "url"]);
  const parsedLink = parseHltvEntityLink(link, "team");

  return {
    id: pickNumber(record, ["id", "team_id", "teamId"]) ?? fallback.id,
    name: sanitizeHltvText(pickString(record, ["name", "team_name", "teamName", "team"])) ?? fallback.name,
    slug: parsedLink.slug ?? fallback.slug,
    country: pickCountry(record, ["country", "country_code", "countryCode", "country.name", "country.code"]) ?? fallback.country,
    rank: pickLooseNumber(record, ["rank", "world_rank", "worldRank", "ranking"]) ?? fallback.rank,
    raw_summary: sanitizeHltvText(pickString(record, ["summary", "description"]))
  };
}

export function normalizePlayerProfile(
  raw: unknown,
  fallback: ResolvedPlayerEntity
): PlayerProfile {
  const record = unwrapPrimaryRecord(raw);
  if (!record) {
    return {
      id: fallback.id,
      name: fallback.name,
      slug: fallback.slug,
      team: fallback.team,
      country: fallback.country
    };
  }

  const link = pickString(record, ["profile_link", "link", "href", "url"]);
  const parsedLink = parseHltvEntityLink(link, "player");

  return {
    id: pickNumber(record, ["id", "player_id", "playerId"]) ?? fallback.id,
    name: buildPlayerName(record, fallback.name),
    slug: parsedLink.slug ?? fallback.slug,
    team:
      sanitizeHltvText(pickString(record, ["team", "team_name", "teamName", "current_team", "team.name"])) ??
      firstNamedValue(pickArray(record, ["team"])) ??
      fallback.team,
    country: pickCountry(record, ["country", "country_code", "countryCode", "country.name", "flag", "img"]) ?? fallback.country,
    raw_summary: sanitizeHltvText(pickString(record, ["summary", "description", "bio"]))
  };
}

export function normalizeOverview(...rawSources: unknown[]): Record<string, string | number> {
  const containers = compact(
    rawSources.flatMap((rawSource) => {
      const record = unwrapPrimaryRecord(rawSource);
      if (!record) {
        return [];
      }

      return compact([
        record,
        asRecord(record.summary),
        asRecord(pickValue(record, ["summary.summary_stats", "summary_stats"])),
        asRecord(record.player_statistics),
        asRecord(record.role_stats),
        asRecord(record.stats),
        flattenMetricArray(record.player_statistics),
        flattenMetricArray(record.stats),
        flattenMetricArray(pickValue(record, ["summary.summary_stats", "summary_stats"]))
      ]);
    })
  );

  if (!containers.length) {
    return {};
  }

  const keyMap: Record<string, string[]> = {
    rating: ["rating", "rating_2.0", "rating2", "rating 2.0", "rating_3.0", "rating3", "rating 3.0"],
    maps: ["maps", "maps_played"],
    kills: ["kills", "total_kills"],
    deaths: ["deaths", "total_deaths"],
    kd_diff: ["kd_diff", "kill_death_difference", "k-d diff", "kd diff"],
    headshots: ["headshots", "headshot_percentage", "hs"],
    adr: ["adr"],
    kast: ["kast"],
    impact: ["impact"],
    firepower: ["firepower"]
  };

  const entries = compact(
    Object.entries(keyMap).map(([normalizedKey, paths]) => {
      for (const container of containers) {
        const rawValue = pickValue(container, paths);
        if (typeof rawValue === "number" || typeof rawValue === "string") {
          return [normalizedKey, typeof rawValue === "string" ? sanitizeHltvText(rawValue) ?? rawValue.trim() : rawValue] as const;
        }
      }

      return undefined;
    })
  );

  return Object.fromEntries(entries);
}

export function normalizeMatches(rawItems: unknown[], perspective?: string): NormalizedMatch[] {
  return compact(
    expandMatchItems(rawItems).map((record) => {
      const link = pickString(record, ["link", "url"]);
      if (!record) {
        return undefined;
      }

      const team1 =
        unwrapEntityName(pickValue(record, ["team1"])) ??
        pickString(record, ["team1_name", "team1.name", "team1Name"]);
      const team2 =
        unwrapEntityName(pickValue(record, ["team2"])) ??
        pickString(record, ["team2_name", "team2.name", "team2Name"]);
      const team1Id = pickNumber(record, ["team1_id", "team1Id", "team1.id", "team1.team_id"]);
      const team2Id = pickNumber(record, ["team2_id", "team2Id", "team2.id", "team2.team_id"]);
      const opponent =
        pickString(record, ["opponent", "opponent_name", "opponentName"]) ??
        (perspective && team1 === perspective ? team2 : perspective && team2 === perspective ? team1 : undefined);
      const opponentId =
        pickNumber(record, ["opponent_id", "opponentId", "opponent.id", "opponent.team_id"]) ??
        (perspective && team1 === perspective ? team2Id : perspective && team2 === perspective ? team1Id : undefined);
      const scheduled = buildDateTimeCandidate(
        record,
        ["date", "scheduled_date", "match_date"],
        ["hour", "time", "match_time"],
        ["scheduled_at", "datetime", "timestamp"]
      );
      const playedAt = buildDateTimeCandidate(
        record,
        ["date", "played_date", "match_date"],
        ["hour", "time", "match_time"],
        ["played_at", "playedAt", "finished_at", "datetime", "timestamp"]
      );
      const result = parseOutcome(record, perspective);
      const score = parseScore(record);

      const hasOutcome = Boolean(score || playedAt);

      return {
        match_id: pickNumber(record, ["id", "match_id", "matchId"]) ?? parseMatchIdFromLink(link),
        team1_id: team1Id,
        team2_id: team2Id,
        opponent_id: opponentId,
        team1,
        team2,
        opponent,
        event: sanitizeHltvText(pickString(record, ["event", "event_name", "eventName", "event.name", "event_title"])),
        result: hasOutcome ? result ?? "unknown" : "scheduled",
        score,
        winner: sanitizeHltvText(pickString(record, ["winner", "winner_name", "winnerName", "winner.name"])),
        best_of: sanitizeHltvText(pickString(record, ["best_of", "bestOf", "format", "meta"])),
        played_at: hasOutcome ? playedAt : undefined,
        scheduled_at: hasOutcome ? undefined : scheduled,
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
    result: "scheduled",
    played_at: undefined,
    scheduled_at: item.scheduled_at ?? item.played_at
  }));
}

export function normalizeNews(rawItems: unknown[]): NewsItem[] {
  return compact(
    rawItems.map((item) => {
      const record = asRecord(item);
      if (!record) {
        return undefined;
      }

      const title = sanitizeHltvText(pickString(record, ["title", "headline", "name"]));
      if (!title) {
        return undefined;
      }

      return {
        title,
        link: sanitizeHltvText(pickString(record, ["link", "url"])),
        published_at: normalizeDateTime(
          pickString(record, ["published_at", "publishedAt", "date", "datetime", "timestamp"])
        ),
        summary_hint: sanitizeHltvText(pickString(record, ["summary", "description", "teaser"])),
        tag: sanitizeHltvText(pickString(record, ["tag", "topic", "category"]))
      };
    })
  );
}

function splitHighlightText(value: string | undefined): string[] {
  const normalized = sanitizeHltvText(value, { preserveNewlines: true });
  if (!normalized) {
    return [];
  }

  const stripHeader = (line: string): string =>
    line
      .replace(/^(?:mvp\s+winner\s+at|winner\s+at|won\s+at|trophy)\s*:?[\s-]*/i, "")
      .trim();

  const splitFlattenedEventList = (line: string): string[] => {
    const chunks = Array.from(line.matchAll(/.*?\b\d{4}\b(?=\s+[A-Z#]|$)/g))
      .map((match) => sanitizeHltvText(match[0]))
      .filter((item): item is string => Boolean(item));

    if (!chunks.length) {
      return line ? [line] : [];
    }

    const consumed = chunks.join(" ").length;
    const remainder = sanitizeHltvText(line.slice(consumed));
    return remainder ? [...chunks, remainder] : chunks;
  };

  const lines = normalized
    .split("\n")
    .map((line) => sanitizeHltvText(line))
    .map((line) => (line ? stripHeader(line) : undefined))
    .filter((line): line is string => Boolean(line));

  if (!lines.length) {
    return [];
  }

  if (lines.length === 1) {
    return splitFlattenedEventList(lines[0]);
  }

  return lines;
}

export function collectRecentHighlights(rawPlayer: unknown, rawOverview: unknown): string[] {
  const playerRecord = unwrapPrimaryRecord(rawPlayer);
  const normalizedOverview = normalizeOverview(rawOverview, rawPlayer);
  const notes = new Set<string>();

  const achievements = playerRecord ? pickArray(playerRecord, ["achievements", "highlights", "trophies"]) : undefined;
  for (const item of achievements ?? []) {
    if (typeof item === "string") {
      for (const highlight of splitHighlightText(item)) {
        notes.add(highlight);
      }
    } else {
      const record = asRecord(item);
      const rawValue = record ? pickString(record, ["title", "name", "text", "event", "achievement"]) : undefined;
      const fallbackValue = record
        ? [
            sanitizeHltvText(pickString(record, ["place"])),
            sanitizeHltvText(pickString(record, ["event"])),
            sanitizeHltvText(pickString(record, ["year"]))
          ]
            .filter(Boolean)
            .join(" ")
        : undefined;
      for (const highlight of splitHighlightText(rawValue ?? fallbackValue)) {
          notes.add(highlight);
      }
    }
  }

  const rating = normalizedOverview.rating;
  if (rating !== undefined) {
    notes.add(`近期 rating: ${rating}`);
  }

  return [...notes].slice(0, 5);
}
