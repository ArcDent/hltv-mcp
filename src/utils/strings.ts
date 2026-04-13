export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const HLTV_MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Krak贸w/g, "Kraków"],
  [/Malm枚/g, "Malmö"],
  [/贸/g, "ó"],
  [/枚/g, "ö"],
  [/Ã¡/g, "á"],
  [/Ã¤/g, "ä"],
  [/Ã©/g, "é"],
  [/Ã­/g, "í"],
  [/Ã³/g, "ó"],
  [/Ã¶/g, "ö"],
  [/Ã¼/g, "ü"],
  [/Ã±/g, "ñ"],
  [/Å‚/g, "ł"]
];

const ENGLISH_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

export function sanitizeHltvText(
  input: string | undefined,
  options: { preserveNewlines?: boolean } = {}
): string | undefined {
  if (!input) {
    return undefined;
  }

  let normalized = input
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\r\n?/g, "\n");

  for (const [pattern, replacement] of HLTV_MOJIBAKE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  if (options.preserveNewlines) {
    normalized = normalized
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    normalized = normalized.replace(/\s+/g, " ").trim();
  }

  return normalized || undefined;
}

export function toEnglishMonthName(month: number | string | undefined): string | undefined {
  if (month === undefined) {
    return undefined;
  }

  if (typeof month === "number") {
    return Number.isInteger(month) && month >= 1 && month <= 12 ? ENGLISH_MONTHS[month - 1] : undefined;
  }

  const normalized = sanitizeHltvText(month);
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? ENGLISH_MONTHS[parsed - 1] : undefined;
  }

  const lower = normalized.toLowerCase();
  const matched = ENGLISH_MONTHS.find(
    (candidate) => candidate.toLowerCase() === lower || candidate.toLowerCase().startsWith(lower)
  );

  return matched;
}

export function parseHltvEntityLink(
  link: string | undefined,
  entityType: "team" | "player"
): {
  id?: number;
  slug?: string;
  path?: string;
} {
  if (!link) {
    return {};
  }

  let normalized = link.trim();

  try {
    if (/^https?:\/\//i.test(normalized)) {
      normalized = new URL(normalized).pathname;
    }
  } catch {
    return {};
  }

  const match = normalized.match(new RegExp(`/${entityType}/(\\d+)/([^/?#]+)`, "i"));
  if (!match) {
    return {};
  }

  const id = Number(match[1]);
  if (!Number.isFinite(id)) {
    return {};
  }

  let slug = match[2];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Ignore decode failures and keep the raw slug.
  }

  return {
    id,
    slug,
    path: match[0]
  };
}

export function includesIgnoreCase(source: string | undefined, needle: string | undefined): boolean {
  if (!source || !needle) {
    return false;
  }

  return source.toLowerCase().includes(needle.toLowerCase());
}

export function equalsIgnoreCase(source: string | undefined, needle: string | undefined): boolean {
  if (!source || !needle) {
    return false;
  }

  return source.toLowerCase() === needle.toLowerCase();
}

export function truncate(input: string, maxLength: number): string {
  return input.length <= maxLength ? input : `${input.slice(0, maxLength - 1)}…`;
}

export function toTitle(input: string): string {
  if (!input) {
    return input;
  }

  return input.charAt(0).toUpperCase() + input.slice(1);
}
