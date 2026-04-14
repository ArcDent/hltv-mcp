import type { MatchCommandParseQuery, MatchCommandParseResult, UpcomingMatchesQuery } from "../types/hltv.js";
import { sanitizeHltvText } from "../utils/strings.js";
import { normalizeUpcomingFilterText } from "./upcomingMatchesQuery.js";

const SEPARATOR_PATTERN = /\s*(?:[,，]|\b(?:at|for|in|on|with)\b|[|/])\s*/i;
const COUNT_PATTERN = /(?:^|\s)(?<value>\d{1,2})(?:\s*(?:场|个|days?|day))?(?:$|\s)/i;
const DAYS_PATTERN = /(?:^|\s)(?:近|未来|接下来|next)?\s*(?<value>\d{1,2})\s*(?:天|days?|day)(?:$|\s)/i;
const TEAM_PREFIX_PATTERN = /^(?:team|战队|队伍)\s*[:：-]?\s*/i;
const EVENT_PREFIX_PATTERN = /^(?:event|赛事|比赛|event name)\s*[:：-]?\s*/i;

const EVENT_HINT_PATTERNS = [
  /major/i,
  /masters/i,
  /open/i,
  /blast/i,
  /iem/i,
  /esl/i,
  /pro\s*league/i,
  /showdown/i,
  /challenger/i,
  /cup/i,
  /league/i,
  /tournament/i,
  /series/i,
  /finals?/i,
  /预选/i,
  /总决赛/i,
  /联赛/i,
  /杯/i,
  /锦标赛/i,
  /公开赛/i,
  /大师赛/i,
  /挑战赛/i,
  /职业联赛/i
] as const;

function isEventLikeText(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return EVENT_HINT_PATTERNS.some((pattern) => pattern.test(value));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = sanitizeHltvText(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function parsePositiveInt(rawValue: string | undefined, min: number, max: number): number | undefined {
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return undefined;
  }

  return parsed;
}

function splitTrailingLimitCandidate(segment: string): { text: string; limit?: number } {
  const matched = sanitizeHltvText(segment)?.match(/^(?<text>.+?)\s+(?<value>\d{1,2})$/);
  const text = sanitizeHltvText(matched?.groups?.text) ?? segment;
  const limit = parsePositiveInt(matched?.groups?.value, 1, 20);

  if (!matched || limit === undefined || !text || isEventLikeText(text)) {
    return { text: segment };
  }

  return { text, limit };
}

function extractValueByLabel(rawArgs: string, labels: string[]): string | undefined {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?:^|\\s)(?:${escapedLabels.join("|")})\\s*[:：=]\\s*(?<value>[^,，|]+(?:\\s+[^,，|]+)*)`,
    "i"
  );
  const matched = rawArgs.match(pattern);
  return sanitizeHltvText(matched?.groups?.value);
}

function stripExtractedLabels(rawArgs: string): string {
  return rawArgs
    .replace(/(?:^|\s)(?:team|战队|队伍)\s*[:：=]\s*[^,，|]+/gi, " ")
    .replace(/(?:^|\s)(?:event|赛事)\s*[:：=]\s*[^,，|]+/gi, " ")
    .replace(/(?:^|\s)(?:timezone|tz|时区)\s*[:：=]\s*[^,，|]+/gi, " ")
    .replace(/(?:^|\s)(?:limit|count|数量)\s*[:：=]\s*\d{1,2}/gi, " ")
    .replace(/(?:^|\s)(?:days|day|天数)\s*[:：=]\s*\d{1,2}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferFreeTextFields(rawArgs: string): { team?: string; event?: string; limit?: number } {
  const stripped = stripExtractedLabels(rawArgs);
  if (!stripped) {
    return {};
  }

  const rawSegments = uniqueStrings(
    stripped
      .split(SEPARATOR_PATTERN)
      .map((segment) => sanitizeHltvText(segment.replace(DAYS_PATTERN, " ")))
  );

  let inferredLimit: number | undefined;
  const cleanedSegments = rawSegments.flatMap((segment) => {
    const pureNumericLimit = segment.match(/^\d{1,2}$/)?.[0];
    const parsedPureNumericLimit = parsePositiveInt(pureNumericLimit, 1, 20);
    if (parsedPureNumericLimit !== undefined) {
      inferredLimit ??= parsedPureNumericLimit;
      return [];
    }

    const trailingLimitCandidate = splitTrailingLimitCandidate(segment);
    if (trailingLimitCandidate.limit !== undefined) {
      inferredLimit ??= trailingLimitCandidate.limit;
    }

    return [trailingLimitCandidate.text];
  });

  const segments = uniqueStrings(cleanedSegments);

  if (!segments.length) {
    return { limit: inferredLimit };
  }

  if (segments.length === 1) {
    const [value] = segments;
    return isEventLikeText(value) ? { event: value, limit: inferredLimit } : { team: value, limit: inferredLimit };
  }

  const event = segments.find((segment) => isEventLikeText(segment));
  const team = segments.find((segment) => segment !== event);
  return { team, event, limit: inferredLimit };
}

export function parseMatchCommandArgs(query: MatchCommandParseQuery): MatchCommandParseResult {
  const rawArgs = sanitizeHltvText(query.raw_args);
  const droppedFields: string[] = [];

  if (!rawArgs) {
    return {
      raw_args: rawArgs,
      payload: {},
      dropped_fields: droppedFields
    };
  }

  const labeledTeam = extractValueByLabel(rawArgs, ["team", "战队", "队伍"]);
  const labeledEvent = extractValueByLabel(rawArgs, ["event", "赛事"]);
  const labeledTimezone = extractValueByLabel(rawArgs, ["timezone", "tz", "时区"]);
  const labeledLimit = extractValueByLabel(rawArgs, ["limit", "count", "数量"]);
  const labeledDays = extractValueByLabel(rawArgs, ["days", "day", "天数"]);

  const inferred = inferFreeTextFields(rawArgs);
  const normalizedTeam = normalizeUpcomingFilterText(
    (labeledTeam ?? inferred.team)?.replace(TEAM_PREFIX_PATTERN, "").trim()
  );
  const normalizedEvent = normalizeUpcomingFilterText(
    (labeledEvent ?? inferred.event)?.replace(EVENT_PREFIX_PATTERN, "").trim()
  );
  const timezone = sanitizeHltvText(labeledTimezone ?? query.timezone);
  const limit = parsePositiveInt(labeledLimit, 1, 20) ?? inferred.limit;
  const days = parsePositiveInt(labeledDays ?? rawArgs.match(DAYS_PATTERN)?.groups?.value, 1, 30);

  if ((labeledTeam ?? inferred.team) && !normalizedTeam) {
    droppedFields.push("team");
  }

  if ((labeledEvent ?? inferred.event) && !normalizedEvent) {
    droppedFields.push("event");
  }

  const payload: UpcomingMatchesQuery = {};
  if (normalizedTeam) {
    payload.team = normalizedTeam;
  }
  if (normalizedEvent) {
    payload.event = normalizedEvent;
  }
  if (limit !== undefined) {
    payload.limit = limit;
  }
  if (days !== undefined) {
    payload.days = days;
  }
  if (timezone) {
    payload.timezone = timezone;
  }

  return {
    raw_args: rawArgs,
    payload,
    dropped_fields: droppedFields
  };
}
