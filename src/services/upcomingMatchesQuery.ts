import type { UpcomingMatchesQuery } from "../types/hltv.js";
import { sanitizeHltvText } from "../utils/strings.js";

const GENERIC_MATCH_FILTER_PATTERNS = [
  /^(?:all|\*|matches?|match|upcoming|upcoming matches|today|todays|today's|today matches|matches today|today schedule|schedule|fixtures?|games?)$/i,
  /^(?:全部|所有|比赛|赛程|未来比赛|未来赛程|今日比赛|今日赛程|今天比赛|今天赛程|即将开始的比赛|接下来的比赛)$/,
  /^(?:今天|今日)(?:有什么|有啥|有哪些)?(?:比赛|赛程)?$/
];

const MATCH_FILTER_EDGE_REPLACEMENTS: RegExp[] = [
  /^(?:today|todays|today's|upcoming)\b[\s:：-]*/i,
  /^[\s:：-]*\b(?:matches?|match|schedule|fixtures?|games?)\b[\s:：-]*/i,
  /^[\s:：-]*\bfor\b[\s:：-]*/i,
  /[\s:：-]*\b(?:today|todays|today's|upcoming)\b$/i,
  /[\s:：-]*\b(?:matches?|match|schedule|fixtures?|games?)\b$/i,
  /^(?:今天|今日|未来|即将|接下来)(?:有什么|有啥|有哪些)?/,
  /(?:有什么|有啥|有哪些)?(?:比赛|赛程)$/,
  /^(?:比赛|赛程)/,
  /^(?:全部|所有)/,
  /(?:全部|所有)$/
];

const PLACEHOLDER_UPCOMING_FILTER_VALUES = new Set([
  "x",
  "y",
  "z",
  "?",
  "-",
  "_",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "unknown",
  "tbd"
]);

export function isGenericMatchFilterText(value: string | undefined): boolean {
  const sanitized = sanitizeHltvText(value);
  if (!sanitized) {
    return true;
  }

  return GENERIC_MATCH_FILTER_PATTERNS.some((pattern) => pattern.test(sanitized));
}

export function normalizeUpcomingFilterText(value: string | undefined): string | undefined {
  const sanitized = sanitizeHltvText(value);
  if (!sanitized || isGenericMatchFilterText(sanitized)) {
    return undefined;
  }

  let current = sanitized;
  for (let index = 0; index < 3; index += 1) {
    const previous = current;
    for (const pattern of MATCH_FILTER_EDGE_REPLACEMENTS) {
      current = current.replace(pattern, " ").trim();
    }
    current = current.replace(/\s+/g, " ").trim();
    if (!current || current === previous) {
      break;
    }
  }

  if (!current || isGenericMatchFilterText(current)) {
    return undefined;
  }

  return current;
}

export function isPlaceholderUpcomingFilterText(value: string | undefined): boolean {
  const sanitized = sanitizeHltvText(value);
  if (!sanitized) {
    return true;
  }

  const normalized = sanitized.toLowerCase();
  return PLACEHOLDER_UPCOMING_FILTER_VALUES.has(normalized) || /^[a-z]$/.test(normalized);
}

export function isLikelyAutofilledUpcomingQuery(query: UpcomingMatchesQuery): boolean {
  const hasExplicitPlaceholderFields =
    Object.prototype.hasOwnProperty.call(query, "team") && Object.prototype.hasOwnProperty.call(query, "event");
  const normalizedTimezone = sanitizeHltvText(query.timezone)?.toUpperCase();
  const suspiciousSentinelPayload =
    hasExplicitPlaceholderFields &&
    query.limit === 1 &&
    query.days === 1 &&
    (normalizedTimezone === undefined || normalizedTimezone === "UTC");

  if (!suspiciousSentinelPayload) {
    return false;
  }

  return isPlaceholderUpcomingFilterText(query.team) && isPlaceholderUpcomingFilterText(query.event);
}
