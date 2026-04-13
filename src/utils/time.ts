export function nowIso(): string {
  return new Date().toISOString();
}

function parseStringDateTime(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed.replace(/\s+/, "T") + ":00");
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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

function formatDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function dateKeyInTimezone(value: string | undefined, timezone: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return formatDateKey(parsed, timezone);
}

export function todayDateKey(timezone: string, reference = new Date()): string {
  return formatDateKey(reference, timezone);
}

export function formatDateTime(
  value: string | undefined,
  timezone: string,
  locale = "zh-CN"
): string {
  if (!value) {
    return "未知时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
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
