type PlainRecord = Record<string, unknown>;

export function asRecord(value: unknown): PlainRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as PlainRecord)
    : undefined;
}

export function getPath(record: PlainRecord, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = record;

  for (const part of parts) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as PlainRecord)[part];
  }

  return current;
}

export function pickValue(record: PlainRecord, paths: string[]): unknown {
  for (const path of paths) {
    const value = getPath(record, path);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

export function pickString(record: PlainRecord, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

export function pickNumber(record: PlainRecord, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

export function pickArray(record: PlainRecord, paths: string[]): unknown[] | undefined {
  for (const path of paths) {
    const value = getPath(record, path);
    if (Array.isArray(value)) {
      return value;
    }
  }

  return undefined;
}

export function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const candidates = [
    "items",
    "results",
    "data",
    "matches",
    "news",
    "teams",
    "players",
    "events"
  ] as const;

  for (const key of candidates) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      return nested;
    }
  }

  return [];
}

export function compact<T>(items: Array<T | undefined | null | false>): T[] {
  return items.filter(Boolean) as T[];
}
