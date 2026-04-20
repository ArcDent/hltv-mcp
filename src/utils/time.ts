export const FIXED_TIMEZONE = "Asia/Shanghai";
const FIXED_TIMEZONE_OFFSET_MINUTES = 8 * 60;

export function nowIso(): string {
  return new Date().toISOString();
}

function buildFixedTimezoneDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date | undefined {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - FIXED_TIMEZONE_OFFSET_MINUTES * 60_000;
  const parsed = new Date(utcMs);
  const fixedTimezoneMs = parsed.getTime() + FIXED_TIMEZONE_OFFSET_MINUTES * 60_000;
  const fixedTimezoneView = new Date(fixedTimezoneMs);

  if (
    fixedTimezoneView.getUTCFullYear() !== year ||
    fixedTimezoneView.getUTCMonth() !== month - 1 ||
    fixedTimezoneView.getUTCDate() !== day ||
    fixedTimezoneView.getUTCHours() !== hour ||
    fixedTimezoneView.getUTCMinutes() !== minute ||
    fixedTimezoneView.getUTCSeconds() !== second
  ) {
    return undefined;
  }

  return parsed;
}

function parseStringDateTime(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const fixedTimezoneMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (fixedTimezoneMatch) {
    const [, year, month, day, hour, minute, second] = fixedTimezoneMatch;
    return buildFixedTimezoneDate(
      Number(year),
      Number(month),
      Number(day),
      hour ? Number(hour) : 0,
      minute ? Number(minute) : 0,
      second ? Number(second) : 0
    );
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeDateTime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const maybeMs = value > 1_000_000_000_000 ? value : value * 1_000;
    return new Date(maybeMs).toISOString();
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = parseStringDateTime(value);
  return parsed ? parsed.toISOString() : undefined;
}

export function dateTimeToTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = parseStringDateTime(value);
  return parsed?.getTime();
}

function formatDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FIXED_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function dateKeyInFixedTimezone(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return formatDateKey(parsed);
}

export function todayDateKey(reference = new Date()): string {
  return formatDateKey(reference);
}

export function formatDateTime(value: string | undefined, locale = "zh-CN"): string {
  if (!value) {
    return "未知时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: FIXED_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function isFutureDate(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() > Date.now();
}
